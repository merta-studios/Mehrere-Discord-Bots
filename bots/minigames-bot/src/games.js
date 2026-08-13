/**
 * Reine, Discord-unabhängige Spiellogik des Minigames-Bots.
 *
 * Jede Herausforderung und jeder Spielstand wird als unsichtbarer Marker in
 * der Discord-Nachricht gespeichert. Dadurch funktionieren die Buttons auch
 * nach einem Neustart weiter, ohne dass eine Datenbank nötig ist.
 */

const GAME_TTT = 'tictactoe';
const GAME_CONNECT4 = 'connect4';
const VALID_GAMES = [GAME_TTT, GAME_CONNECT4];

const STATUS_PENDING = 'pending';
const STATUS_ACTIVE = 'active';
const STATUS_WON = 'won';
const STATUS_DRAW = 'draw';
const STATUS_DECLINED = 'declined';
const STATUS_EXPIRED = 'expired';
const VALID_STATUSES = [
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  STATUS_DECLINED,
  STATUS_EXPIRED,
];

const CHALLENGE_TTL_MS = 60 * 60 * 1000;

// Vier Gewinnt läuft auf 5 Spalten × 6 Reihen. Discord erlaubt maximal fünf
// Buttons pro Action-Row – mit fünf Spalten steht deshalb genau ein Button
// unter genau einer Spalte und niemand muss Spalten abzählen.
const C4_COLUMNS = 5;
const C4_ROWS = 6;
const C4_SIZE = C4_COLUMNS * C4_ROWS;
const TTT_SIZE = 9;

// v2, weil sich die Brettgröße von Vier Gewinnt geändert hat: alte Marker
// werden bewusst nicht mehr gelesen statt falsch interpretiert zu werden.
const GAME_MARKER = 'mgame::v2::';
const LANG_MARKER = 'mgcfg::v1::';
const VALID_LANGS = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];

const CID = {
  accept: 'mg_accept',
  decline: 'mg_decline',
  tttMove: (cell) => `mg_ttt_${cell}`,
  connect4Move: (column) => `mg_c4_${column}`,
};

function normalizeLang(code) {
  const value = String(code || '').toLowerCase();
  return VALID_LANGS.includes(value) ? value : 'en';
}

function boardSize(game) {
  return game === GAME_CONNECT4 ? C4_SIZE : TTT_SIZE;
}

function emptyBoard(game) {
  return Array(boardSize(game)).fill(0);
}

function createChallenge({ game, challengerId, opponentId, lang = 'en', now = Date.now() }) {
  if (!VALID_GAMES.includes(game)) throw new Error(`Unbekanntes Spiel: ${game}`);
  return {
    game,
    status: STATUS_PENDING,
    challengerId: String(challengerId),
    opponentId: String(opponentId),
    lang: normalizeLang(lang),
    board: emptyBoard(game),
    turn: '',
    winnerId: '',
    winningCells: [],
    moves: 0,
    createdAt: Number(now),
    expiresAt: Number(now) + CHALLENGE_TTL_MS,
    acceptedAt: 0,
    finishedAt: 0,
  };
}

function normalizeState(input) {
  if (!input || !VALID_GAMES.includes(input.game)) return null;
  const challengerId = String(input.challengerId || '');
  const opponentId = String(input.opponentId || '');
  if (!challengerId || !opponentId || challengerId === opponentId) return null;

  const expectedSize = boardSize(input.game);
  const rawBoard = Array.isArray(input.board) ? input.board : [];
  const board = Array.from({ length: expectedSize }, (_, i) => {
    const value = Number(rawBoard[i]);
    return value === 1 || value === 2 ? value : 0;
  });
  const status = VALID_STATUSES.includes(input.status) ? input.status : STATUS_PENDING;
  const participants = [challengerId, opponentId];

  return {
    game: input.game,
    status,
    challengerId,
    opponentId,
    lang: normalizeLang(input.lang),
    board,
    turn: participants.includes(String(input.turn || '')) ? String(input.turn) : '',
    winnerId: participants.includes(String(input.winnerId || '')) ? String(input.winnerId) : '',
    winningCells: (Array.isArray(input.winningCells) ? input.winningCells : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < expectedSize),
    moves: Math.max(0, Math.min(expectedSize, Number(input.moves) || board.filter(Boolean).length)),
    createdAt: Number(input.createdAt) || Date.now(),
    expiresAt: Number(input.expiresAt) || Date.now() + CHALLENGE_TTL_MS,
    acceptedAt: Number(input.acceptedAt) || 0,
    finishedAt: Number(input.finishedAt) || 0,
  };
}

