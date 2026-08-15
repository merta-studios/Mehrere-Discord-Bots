/**
 * 🧩 2048 – Single-Player-Spiel des Minigames-Bots.
 *
 * Reine, Discord-unabhängige Logik. Wie bei den Multiplayer-Spielen steckt
 * der komplette Spielstand später unsichtbar in der Discord-Nachricht, damit
 * eine Runde Bot-Neustarts und Deployments überlebt – ganz ohne Datenbank.
 *
 * Besonderheiten dieser Umsetzung:
 * - Originalgetreue 4×4-Mechanik inklusive „ein Stein verschmilzt pro Zug nur
 *   einmal“ und 90 % / 10 % Verteilung beim Nachrücken neuer Steine.
 * - Ein Schritt **Rückgängig** (der vorherige Zustand reist im Marker mit).
 * - 2048 beendet das Spiel nicht: es gibt einen Sieg-Moment und danach den
 *   Endlos-Modus für 4096, 8192 …
 * - Für die Anzeige merkt sich der Zustand, welcher Stein neu ist und welche
 *   Felder gerade verschmolzen sind.
 *
 * Intern werden **Exponenten** gespeichert (0 = leer, 1 = 2, 2 = 4, …). Das
 * hält den Marker winzig: das ganze Brett sind 16 Zeichen.
 */

const SIZE = 4;
const CELLS = SIZE * SIZE;

const GAME_2048 = '2048';
const SOLO_GAMES = [GAME_2048];

/** 2 hoch 11 = 2048 – der klassische Siegstein. */
const WIN_EXP = 11;
const MAX_EXP = 31;

const SOLO_ACTIVE = 'active';
const SOLO_WON = 'won';
const SOLO_OVER = 'over';
const SOLO_STATUSES = [SOLO_ACTIVE, SOLO_WON, SOLO_OVER];

const DIRECTIONS = ['up', 'down', 'left', 'right'];

// v1 des Solo-Markers. Bewusst ein anderer Marker als bei den Battles, damit
// beide Spielarten sich niemals gegenseitig fehlinterpretieren können.
const SOLO_MARKER = 'msolo::v1::';

const SOLO_PREFIX = 'mg_s_';
const SOLO_CID = {
  prefix: SOLO_PREFIX,
  move: (direction) => `${SOLO_PREFIX}2048_${direction}`,
  undo: `${SOLO_PREFIX}2048_undo`,
  restart: `${SOLO_PREFIX}2048_new`,
  resume: `${SOLO_PREFIX}2048_go`,
  pad: (slot) => `${SOLO_PREFIX}2048_pad${slot}`,
};

const VALID_LANGS = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];

function normalizeLang(code) {
  const value = String(code || '').toLowerCase();
  return VALID_LANGS.includes(value) ? value : 'en';
}

/* ------------------------------------------------------------------ *
 * Brett-Grundlagen
 * ------------------------------------------------------------------ */

function emptyBoard() {
  return Array(CELLS).fill(0);
}

function tileValue(exp) {
  return exp > 0 ? 2 ** exp : 0;
}

function emptyCells(board) {
  const out = [];
  for (let i = 0; i < CELLS; i += 1) if (!board[i]) out.push(i);
  return out;
}

function highestExp(board) {
  return board.reduce((best, exp) => (exp > best ? exp : best), 0);
}

function bestTile(board) {
  return tileValue(highestExp(board));
}

/** Zufälliger Wert im Bereich [0, max) – robust gegen kaputte RNGs. */
function randomIndex(max, random) {
  const raw = Number(random());
  const value = Number.isFinite(raw) ? Math.min(0.9999999, Math.max(0, raw)) : 0;
  return Math.floor(value * max);
}

/**
 * Setzt einen neuen Stein auf ein freies Feld: 90 % eine 2, 10 % eine 4 –
 * exakt wie im Original.
 */
function spawnTile(board, random = Math.random) {
  const free = emptyCells(board);
  if (!free.length) return { board: [...board], index: -1 };
  const cell = free[randomIndex(free.length, random)];
  const next = [...board];
  next[cell] = Number(random()) < 0.1 ? 2 : 1;
  return { board: next, index: cell };
}

