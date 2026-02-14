(function () {
  'use strict';

  const WORLD_W = 800;
  const WORLD_H = 600;
  const DOG_SPEED = 3.2;
  const DOG_RADIUS = 22;
  const BALL_RADIUS = 8;
  const TIME_BALL_RADIUS = 9;
  const TIME_BALL_BONUS = 10;
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
  let heroImg = null;

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
  let timeBalls = [];
  let trees = [];
  let enemies = [];
  let particles = [];
  let ballsInBasket = 0;
  let currentLevel = 1;
  let activeLevelConfig = LEVELS[0];
  let levelRetries = {};
  let levelTimeLimit = 0;
  let levelStartTime = 0;
  let lastFrameTime = Date.now();
  let gamePhase = 'title';
  let levelCompleteData = { timeRemaining: 0, previousBest: 0 };
  let screenShake = 0;
  let pauseBtnRect = { x: 0, y: 0, w: 44, h: 44 };

  const basket = { x: WORLD_W / 2, y: WORLD_H / 2 };

  let audioCtx = null;
  let audioUnlocked = false;
  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  function unlockAudio(cb) {
    initAudio();
    if (!audioCtx) { if (cb) cb(); return; }
    if (audioUnlocked && audioCtx.state === 'running') { if (cb) cb(); return; }
    audioCtx.resume().then(function () {
      if (!audioUnlocked) {
        try {
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          osc.connect(g);
          g.connect(audioCtx.destination);
          osc.frequency.value = 100;
          g.gain.setValueAtTime(0.001, audioCtx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.01);
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 0.01);
        } catch (_) {}
        audioUnlocked = true;
      }
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
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
    if (!audioCtx || (!audioUnlocked && audioCtx.state === 'suspended')) return;
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
  function saveBestLevel(level) {
    const scores = loadScores();
    const prev = scores.bestLevel || 0;
    if (level > prev) {
      scores.bestLevel = level;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); } catch (_) {}
    }
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
    const need = Math.min(cfg.ballsRequired + 15, 85);
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

  function isValidTimeBallPosition(x, y) {
    if (!isValidBallPosition(x, y, TIME_BALL_RADIUS)) return false;
    const minDist = BALL_RADIUS + TIME_BALL_RADIUS + 6;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.collected && dist(x, y, b.x, b.y) < minDist) return false;
    }
    for (let i = 0; i < timeBalls.length; i++) {
      if (dist(x, y, timeBalls[i].x, timeBalls[i].y) < TIME_BALL_RADIUS * 2 + 8) return false;
    }
    return true;
  }

  function initTimeBalls() {
    timeBalls = [];
    const count = 2 + Math.min(2, Math.floor(currentLevel / 4));
    const padding = 80;
    let attempts = 0;
    while (timeBalls.length < count && attempts < 200) {
      attempts++;
      const x = padding + Math.random() * (WORLD_W - 2 * padding);
      const y = padding + Math.random() * (WORLD_H - 2 * padding);
      if (isValidTimeBallPosition(x, y)) {
        timeBalls.push({ x, y });
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
    const extra = Math.max(0, currentLevel - LEVELS.length);
    activeLevelConfig = {
      ballsRequired: base.ballsRequired + extra * 5,
      timeLimit: Math.max(28, base.timeLimit - extra * 2 + Math.min(20, retries * 4)),
      treeCount: Math.min(18, Math.max(3, base.treeCount + Math.floor(extra / 2) - Math.floor(retries / 3))),
      enemyCount: Math.min(8, Math.max(0, base.enemyCount + Math.floor(extra / 3) - Math.floor(retries / 2)))
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
      initTimeBalls();
      initEnemies(enemyCount);
      generated = balls.length >= cfg.ballsRequired && isLevelLayoutPlayable(cfg);
    }
    if (!generated) {
      // Hard fallback: keep map sparse so level always remains finishable.
      initTrees(2);
      initBalls();
      initTimeBalls();
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

  function collectTimeBalls() {
    for (let i = timeBalls.length - 1; i >= 0; i--) {
      const tb = timeBalls[i];
      if (circleVsCircle(dog.x, dog.y, DOG_RADIUS, tb.x, tb.y, TIME_BALL_RADIUS)) {
        levelStartTime += TIME_BALL_BONUS * 1000;
        spawnParticles(tb.x, tb.y, 12, '#00bcd4');
        spawnParticles(tb.x, tb.y, 8, '#fff');
        playSound('collect');
        haptic('collect');
        timeBalls.splice(i, 1);
      }
    }
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
        saveBestLevel(currentLevel);
        levelRetries[currentLevel - 1] = 0;
        gamePhase = 'levelComplete';
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

  function drawTimeBalls() {
    const t = Date.now() * 0.004;
    timeBalls.forEach(tb => {
      const pulse = 0.92 + 0.08 * Math.sin(t + tb.x * 0.1);
      const r = TIME_BALL_RADIUS * pulse;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(Math.floor(tb.x), Math.floor(tb.y + 2), r, 0, Math.PI * 2);
      ctx.fill();
      const grad = ctx.createRadialGradient(tb.x - 2, tb.y - 2, 1, tb.x, tb.y, r);
      grad.addColorStop(0, '#e0f7fa');
      grad.addColorStop(0.5, '#00bcd4');
      grad.addColorStop(1, '#0097a7');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(Math.floor(tb.x), Math.floor(tb.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#006064';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+10', Math.floor(tb.x), Math.floor(tb.y));
    });
  }

  function drawGolfer(ex, ey, vx, vy) {
    const r = ENEMY_RADIUS;
    const dx = Math.floor(ex);
    const dy = Math.floor(ey);
    const angle = (vx !== 0 || vy !== 0) ? Math.atan2(vy, vx) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(dx, dy + 4, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(angle);
    ctx.fillStyle = '#e3f2fd';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.15, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#90caf9';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffcc80';
    ctx.beginPath();
    ctx.arc(0, -r * 0.5, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8d6e63';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.62, r * 0.3, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 0.2, r * 0.05);
    ctx.lineTo(r * 1.05, -r * 0.35);
    ctx.stroke();
    ctx.fillStyle = '#1b5e20';
    ctx.beginPath();
    ctx.arc(r * 1.1, -r * 0.4, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemies() {
    const now = Date.now();
    const pulse = 0.98 + 0.04 * Math.sin(now * 0.004);
    enemies.forEach(e => {
      const r = ENEMY_RADIUS * pulse;
      const vx = e.vx || 0;
      const vy = e.vy || 0;
      drawGolfer(e.x, e.y, vx, vy);
    });
  }

  function drawDog() {
    const stun = Date.now() < dog.stunUntil;
    if (stun) ctx.globalAlpha = 0.5 + 0.25 * Math.sin(Date.now() * 0.02);
    const r = DOG_RADIUS * 1.15;
    const dx = Math.floor(dog.x);
    const dy = Math.floor(dog.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(dx, dy + 4, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const furGrad = ctx.createRadialGradient(dx - r * 0.35, dy - r * 0.35, 0, dx, dy, r * 1.2);
    furGrad.addColorStop(0, '#3d3528');
    furGrad.addColorStop(0.15, '#2a2520');
    furGrad.addColorStop(0.35, '#1a1612');
    furGrad.addColorStop(0.6, '#0d0a08');
    furGrad.addColorStop(0.85, '#080605');
    furGrad.addColorStop(1, '#030202');
    ctx.fillStyle = furGrad;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + dx * 0.015;
      const curlX = dx + Math.cos(a) * r * 0.6;
      const curlY = dy + Math.sin(a) * r * 0.6;
      const curlR = 2.5 + (i % 3) * 0.5;
      const cg = ctx.createRadialGradient(curlX, curlY, 0, curlX, curlY, curlR);
      cg.addColorStop(0, 'rgba(95,80,65,0.22)');
      cg.addColorStop(0.5, 'rgba(45,38,28,0.1)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(Math.floor(curlX), Math.floor(curlY), curlR, 0, Math.PI * 2);
      ctx.fill();
    }
    const noseGrad = ctx.createRadialGradient(dx - 2, dy + r * 0.08, 0, dx, dy + r * 0.1, r * 0.2);
    noseGrad.addColorStop(0, '#4a4a4a');
    noseGrad.addColorStop(0.3, '#1e1e1e');
    noseGrad.addColorStop(0.7, '#0a0a0a');
    noseGrad.addColorStop(1, '#050505');
    ctx.fillStyle = noseGrad;
    ctx.beginPath();
    ctx.arc(dx, Math.floor(dy + r * 0.1), r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,120,120,0.4)';
    ctx.beginPath();
    ctx.arc(Math.floor(dx - 1), Math.floor(dy + r * 0.05), 1.5, 0, Math.PI * 2);
    ctx.fill();
    const chinGrad = ctx.createRadialGradient(dx, dy + r * 0.4, 0, dx, dy + r * 0.4, r * 0.16);
    chinGrad.addColorStop(0, '#fffef9');
    chinGrad.addColorStop(0.35, '#f0ebe0');
    chinGrad.addColorStop(0.65, '#e0d8c8');
    chinGrad.addColorStop(1, 'rgba(200,190,175,0.4)');
    ctx.fillStyle = chinGrad;
    ctx.beginPath();
    ctx.ellipse(dx, Math.floor(dy + r * 0.42), r * 0.14, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    const eyeGrad = ctx.createRadialGradient(dx - r * 0.25, dy - r * 0.15, 0, dx - r * 0.25, dy - r * 0.15, r * 0.15);
    eyeGrad.addColorStop(0, '#1a1510');
    eyeGrad.addColorStop(0.6, '#0a0806');
    eyeGrad.addColorStop(1, '#050403');
    ctx.fillStyle = eyeGrad;
    ctx.beginPath();
    ctx.arc(Math.floor(dx - r * 0.28), Math.floor(dy - r * 0.12), r * 0.1, 0, Math.PI * 2);
    ctx.arc(Math.floor(dx + r * 0.28), Math.floor(dy - r * 0.12), r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(Math.floor(dx - r * 0.26), Math.floor(dy - r * 0.14), 1.2, 0, Math.PI * 2);
    ctx.arc(Math.floor(dx + r * 0.3), Math.floor(dy - r * 0.14), 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const earGrad = ctx.createRadialGradient(dx - r * 0.5, dy - r * 0.8, 0, dx, dy - r * 0.5, r * 0.6);
    earGrad.addColorStop(0, '#2a2520');
    earGrad.addColorStop(0.4, '#1a1612');
    earGrad.addColorStop(0.8, '#0d0a08');
    earGrad.addColorStop(1, '#050403');
    ctx.fillStyle = earGrad;
    ctx.beginPath();
    ctx.ellipse(dx - r * 0.65, dy - r * 0.5, r * 0.35, r * 0.55, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(dx + r * 0.65, dy - r * 0.5, r * 0.35, r * 0.55, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b8c4c4';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(dx, dy, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#bfff00';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(dx, dy, r * 0.9, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
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
    const btnSize = Math.round(36 * s);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, barH);
    ctx.fillStyle = '#fff';
    ctx.font = fSize + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Level ' + currentLevel + '  Balls: ' + ballsInBasket + ' / ' + cfg.ballsRequired, pad, barH / 2);
    pauseBtnRect.w = btnSize;
    pauseBtnRect.h = btnSize;
    pauseBtnRect.x = canvas.width - btnSize - pad;
    pauseBtnRect.y = (barH - btnSize) / 2;
    const levelTimeRemaining = levelTimeLimit - (Date.now() - levelStartTime) / 1000;
    const secs = Math.max(0, Math.ceil(levelTimeRemaining));
    ctx.fillStyle = levelTimeRemaining <= 10 ? '#ff6b6b' : '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(secs + 's', pauseBtnRect.x - 8, barH / 2);
    if (dog.carried > 0) {
      ctx.fillStyle = '#fff';
      ctx.fillText('Carrying: ' + dog.carried, pauseBtnRect.x - 8, barH - 4);
    }
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
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const titleSize = Math.round(36 * s);
    const bodySize = Math.round(18 * s);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const hasHero = heroImg && heroImg.complete && heroImg.naturalWidth;
    if (hasHero) {
      const imgW = heroImg.naturalWidth;
      const imgH = heroImg.naturalHeight;
      const maxW = Math.min(canvas.width * 0.75, 300);
      const maxH = Math.min(canvas.height * 0.5, 340);
      const imgScale = Math.min(maxW / imgW, maxH / imgH);
      const w = imgW * imgScale;
      const h = imgH * imgScale;
      const x = cx - w / 2;
      const y = cy - h / 2 - 70;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 14);
      } else {
        ctx.rect(x - 6, y - 6, w + 12, h + 12);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(129,199,132,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.drawImage(heroImg, x, y, w, h);
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + titleSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("Zoey's Golf Adventures", cx, hasHero ? cy + 85 : cy - 50);
    ctx.font = bodySize + 'px sans-serif';
    ctx.fillText('Collect balls. Drop in basket. Avoid the enemies!', cx, hasHero ? cy + 118 : cy - 10);
    ctx.fillText('Endless levels. Tap to start.', cx, hasHero ? cy + 148 : cy + 30);
    ctx.restore();
  }

  function drawLevelComplete() {
    const s = hudScale();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const cardW = Math.min(320, canvas.width - 48);
    const cardH = 200;
    const cardX = cx - cardW / 2;
    const cardY = cy - cardH / 2;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeStyle = 'rgba(129,199,132,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cardX, cardY, cardW, cardH, 16);
    } else {
      ctx.rect(cardX, cardY, cardW, cardH);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#66bb6a';
    ctx.font = 'bold ' + Math.round(24 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LEVEL ' + currentLevel + ' COMPLETE', cx, cardY + 36);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(18 * s) + 'px sans-serif';
    ctx.fillText(Math.round(levelCompleteData.timeRemaining) + ' seconds left', cx, cardY + 72);
    const isNewBest = levelCompleteData.previousBest === 0 || levelCompleteData.timeRemaining >= levelCompleteData.previousBest;
    if (isNewBest) {
      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold ' + Math.round(14 * s) + 'px sans-serif';
      ctx.fillText('★ New best!', cx, cardY + 100);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = Math.round(15 * s) + 'px sans-serif';
    ctx.fillText('Tap for next level', cx, cardY + cardH - 44);
    ctx.fillStyle = 'rgba(129,199,132,0.4)';
    ctx.font = Math.round(12 * s) + 'px sans-serif';
    ctx.fillText('Level ' + currentLevel, cx, cardY + cardH - 22);
    ctx.restore();
  }

  function drawGameOver() {
    const s = hudScale();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const cardW = Math.min(300, canvas.width - 48);
    const cardH = 160;
    const cardX = cx - cardW / 2;
    const cardY = cy - cardH / 2;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(239,83,80,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cardX, cardY, cardW, cardH, 16);
    } else {
      ctx.rect(cardX, cardY, cardW, cardH);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ef5350';
    ctx.font = 'bold ' + Math.round(26 * s) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Time\'s up!', cx, cardY + 48);
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(15 * s) + 'px sans-serif';
    ctx.fillText('Tap to retry level ' + currentLevel, cx, cardY + 92);
    const best = loadScores().bestLevel || 0;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = Math.round(12 * s) + 'px sans-serif';
    ctx.fillText('Level ' + currentLevel + (best > 0 ? '  •  Best: ' + best : ''), cx, cardY + cardH - 28);
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
    drawTimeBalls();
    drawParticles();
    drawEnemies();
    drawDog();
    if (gamePhase === 'playing') drawHUD();
    ctx.restore();
    if (gamePhase === 'title') drawTitle();
    else if (gamePhase === 'levelComplete') drawLevelComplete();
    else if (gamePhase === 'gameOver') drawGameOver();
    else if (gamePhase === 'paused') drawPauseOverlay();
  }

  function update() {
    if (gamePhase === 'title') {
      lastFrameTime = Date.now();
      return;
    }
    if (gamePhase === 'levelComplete') {
      lastFrameTime = Date.now();
      return;
    }
    if (gamePhase === 'gameOver') {
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
    collectTimeBalls();
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
      var started = false;
      function doStart() {
        if (started) return;
        started = true;
        tryFullscreen();
        gamePhase = 'playing';
        currentLevel = 1;
        startLevel();
      }
      unlockAudio(doStart);
      setTimeout(doStart, 800);
      return;
    }
    if (gamePhase === 'levelComplete') {
      currentLevel++;
      startLevel();
      gamePhase = 'playing';
      return;
    }
    if (gamePhase === 'gameOver') {
      levelRetries[currentLevel - 1] = (levelRetries[currentLevel - 1] || 0) + 1;
      startLevel();
      gamePhase = 'playing';
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
  window.addEventListener('focus', function () { setTimeout(resize, 100); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }
  resize();
  setTimeout(resize, 100);
  gamePhase = 'title';
  heroImg = new Image();
  heroImg.src = './assets/hero.png';
  gameLoop();
})();