function compactState(state) {
  const s = normalizeState(state);
  if (!s) return null;
  return {
    g: s.game,
    s: s.status,
    a: s.challengerId,
    o: s.opponentId,
    l: s.lang,
    b: s.board.join(''),
    t: s.turn,
    w: s.winnerId,
    c: s.winningCells,
    m: s.moves,
    n: s.createdAt,
    e: s.expiresAt,
    x: s.acceptedAt,
    f: s.finishedAt,
  };
}

function expandState(data) {
  if (!data || typeof data !== 'object') return null;
  return normalizeState({
    game: data.g,
    status: data.s,
    challengerId: data.a,
    opponentId: data.o,
    lang: data.l,
    board: String(data.b || '').split('').map(Number),
    turn: data.t,
    winnerId: data.w,
    winningCells: data.c,
    moves: data.m,
    createdAt: data.n,
    expiresAt: data.e,
    acceptedAt: data.x,
    finishedAt: data.f,
  });
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function encodeGamePayload(state) {
  const compact = compactState(state);
  if (!compact) throw new Error('Ungültiger Spielstand');
  return `${GAME_MARKER}${encodeJson(compact)}`;
}

function decodeGamePayload(payload) {
  const text = String(payload || '');
  const index = text.indexOf(GAME_MARKER);
  if (index === -1) return null;
  const encoded = text.slice(index + GAME_MARKER.length).match(/^[A-Za-z0-9_-]+/)?.[0];
  return encoded ? expandState(decodeJson(encoded)) : null;
}

function encodeLanguagePayload(guildId, lang, changedAt = Date.now()) {
  return `${LANG_MARKER}${encodeJson({ g: String(guildId), l: normalizeLang(lang), t: Number(changedAt) })}`;
}

function decodeLanguagePayload(payload) {
  const text = String(payload || '');
  const index = text.indexOf(LANG_MARKER);
  if (index === -1) return null;
  const encoded = text.slice(index + LANG_MARKER.length).match(/^[A-Za-z0-9_-]+/)?.[0];
  const data = encoded ? decodeJson(encoded) : null;
  if (!data?.g || !VALID_LANGS.includes(String(data.l))) return null;
  return { guildId: String(data.g), lang: String(data.l), changedAt: Number(data.t) || 0 };
}

function cloneState(state, changes = {}) {
  return normalizeState({
    ...state,
    ...changes,
    board: Array.isArray(changes.board) ? [...changes.board] : [...state.board],
  });
}

function acceptChallenge(state, userId, now = Date.now()) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_PENDING) return { error: 'not_pending', state: s };
  if (String(userId) !== s.opponentId) return { error: 'not_opponent', state: s };
  if (Number(now) >= s.expiresAt) return { error: 'expired', state: expireChallenge(s, now) };
  return {
    state: cloneState(s, {
      status: STATUS_ACTIVE,
      turn: s.challengerId,
      acceptedAt: Number(now),
    }),
  };
}

function declineChallenge(state, userId, now = Date.now()) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_PENDING) return { error: 'not_pending', state: s };
  if (String(userId) !== s.opponentId) return { error: 'not_opponent', state: s };
  if (Number(now) >= s.expiresAt) return { error: 'expired', state: expireChallenge(s, now) };
  return {
    state: cloneState(s, { status: STATUS_DECLINED, turn: '', finishedAt: Number(now) }),
  };
}