/** Indizes einer Reihe/Spalte, beginnend an der Kante, zu der geschoben wird. */
function lineIndices(direction) {
  const lines = [];
  for (let i = 0; i < SIZE; i += 1) {
    const line = [];
    for (let j = 0; j < SIZE; j += 1) {
      let row;
      let col;
      if (direction === 'left') { row = i; col = j; }
      else if (direction === 'right') { row = i; col = SIZE - 1 - j; }
      else if (direction === 'up') { row = j; col = i; }
      else { row = SIZE - 1 - j; col = i; }
      line.push(row * SIZE + col);
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Schiebt eine Linie zur Kante (Index 0) zusammen. Ein bereits verschmolzener
 * Stein nimmt im selben Zug an keiner weiteren Verschmelzung mehr teil.
 */
function slideLine(values) {
  const out = [];
  const merged = [];
  let gained = 0;
  for (const value of values) {
    if (!value) continue;
    const last = out.length - 1;
    if (last >= 0 && out[last] === value && !merged[last] && value < MAX_EXP) {
      out[last] = value + 1;
      merged[last] = true;
      gained += tileValue(value + 1);
    } else {
      out.push(value);
      merged.push(false);
    }
  }
  while (out.length < SIZE) {
    out.push(0);
    merged.push(false);
  }
  return { values: out, merged, gained };
}

/** Führt einen Zug auf dem Brett aus – ohne neuen Stein und ohne Status. */
function slideBoard(board, direction) {
  const next = [...board];
  const mergedCells = [];
  let gained = 0;
  let moved = false;

  for (const line of lineIndices(direction)) {
    const before = line.map((cell) => board[cell]);
    const result = slideLine(before);
    gained += result.gained;
    line.forEach((cell, position) => {
      if (next[cell] !== result.values[position]) moved = true;
      next[cell] = result.values[position];
      if (result.merged[position]) mergedCells.push(cell);
    });
  }

  return { board: next, mergedCells, gained, moved };
}

/** Gibt es überhaupt noch einen möglichen Zug? */
function canMove(board) {
  if (emptyCells(board).length) return true;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const exp = board[row * SIZE + col];
      if (col + 1 < SIZE && board[row * SIZE + col + 1] === exp) return true;
      if (row + 1 < SIZE && board[(row + 1) * SIZE + col] === exp) return true;
    }
  }
  return false;
}

function availableDirections(board) {
  return DIRECTIONS.filter((direction) => slideBoard(board, direction).moved);
}

/* ------------------------------------------------------------------ *
 * Spielstand
 * ------------------------------------------------------------------ */

function normalizeBoard(input) {
  const raw = Array.isArray(input) ? input : [];
  return Array.from({ length: CELLS }, (_, i) => {
    const value = Number(raw[i]);
    return Number.isInteger(value) && value > 0 && value <= MAX_EXP ? value : 0;
  });
}

function normalizeSoloState(input) {
  if (!input || input.game !== GAME_2048) return null;
  const userId = String(input.userId || '');
  if (!userId) return null;

  const board = normalizeBoard(input.board);
  const status = SOLO_STATUSES.includes(input.status) ? input.status : SOLO_ACTIVE;
  const previous = input.previous
    ? {
        board: normalizeBoard(input.previous.board),
        score: Math.max(0, Number(input.previous.score) || 0),
        moves: Math.max(0, Number(input.previous.moves) || 0),
        status: SOLO_STATUSES.includes(input.previous.status) ? input.previous.status : SOLO_ACTIVE,
        reachedWin: Boolean(input.previous.reachedWin),
      }
    : null;

  return {
    game: GAME_2048,
    userId,
    lang: normalizeLang(input.lang),
    board,
    score: Math.max(0, Number(input.score) || 0),
    moves: Math.max(0, Number(input.moves) || 0),
    status,
    reachedWin: Boolean(input.reachedWin) || highestExp(board) >= WIN_EXP,
    lastGain: Math.max(0, Number(input.lastGain) || 0),
    newCell:
      Number.isInteger(Number(input.newCell)) && Number(input.newCell) >= 0 && Number(input.newCell) < CELLS
        ? Number(input.newCell)
        : -1,
    mergedCells: (Array.isArray(input.mergedCells) ? input.mergedCells : [])
      .map(Number)
      .filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < CELLS),
    previous,
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now(),
    finishedAt: Number(input.finishedAt) || 0,
  };
}

