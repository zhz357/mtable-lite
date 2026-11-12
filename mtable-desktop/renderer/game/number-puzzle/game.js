(() => {
  const STORAGE_KEY = 'com.mtable.puzzle';
  const SIZES = [3, 4, 5];

  let settings = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { size: SIZES.includes(raw.size) ? raw.size : 4, soundOn: raw.soundOn !== false };
    } catch { return { size: 4, soundOn: true }; }
  })();

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* 忽略 */ }
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtMs(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  function beep(freq = 520, dur = 0.09) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.03);
      setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch { /* 无声环境下静默失败 */ }
  }

  function winSound() {
    [660, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, 0.18), i * 160));
  }

  function solvedBoard(size) {
    const n = size * size;
    return Array.from({ length: n }, (_, i) => (i + 1) % n);
  }

  function isSolved(board) {
    return board.every((v, i) => v === (i + 1) % board.length);
  }

  function neighbors(pos, size) {
    const r = Math.floor(pos / size);
    const c = pos % size;
    const out = [];
    if (r > 0) out.push(pos - size);
    if (r < size - 1) out.push(pos + size);
    if (c > 0) out.push(pos - 1);
    if (c < size - 1) out.push(pos + 1);
    return out;
  }

  function shuffleBoard(size) {
    let board = solvedBoard(size);
    let blank = board.length - 1;
    let prev = -1;
    const rounds = size * size * 40;
    for (let i = 0; i < rounds; i++) {
      const cand = neighbors(blank, size).filter((x) => x !== prev);
      const pick = cand[Math.floor(Math.random() * cand.length)];
      prev = blank;
      [board[blank], board[pick]] = [board[pick], board[blank]];
      blank = pick;
    }
    if (isSolved(board)) return shuffleBoard(size);
    return board;
  }

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const boardWrapEl = $('boardWrap');
  const moveCounterEl = $('moveCounter');
  const timerEl = $('timer');
  const statusEl = $('status');
  const soundBtn = $('soundBtn');

  let size = settings.size;
  let board = shuffleBoard(size);
  let moves = 0;
  let startedAt = 0;
  let frozenMs = 0;
  let running = false;
  let won = false;
  let victoryEl = null;

  function elapsedMs() {
    return frozenMs + (running ? Date.now() - startedAt : 0);
  }

  function updateStats() {
    moveCounterEl.textContent = String(moves).padStart(3, '0');
    timerEl.textContent = fmtMs(elapsedMs());
  }

  function renderLevels() {
    document.querySelectorAll('#levels button').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.size) === size);
    });
  }

  function renderSoundBtn() {
    soundBtn.textContent = settings.soundOn ? '🔔' : '🔕';
    soundBtn.classList.toggle('off', !settings.soundOn);
    soundBtn.title = settings.soundOn ? '关闭音效' : '开启音效';
  }

  function renderBoard() {
    boardEl.dataset.size = String(size);
    boardEl.innerHTML = '';
    board.forEach((v, i) => {
      if (v === 0) {
        const blank = document.createElement('div');
        blank.className = 'blank';
        boardEl.append(blank);
        return;
      }
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.textContent = String(v);
      tile.addEventListener('click', () => tileClick(i));
      boardEl.append(tile);
    });
  }

  function showVictory() {
    hideVictory();
    victoryEl = document.createElement('div');
    victoryEl.className = 'victory';
    victoryEl.innerHTML = `
      <div class="cup">🏆</div>
      <div class="victory-title">${size}×${size} 拼图完成！</div>
      <div class="victory-sub">共用 ${moves} 步 · 用时 ${fmtMs(frozenMs)}</div>
      <button class="btn-ok" id="againBtn">再来一局</button>`;
    boardWrapEl.append(victoryEl);
    victoryEl.querySelector('#againBtn').addEventListener('click', () => reset(size));
  }

  function hideVictory() {
    if (victoryEl) { victoryEl.remove(); victoryEl = null; }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function confirmDlg(title, msg) {
    return new Promise((resolve) => {
      const modal = $('confirmModal');
      $('confirmTitle').textContent = title;
      $('confirmMsg').textContent = msg;
      modal.classList.remove('hidden');
      const done = (ok) => {
        modal.classList.add('hidden');
        $('confirmOk').onclick = null;
        $('confirmCancel').onclick = null;
        resolve(ok);
      };
      $('confirmOk').onclick = () => done(true);
      $('confirmCancel').onclick = () => done(false);
    });
  }

  function tileClick(pos) {
    if (won) return;
    const blank = board.indexOf(0);
    if (!neighbors(blank, size).includes(pos)) return;
    const movedVal = board[pos];
    [board[blank], board[pos]] = [board[pos], board[blank]];
    moves += 1;
    if (!running) {
      running = true;
      startedAt = Date.now();
    }
    if (settings.soundOn) beep(460 + (movedVal % 5) * 60);
    updateStats();
    renderBoard();
    if (isSolved(board)) finish();
  }

  function finish() {
    frozenMs = elapsedMs();
    running = false;
    won = true;
    updateStats();
    statusEl.textContent = `恭喜完成！${moves} 步 · ${fmtMs(frozenMs)}`;
    showVictory();
    if (settings.soundOn) winSound();
  }

  async function autoComplete() {
    if (won) return;
    const ok = await confirmDlg('自动完成提示', `确定要自动复原当前 ${size}×${size} 棋盘吗？`);
    if (!ok || won) return;
    board = solvedBoard(size);
    renderBoard();
    if (!running) {
      running = true;
      startedAt = Date.now();
    }
    finish();
  }

  function reset(nextSize) {
    size = nextSize;
    settings.size = size;
    persist();
    board = shuffleBoard(size);
    moves = 0;
    frozenMs = 0;
    running = false;
    won = false;
    startedAt = 0;
    statusEl.textContent = '';
    hideVictory();
    renderLevels();
    renderBoard();
    updateStats();
  }

  document.querySelectorAll('#levels button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.size);
      if (n !== size) reset(n);
    });
  });

  $('resetBtn').addEventListener('click', () => reset(size));
  $('autoBtn').addEventListener('click', autoComplete);
  soundBtn.addEventListener('click', () => {
    settings.soundOn = !settings.soundOn;
    persist();
    renderSoundBtn();
    toast(settings.soundOn ? '已开启音效' : '已关闭音效');
  });

  setInterval(() => {
    if (running) timerEl.textContent = fmtMs(elapsedMs());
  }, 200);

  renderLevels();
  renderSoundBtn();
  renderBoard();
  updateStats();
})();
