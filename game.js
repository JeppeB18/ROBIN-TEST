(function () {
  'use strict';

  const WORLD_W = 800;
  const WORLD_H = 600;
  const DOG_SPEED = 3.2;
  const DOG_RADIUS = 22;
  const BALL_RADIUS = 8;
  const BASKET_RADIUS = 45;
  const ENEMY_RADIUS = 18;
  const ENEMY_SPEED = 2.1;
  const ENEMY_FLEE_SPEED = 2.8;
  const ENEMY_FLEE_MS = 1200;
  const STUN_DURATION_MS = 1800;
  const HIT_INVULN_MS = 1400;
  const NUM_LEVELS = 10;
  const DOG_START_X = WORLD_W / 2 - 70;
  const DOG_START_Y = WORLD_H / 2;

  const LEVELS = [
    { ballsRequired: 5,  timeLimit: 90,  treeCount: 4,  enemyCount: 0 },
    { ballsRequired: 8,  timeLimit: 85,  treeCount: 5,  enemyCount: 1 },
    { ballsRequired: 10, timeLimit: 80,  treeCount: 6,  enemyCount: 1 },
    { ballsRequired: 12, timeLimit: 75,  treeCount: 7,  enemyCount: 2 },
    { ballsRequired: 15, timeLimit: 70,  treeCount: 8,  enemyCount: 2 },
    { ballsRequired: 20, timeLimit: 65,  treeCount: 9,  enemyCount: 3 },
    { ballsRequired: 25, timeLimit: 60,  treeCount: 10, enemyCount: 3 },
    { ballsRequired: 35, timeLimit: 55,  treeCount: 11, enemyCount: 4 },
    { ballsRequired: 42, timeLimit: 50,  treeCount: 12, enemyCount: 4 },
    { ballsRequired: 50, timeLimit: 45,  treeCount: 14, enemyCount: 5 }
  ];

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dogImage = null;

  const dog = {
    x: DOG_START_X,
    y: DOG_START_Y,
    targetX: DOG_START_X,
    targetY: DOG_START_Y,
    carried: 0,
    angle: 0,
    stunUntil: 0,
    invulnerableUntil: 0
  };

  let balls = [];
  let trees = [];
  let enemies = [];
  let ballsInBasket = 0;
  let currentLevel = 1;
  let activeLevelConfig = LEVELS[0];
  const levelRetries = new Array(NUM_LEVELS).fill(0);
  let levelTimeLimit = 0;
  let levelStartTime = 0;
  let lastFrameTime = Date.now();
  let gamePhase = 'title';
  let levelCompleteUntil = 0;

  const basket = { x: WORLD_W / 2, y: WORLD_H / 2 };

  function resize() {
    const w = document.documentElement.clientWidth || window.innerWidth;
    const h = document.documentElement.clientHeight || window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    scale = Math.min(w / WORLD_W, h / WORLD_H);
    offsetX = (w - WORLD_W * scale) / 2;
    offsetY = (h - WORLD_H * scale) / 2;
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const hudScale = () => isMobile ? Math.max(1, Math.min(window.innerWidth / 400, 1.4)) : 1;

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
  }

  function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  function getLevelConfig() {
    return activeLevelConfig;
  }

  function treeCollisionRadius(t) {
    return (t.coneHeight || 40) * 0.85;
  }

  function overlapsTree(x, y, r) {
    return trees.some(t => dist(x, y, t.x, t.y) < r + treeCollisionRadius(t));
  }

  function isValidBallPosition(x, y, r) {
    if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return false;
    if (dist(x, y, basket.x, basket.y) < BASKET_RADIUS + 25) return false;
    if (overlapsTree(x, y, r)) return false;
    return true;
  }

  function circleVsCircle(x1, y1, r1, x2, y2, r2) {
    return dist(x1, y1, x2, y2) < r1 + r2;
  }

  function circleVsTree(x, y, r) {
    return trees.some(t => dist(x, y, t.x, t.y) < r + treeCollisionRadius(t));
  }

  function initTrees(treeCountOverride) {
    const cfg = getLevelConfig();
    trees = [];
    const treeCount = typeof treeCountOverride === 'number' ? treeCountOverride : cfg.treeCount;
    const padding = 70;
    const avoidBasket = 80;
    let tries = 0;
    while (trees.length < treeCount && tries < 500) {
      tries++;
      const x = padding + Math.random() * (WORLD_W - 2 * padding);
      const y = padding + Math.random() * (WORLD_H - 2 * padding);
      if (dist(x, y, basket.x, basket.y) < avoidBasket) continue;
      const coneH = 32 + Math.random() * 24;
      const coneW = coneH * 0.9;
      const overlap = trees.some(t => dist(x, y, t.x, t.y) < treeCollisionRadius(t) + coneW);
      if (!overlap) trees.push({ x, y, coneW, coneHeight: coneH });
    }
  }

  function initBalls() {
    const cfg = getLevelConfig();
    const need = Math.min(cfg.ballsRequired + 15, 65);
    balls = [];
    const padding = 75;
    let attempts = 0;
    const maxAttempts = need * 150;
    while (balls.length < need && attempts < maxAttempts) {
      attempts++;
      const x = padding + Math.random() * (WORLD_W - 2 * padding);
      const y = padding + Math.random() * (WORLD_H - 2 * padding);
      if (isValidBallPosition(x, y, BALL_RADIUS)) {
        balls.push({ x, y, collected: false });
      }
    }
  }

  function initEnemies(enemyCountOverride) {
    const cfg = getLevelConfig();
    enemies = [];
    const enemyCount = typeof enemyCountOverride === 'number' ? enemyCountOverride : cfg.enemyCount;
    const margin = 60;
    const positions = [
      [margin, margin], [WORLD_W - margin, margin],
      [WORLD_W - margin, WORLD_H - margin], [margin, WORLD_H - margin],
      [WORLD_W / 2, margin], [WORLD_W / 2, WORLD_H - margin]
    ];
    for (let i = 0; i < enemyCount; i++) {
      const p = positions[i % positions.length];
      enemies.push({
        x: p[0] + (Math.random() - 0.5) * 40,
        y: p[1] + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        fleeUntil: 0,
        fleeDx: 0,
        fleeDy: 0
      });
    }
  }

  function hasPath(startX, startY, endX, endY) {
    const grid = 24;
    const cols = Math.floor(WORLD_W / grid);
    const rows = Math.floor(WORLD_H / grid);
    const toCell = (v, max) => Math.max(0, Math.min(max - 1, Math.floor(v / grid)));
    const sx = toCell(startX, cols);
    const sy = toCell(startY, rows);
    const ex = toCell(endX, cols);
    const ey = toCell(endY, rows);
    const key = (x, y) => y * cols + x;
    const queue = [[sx, sy]];
    const seen = new Uint8Array(cols * rows);
    seen[key(sx, sy)] = 1;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      if (cx === ex && cy === ey) return true;
      for (let i = 0; i < dirs.length; i++) {
        const nx = cx + dirs[i][0];
        const ny = cy + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const idx = key(nx, ny);
        if (seen[idx]) continue;
        const wx = nx * grid + grid / 2;
        const wy = ny * grid + grid / 2;
        if (circleVsTree(wx, wy, DOG_RADIUS * 0.8)) continue;
        seen[idx] = 1;
        queue.push([nx, ny]);
      }
    }
    return false;
  }

  function isLevelLayoutPlayable(cfg) {
    if (!hasPath(DOG_START_X, DOG_START_Y, basket.x, basket.y)) return false;
    let reachableBalls = 0;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (hasPath(DOG_START_X, DOG_START_Y, b.x, b.y) && hasPath(b.x, b.y, basket.x, basket.y)) {
        reachableBalls++;
        if (reachableBalls >= cfg.ballsRequired) return true;
      }
    }
    return false;
  }

  function dropBallNearDog() {
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = DOG_RADIUS + BALL_RADIUS + 8 + Math.random() * 18;
      const x = dog.x + Math.cos(angle) * spread;
      const y = dog.y + Math.sin(angle) * spread;
      if (isValidBallPosition(x, y, BALL_RADIUS)) {
        balls.push({ x, y, collected: false });
        return true;
      }
    }
    return false;
  }

  function startLevel() {
    const base = LEVELS[Math.min(currentLevel - 1, LEVELS.length - 1)];
    const retries = levelRetries[currentLevel - 1] || 0;
    activeLevelConfig = {
      ballsRequired: base.ballsRequired,
      timeLimit: base.timeLimit + Math.min(20, retries * 4),
      treeCount: Math.max(3, base.treeCount - Math.floor(retries / 3)),
      enemyCount: Math.max(0, base.enemyCount - Math.floor(retries / 2))
    };
    const cfg = getLevelConfig();
    dog.x = DOG_START_X;
    dog.y = DOG_START_Y;
    dog.targetX = dog.x;
    dog.targetY = dog.y;
    dog.carried = 0;
    dog.stunUntil = 0;
    dog.invulnerableUntil = 0;
    ballsInBasket = 0;
    levelTimeLimit = cfg.timeLimit;
    levelStartTime = Date.now();
    lastFrameTime = levelStartTime;
    let attempts = 0;
    let generated = false;
    while (attempts < 14 && !generated) {
      attempts++;
      const treeCount = Math.max(2, cfg.treeCount - (attempts > 8 ? 1 : 0));
      const enemyCount = Math.max(0, cfg.enemyCount - (attempts > 10 ? 1 : 0));
      initTrees(treeCount);
      initBalls();
      initEnemies(enemyCount);
      generated = balls.length >= cfg.ballsRequired && isLevelLayoutPlayable(cfg);
    }
    if (!generated) {
      // Hard fallback: keep map sparse so level always remains finishable.
      initTrees(2);
      initBalls();
      initEnemies(Math.max(0, cfg.enemyCount - 2));
    }
    gamePhase = 'playing';
  }

  function moveDogTowardTarget() {
    if (Date.now() < dog.stunUntil) return;
    const dx = dog.targetX - dog.x;
    const dy = dog.targetY - dog.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return;
    dog.angle = Math.atan2(dy, dx);
    const step = Math.min(DOG_SPEED, d);
    const nx = dog.x + (dx / d) * step;
    const ny = dog.y + (dy / d) * step;
    if (!circleVsTree(nx, ny, DOG_RADIUS)) {
      dog.x = nx;
      dog.y = ny;
    } else {
      const nxOnly = dog.x + (dx / d) * step;
      if (!circleVsTree(nxOnly, dog.y, DOG_RADIUS)) dog.x = nxOnly;
      const ny2 = dog.y + (dy / d) * step;
      if (!circleVsTree(dog.x, ny2, DOG_RADIUS)) dog.y = ny2;
    }
    dog.x = Math.max(DOG_RADIUS, Math.min(WORLD_W - DOG_RADIUS, dog.x));
    dog.y = Math.max(DOG_RADIUS, Math.min(WORLD_H - DOG_RADIUS, dog.y));
  }

  function updateEnemies() {
    const now = Date.now();
    enemies.forEach(e => {
      let vx = 0;
      let vy = 0;
      if (now < e.fleeUntil) {
        vx = e.fleeDx * ENEMY_FLEE_SPEED;
        vy = e.fleeDy * ENEMY_FLEE_SPEED;
      } else if (now >= dog.stunUntil) {
        const dx = dog.x - e.x;
        const dy = dog.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d >= 1) {
          vx = (dx / d) * ENEMY_SPEED;
          vy = (dy / d) * ENEMY_SPEED;
        }
      }
      e.vx = vx;
      e.vy = vy;
      let nx = e.x + e.vx;
      let ny = e.y + e.vy;
      if (!circleVsTree(nx, ny, ENEMY_RADIUS)) {
        e.x = nx;
        e.y = ny;
      } else {
        if (!circleVsTree(e.x + e.vx, e.y, ENEMY_RADIUS)) e.x += e.vx;
        if (!circleVsTree(e.x, e.y + e.vy, ENEMY_RADIUS)) e.y += e.vy;
      }
      e.x = Math.max(ENEMY_RADIUS, Math.min(WORLD_W - ENEMY_RADIUS, e.x));
      e.y = Math.max(ENEMY_RADIUS, Math.min(WORLD_H - ENEMY_RADIUS, e.y));
      if (now < dog.invulnerableUntil) return;
      if (circleVsCircle(dog.x, dog.y, DOG_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        dog.stunUntil = now + STUN_DURATION_MS;
        dog.invulnerableUntil = now + HIT_INVULN_MS;
        const retreatDist = DOG_RADIUS + ENEMY_RADIUS + 35;
        const ex = (e.x - dog.x) || 1;
        const ey = (e.y - dog.y) || 1;
        const ed = Math.hypot(ex, ey) || 1;
        e.fleeDx = ex / ed;
        e.fleeDy = ey / ed;
        e.fleeUntil = now + ENEMY_FLEE_MS;
        e.x = dog.x + (ex / ed) * retreatDist;
        e.y = dog.y + (ey / ed) * retreatDist;
        e.x = Math.max(ENEMY_RADIUS, Math.min(WORLD_W - ENEMY_RADIUS, e.x));
        e.y = Math.max(ENEMY_RADIUS, Math.min(WORLD_H - ENEMY_RADIUS, e.y));
        if (dog.carried > 0) {
          const drop = Math.min(dog.carried, 3);
          dog.carried -= drop;
          for (let i = 0; i < drop; i++) {
            dropBallNearDog();
          }
        }
      }
    });
  }

  function collectBalls() {
    balls.forEach(b => {
      if (b.collected) return;
      if (circleVsCircle(dog.x, dog.y, DOG_RADIUS, b.x, b.y, BALL_RADIUS)) {
        b.collected = true;
        dog.carried++;
      }
    });
  }

  function depositBalls() {
    if (!circleVsCircle(dog.x, dog.y, DOG_RADIUS, basket.x, basket.y, BASKET_RADIUS)) return;
    if (dog.carried > 0) {
      ballsInBasket += dog.carried;
      dog.carried = 0;
      const cfg = getLevelConfig();
      if (ballsInBasket >= cfg.ballsRequired) {
        levelRetries[currentLevel - 1] = 0;
        gamePhase = 'levelComplete';
        levelCompleteUntil = Date.now() + 2200;
      }
    }
  }

  function drawGrass() {
    const green1 = '#2d5a27';
    const green2 = '#3d7a35';
    const tile = 25;
    for (let gy = 0; gy < WORLD_H + tile; gy += tile) {
      for (let gx = 0; gx < WORLD_W + tile; gx += tile) {
        ctx.fillStyle = (gx / tile + gy / tile) % 2 === 0 ? green1 : green2;
        ctx.fillRect(gx, gy, tile, tile);
      }
    }
  }

  function drawConiferTree(t) {
    const { x, y, coneW, coneHeight } = t;
    const trunkH = 14;
    const trunkW = 8;
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(x - trunkW / 2, y + coneHeight / 2, trunkW, trunkH);
    const layers = 5;
    const dark = '#0d3d0d';
    const mid = '#1a5c1a';
    const light = '#2d7a2d';
    for (let i = layers; i >= 0; i--) {
      const t0 = i / layers;
      const t1 = (i + 1) / layers;
      const y0 = y - coneHeight / 2 + t0 * coneHeight;
      const y1 = y - coneHeight / 2 + t1 * coneHeight;
      const w0 = coneW * (0.2 + 0.8 * t0);
      const w1 = coneW * (0.2 + 0.8 * t1);
      ctx.fillStyle = i === 0 ? light : i < 2 ? mid : dark;
      ctx.beginPath();
      ctx.moveTo(x - w0, y0);
      ctx.lineTo(x + w0, y0);
      ctx.lineTo(x + w1, y1);
      ctx.lineTo(x - w1, y1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(x - coneW * 0.3, y - coneHeight * 0.2);
    ctx.lineTo(x + coneW * 0.2, y + coneHeight * 0.3);
    ctx.lineTo(x - coneW * 0.2, y + coneHeight * 0.3);
    ctx.closePath();
    ctx.fill();
  }

  function drawTrees() {
    trees.forEach(t => drawConiferTree(t));
  }

  function drawBasket() {
    const bx = basket.x;
    const by = basket.y;
    ctx.fillStyle = '#8d6e63';
    ctx.beginPath();
    ctx.ellipse(bx, by, BASKET_RADIUS, BASKET_RADIUS * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a1887f';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#1b5e20';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Drop here', bx, by);
  }

  function drawBalls() {
    balls.forEach(b => {
      if (b.collected) return;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + b.x * 0.1;
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(a) * 4, b.y + Math.sin(a) * 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawEnemies() {
    const now = Date.now();
    enemies.forEach(e => {
      const pulse = 0.9 + 0.1 * Math.sin(now * 0.005);
      ctx.fillStyle = '#d32f2f';
      ctx.beginPath();
      ctx.arc(e.x, e.y, ENEMY_RADIUS * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b71c1c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', e.x, e.y);
    });
  }

  function drawDog() {
    const stun = Date.now() < dog.stunUntil;
    if (stun) {
      ctx.globalAlpha = 0.5 + 0.25 * Math.sin(Date.now() * 0.02);
    }
    ctx.save();
    ctx.translate(dog.x, dog.y);
    ctx.rotate(dog.angle);
    if (dogImage && dogImage.complete && dogImage.naturalWidth) {
      const w = DOG_RADIUS * 2.4;
      const h = DOG_RADIUS * 2.2;
      ctx.drawImage(dogImage, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(0, 0, DOG_RADIUS * 1.2, DOG_RADIUS, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-DOG_RADIUS * 0.9, -DOG_RADIUS * 0.5, 9, 11, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-DOG_RADIUS * 0.9, DOG_RADIUS * 0.5, 9, 11, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b5b4f';
      ctx.fillRect(-6, -4, 12, 8);
    }
    ctx.restore();
    if (stun) ctx.globalAlpha = 1;
    if (dog.carried > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(dog.carried, dog.x, dog.y - DOG_RADIUS - 10);
    }
  }

  function drawHUD() {
    const cfg = getLevelConfig();
    const s = hudScale();
    const barH = Math.round(44 * s);
    const pad = Math.round(14 * s);
    const fSize = Math.round(18 * s);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, barH);
    ctx.fillStyle = '#fff';
    ctx.font = fSize + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Level ' + currentLevel + '  Balls: ' + ballsInBasket + ' / ' + cfg.ballsRequired, offsetX + pad, offsetY + barH / 2);
    const levelTimeRemaining = levelTimeLimit - (Date.now() - levelStartTime) / 1000;
    const secs = Math.max(0, Math.ceil(levelTimeRemaining));
    ctx.fillStyle = levelTimeRemaining <= 10 ? '#ffcdd2' : '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(secs + 's', offsetX + WORLD_W * scale - pad, offsetY + barH / 2);
    if (dog.carried > 0) {
      ctx.fillStyle = '#fff';
      ctx.fillText('Carrying: ' + dog.carried, offsetX + WORLD_W * scale - pad, offsetY + barH - 4);
    }
    ctx.restore();
  }

  function drawTitle() {
    const s = hudScale();
    const titleSize = Math.round(36 * s);
    const bodySize = Math.round(18 * s);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + titleSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("Zoey's Golf Adventures", canvas.width / 2, canvas.height / 2 - 50);
    ctx.font = bodySize + 'px sans-serif';
    ctx.fillText('Collect balls. Drop in basket. Avoid the enemies!', canvas.width / 2, canvas.height / 2 - 10);
    ctx.fillText('10 levels. Tap to start.', canvas.width / 2, canvas.height / 2 + 30);
    ctx.restore();
  }

  function drawLevelComplete() {
    const s = hudScale();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#c8e6c9';
    ctx.font = 'bold ' + Math.round(28 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Level ' + currentLevel + ' complete!', canvas.width / 2, canvas.height / 2 - 30);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(16 * s) + 'px sans-serif';
    ctx.fillText(currentLevel < NUM_LEVELS ? 'Next level in 2 sec...' : 'You won!', canvas.width / 2, canvas.height / 2 + 15);
    ctx.restore();
  }

  function drawGameOver() {
    const s = hudScale();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffcdd2';
    ctx.font = 'bold ' + Math.round(32 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Time\'s up!', canvas.width / 2, canvas.height / 2 - 30);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(18 * s) + 'px sans-serif';
    ctx.fillText('Tap to retry level ' + currentLevel, canvas.width / 2, canvas.height / 2 + 20);
    ctx.restore();
  }

  function drawGameWon() {
    const s = hudScale();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#c8e6c9';
    ctx.font = 'bold ' + Math.round(36 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You won!', canvas.width / 2, canvas.height / 2 - 40);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(20 * s) + 'px sans-serif';
    ctx.fillText('All 10 levels complete.', canvas.width / 2, canvas.height / 2);
    ctx.fillText('Tap to play again', canvas.width / 2, canvas.height / 2 + 45);
    ctx.restore();
  }

  function render() {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    drawGrass();
    drawTrees();
    drawBasket();
    drawBalls();
    drawEnemies();
    drawDog();
    if (gamePhase === 'playing') drawHUD();
    ctx.restore();
    if (gamePhase === 'title') drawTitle();
    else if (gamePhase === 'levelComplete') drawLevelComplete();
    else if (gamePhase === 'gameOver') drawGameOver();
    else if (gamePhase === 'gameWon') drawGameWon();
  }

  function update() {
    if (gamePhase === 'title') {
      lastFrameTime = Date.now();
      return;
    }
    if (gamePhase === 'levelComplete') {
      lastFrameTime = Date.now();
      if (Date.now() >= levelCompleteUntil) {
        if (currentLevel >= NUM_LEVELS) {
          gamePhase = 'gameWon';
        } else {
          currentLevel++;
          startLevel();
        }
      }
      return;
    }
    if (gamePhase === 'gameOver' || gamePhase === 'gameWon') {
      lastFrameTime = Date.now();
      return;
    }

    const now = Date.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    if (now < dog.stunUntil) {
      // Keep the timer fair while player is fully disabled by stun.
      levelStartTime += dt;
    }

    const levelTimeRemaining = levelTimeLimit - (Date.now() - levelStartTime) / 1000;
    if (levelTimeRemaining <= 0) {
      gamePhase = 'gameOver';
      return;
    }

    moveDogTowardTarget();
    updateEnemies();
    collectBalls();
    depositBalls();
  }

  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  function setTarget(clientX, clientY) {
    const w = screenToWorld(clientX, clientY);
    dog.targetX = Math.max(DOG_RADIUS, Math.min(WORLD_W - DOG_RADIUS, w.x));
    dog.targetY = Math.max(DOG_RADIUS, Math.min(WORLD_H - DOG_RADIUS, w.y));
  }

  function onPointer(e) {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    if (gamePhase === 'title') {
      gamePhase = 'playing';
      currentLevel = 1;
      startLevel();
      return;
    }
    if (gamePhase === 'gameOver') {
      levelRetries[currentLevel - 1] = (levelRetries[currentLevel - 1] || 0) + 1;
      startLevel();
      gamePhase = 'playing';
      return;
    }
    if (gamePhase === 'gameWon') {
      currentLevel = 1;
      startLevel();
      return;
    }
    if (gamePhase === 'playing') setTarget(clientX, clientY);
  }

  canvas.addEventListener('touchstart', onPointer, { passive: false });
  canvas.addEventListener('touchmove', onPointer, { passive: false });
  canvas.addEventListener('mousedown', onPointer);

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 100); });

  dogImage = new Image();
  dogImage.src = 'assets/dog.png';

  resize();
  gamePhase = 'title';
  gameLoop();
})();