function expireChallenge(state, now = Date.now()) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_PENDING || Number(now) < s.expiresAt) return s;
  return cloneState(s, { status: STATUS_EXPIRED, turn: '', finishedAt: Number(now) });
}

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function tttWinner(board) {
  for (const line of TTT_LINES) {
    const token = board[line[0]];
    if (token && line.every((cell) => board[cell] === token)) return { token, cells: line };
  }
  return null;
}

function connect4Winner(board, lastCell) {
  const row = Math.floor(lastCell / C4_COLUMNS);
  const col = lastCell % C4_COLUMNS;
  const token = board[lastCell];
  if (!token) return null;

  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [lastCell];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLUMNS && board[r * C4_COLUMNS + c] === token) {
        cells.push(r * C4_COLUMNS + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return { token, cells: cells.sort((a, b) => a - b) };
  }
  return null;
}

function tokenFor(state, userId) {
  if (String(userId) === state.challengerId) return 1;
  if (String(userId) === state.opponentId) return 2;
  return 0;
}

function applyMove(state, userId, position, now = Date.now()) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_ACTIVE) return { error: 'not_active', state: s };
  const token = tokenFor(s, userId);
  if (!token) return { error: 'not_player', state: s };
  if (s.turn !== String(userId)) return { error: 'not_turn', state: s };

  const board = [...s.board];
  let cell;
  if (s.game === GAME_TTT) {
    cell = Number(position);
    if (!Number.isInteger(cell) || cell < 0 || cell >= 9) return { error: 'invalid_move', state: s };
    if (board[cell]) return { error: 'cell_taken', state: s };
  } else {
    const column = Number(position);
    if (!Number.isInteger(column) || column < 0 || column >= C4_COLUMNS) {
      return { error: 'invalid_move', state: s };
    }
    for (let row = C4_ROWS - 1; row >= 0; row -= 1) {
      if (!board[row * C4_COLUMNS + column]) {
        cell = row * C4_COLUMNS + column;
        break;
      }
    }
    if (cell === undefined) return { error: 'column_full', state: s };
  }

  board[cell] = token;
  const moves = s.moves + 1;
  const won = s.game === GAME_TTT ? tttWinner(board) : connect4Winner(board, cell);
  if (won) {
    return {
      state: cloneState(s, {
        board,
        moves,
        status: STATUS_WON,
        turn: '',
        winnerId: String(userId),
        winningCells: won.cells,
        finishedAt: Number(now),
      }),
      cell,
    };
  }
  if (board.every(Boolean)) {
    return {
      state: cloneState(s, {
        board,
        moves,
        status: STATUS_DRAW,
        turn: '',
        finishedAt: Number(now),
      }),
      cell,
    };
  }

  return {
    state: cloneState(s, {
      board,
      moves,
      turn: String(userId) === s.challengerId ? s.opponentId : s.challengerId,
    }),
    cell,
  };
}

function parseCustomId(customId) {
  const id = String(customId || '');
  if (id === CID.accept) return { kind: 'accept' };
  if (id === CID.decline) return { kind: 'decline' };
  let match = id.match(/^mg_ttt_([0-8])$/);
  if (match) return { kind: 'move', game: GAME_TTT, position: Number(match[1]) };
  match = id.match(new RegExp(`^mg_c4_([0-${C4_COLUMNS - 1}])$`));
  if (match) return { kind: 'move', game: GAME_CONNECT4, position: Number(match[1]) };
  return null;
}

module.exports = {
  GAME_TTT,
  GAME_CONNECT4,
  VALID_GAMES,
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  STATUS_DECLINED,
  STATUS_EXPIRED,
  CHALLENGE_TTL_MS,
  C4_COLUMNS,
  C4_ROWS,
  C4_SIZE,
  TTT_SIZE,
  GAME_MARKER,
  LANG_MARKER,
  VALID_LANGS,
  CID,
  normalizeLang,
  boardSize,
  emptyBoard,
  createChallenge,
  normalizeState,
  encodeGamePayload,
  decodeGamePayload,
  encodeLanguagePayload,
  decodeLanguagePayload,
  acceptChallenge,
  declineChallenge,
  expireChallenge,
  tttWinner,
  connect4Winner,
  applyMove,
  parseCustomId,
};
