(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TetrisLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var COLS = 10;
  var ROWS = 20;

  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
  };

  var LINE_SCORES = [0, 100, 300, 500, 800];
  var KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

  var DIFFICULTIES = {
    easy: { key: 'easy', label: '简单', pieces: ['I', 'O', 'T'], gravity: 800, minGravity: 220, scoreFactor: 1, linesPerLevel: 10 },
    medium: { key: 'medium', label: '中等', pieces: ['I', 'O', 'T', 'L', 'J'], gravity: 450, minGravity: 120, scoreFactor: 2, linesPerLevel: 10 },
    hard: { key: 'hard', label: '困难', pieces: ['I', 'O', 'T', 'L', 'J', 'S', 'Z'], gravity: 220, minGravity: 60, scoreFactor: 3, linesPerLevel: 10 }
  };

  function createBoard() {
    var board = [];
    for (var y = 0; y < ROWS; y++) board.push(filledRow(0));
    return board;
  }

  function filledRow(value) {
    var row = [];
    for (var x = 0; x < COLS; x++) row.push(value);
    return row;
  }

  function cloneBoard(board) {
    return board.map(function (row) { return row.slice(); });
  }

  function cellsOf(matrix) {
    var cells = [];
    for (var y = 0; y < matrix.length; y++) {
      for (var x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x]) cells.push([x, y]);
      }
    }
    return cells;
  }

  function rotateMatrix(matrix, dir) {
    var n = matrix.length;
    var out = [];
    for (var y = 0; y < n; y++) {
      out.push([]);
      for (var x = 0; x < n; x++) {
        out[y].push(dir > 0 ? matrix[n - 1 - x][y] : matrix[x][n - 1 - y]);
      }
    }
    return out;
  }

  function createPiece(type) {
    var matrix = SHAPES[type].map(function (row) { return row.slice(); });
    return { type: type, matrix: matrix, x: Math.floor((COLS - matrix.length) / 2), y: 0 };
  }

  function collides(board, matrix, px, py) {
    var cells = cellsOf(matrix);
    for (var i = 0; i < cells.length; i++) {
      var x = px + cells[i][0];
      var y = py + cells[i][1];
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y][x]) return true;
    }
    return false;
  }

  function merge(board, piece) {
    var cells = cellsOf(piece.matrix);
    for (var i = 0; i < cells.length; i++) {
      var x = piece.x + cells[i][0];
      var y = piece.y + cells[i][1];
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) board[y][x] = piece.type;
    }
    return board;
  }

  function clearLines(board) {
    var kept = [];
    var cleared = 0;
    for (var y = 0; y < board.length; y++) {
      var full = true;
      for (var x = 0; x < COLS; x++) {
        if (!board[y][x]) { full = false; break; }
      }
      if (full) cleared++;
      else kept.push(board[y].slice());
    }
    while (kept.length < ROWS) kept.unshift(filledRow(0));
    return { board: kept, cleared: cleared };
  }

  function tryRotate(board, piece, dir) {
    var rotated = rotateMatrix(piece.matrix, dir);
    for (var i = 0; i < KICKS.length; i++) {
      var nx = piece.x + KICKS[i][0];
      var ny = piece.y + KICKS[i][1];
      if (!collides(board, rotated, nx, ny)) {
        piece.matrix = rotated;
        piece.x = nx;
        piece.y = ny;
        return true;
      }
    }
    return false;
  }

  function ghostY(board, piece) {
    var y = piece.y;
    while (!collides(board, piece.matrix, piece.x, y + 1)) y++;
    return y;
  }

  function shuffle(arr, rng) {
    var rand = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function createGenerator(difficultyKey, rng) {
    var types = DIFFICULTIES[difficultyKey].pieces;
    var bag = [];
    return {
      next: function () {
        if (!bag.length) bag = shuffle(types.slice(), rng);
        return bag.shift();
      }
    };
  }

  function lineScore(cleared, difficultyKey) {
    var factor = DIFFICULTIES[difficultyKey].scoreFactor;
    var base = LINE_SCORES[Math.min(Math.max(cleared, 0), LINE_SCORES.length - 1)];
    return base * factor;
  }

  function dropScore(cells, hard) {
    return cells * (hard ? 2 : 1);
  }

  function levelOf(lines, difficultyKey) {
    return Math.floor(lines / DIFFICULTIES[difficultyKey].linesPerLevel) + 1;
  }

  function dropInterval(level, difficultyKey) {
    var d = DIFFICULTIES[difficultyKey];
    return Math.max(d.minGravity, Math.round(d.gravity * Math.pow(0.85, level - 1)));
  }

  return {
    COLS: COLS,
    ROWS: ROWS,
    SHAPES: SHAPES,
    LINE_SCORES: LINE_SCORES,
    KICKS: KICKS,
    DIFFICULTIES: DIFFICULTIES,
    createBoard: createBoard,
    cloneBoard: cloneBoard,
    cellsOf: cellsOf,
    rotateMatrix: rotateMatrix,
    createPiece: createPiece,
    collides: collides,
    merge: merge,
    clearLines: clearLines,
    tryRotate: tryRotate,
    ghostY: ghostY,
    shuffle: shuffle,
    createGenerator: createGenerator,
    lineScore: lineScore,
    dropScore: dropScore,
    levelOf: levelOf,
    dropInterval: dropInterval
  };
});
