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
const STATUS_CANCELLED = 'cancelled';
const STATUS_EXPIRED = 'expired';
const VALID_STATUSES = [
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  STATUS_DECLINED,
  STATUS_CANCELLED,
  STATUS_EXPIRED,
];

const CHALLENGE_TTL_MS = 60 * 60 * 1000;

// Vier Gewinnt läuft in der klassischen Größe 7 Spalten × 6 Reihen.
// Discord erlaubt nur fünf Buttons pro Action-Row – sieben Spalten-Buttons
// passen deshalb niemals bündig unter ein sieben Spalten breites Brett.
// Statt das Brett zu verkleinern, wird die Spalte im Brett selbst gewählt:
// eine Zeiger-Zeile (🔽) sitzt im selben Textblock wie das Brett und ist
// dadurch IMMER exakt ausgerichtet. Darunter steht genau eine Button-Reihe
// mit fünf Buttons: ⏮ ◀ ⬇ ▶ ⏭.
const C4_COLUMNS = 7;
const C4_ROWS = 6;
const C4_SIZE = C4_COLUMNS * C4_ROWS;
const TTT_SIZE = 9;

// v3: Brettgröße (7×6) und der neue Spalten-Zeiger verändern das Format.
// Alte Marker werden bewusst nicht mehr gelesen statt falsch interpretiert.
const GAME_MARKER = 'mgame::v3::';
const LANG_MARKER = 'mgcfg::v1::';
const VALID_LANGS = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];

const CURSOR_ACTIONS = ['first', 'left', 'right', 'last'];

