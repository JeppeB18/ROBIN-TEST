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
  const TREE_SLOW_FACTOR = 0.18;
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
  let grassCache = null;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

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
  let particles = [];
  let ballsInBasket = 0;
  let currentLevel = 1;
  let activeLevelConfig = LEVELS[0];
  const levelRetries = new Array(NUM_LEVELS).fill(0);
  let levelTimeLimit = 0;
  let levelStartTime = 0;
  let lastFrameTime = Date.now();
  let gamePhase = 'title';
  let levelCompleteUntil = 0;
  let levelCompleteData = { timeRemaining: 0, bestRemaining: 0 };
  let screenShake = 0;
  let pauseBtnRect = { x: 0, y: 0, w: 44, h: 44 };

  const basket = { x: WORLD_W / 2, y: WORLD_H / 2 };

  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  function playTone(freq, duration, type) {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = type || 'sine';
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }
  function playSound(name) {
    initAudio();
    if (!audioCtx || audioCtx.state === 'suspended') return;
    if (name === 'collect') {
      playTone(880, 0.08, 'sine');
      playTone(1320, 0.06, 'sine');
    } else if (name === 'deposit') {
      playTone(523, 0.1, 'sine');
      playTone(659, 0.1, 'sine');
      playTone(784, 0.12, 'sine');
    } else if (name === 'hit') {
      playTone(200, 0.15, 'sawtooth');
      playTone(150, 0.2, 'square');
    } else if (name === 'levelComplete') {
      playTone(523, 0.12, 'sine');
      playTone(659, 0.12, 'sine');
      playTone(784, 0.12, 'sine');
      playTone(1047, 0.2, 'sine');
    } else if (name === 'gameOver') {
      playTone(200, 0.2, 'sawtooth');
      playTone(180, 0.25, 'square');
    } else if (name === 'gameWon') {
      playTone(523, 0.15, 'sine');
      playTone(659, 0.15, 'sine');
      playTone(784, 0.15, 'sine');
      playTone(1047, 0.2, 'sine');
      playTone(1319, 0.25, 'sine');
    }
  }

  function haptic(type) {
    if (!navigator.vibrate) return;
    try {
      if (type === 'collect') navigator.vibrate(10);
      else if (type === 'deposit') navigator.vibrate(15);
      else if (type === 'hit') navigator.vibrate([30, 20, 30]);
      else if (type === 'levelComplete') navigator.vibrate([20, 30, 20, 30]);
      else if (type === 'gameOver') navigator.vibrate([50, 30, 50]);
      else if (type === 'gameWon') navigator.vibrate([20, 20, 20, 40, 40]);
    } catch (_) {}
  }

  const STORAGE_KEY = 'zoeyGolfScores';
  function loadScores() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s) : { bestTimeRemaining: {}, totalWins: 0 };
    } catch (_) { return { bestTimeRemaining: {}, totalWins: 0 }; }
  }
  function saveScore(level, timeRemaining) {
    const scores = loadScores();
    const prev = scores.bestTimeRemaining[level] || 0;
    if (timeRemaining > prev) {
      scores.bestTimeRemaining[level] = timeRemaining;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); } catch (_) {}
    }
  }
  function saveWin() {
    const scores = loadScores();
    scores.totalWins = (scores.totalWins || 0) + 1;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); } catch (_) {}
  }

  function resize() {
    const vp = window.visualViewport;
    const w = vp ? vp.width : (window.innerWidth || document.documentElement.clientWidth);
    const h = vp ? vp.height : (window.innerHeight || document.documentElement.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    scale = Math.min(pw / WORLD_W, ph / WORLD_H);
    offsetX = (pw - WORLD_W * scale) / 2;
    offsetY = (ph - WORLD_H * scale) / 2;
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const hudScale = () => isMobile ? Math.max(1, Math.min(window.innerWidth / 400, 1.4)) : 1;

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const px = (sx / rect.width) * canvas.width;
    const py = (sy / rect.height) * canvas.height;
    return { x: (px - offsetX) / scale, y: (py - offsetY) / scale };
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
    const inTree = circleVsTree(dog.x, dog.y, DOG_RADIUS);
    const speedMult = inTree ? TREE_SLOW_FACTOR : 1;
    const step = Math.min(DOG_SPEED * speedMult, d);
    const nx = dog.x + (dx / d) * step;
    const ny = dog.y + (dy / d) * step;
    dog.x = Math.max(DOG_RADIUS, Math.min(WORLD_W - DOG_RADIUS, nx));
    dog.y = Math.max(DOG_RADIUS, Math.min(WORLD_H - DOG_RADIUS, ny));
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
      const inTree = circleVsTree(e.x, e.y, ENEMY_RADIUS);
      const speedMult = inTree ? TREE_SLOW_FACTOR : 1;
      e.x += e.vx * speedMult;
      e.y += e.vy * speedMult;
      e.x = Math.max(ENEMY_RADIUS, Math.min(WORLD_W - ENEMY_RADIUS, e.x));
      e.y = Math.max(ENEMY_RADIUS, Math.min(WORLD_H - ENEMY_RADIUS, e.y));
      if (now < dog.invulnerableUntil) return;
      if (circleVsCircle(dog.x, dog.y, DOG_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        dog.stunUntil = now + STUN_DURATION_MS;
        dog.invulnerableUntil = now + HIT_INVULN_MS;
        screenShake = 12;
        playSound('hit');
        haptic('hit');
        spawnParticles(dog.x, dog.y, 15, '#ff6b6b');
        spawnParticles(dog.x, dog.y, 10, '#ffaa00');
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

  function spawnParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 1,
        decay: 0.015 + Math.random() * 0.01,
        r: 2 + Math.random() * 3,
        color: color || '#fff'
      });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(Math.floor(p.x), Math.floor(p.y), p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function collectBalls() {
    balls.forEach(b => {
      if (b.collected) return;
      if (circleVsCircle(dog.x, dog.y, DOG_RADIUS, b.x, b.y, BALL_RADIUS)) {
        b.collected = true;
        dog.carried++;
        spawnParticles(b.x, b.y, 8, '#ffd700');
        spawnParticles(b.x, b.y, 6, '#fff');
        playSound('collect');
        haptic('collect');
      }
    });
  }

  function depositBalls() {
    if (!circleVsCircle(dog.x, dog.y, DOG_RADIUS, basket.x, basket.y, BASKET_RADIUS)) return;
    if (dog.carried > 0) {
      ballsInBasket += dog.carried;
      spawnParticles(basket.x, basket.y, dog.carried * 3, '#4caf50');
      spawnParticles(basket.x, basket.y, dog.carried * 2, '#ffd700');
      dog.carried = 0;
      playSound('deposit');
      haptic('deposit');
      const cfg = getLevelConfig();
      if (ballsInBasket >= cfg.ballsRequired) {
        const timeRem = Math.max(0, levelTimeLimit - (Date.now() - levelStartTime) / 1000);
        const prevBest = loadScores().bestTimeRemaining[currentLevel] || 0;
        levelCompleteData = { timeRemaining: timeRem, previousBest: prevBest };
        saveScore(currentLevel, timeRem);
        levelRetries[currentLevel - 1] = 0;
        gamePhase = 'levelComplete';
        levelCompleteUntil = Date.now() + 2200;
        spawnParticles(basket.x, basket.y, 30, '#4caf50');
        playSound('levelComplete');
        haptic('levelComplete');
      }
    }
  }

  function initGrassCache() {
    if (grassCache) return;
    grassCache = document.createElement('canvas');
    grassCache.width = WORLD_W;
    grassCache.height = WORLD_H;
    const g = grassCache.getContext('2d');
    const grad = g.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 100, WORLD_W / 2, WORLD_H / 2, WORLD_H);
    grad.addColorStop(0, '#3d7a35');
    grad.addColorStop(0.5, '#2d5a27');
    grad.addColorStop(1, '#1d4a17');
    g.fillStyle = grad;
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    const green1 = 'rgba(45, 90, 39, 0.35)';
    const tile = 25;
    g.fillStyle = green1;
    for (let gy = 0; gy < WORLD_H + tile; gy += tile) {
      for (let gx = 0; gx < WORLD_W + tile; gx += tile) {
        if ((gx / tile + gy / tile) % 2 === 0) {
          g.fillRect(gx, gy, tile, tile);
        }
      }
    }
  }

  function drawGrass() {
    if (!grassCache) initGrassCache();
    ctx.drawImage(grassCache, 0, 0);
  }

  function drawConiferTree(t) {
    const { x, y, coneW, coneHeight } = t;
    const trunkH = 14;
    const trunkW = 8;
    const tx = Math.floor(x - trunkW / 2);
    const ty = Math.floor(y + coneHeight / 2);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(tx, ty, trunkW, trunkH);
    const layers = 5;
    const dark = '#0a2e0a';
    const mid = '#0f4a0f';
    const light = '#1a6b1a';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    for (let i = layers; i >= 0; i--) {
      const t0 = i / layers;
      const t1 = (i + 1) / layers;
      const y0 = y - coneHeight / 2 + t0 * coneHeight;
      const y1 = y - coneHeight / 2 + t1 * coneHeight;
      const w0 = coneW * (0.2 + 0.8 * t0);
      const w1 = coneW * (0.2 + 0.8 * t1);
      ctx.fillStyle = i === 0 ? light : i < 2 ? mid : dark;
      ctx.beginPath();
      ctx.moveTo(Math.floor(x - w0), Math.floor(y0));
      ctx.lineTo(Math.floor(x + w0), Math.floor(y0));
      ctx.lineTo(Math.floor(x + w1), Math.floor(y1));
      ctx.lineTo(Math.floor(x - w1), Math.floor(y1));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(Math.floor(x - coneW * 0.3), Math.floor(y - coneHeight * 0.2));
    ctx.lineTo(Math.floor(x + coneW * 0.2), Math.floor(y + coneHeight * 0.3));
    ctx.lineTo(Math.floor(x - coneW * 0.2), Math.floor(y + coneHeight * 0.3));
    ctx.closePath();
    ctx.fill();
  }

  function drawTrees() {
    trees.forEach(t => drawConiferTree(t));
  }

  function drawBasket() {
    const bx = Math.floor(basket.x);
    const by = Math.floor(basket.y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(bx, by + 4, BASKET_RADIUS + 2, (BASKET_RADIUS + 2) * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createRadialGradient(bx - 10, by - 5, 5, bx, by, BASKET_RADIUS);
    grad.addColorStop(0, '#a1887f');
    grad.addColorStop(0.6, '#8d6e63');
    grad.addColorStop(1, '#5d4037');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(bx, by, BASKET_RADIUS, BASKET_RADIUS * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Drop here', bx, by);
  }

  function drawBalls() {
    const t = Date.now() * 0.003;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    balls.forEach(b => {
      if (b.collected) return;
      ctx.beginPath();
      ctx.arc(Math.floor(b.x), Math.floor(b.y + 2), BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
    const visibleBalls = balls.filter(b => !b.collected);
    visibleBalls.forEach(b => {
      const pulse = 0.95 + 0.05 * Math.sin(t + b.x * 0.1);
      const r = BALL_RADIUS * pulse;
      const grad = ctx.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, r);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.7, '#f5f5f5');
      grad.addColorStop(1, '#e0e0e0');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(Math.floor(b.x), Math.floor(b.y), r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    visibleBalls.forEach(b => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + b.x * 0.1;
        ctx.beginPath();
        ctx.arc(Math.floor(b.x + Math.cos(a) * 4), Math.floor(b.y + Math.sin(a) * 4), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawEnemies() {
    const now = Date.now();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    enemies.forEach(e => {
      ctx.beginPath();
      ctx.arc(Math.floor(e.x), Math.floor(e.y + 3), ENEMY_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = '#7f0000';
    ctx.lineWidth = 2;
    enemies.forEach(e => {
      const pulse = 0.9 + 0.1 * Math.sin(now * 0.005);
      const r = ENEMY_RADIUS * pulse;
      const grad = ctx.createRadialGradient(e.x - 4, e.y - 4, 2, e.x, e.y, r);
      grad.addColorStop(0, '#ff5252');
      grad.addColorStop(0.6, '#d32f2f');
      grad.addColorStop(1, '#b71c1c');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(Math.floor(e.x), Math.floor(e.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    enemies.forEach(e => ctx.fillText('!', Math.floor(e.x), Math.floor(e.y)));
  }

  function drawDog() {
    const stun = Date.now() < dog.stunUntil;
    if (stun) ctx.globalAlpha = 0.5 + 0.25 * Math.sin(Date.now() * 0.02);
    const r = DOG_RADIUS * 1.15;
    const dx = Math.floor(dog.x);
    const dy = Math.floor(dog.y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(dx, dy + 3, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4a574';
    ctx.beginPath();
    ctx.ellipse(dx, Math.floor(dy + r * 0.4), r * 0.35, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d2d2d';
    ctx.beginPath();
    ctx.arc(Math.floor(dx - r * 0.25), Math.floor(dy - r * 0.15), r * 0.12, 0, Math.PI * 2);
    ctx.arc(Math.floor(dx + r * 0.25), Math.floor(dy - r * 0.15), r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(dx, Math.floor(dy + r * 0.1), r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (stun) ctx.globalAlpha = 1;
    if (dog.carried > 0) {
      const bounce = 1 + 0.08 * Math.sin(Date.now() * 0.01);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(dx, Math.floor(dy - DOG_RADIUS - 9), 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(dx, Math.floor(dy - DOG_RADIUS - 10), 7 * bounce, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dog.carried, dx, Math.floor(dy - DOG_RADIUS - 10));
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
    const btnSize = Math.round(36 * s);
    pauseBtnRect.w = btnSize;
    pauseBtnRect.h = btnSize;
    pauseBtnRect.x = offsetX + WORLD_W * scale - btnSize - pad;
    const levelTimeRemaining = levelTimeLimit - (Date.now() - levelStartTime) / 1000;
    const secs = Math.max(0, Math.ceil(levelTimeRemaining));
    ctx.fillStyle = levelTimeRemaining <= 10 ? '#ff6b6b' : '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(secs + 's', pauseBtnRect.x - 8, offsetY + barH / 2);
    if (dog.carried > 0) {
      ctx.fillStyle = '#fff';
      ctx.fillText('Carrying: ' + dog.carried, pauseBtnRect.x - 8, offsetY + barH - 4);
    }
    pauseBtnRect.y = offsetY + (barH - btnSize) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(pauseBtnRect.x + btnSize / 2, pauseBtnRect.y + btnSize / 2, btnSize / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    const barW = 4;
    const barGap = 6;
    ctx.fillRect(pauseBtnRect.x + btnSize / 2 - barW - barGap / 2, pauseBtnRect.y + 10, barW, btnSize - 20);
    ctx.fillRect(pauseBtnRect.x + btnSize / 2 + barGap / 2, pauseBtnRect.y + 10, barW, btnSize - 20);
    ctx.restore();
  }

  function drawPauseOverlay() {
    const s = hudScale();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.round(32 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Paused', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = Math.round(18 * s) + 'px sans-serif';
    ctx.fillText('Tap to resume', canvas.width / 2, canvas.height / 2 + 25);
    ctx.restore();
  }

  function isInPauseButton(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = (clientX - rect.left) / rect.width * canvas.width;
    const py = (clientY - rect.top) / rect.height * canvas.height;
    const r = pauseBtnRect;
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
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
    ctx.fillStyle = '#81c784';
    ctx.font = 'bold ' + Math.round(28 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Level ' + currentLevel + ' complete!', canvas.width / 2, canvas.height / 2 - 30);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(16 * s) + 'px sans-serif';
    ctx.fillText(currentLevel < NUM_LEVELS ? 'Next level in 2 sec...' : 'You won!', canvas.width / 2, canvas.height / 2 + 15);
    const isNewBest = levelCompleteData.previousBest === 0 || levelCompleteData.timeRemaining >= levelCompleteData.previousBest;
    ctx.font = Math.round(14 * s) + 'px sans-serif';
    ctx.fillText(Math.round(levelCompleteData.timeRemaining) + 's left', canvas.width / 2, canvas.height / 2 + 45);
    if (isNewBest) {
      ctx.fillStyle = '#ffd700';
      ctx.fillText('New best!', canvas.width / 2, canvas.height / 2 + 65);
    }
    ctx.restore();
  }

  function drawGameOver() {
    const s = hudScale();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff6b6b';
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
    ctx.fillStyle = '#81c784';
    ctx.font = 'bold ' + Math.round(36 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You won!', canvas.width / 2, canvas.height / 2 - 40);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(20 * s) + 'px sans-serif';
    ctx.fillText('All 10 levels complete.', canvas.width / 2, canvas.height / 2);
    const wins = loadScores().totalWins || 0;
    ctx.fillText('Total wins: ' + wins, canvas.width / 2, canvas.height / 2 + 30);
    ctx.fillText('Tap to play again', canvas.width / 2, canvas.height / 2 + 55);
    ctx.restore();
  }

  function render() {
    ctx.save();
    let shakeX = 0, shakeY = 0;
    if (screenShake > 0) {
      shakeX = (Math.random() - 0.5) * screenShake;
      shakeY = (Math.random() - 0.5) * screenShake;
      screenShake *= 0.85;
      if (screenShake < 0.5) screenShake = 0;
    }
    ctx.translate(offsetX + shakeX, offsetY + shakeY);
    ctx.scale(scale, scale);
    drawGrass();
    drawTrees();
    drawBasket();
    drawBalls();
    drawParticles();
    drawEnemies();
    drawDog();
    if (gamePhase === 'playing') drawHUD();
    ctx.restore();
    if (gamePhase === 'title') drawTitle();
    else if (gamePhase === 'levelComplete') drawLevelComplete();
    else if (gamePhase === 'gameOver') drawGameOver();
    else if (gamePhase === 'gameWon') drawGameWon();
    else if (gamePhase === 'paused') drawPauseOverlay();
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
          saveWin();
          playSound('gameWon');
          haptic('gameWon');
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
    if (gamePhase === 'paused') {
      const now = Date.now();
      levelStartTime += now - lastFrameTime;
      lastFrameTime = now;
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
      playSound('gameOver');
      haptic('gameOver');
      return;
    }

    moveDogTowardTarget();
    updateEnemies();
    collectBalls();
    depositBalls();
    updateParticles();
  }

  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  function tryFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(function () {});
    }
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
      initAudio();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      tryFullscreen();
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
    if (gamePhase === 'paused') {
      gamePhase = 'playing';
      return;
    }
    if (gamePhase === 'playing') {
      if (isInPauseButton(clientX, clientY)) {
        gamePhase = 'paused';
      } else {
        setTarget(clientX, clientY);
      }
      return;
    }
  }

  canvas.addEventListener('touchstart', onPointer, { passive: false });
  canvas.addEventListener('touchmove', onPointer, { passive: false });
  canvas.addEventListener('mousedown', onPointer);

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }

  resize();
  gamePhase = 'title';
  gameLoop();
})();