/** Legt eine frische Runde mit zwei Startsteinen an. */
function createSoloGame({ game = GAME_2048, userId, lang = 'en', now = Date.now(), random = Math.random } = {}) {
  if (game !== GAME_2048) throw new Error(`Unbekanntes Solo-Spiel: ${game}`);
  const first = spawnTile(emptyBoard(), random);
  const second = spawnTile(first.board, random);
  return normalizeSoloState({
    game: GAME_2048,
    userId,
    lang,
    board: second.board,
    score: 0,
    moves: 0,
    status: SOLO_ACTIVE,
    reachedWin: false,
    lastGain: 0,
    newCell: second.index,
    mergedCells: [],
    previous: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: 0,
  });
}

function cloneSolo(state, changes = {}) {
  return normalizeSoloState({ ...state, ...changes });
}

function isOwner(state, userId) {
  return Boolean(state) && String(userId) === state.userId;
}

/**
 * Führt einen Zug aus. Rückgabe `{ state, gained }` oder `{ error }`:
 * - `not_owner`   – jemand anderes hat geklickt
 * - `game_over`   – die Runde ist bereits vorbei
 * - `no_move`     – in diese Richtung bewegt sich nichts
 */
function moveSolo(state, userId, direction, { now = Date.now(), random = Math.random } = {}) {
  const s = normalizeSoloState(state);
  if (!s) return { error: 'invalid_state', state: s };
  if (!isOwner(s, userId)) return { error: 'not_owner', state: s };
  if (s.status === SOLO_OVER) return { error: 'game_over', state: s };
  if (!DIRECTIONS.includes(direction)) return { error: 'invalid_move', state: s };

  const slid = slideBoard(s.board, direction);
  if (!slid.moved) return { error: 'no_move', state: s };

  const spawned = spawnTile(slid.board, random);
  const board = spawned.board;
  const score = s.score + slid.gained;
  const reachedWin = s.reachedWin || highestExp(board) >= WIN_EXP;
  // Der Sieg-Moment wird genau einmal gefeiert, danach läuft der Endlos-Modus.
  const justWon = !s.reachedWin && reachedWin;
  let status = SOLO_ACTIVE;
  if (justWon) status = SOLO_WON;
  if (!canMove(board)) status = SOLO_OVER;

  return {
    state: cloneSolo(s, {
      board,
      score,
      moves: s.moves + 1,
      status,
      reachedWin,
      lastGain: slid.gained,
      newCell: spawned.index,
      mergedCells: slid.mergedCells,
      previous: {
        board: s.board,
        score: s.score,
        moves: s.moves,
        status: s.status === SOLO_WON ? SOLO_ACTIVE : s.status,
        reachedWin: s.reachedWin,
      },
      updatedAt: now,
      finishedAt: status === SOLO_OVER ? now : 0,
    }),
    gained: slid.gained,
    justWon,
  };
}

/** Ein Schritt zurück – der vorherige Zustand reist im Marker mit. */
function undoSolo(state, userId, { now = Date.now() } = {}) {
  const s = normalizeSoloState(state);
  if (!s) return { error: 'invalid_state', state: s };
  if (!isOwner(s, userId)) return { error: 'not_owner', state: s };
  if (!s.previous) return { error: 'no_undo', state: s };

  return {
    state: cloneSolo(s, {
      board: s.previous.board,
      score: s.previous.score,
      moves: s.previous.moves,
      status: s.previous.status,
      reachedWin: s.previous.reachedWin,
      lastGain: 0,
      newCell: -1,
      mergedCells: [],
      previous: null,
      updatedAt: now,
      finishedAt: 0,
    }),
  };
}

/** Beendet den Sieg-Bildschirm und spielt im Endlos-Modus weiter. */
function resumeSolo(state, userId, { now = Date.now() } = {}) {
  const s = normalizeSoloState(state);
  if (!s) return { error: 'invalid_state', state: s };
  if (!isOwner(s, userId)) return { error: 'not_owner', state: s };
  if (s.status !== SOLO_WON) return { error: 'not_won', state: s };
  return { state: cloneSolo(s, { status: canMove(s.board) ? SOLO_ACTIVE : SOLO_OVER, updatedAt: now }) };
}

/** Startet in derselben Nachricht eine komplett neue Runde. */
function restartSolo(state, userId, { now = Date.now(), random = Math.random } = {}) {
  const s = normalizeSoloState(state);
  if (!s) return { error: 'invalid_state', state: s };
  if (!isOwner(s, userId)) return { error: 'not_owner', state: s };
  return { state: createSoloGame({ userId: s.userId, lang: s.lang, now, random }) };
}

