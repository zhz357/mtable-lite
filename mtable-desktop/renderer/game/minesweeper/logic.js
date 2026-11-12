//
// logic.js — 扫雷核心逻辑（纯函数，无 DOM 依赖，可被 Node 直接加载测试）
//
(function (global) {
  'use strict';

  var LIMITS = { rowMin: 5, rowMax: 30, colMin: 5, colMax: 30, mineMin: 1 };

  var PRESETS = {
    easy: { key: 'easy', name: '初级', rows: 9, cols: 9, mines: 10 },
    medium: { key: 'medium', name: '中级', rows: 16, cols: 16, mines: 40 },
    hard: { key: 'hard', name: '高级', rows: 16, cols: 30, mines: 99 },
  };

  function clampInt(value, min, max) {
    var n = Math.floor(Number(value));
    if (!isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function key(r, c) { return r + ',' + c; }

  function at(state, r, c) {
    if (r < 0 || c < 0 || r >= state.rows || c >= state.cols) return null;
    return state.grid[r][c];
  }

  function forEachNeighbor(state, r, c, fn) {
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= state.rows || nc >= state.cols) continue;
        fn(nr, nc);
      }
    }
  }

  // 自定义难度校验：返回 { ok, config } 或 { ok, error }
  function validateCustom(rows, cols, mines) {
    rows = Math.floor(Number(rows));
    cols = Math.floor(Number(cols));
    mines = Math.floor(Number(mines));
    if (!isFinite(rows) || !isFinite(cols) || !isFinite(mines)) {
      return { ok: false, error: '请输入有效的整数' };
    }
    if (rows < LIMITS.rowMin || rows > LIMITS.rowMax) {
      return { ok: false, error: '行数需在 ' + LIMITS.rowMin + ' ~ ' + LIMITS.rowMax + ' 之间' };
    }
    if (cols < LIMITS.colMin || cols > LIMITS.colMax) {
      return { ok: false, error: '列数需在 ' + LIMITS.colMin + ' ~ ' + LIMITS.colMax + ' 之间' };
    }
    if (mines < LIMITS.mineMin) {
      return { ok: false, error: '地雷数至少为 1' };
    }
    if (mines > rows * cols - 1) {
      return { ok: false, error: '地雷数不能超过 ' + (rows * cols - 1) };
    }
    return { ok: true, config: { rows: rows, cols: cols, mines: mines } };
  }

  function createGame(rows, cols, mines) {
    rows = clampInt(rows, LIMITS.rowMin, LIMITS.rowMax);
    cols = clampInt(cols, LIMITS.colMin, LIMITS.colMax);
    mines = clampInt(mines, LIMITS.mineMin, rows * cols - 1);

    var grid = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        row.push({ mine: false, adj: 0, revealed: false, flagged: false, exploded: false, wrongFlag: false });
      }
      grid.push(row);
    }
    return {
      rows: rows, cols: cols, mines: mines,
      grid: grid,
      status: 'ready',       // ready → playing → won | lost
      minesPlaced: false,
      flags: 0,
      revealedCount: 0,
    };
  }

  // 首点保护：首次点击的 3×3 邻域不放雷（雷数放不下时退化为仅保护点击格）
  function placeMines(state, safeR, safeC, rng) {
    rng = rng || Math.random;
    var total = state.rows * state.cols;
    var excluded = {};
    forEachNeighbor(state, safeR, safeC, function (nr, nc) { excluded[key(nr, nc)] = true; });
    excluded[key(safeR, safeC)] = true;

    var excludeCount = Object.keys(excluded).length;
    if (state.mines > total - excludeCount) {
      excluded = {};
      excluded[key(safeR, safeC)] = true;
      excludeCount = 1;
    }
    if (state.mines > total - 1) state.mines = total - 1;

    var candidates = [];
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        if (!excluded[key(r, c)]) candidates.push([r, c]);
      }
    }

    for (var i = 0; i < state.mines; i++) {
      var span = candidates.length - i;
      var j = i + Math.floor(rng() * span);
      if (j >= candidates.length) j = candidates.length - 1;
      var tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
      var pos = candidates[i];
      state.grid[pos[0]][pos[1]].mine = true;
    }

    computeAdj(state);
    state.minesPlaced = true;
  }

  function computeAdj(state) {
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        if (state.grid[r][c].mine) { state.grid[r][c].adj = -1; continue; }
        var n = 0;
        forEachNeighbor(state, r, c, function (nr, nc) {
          if (state.grid[nr][nc].mine) n++;
        });
        state.grid[r][c].adj = n;
      }
    }
  }

  // 泛洪揭开安全区域（跳过已揭开 / 已插旗 / 地雷格）
  function revealSafe(state, r, c) {
    var stack = [[r, c]];
    while (stack.length) {
      var pos = stack.pop();
      var cell = state.grid[pos[0]][pos[1]];
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      state.revealedCount++;
      if (cell.adj === 0) {
        forEachNeighbor(state, pos[0], pos[1], function (nr, nc) {
          var n = state.grid[nr][nc];
          if (!n.revealed && !n.flagged && !n.mine) stack.push([nr, nc]);
        });
      }
    }
  }

  function checkWin(state) {
    if (state.status === 'lost') return;
    if (state.revealedCount !== state.rows * state.cols - state.mines) return;
    state.status = 'won';
    var flags = 0;
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        var cell = state.grid[r][c];
        if (cell.mine && !cell.flagged) cell.flagged = true;
        if (cell.flagged) flags++;
      }
    }
    state.flags = flags;
  }

  function lose(state) {
    state.status = 'lost';
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        var cell = state.grid[r][c];
        if (cell.mine && !cell.flagged) cell.revealed = true;
        if (!cell.mine && cell.flagged) cell.wrongFlag = true;
      }
    }
  }

  function reveal(state, r, c, rng) {
    if (state.status === 'won' || state.status === 'lost') return;
    var cell = at(state, r, c);
    if (!cell || cell.revealed || cell.flagged) return;

    if (!state.minesPlaced) {
      placeMines(state, r, c, rng);
      state.status = 'playing';
    }

    if (cell.mine) {
      cell.exploded = true;
      cell.revealed = true;
      lose(state);
      return;
    }
    revealSafe(state, r, c);
    checkWin(state);
  }

  function toggleFlag(state, r, c) {
    if (state.status === 'won' || state.status === 'lost') return;
    var cell = at(state, r, c);
    if (!cell || cell.revealed) return;
    cell.flagged = !cell.flagged;
    state.flags += cell.flagged ? 1 : -1;
  }

  // 开圈：数字格周围旗数等于数字时，揭开其余未标记格
  function chord(state, r, c, rng) {
    if (state.status !== 'playing') return;
    var cell = at(state, r, c);
    if (!cell || !cell.revealed || cell.adj <= 0) return;

    var flags = 0;
    forEachNeighbor(state, r, c, function (nr, nc) {
      if (state.grid[nr][nc].flagged) flags++;
    });
    if (flags !== cell.adj) return;

    forEachNeighbor(state, r, c, function (nr, nc) {
      if (state.status === 'lost') return;
      var n = state.grid[nr][nc];
      if (n.revealed || n.flagged) return;
      if (n.mine) {
        n.exploded = true;
        n.revealed = true;
        lose(state);
        return;
      }
      revealSafe(state, nr, nc);
    });
    if (state.status === 'playing') checkWin(state);
  }

  function remainingMines(state) { return state.mines - state.flags; }
  function isOver(state) { return state.status === 'won' || state.status === 'lost'; }

  var Core = {
    LIMITS: LIMITS,
    PRESETS: PRESETS,
    validateCustom: validateCustom,
    createGame: createGame,
    placeMines: placeMines,
    computeAdj: computeAdj,
    reveal: reveal,
    toggleFlag: toggleFlag,
    chord: chord,
    remainingMines: remainingMines,
    isOver: isOver,
    forEachNeighbor: forEachNeighbor,
    at: at,
  };

  global.MinesweeperCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : this);