const CID = {
  accept: 'mg_accept',
  decline: 'mg_decline',
  tttMove: (cell) => `mg_ttt_${cell}`,
  connect4Drop: 'mg_c4_drop',
  connect4Cursor: (action) => `mg_c4_${action}`,
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

/** Eine Spalte ist voll, sobald ihr oberstes Feld belegt ist. */
function columnFull(board, column) {
  return Boolean(board[column]);
}

function freeColumns(board) {
  return Array.from({ length: C4_COLUMNS }, (_, column) => column).filter(
    (column) => !columnFull(board, column)
  );
}

/**
 * Nächste freie Spalte in Blickrichtung – mit Umlauf, damit man mit einem
 * Klick von ganz links nach ganz rechts springen kann.
 */
function nextFreeColumn(board, from, direction) {
  const free = freeColumns(board);
  if (!free.length) return Math.max(0, Math.min(C4_COLUMNS - 1, Number(from) || 0));
  const start = Math.max(0, Math.min(C4_COLUMNS - 1, Number(from) || 0));
  for (let step = 1; step <= C4_COLUMNS; step += 1) {
    const candidate = (start + direction * step + C4_COLUMNS * step) % C4_COLUMNS;
    if (!columnFull(board, candidate)) return candidate;
  }
  return free[0];
}

/** Sorgt dafür, dass der Zeiger nie auf einer vollen Spalte stehen bleibt. */
function sanitizeCursor(board, cursor) {
  const value = Number.isInteger(Number(cursor)) ? Number(cursor) : 0;
  const clamped = Math.max(0, Math.min(C4_COLUMNS - 1, value));
  if (!columnFull(board, clamped)) return clamped;
  const free = freeColumns(board);
  if (!free.length) return clamped;
  // Nächste freie Spalte in der Nähe suchen (erst rechts, dann links).
  return free.reduce((best, column) =>
    Math.abs(column - clamped) < Math.abs(best - clamped) ? column : best
  );
}

function defaultCursor(game) {
  return game === GAME_CONNECT4 ? Math.floor(C4_COLUMNS / 2) : 0;
}

/**
 * Legt eine Herausforderung an. Ohne `opponentId` entsteht eine **offene**
 * Runde: dann darf jedes Servermitglied antreten.
 */
function createChallenge({ game, challengerId, opponentId = '', lang = 'en', now = Date.now() }) {
  if (!VALID_GAMES.includes(game)) throw new Error(`Unbekanntes Spiel: ${game}`);
  return {
    game,
    status: STATUS_PENDING,
    challengerId: String(challengerId),
    opponentId: opponentId ? String(opponentId) : '',
    lang: normalizeLang(lang),
    board: emptyBoard(game),
    turn: '',
    winnerId: '',
    winningCells: [],
    cursor: defaultCursor(game),
    moves: 0,
    createdAt: Number(now),
    expiresAt: Number(now) + CHALLENGE_TTL_MS,
    acceptedAt: 0,
    finishedAt: 0,
  };
}

function isOpenChallenge(state) {
  return Boolean(state) && state.status === STATUS_PENDING && !state.opponentId;
}

function normalizeState(input) {
  if (!input || !VALID_GAMES.includes(input.game)) return null;
  const challengerId = String(input.challengerId || '');
  const opponentId = String(input.opponentId || '');
  if (!challengerId) return null;
  if (opponentId && challengerId === opponentId) return null;

  const status = VALID_STATUSES.includes(input.status) ? input.status : STATUS_PENDING;
  // Ohne Gegner ist nur eine offene (oder abgebrochene/abgelaufene) Anfrage gültig.
  if (!opponentId && ![STATUS_PENDING, STATUS_CANCELLED, STATUS_EXPIRED].includes(status)) return null;

  const expectedSize = boardSize(input.game);
  const rawBoard = Array.isArray(input.board) ? input.board : [];
  const board = Array.from({ length: expectedSize }, (_, i) => {
    const value = Number(rawBoard[i]);
    return value === 1 || value === 2 ? value : 0;
  });
  const participants = [challengerId, opponentId].filter(Boolean);

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
    cursor:
      input.game === GAME_CONNECT4
        ? sanitizeCursor(board, input.cursor === undefined ? defaultCursor(input.game) : input.cursor)
        : 0,
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
    p: s.cursor,
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
    cursor: data.p,
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

/**
 * Wer beginnt, entscheidet der Zufall – nicht mehr automatisch die Person,
 * die den Command benutzt hat.
 */
function randomStarter(state, random = Math.random) {
  const value = Number(random());
  const roll = Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
  return roll < 0.5 ? state.challengerId : state.opponentId;
}

/**
 * Nimmt eine Herausforderung an. Bei einer offenen Runde wird die annehmende
 * Person zum Gegner; bei einer gezielten Anfrage darf nur der Gegner klicken.
 */
function acceptChallenge(state, userId, now = Date.now(), random = Math.random) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_PENDING) return { error: 'not_pending', state: s };
  const id = String(userId);
  const open = isOpenChallenge(s);
  if (open && id === s.challengerId) return { error: 'self_join', state: s };
  if (!open && id !== s.opponentId) return { error: 'not_opponent', state: s };
  if (Number(now) >= s.expiresAt) return { error: 'expired', state: expireChallenge(s, now) };

  const joined = open ? cloneState(s, { opponentId: id }) : s;
  return {
    state: cloneState(joined, {
      status: STATUS_ACTIVE,
      turn: randomStarter(joined, random),
      acceptedAt: Number(now),
    }),
  };
}

/**
 * Gezielte Anfrage: nur der Gegner darf ablehnen.
 * Offene Runde: nur der Herausforderer darf seine Suche abbrechen.
 */
function declineChallenge(state, userId, now = Date.now()) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_PENDING) return { error: 'not_pending', state: s };
  const id = String(userId);
  const open = isOpenChallenge(s);
  if (open && id !== s.challengerId) return { error: 'not_challenger', state: s };
  if (!open && id !== s.opponentId) return { error: 'not_opponent', state: s };
  if (Number(now) >= s.expiresAt) return { error: 'expired', state: expireChallenge(s, now) };
  return {
    state: cloneState(s, {
      status: open ? STATUS_CANCELLED : STATUS_DECLINED,
      turn: '',
      finishedAt: Number(now),
    }),
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
  if (state.opponentId && String(userId) === state.opponentId) return 2;
  return 0;
}