/* ------------------------------------------------------------------ *
 * Marker (unsichtbare „Datenbank“ in der Nachricht)
 * ------------------------------------------------------------------ */

const BOARD_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

function boardToString(board) {
  return board.map((exp) => BOARD_ALPHABET[exp] || '0').join('');
}

function boardFromString(text) {
  const value = String(text || '');
  return Array.from({ length: CELLS }, (_, i) => {
    const index = BOARD_ALPHABET.indexOf(value[i]);
    return index > 0 ? index : 0;
  });
}

function compactSolo(state) {
  const s = normalizeSoloState(state);
  if (!s) return null;
  const compact = {
    v: 1,
    g: s.game,
    u: s.userId,
    l: s.lang,
    b: boardToString(s.board),
    s: s.score,
    m: s.moves,
    t: s.status,
    w: s.reachedWin ? 1 : 0,
    d: s.lastGain,
    n: s.newCell,
    c: s.mergedCells,
    x: s.createdAt,
    y: s.updatedAt,
    f: s.finishedAt,
  };
  if (s.previous) {
    compact.p = [
      boardToString(s.previous.board),
      s.previous.score,
      s.previous.moves,
      s.previous.status,
      s.previous.reachedWin ? 1 : 0,
    ];
  }
  return compact;
}

function expandSolo(data) {
  if (!data || typeof data !== 'object') return null;
  const previous = Array.isArray(data.p)
    ? {
        board: boardFromString(data.p[0]),
        score: Number(data.p[1]) || 0,
        moves: Number(data.p[2]) || 0,
        status: data.p[3],
        reachedWin: Boolean(Number(data.p[4])),
      }
    : null;
  return normalizeSoloState({
    game: data.g,
    userId: data.u,
    lang: data.l,
    board: boardFromString(data.b),
    score: data.s,
    moves: data.m,
    status: data.t,
    reachedWin: Boolean(Number(data.w)),
    lastGain: data.d,
    newCell: data.n,
    mergedCells: data.c,
    previous,
    createdAt: data.x,
    updatedAt: data.y,
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

function encodeSoloPayload(state) {
  const compact = compactSolo(state);
  if (!compact) throw new Error('Ungültiger Solo-Spielstand');
  return `${SOLO_MARKER}${encodeJson(compact)}`;
}

function decodeSoloPayload(payload) {
  const text = String(payload || '');
  const index = text.indexOf(SOLO_MARKER);
  if (index === -1) return null;
  const encoded = text.slice(index + SOLO_MARKER.length).match(/^[A-Za-z0-9_-]+/)?.[0];
  return encoded ? expandSolo(decodeJson(encoded)) : null;
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

function parseSoloCustomId(customId) {
  const id = String(customId || '');
  if (!id.startsWith(SOLO_PREFIX)) return null;
  const move = id.match(/^mg_s_2048_(up|down|left|right)$/);
  if (move) return { kind: 'move', game: GAME_2048, direction: move[1] };
  if (id === SOLO_CID.undo) return { kind: 'undo', game: GAME_2048 };
  if (id === SOLO_CID.restart) return { kind: 'restart', game: GAME_2048 };
  if (id === SOLO_CID.resume) return { kind: 'resume', game: GAME_2048 };
  if (/^mg_s_2048_pad\d$/.test(id)) return { kind: 'noop', game: GAME_2048 };
  return null;
}

module.exports = {
  SIZE,
  CELLS,
  GAME_2048,
  SOLO_GAMES,
  WIN_EXP,
  MAX_EXP,
  SOLO_ACTIVE,
  SOLO_WON,
  SOLO_OVER,
  SOLO_STATUSES,
  DIRECTIONS,
  SOLO_MARKER,
  SOLO_PREFIX,
  SOLO_CID,
  normalizeLang,
  emptyBoard,
  tileValue,
  emptyCells,
  highestExp,
  bestTile,
  spawnTile,
  lineIndices,
  slideLine,
  slideBoard,
  canMove,
  availableDirections,
  normalizeSoloState,
  createSoloGame,
  isOwner,
  moveSolo,
  undoSolo,
  resumeSolo,
  restartSolo,
  boardToString,
  boardFromString,
  encodeSoloPayload,
  decodeSoloPayload,
  parseSoloCustomId,
};
