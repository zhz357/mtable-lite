(() => {
  const L = window.TetrisLogic;
  const BEST_KEY = 'mtable.tetris.best';

  const boardCanvas = document.getElementById('board');
  const nextCanvas = document.getElementById('next');
  const ctx = boardCanvas.getContext('2d');
  const nctx = nextCanvas.getContext('2d');
  const stageEl = document.getElementById('stage');
  const sideEl = document.getElementById('side');
  const boardWrap = document.getElementById('boardWrap');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const linesEl = document.getElementById('lines');
  const diffNameEl = document.getElementById('diffName');
  const bestEl = document.getElementById('best');
  const statusEl = document.getElementById('status');
  const pauseBtn = document.getElementById('pauseBtn');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayMsg = document.getElementById('overlayMsg');
  const overlayBtn = document.getElementById('overlayBtn');

  const COLORS = {
    I: '#2fc7d8', O: '#f2c14e', T: '#a66cf0',
    S: '#3ddc84', Z: '#e2564c', J: '#4d7ef0', L: '#f2994a'
  };

  let cell = 26;
  let dropAcc = 0;
  let lastTs = 0;

  const state = {
    difficulty: 'easy',
    status: 'ready',
    board: L.createBoard(),
    current: null,
    nextType: null,
    gen: null,
    score: 0,
    lines: 0,
    level: 1
  };

  function readBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
  }

  function writeBest(score) {
    const best = readBest();
    if (score > (best[state.difficulty] || 0)) {
      best[state.difficulty] = score;
      try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* 无痕模式忽略 */ }
    }
  }

  function bestScore() {
    return readBest()[state.difficulty] || 0;
  }

  function init(difficulty) {
    state.difficulty = difficulty;
    state.board = L.createBoard();
    state.gen = L.createGenerator(difficulty);
    state.current = L.createPiece(state.gen.next());
    state.nextType = state.gen.next();
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.status = 'running';
    dropAcc = 0;
    hideOverlay();
    updateHud();
    draw();
    focusGame();
  }

  function focusGame() {
    try { boardWrap.focus({ preventScroll: true }); window.focus(); } catch { /* 焦点不可用时忽略 */ }
  }

  function updateHud() {
    scoreEl.textContent = state.score;
    levelEl.textContent = 'Lv ' + state.level;
    linesEl.textContent = state.lines;
    diffNameEl.textContent = '难度：' + L.DIFFICULTIES[state.difficulty].label
      + ' · 行分 ×' + L.DIFFICULTIES[state.difficulty].scoreFactor;
    bestEl.textContent = '最佳 ' + bestScore();
    pauseBtn.textContent = state.status === 'paused' ? '▶' : '⏸';
    document.querySelectorAll('#levels button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === state.difficulty);
    });
    statusEl.textContent = '键盘：← → 移动 · ↑/X 旋转 · Z 逆转 · ↓ 软降 · 空格 硬降 · P 暂停 · R 重开';
  }

  function resize() {
    const stageW = stageEl.clientWidth;
    const stageH = stageEl.clientHeight;
    const sideW = sideEl.offsetWidth;
    const availW = stageW - sideW - 24;
    const availH = stageH - 6;
    cell = Math.max(12, Math.min(46, Math.floor(Math.min(availW / L.COLS, availH / L.ROWS))));
    const dpr = window.devicePixelRatio || 1;
    boardCanvas.width = L.COLS * cell * dpr;
    boardCanvas.height = L.ROWS * cell * dpr;
    boardCanvas.style.width = L.COLS * cell + 'px';
    boardCanvas.style.height = L.ROWS * cell + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pcell = Math.max(10, Math.round(cell * 0.8));
    nextCanvas.width = 4 * pcell * dpr;
    nextCanvas.height = 4 * pcell * dpr;
    nextCanvas.style.width = 4 * pcell + 'px';
    nextCanvas.style.height = 4 * pcell + 'px';
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function drawCell(target, x, y, size, color, alpha) {
    const px = x * size;
    const py = y * size;
    const r = Math.max(2, size * 0.18);
    target.save();
    if (alpha) target.globalAlpha = alpha;
    target.fillStyle = color;
    target.beginPath();
    target.moveTo(px + r, py);
    target.arcTo(px + size, py, px + size, py + size, r);
    target.arcTo(px + size, py + size, px, py + size, r);
    target.arcTo(px, py + size, px, py, r);
    target.arcTo(px, py, px + size, py, r);
    target.closePath();
    target.fill();
    target.fillStyle = 'rgba(255,255,255,.22)';
    target.fillRect(px + size * 0.16, py + size * 0.14, size * 0.68, size * 0.14);
    target.restore();
  }

  function draw() {
    ctx.fillStyle = '#1d2531';
    ctx.fillRect(0, 0, L.COLS * cell, L.ROWS * cell);
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    for (let x = 1; x < L.COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, L.ROWS * cell);
      ctx.stroke();
    }
    for (let y = 1; y < L.ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell);
      ctx.lineTo(L.COLS * cell, y * cell);
      ctx.stroke();
    }
    for (let y = 0; y < L.ROWS; y++) {
      for (let x = 0; x < L.COLS; x++) {
        const t = state.board[y][x];
        if (t) drawCell(ctx, x, y, cell, COLORS[t], 0);
      }
    }
    if (state.current) {
      L.cellsOf(state.current.matrix).forEach(([cx, cy]) => {
        const y = state.current.y + cy;
        if (y >= 0) drawCell(ctx, state.current.x + cx, y, cell, COLORS[state.current.type], 0);
      });
    }
    drawNext();
  }

  function drawNext() {
    const size = nextCanvas.width / (window.devicePixelRatio || 1) / 4;
    nctx.clearRect(0, 0, 4 * size, 4 * size);
    if (!state.nextType) return;
    const matrix = L.SHAPES[state.nextType];
    const cells = L.cellsOf(matrix);
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const ox = (4 - w) / 2 - Math.min(...xs);
    const oy = (4 - h) / 2 - Math.min(...ys);
    cells.forEach(([cx, cy]) => drawCell(nctx, cx + ox, cy + oy, size, COLORS[state.nextType], 0));
  }

  function spawn() {
    state.current = L.createPiece(state.nextType);
    state.nextType = state.gen.next();
    if (L.collides(state.board, state.current.matrix, state.current.x, state.current.y)) {
      gameOver();
    }
  }

  function lockPiece() {
    L.merge(state.board, state.current);
    const res = L.clearLines(state.board);
    state.board = res.board;
    if (res.cleared) {
      state.score += L.lineScore(res.cleared, state.difficulty);
      state.lines += res.cleared;
      state.level = L.levelOf(state.lines, state.difficulty);
    }
    updateHud();
    spawn();
  }

  function stepDown(soft) {
    if (state.status !== 'running') return;
    if (!L.collides(state.board, state.current.matrix, state.current.x, state.current.y + 1)) {
      state.current.y++;
      state.score += soft ? L.dropScore(1, false) : 0;
      updateHud();
    } else {
      lockPiece();
    }
    draw();
  }

  function hardDrop() {
    if (state.status !== 'running') return;
    const targetY = L.ghostY(state.board, state.current);
    state.score += L.dropScore(targetY - state.current.y, true);
    state.current.y = targetY;
    lockPiece();
    dropAcc = 0;
    draw();
  }

  function move(dir) {
    if (state.status !== 'running') return;
    if (!L.collides(state.board, state.current.matrix, state.current.x + dir, state.current.y)) {
      state.current.x += dir;
      draw();
    }
  }

  function rotate(dir) {
    if (state.status !== 'running') return;
    if (L.tryRotate(state.board, state.current, dir)) draw();
  }

  function gameOver() {
    state.status = 'over';
    writeBest(state.score);
    updateHud();
    showOverlay('游戏结束', '得分 ' + state.score + ' · 消除 ' + state.lines + ' 行 · 最佳 ' + bestScore(), '再来一局', () => init(state.difficulty));
  }

  function togglePause() {
    if (state.status === 'running') {
      state.status = 'paused';
      showOverlay('已暂停', '得分 ' + state.score + ' · 消除 ' + state.lines + ' 行', '继续游戏', togglePause);
    } else if (state.status === 'paused') {
      state.status = 'running';
      dropAcc = 0;
      hideOverlay();
    }
    updateHud();
    focusGame();
  }

  function showOverlay(title, msg, btnText, onClick) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlayBtn.textContent = btnText;
    overlayBtn.onclick = onClick;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function tick(ts) {
    requestAnimationFrame(tick);
    if (!lastTs) lastTs = ts;
    const dt = Math.min(120, ts - lastTs);
    lastTs = ts;
    if (state.status !== 'running') return;
    dropAcc += dt;
    const interval = L.dropInterval(state.level, state.difficulty);
    while (dropAcc >= interval) {
      dropAcc -= interval;
      stepDown(false);
      if (state.status !== 'running') break;
    }
    draw();
  }

  function handleKey(e) {
    if (e.repeat && (e.key === 'p' || e.key === 'P' || e.key === 'r' || e.key === 'R')) return;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); move(-1); break;
      case 'ArrowRight': case 'd': case 'D': e.preventDefault(); move(1); break;
      case 'ArrowDown': case 's': case 'S': e.preventDefault(); stepDown(true); break;
      case 'ArrowUp': case 'w': case 'W': case 'x': case 'X': e.preventDefault(); rotate(1); break;
      case 'z': case 'Z': e.preventDefault(); rotate(-1); break;
      case ' ': case 'Spacebar': e.preventDefault(); hardDrop(); break;
      case 'p': case 'P': case 'Escape': togglePause(); break;
      case 'r': case 'R': init(state.difficulty); break;
    }
  }

  const ACTIONS = {
    left: () => move(-1),
    right: () => move(1),
    rotate: () => rotate(1),
    down: () => stepDown(true),
    drop: hardDrop,
    pause: togglePause,
    restart: () => init(state.difficulty)
  };
  const REPEATABLE = { left: 1, right: 1, down: 1 };

  document.querySelectorAll('.pad button').forEach((btn) => {
    const act = btn.dataset.act;
    const run = ACTIONS[act];
    if (!run) return;
    let delayTimer = null;
    let repTimer = null;
    let lastPointer = 0;
    const stop = () => {
      clearTimeout(delayTimer);
      clearInterval(repTimer);
      delayTimer = repTimer = null;
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lastPointer = Date.now();
      run();
      if (REPEATABLE[act]) {
        delayTimer = setTimeout(() => { repTimer = setInterval(run, 90); }, 250);
      }
      focusGame();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (Date.now() - lastPointer > 600) run();
    });
  });

  window.addEventListener('keydown', handleKey, true);
  document.addEventListener('pointerdown', focusGame);
  document.getElementById('levels').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.dataset.difficulty) init(btn.dataset.difficulty);
  });

  pauseBtn.addEventListener('click', togglePause);
  document.getElementById('restartBtn').addEventListener('click', () => init(state.difficulty));
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);

  resize();
  init('easy');
  requestAnimationFrame(tick);
})();
