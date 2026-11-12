//
// game.js — 扫雷界面与交互（核心逻辑见 logic.js）
//
(function () {
  'use strict';

  var Core = window.MinesweeperCore;
  var BEST_KEY = 'mtable.minesweeper.best';
  var SETTING_KEY = 'mtable.minesweeper.settings';

  var boardEl = document.getElementById('board');
  var boardWrap = document.getElementById('boardWrap');
  var mineCounterEl = document.getElementById('mineCounter');
  var timerEl = document.getElementById('timer');
  var faceEl = document.getElementById('face');
  var statusEl = document.getElementById('status');
  var bestEl = document.getElementById('best');
  var levelBar = document.getElementById('levels');
  var modalEl = document.getElementById('customModal');
  var modalError = document.getElementById('customError');

  var state = null;
  var difficulty = 'easy';
  var customConfig = { rows: 9, cols: 9, mines: 10 };
  var timerId = null;
  var seconds = 0;

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 存储失败不影响游戏 */ }
  }

  var bests = loadJSON(BEST_KEY, {});
  var settings = loadJSON(SETTING_KEY, {});
  if (settings.custom) customConfig = settings.custom;
  if (settings.difficulty) difficulty = settings.difficulty;

  // ---------- 计时 ----------
  function startTimer() {
    if (timerId) return;
    seconds = 0;
    timerEl.textContent = fmtCounter(0);
    timerId = setInterval(function () {
      if (seconds < 999) seconds++;
      timerEl.textContent = fmtCounter(seconds);
    }, 1000);
  }
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }
  function fmtCounter(v) {
    var n = Math.max(-99, Math.min(999, v));
    if (n < 0) return '-' + String(Math.abs(n)).padStart(2, '0');
    return String(n).padStart(3, '0');
  }

  // ---------- 新局 ----------
  function currentConfig() {
    if (difficulty === 'custom') return customConfig;
    var p = Core.PRESETS[difficulty] || Core.PRESETS.easy;
    return { rows: p.rows, cols: p.cols, mines: p.mines };
  }

  function newGame() {
    stopTimer();
    var cfg = currentConfig();
    state = Core.createGame(cfg.rows, cfg.cols, cfg.mines);
    seconds = 0;
    timerEl.textContent = fmtCounter(0);
    fitBoard();
    renderAll();
    saveJSON(SETTING_KEY, { difficulty: difficulty, custom: customConfig });
  }

  function bestTimeKey() {
    return difficulty === 'custom'
      ? 'custom-' + customConfig.rows + 'x' + customConfig.cols + 'x' + customConfig.mines
      : difficulty;
  }

  function renderBest() {
    var b = bests[bestTimeKey()];
    bestEl.textContent = b != null ? '最佳 ' + b + 's' : '最佳 --';
  }

  // ---------- 渲染 ----------
  function renderAll() {
    mineCounterEl.textContent = fmtCounter(Core.remainingMines(state));
    faceEl.textContent = state.status === 'won' ? '😎' : state.status === 'lost' ? '😵' : '🙂';
    renderBest();

    var frag = document.createDocumentFragment();
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        var cell = state.grid[r][c];
        var div = document.createElement('div');
        div.className = 'cell';
        div.dataset.r = r;
        div.dataset.c = c;

        if (cell.revealed) {
          div.classList.add('revealed');
          if (cell.mine) {
            div.classList.add('mine');
            div.textContent = '💣';
            if (cell.exploded) div.classList.add('boom');
          } else if (cell.adj > 0) {
            div.classList.add('n' + cell.adj);
            div.textContent = String(cell.adj);
          }
        } else if (cell.flagged) {
          div.classList.add('flagged');
          div.textContent = '🚩';
          if (cell.wrongFlag) { div.classList.add('wrong'); div.textContent = '❌'; }
        }
        frag.appendChild(div);
      }
    }
    boardEl.style.setProperty('--cols', state.cols);
    boardEl.replaceChildren(frag);
  }

  function renderStatus() {
    statusEl.classList.remove('win', 'lost');
    if (state.status === 'won') {
      statusEl.classList.add('win');
      statusEl.textContent = '🎉 扫雷成功！用时 ' + seconds + ' 秒';
    } else if (state.status === 'lost') {
      statusEl.classList.add('lost');
      statusEl.textContent = '💥 踩到地雷了，点笑脸重新开始';
    } else {
      statusEl.textContent = '左键揭开 · 右键插旗 · 数字格点击可开圈';
    }
  }

  function fitBoard() {
    if (!state) return;
    var wrapWidth = boardWrap.clientWidth - 24;
    var gap = 3;
    var size = Math.floor((wrapWidth - (state.cols - 1) * gap) / state.cols);
    size = Math.max(18, Math.min(34, size));
    boardEl.style.setProperty('--cell', size + 'px');
    boardEl.style.setProperty('--gap', gap + 'px');
  }

  // ---------- 交互 ----------
  function cellFromEvent(e) {
    var el = e.target.closest ? e.target.closest('.cell') : null;
    if (!el || !el.dataset.r) return null;
    return { r: +el.dataset.r, c: +el.dataset.c };
  }

  function afterAction() {
    renderAll();
    renderStatus();
  }

  function handleResult(prevStatus) {
    if (state.status === prevStatus) return;
    if (state.status === 'won') {
      stopTimer();
      recordBest();
      playFireworks();
    } else if (state.status === 'lost') {
      stopTimer();
    }
  }

  // 胜利烟花：棋盘正中央播放 2 秒
  function playFireworks() {
    var size = Math.max(280, Math.min(420, boardEl.offsetWidth));
    var canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.width = size;
    canvas.height = size;
    canvas.style.left = (boardEl.offsetLeft + boardEl.offsetWidth / 2 - size / 2) + 'px';
    canvas.style.top = (boardEl.offsetTop + boardEl.offsetHeight / 2 - size / 2) + 'px';
    boardWrap.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var colors = ['#ff6b6b', '#ffd166', '#5ad46b', '#4d9df0', '#c86bff', '#ff9f43', '#22d3ee'];
    var burstAt = [0, 320, 660, 1020, 1380];
    var burstIdx = 0;
    var particles = [];
    var start = performance.now();
    var last = start;

    function burst(x, y, color) {
      for (var i = 0; i < 30; i++) {
        var ang = (Math.PI * 2 * i) / 30 + Math.random() * 0.25;
        var sp = 60 + Math.random() * 130;
        particles.push({
          x: x, y: y, color: color, life: 1,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        });
      }
    }

    function frame(now) {
      var elapsed = now - start;
      while (burstIdx < burstAt.length && elapsed >= burstAt[burstIdx]) {
        burst(size * (0.25 + Math.random() * 0.5), size * (0.25 + Math.random() * 0.5),
          colors[Math.floor(Math.random() * colors.length)]);
        burstIdx++;
      }

      var dt = Math.min(50, now - last) / 1000;
      last = now;

      ctx.clearRect(0, 0, size, size);
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.vy += 140 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 1.15;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (elapsed < 2000) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  boardEl.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var pos = cellFromEvent(e);
    if (!pos || Core.isOver(state)) return;
    Core.toggleFlag(state, pos.r, pos.c);
    afterAction();
  });

  boardEl.addEventListener('mousedown', function (e) {
    if (e.button === 1) {
      e.preventDefault();
      var pos = cellFromEvent(e);
      if (!pos || Core.isOver(state)) return;
      var prevStatus = state.status;
      Core.chord(state, pos.r, pos.c);
      handleResult(prevStatus);
      afterAction();
    }
  });

  boardEl.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    var pos = cellFromEvent(e);
    if (!pos || Core.isOver(state)) return;
    var prevStatus = state.status;
    var cell = Core.at(state, pos.r, pos.c);
    if (cell && cell.revealed && cell.adj > 0) {
      Core.chord(state, pos.r, pos.c);
    } else {
      var wasReady = state.status === 'ready';
      Core.reveal(state, pos.r, pos.c);
      if (wasReady && state.status === 'playing') startTimer();
    }
    handleResult(prevStatus);
    afterAction();
  });

  function recordBest() {
    var k = bestTimeKey();
    if (bests[k] == null || seconds < bests[k]) {
      bests[k] = seconds;
      saveJSON(BEST_KEY, bests);
    }
  }

  faceEl.addEventListener('click', function () {
    newGame();
    renderStatus();
  });

  window.addEventListener('resize', fitBoard);

  // ---------- 难度 ----------
  levelBar.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-level]');
    if (!btn) return;
    var level = btn.dataset.level;
    if (level === 'custom') { openModal(); return; }
    difficulty = level;
    syncLevels();
    newGame();
    renderStatus();
  });

  function syncLevels() {
    var btns = levelBar.querySelectorAll('button[data-level]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.level === difficulty);
    }
  }

  function openModal() {
    document.getElementById('customRows').value = customConfig.rows;
    document.getElementById('customCols').value = customConfig.cols;
    document.getElementById('customMines').value = customConfig.mines;
    modalError.textContent = '';
    modalEl.classList.remove('hidden');
    document.getElementById('customRows').focus();
  }
  function closeModal() { modalEl.classList.add('hidden'); }

  document.getElementById('customCancel').addEventListener('click', closeModal);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });
  document.getElementById('customOk').addEventListener('click', function () {
    var res = Core.validateCustom(
      document.getElementById('customRows').value,
      document.getElementById('customCols').value,
      document.getElementById('customMines').value);
    if (!res.ok) { modalError.textContent = res.error; return; }
    customConfig = res.config;
    difficulty = 'custom';
    syncLevels();
    closeModal();
    newGame();
    renderStatus();
  });

  // ---------- 启动 ----------
  syncLevels();
  newGame();
  renderStatus();
})();