/** Bewegt den Spalten-Zeiger von Vier Gewinnt (nur die Person am Zug). */
function moveCursor(state, userId, action) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_ACTIVE) return { error: 'not_active', state: s };
  if (s.game !== GAME_CONNECT4) return { error: 'invalid_move', state: s };
  if (!tokenFor(s, userId)) return { error: 'not_player', state: s };
  if (s.turn !== String(userId)) return { error: 'not_turn', state: s };
  if (!CURSOR_ACTIONS.includes(action)) return { error: 'invalid_move', state: s };

  const free = freeColumns(s.board);
  if (!free.length) return { error: 'invalid_move', state: s };

  let cursor = s.cursor;
  if (action === 'first') cursor = free[0];
  else if (action === 'last') cursor = free[free.length - 1];
  else cursor = nextFreeColumn(s.board, s.cursor, action === 'left' ? -1 : 1);

  return { state: cloneState(s, { cursor }), moved: cursor !== s.cursor };
}

function applyMove(state, userId, position, now = Date.now()) {
  const s = normalizeState(state);
  if (!s || s.status !== STATUS_ACTIVE) return { error: 'not_active', state: s };
  const token = tokenFor(s, userId);
  if (!token) return { error: 'not_player', state: s };
  if (s.turn !== String(userId)) return { error: 'not_turn', state: s };

  const board = [...s.board];
  let cell;
  let column;
  if (s.game === GAME_TTT) {
    cell = Number(position);
    if (!Number.isInteger(cell) || cell < 0 || cell >= 9) return { error: 'invalid_move', state: s };
    if (board[cell]) return { error: 'cell_taken', state: s };
  } else {
    column = position === undefined || position === null ? s.cursor : Number(position);
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
  const cursor = s.game === GAME_CONNECT4 ? sanitizeCursor(board, column) : 0;
  const won = s.game === GAME_TTT ? tttWinner(board) : connect4Winner(board, cell);
  if (won) {
    return {
      state: cloneState(s, {
        board,
        moves,
        cursor,
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
        cursor,
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
      cursor,
      turn: String(userId) === s.challengerId ? s.opponentId : s.challengerId,
    }),
    cell,
  };
}

function parseCustomId(customId) {
  const id = String(customId || '');
  if (id === CID.accept) return { kind: 'accept' };
  if (id === CID.decline) return { kind: 'decline' };
  const ttt = id.match(/^mg_ttt_([0-8])$/);
  if (ttt) return { kind: 'move', game: GAME_TTT, position: Number(ttt[1]) };
  if (id === CID.connect4Drop) return { kind: 'move', game: GAME_CONNECT4, position: null };
  const cursor = id.match(/^mg_c4_(first|left|right|last)$/);
  if (cursor) return { kind: 'cursor', game: GAME_CONNECT4, action: cursor[1] };
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
  STATUS_CANCELLED,
  STATUS_EXPIRED,
  CHALLENGE_TTL_MS,
  C4_COLUMNS,
  C4_ROWS,
  C4_SIZE,
  TTT_SIZE,
  GAME_MARKER,
  LANG_MARKER,
  VALID_LANGS,
  CURSOR_ACTIONS,
  CID,
  normalizeLang,
  boardSize,
  emptyBoard,
  columnFull,
  freeColumns,
  nextFreeColumn,
  createChallenge,
  isOpenChallenge,
  normalizeState,
  encodeGamePayload,
  decodeGamePayload,
  encodeLanguagePayload,
  decodeLanguagePayload,
  randomStarter,
  acceptChallenge,
  declineChallenge,
  expireChallenge,
  tttWinner,
  connect4Winner,
  moveCursor,
  applyMove,
  parseCustomId,
};
