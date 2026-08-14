/** Tests des Minigames-Bots – vollständig ohne Discord-Verbindung. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageFlags, ChannelType } = require('discord.js');

const {
  GAME_TTT,
  GAME_CONNECT4,
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
  CID,
  createChallenge,
  encodeGamePayload,
  decodeGamePayload,
  encodeLanguagePayload,
  decodeLanguagePayload,
  acceptChallenge,
  declineChallenge,
  expireChallenge,
  applyMove,
  moveCursor,
  randomStarter,
  isOpenChallenge,
  freeColumns,
  nextFreeColumn,
  parseCustomId,
} = require('../bots/minigames-bot/src/games');
const {
  extractAllText,
  parseGameMessage,
  parseLanguageMessage,
  buildGameContainer,
  buildGamePayload,
  buildLanguageContainer,
  connect4Cursor,
} = require('../bots/minigames-bot/src/embed-builder');
const { defineCommands, setLanguageCmd } = require('../bots/minigames-bot/src/commands');
const {
  parseCountingNumber,
  evaluateCount,
  createCountingState,
  failureText,
  safeFailureText,
  FAIL_VARIANTS,
  RAGE_VARIANTS,
  FREAKOUT_PINGS,
  FREAKOUT_CHANCE,
  shouldFreakout,
  pingBomb,
  buildFreakoutLines,
  buildEscalationLines,
  rageTierForCount,
  buildCountingTopic,
  parseCountingTopic,
  stripCountingTopic,
  TOPIC_MAX_LENGTH,
  createCountingManager,
} = require('../bots/minigames-bot/src/counting');
const {
  pickVoiceChannel,
  createVoicePresenceManager,
} = require('../bots/minigames-bot/src/voice-presence');
const { renderDetailPayload } = require('../bots/minigames-bot/src/admin-panel');
const { T } = require('../bots/minigames-bot/src/languages');

function asMessage(container) {
  return { content: '', components: [container.toJSON()], embeds: [] };
}

function customIds(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) customIds(item, out);
  } else if (typeof value === 'object') {
    if (value.custom_id) out.push(value.custom_id);
    if (value.components) customIds(value.components, out);
  }
  return out;
}

function startTtt(now = 1_000) {
  const pending = createChallenge({
    game: GAME_TTT,
    challengerId: 'u1',
    opponentId: 'u2',
    lang: 'de',
    now,
  });
  // Startspieler ist zufällig – für Tests wird er fest auf den Herausforderer gelegt.
  return acceptChallenge(pending, 'u2', now + 1, () => 0).state;
}

test('Challenge-Marker speichert den vollständigen Spielstand', () => {
  const state = createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', lang: 'de', now: 50 });
  const payload = encodeGamePayload(state);
  assert.ok(payload.startsWith('mgame::v3::'));
  assert.deepEqual(decodeGamePayload(payload), state);
});

test('Sprach-Marker speichert Server, Sprache und Zeitpunkt', () => {
  const payload = encodeLanguagePayload('g1', 'ja', 12345);
  assert.deepEqual(decodeLanguagePayload(payload), { guildId: 'g1', lang: 'ja', changedAt: 12345 });
  const container = buildLanguageContainer('g1', 'ja', '保存しました', 12345);
  assert.deepEqual(parseLanguageMessage(asMessage(container)), { guildId: 'g1', lang: 'ja', changedAt: 12345 });
});

test('Herausforderung ist genau eine Stunde offen und nur der Gegner kann annehmen', () => {
  const state = createChallenge({ game: GAME_TTT, challengerId: 'u1', opponentId: 'u2', now: 100 });
  assert.equal(state.expiresAt, 100 + CHALLENGE_TTL_MS);
  assert.equal(acceptChallenge(state, 'u1', 200).error, 'not_opponent');

  const accepted = acceptChallenge(state, 'u2', 200).state;
  assert.equal(accepted.status, STATUS_ACTIVE);
  assert.ok(['u1', 'u2'].includes(accepted.turn));

  const expired = expireChallenge(state, state.expiresAt);
  assert.equal(expired.status, STATUS_EXPIRED);
  assert.equal(acceptChallenge(state, 'u2', state.expiresAt).error, 'expired');
});

test('Gegner kann eine offene Herausforderung ablehnen', () => {
  const state = createChallenge({ game: GAME_TTT, challengerId: 'u1', opponentId: 'u2', now: 100 });
  assert.equal(declineChallenge(state, 'spectator', 200).error, 'not_opponent');
  assert.equal(declineChallenge(state, 'u2', 200).state.status, STATUS_DECLINED);
});

test('Tic-Tac-Toe erzwingt Spieler, Reihenfolge und freie Felder', () => {
  let state = startTtt();
  assert.equal(applyMove(state, 'spectator', 0).error, 'not_player');
  assert.equal(applyMove(state, 'u2', 0).error, 'not_turn');

  state = applyMove(state, 'u1', 0).state;
  assert.equal(state.board[0], 1);
  assert.equal(state.turn, 'u2');
  assert.equal(applyMove(state, 'u2', 0).error, 'cell_taken');
});

test('Tic-Tac-Toe erkennt Sieg und markiert die Gewinnlinie', () => {
  let state = startTtt();
  for (const [user, cell] of [['u1', 0], ['u2', 3], ['u1', 1], ['u2', 4], ['u1', 2]]) {
    state = applyMove(state, user, cell).state;
  }
  assert.equal(state.status, STATUS_WON);
  assert.equal(state.winnerId, 'u1');
  assert.deepEqual(state.winningCells, [0, 1, 2]);
});

test('Tic-Tac-Toe erkennt ein volles Unentschieden', () => {
  let state = startTtt();
  const moves = [
    ['u1', 0], ['u2', 1], ['u1', 2],
    ['u2', 4], ['u1', 3], ['u2', 5],
    ['u1', 7], ['u2', 6], ['u1', 8],
  ];
  for (const [user, cell] of moves) state = applyMove(state, user, cell).state;
  assert.equal(state.status, STATUS_DRAW);
});

test('Vier Gewinnt lässt Chips fallen, sperrt volle Spalten und erkennt vertikalen Sieg', () => {
  let state = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 100 }),
    'u2',
    101,
    () => 0
  ).state;
  const moves = [
    ['u1', 0], ['u2', 1], ['u1', 0], ['u2', 1],
    ['u1', 0], ['u2', 1], ['u1', 0],
  ];
  for (const [user, column] of moves) state = applyMove(state, user, column).state;
  assert.equal(state.status, STATUS_WON);
  assert.equal(state.winnerId, 'u1');
  assert.deepEqual(state.winningCells, [14, 21, 28, 35], 'Spalte 0, Reihen 2-5 im 7x6-Brett');
});

test('Vier Gewinnt erkennt waagerechte und diagonale Reihen', () => {
  let horizontal = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2, () => 0
  ).state;
  for (const [user, column] of [['u1', 0], ['u2', 0], ['u1', 1], ['u2', 1], ['u1', 2], ['u2', 2], ['u1', 3]]) {
    horizontal = applyMove(horizontal, user, column).state;
  }
  assert.equal(horizontal.status, STATUS_WON);

  const diagonalBoard = Array(C4_COLUMNS * C4_ROWS).fill(0);
  const at = (row, col) => row * C4_COLUMNS + col;
  // u1 hat drei diagonal steigende Chips; der vierte fällt in Spalte 3 auf Zeile 2.
  diagonalBoard[at(5, 0)] = 1;
  diagonalBoard[at(4, 1)] = 1; diagonalBoard[at(5, 1)] = 2;
  diagonalBoard[at(3, 2)] = 1; diagonalBoard[at(4, 2)] = 2; diagonalBoard[at(5, 2)] = 2;
  diagonalBoard[at(4, 3)] = 2; diagonalBoard[at(5, 3)] = 2; diagonalBoard[at(3, 3)] = 2;
  let diagonal = {
    ...horizontal,
    status: STATUS_ACTIVE,
    board: diagonalBoard,
    turn: 'u1',
    winnerId: '',
    winningCells: [],
    moves: diagonalBoard.filter(Boolean).length,
  };
  diagonal = applyMove(diagonal, 'u1', 3).state;
  assert.equal(diagonal.status, STATUS_WON);
  assert.equal(diagonal.winnerId, 'u1');
});

test('Challenge-UI pingt Gegner, zeigt Deadline und hat Annahme-/Ablehnen-Buttons', () => {
  const state = createChallenge({ game: GAME_TTT, challengerId: 'u1', opponentId: 'u2', lang: 'de', now: 100 });
  const container = buildGameContainer(state);
  const json = container.toJSON();
  const text = extractAllText(json);
  const ids = customIds(json);
  assert.ok(text.includes('<@u2>'));
  assert.ok(text.includes(`<t:${Math.floor(state.expiresAt / 1000)}:R>`));
  assert.ok(ids.includes(CID.accept));
  assert.ok(ids.includes(CID.decline));
  assert.deepEqual(parseGameMessage(asMessage(container)), state);
});

function actionRows(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) actionRows(item, out);
  } else if (typeof value === 'object') {
    if (value.type === 1 && Array.isArray(value.components)) out.push(value);
    if (value.components) actionRows(value.components, out);
  }
  return out;
}

function collectButtons(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectButtons(item, out);
  } else if (typeof value === 'object') {
    if (value.custom_id && value.label) out.push(value);
    if (value.components) collectButtons(value.components, out);
  }
  return out;
}

test('Tic-Tac-Toe zeigt genau EIN Spielfeld: neun Buttons, kein Textbrett', () => {
  const state = startTtt();
  const json = buildGameContainer(state).toJSON();
  assert.equal(customIds(json).filter((id) => id.startsWith('mg_ttt_')).length, 9);

  // Die Buttons sind das Spielfeld – im Text darf kein zweites Brett stehen.
  const text = extractAllText(json);
  assert.ok(!text.includes('⬜'), 'kein Text-Spielfeld neben den Buttons');
  assert.ok(!text.includes('┃'), 'keine gezeichneten Brett-Trenner mehr');
});

test('Vier Gewinnt ist 7x6 gross und hat genau EINE Steuerreihe mit fuenf Buttons', () => {
  const state = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2, () => 0
  ).state;
  const json = buildGameContainer(state).toJSON();

  assert.equal(C4_COLUMNS, 7, 'klassische Breite');
  assert.equal(C4_ROWS, 6, 'klassische Hoehe');

  const rows = actionRows(json);
  const controlRows = rows.filter((row) =>
    row.components.every((component) => String(component.custom_id || '').startsWith('mg_c4_'))
  );
  assert.equal(controlRows.length, 1, 'genau eine Button-Reihe');
  assert.equal(controlRows[0].components.length, 5, 'Discords Maximum pro Action-Row');
  assert.deepEqual(customIds(json).filter((id) => id.startsWith('mg_c4_')), [
    'mg_c4_first', 'mg_c4_left', 'mg_c4_drop', 'mg_c4_right', 'mg_c4_last',
  ]);
});

test('Tic-Tac-Toe-Buttons bleiben nach einem Zug gleich breit', () => {
  let state = startTtt();
  const emptyLabels = collectButtons(buildGameContainer(state).toJSON())
    .filter((btn) => btn.custom_id.startsWith('mg_ttt_'))
    .map((btn) => btn.label);
  assert.equal(new Set(emptyLabels.map((label) => [...label].length)).size, 1);

  state = applyMove(state, 'u1', 4).state;
  const after = collectButtons(buildGameContainer(state).toJSON())
    .filter((btn) => btn.custom_id.startsWith('mg_ttt_'));
  assert.equal(new Set(after.map((btn) => [...btn.label].length)).size, 1);
  assert.equal([...after[0].label].length, [...emptyLabels[0]].length);
});

test('Vier-Gewinnt-Brett bleibt zur Zeiger-Zeile bündig und braucht keine Spaltennummern', () => {
  let state = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2, () => 0
  ).state;
  state = applyMove(state, state.turn, 0).state;
  const json = buildGameContainer(state).toJSON();
  const text = extractAllText(json);

  // Niemand soll mehr Spalten abzählen müssen.
  for (const digit of ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣']) {
    assert.ok(!text.includes(digit), `Spaltennummer ${digit} darf nicht mehr vorkommen`);
  }

  const boardRows = text.split('\n').filter((line) => /^[⚫🔴🟡🟥🟨]+$/u.test(line));
  assert.equal(boardRows.length, C4_ROWS);
  for (const row of boardRows) assert.equal([...row].length, C4_COLUMNS);

  // Die Zeiger-Zeile steht im selben Textblock und ist genauso breit wie das
  // Brett – dadurch kann sie nicht gegen die Spalten verrutschen.
  const cursorRow = text.split('\n').find((line) => line.includes('🔽'));
  assert.ok(cursorRow, 'Zeiger-Zeile vorhanden');
  assert.equal([...cursorRow].length, C4_COLUMNS);
  assert.equal([...cursorRow].indexOf('🔽'), state.cursor);
  assert.deepEqual(connect4Cursor(3), [...'⬛⬛⬛🔽⬛⬛⬛']. join(''));

  const labels = collectButtons(json)
    .filter((btn) => btn.custom_id.startsWith('mg_c4_'))
    .map((btn) => btn.label);
  assert.equal(labels.length, 5);
  assert.equal(new Set(labels.map((label) => [...label].length)).size, 1, 'gleich breite Buttons');
});

test('Der Zeiger springt nur ueber freie Spalten und der Wurf nutzt seine Spalte', () => {
  let state = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2, () => 0
  ).state;
  assert.equal(state.cursor, 3, 'Start in der Mitte');

  const spectator = moveCursor(state, 'spectator', 'left');
  assert.equal(spectator.error, 'not_player');

  const right = moveCursor(state, state.turn, 'right');
  assert.equal(right.state.cursor, 4);
  assert.equal(right.moved, true);
  assert.equal(moveCursor(state, state.turn, 'first').state.cursor, 0);
  assert.equal(moveCursor(state, state.turn, 'last').state.cursor, C4_COLUMNS - 1);
  assert.equal(moveCursor(state, state.turn, 'wobble').error, 'invalid_move');

  // Volle Spalte 4 wird uebersprungen.
  const board = [...state.board];
  for (let row = 0; row < C4_ROWS; row += 1) board[row * C4_COLUMNS + 4] = 1;
  const blocked = { ...state, board, cursor: 3 };
  assert.equal(moveCursor(blocked, state.turn, 'right').state.cursor, 5);
  assert.deepEqual(freeColumns(board), [0, 1, 2, 3, 5, 6]);
  assert.equal(nextFreeColumn(board, 6, 1), 0, 'mit Umlauf');

  // Ohne Position wird die Spalte des Zeigers benutzt.
  const dropped = applyMove(right.state, right.state.turn, null);
  assert.equal(dropped.cell, (C4_ROWS - 1) * C4_COLUMNS + 4);
});

test('Game-Payload nutzt Components V2 und pingt in der Anfrage gezielt nur den Gegner', () => {
  const state = createChallenge({ game: GAME_TTT, challengerId: 'u1', opponentId: 'u2' });
  const payload = buildGamePayload(state);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(payload.allowedMentions.users, ['u2']);
  assert.deepEqual(payload.allowedMentions.parse, []);
});

test('Custom-IDs werden strikt geparst', () => {
  assert.deepEqual(parseCustomId('mg_accept'), { kind: 'accept' });
  assert.deepEqual(parseCustomId('mg_decline'), { kind: 'decline' });
  assert.deepEqual(parseCustomId('mg_ttt_8'), { kind: 'move', game: GAME_TTT, position: 8 });
  assert.deepEqual(parseCustomId('mg_c4_drop'), { kind: 'move', game: GAME_CONNECT4, position: null });
  assert.deepEqual(parseCustomId('mg_c4_left'), { kind: 'cursor', game: GAME_CONNECT4, action: 'left' });
  assert.deepEqual(parseCustomId('mg_c4_last'), { kind: 'cursor', game: GAME_CONNECT4, action: 'last' });
  assert.equal(parseCustomId('mg_ttt_9'), null);
  assert.equal(parseCustomId('mg_c4_4'), null, 'Spalten werden nicht mehr direkt angeklickt');
  assert.equal(parseCustomId('vrf_verify'), null, 'alte Verify-Buttons sind entfernt');
});

const VALID_LOCALES = new Set([
  'id', 'da', 'de', 'en-GB', 'en-US', 'es-ES', 'es-419', 'fr', 'hr', 'it', 'lt',
  'hu', 'nl', 'no', 'pl', 'pt-BR', 'ro', 'fi', 'sv-SE', 'vi', 'tr', 'cs', 'el',
  'bg', 'ru', 'uk', 'hi', 'th', 'zh-CN', 'ja', 'zh-TW', 'ko',
]);

function assertLocales(map, path) {
  for (const locale of Object.keys(map || {})) {
    assert.ok(VALID_LOCALES.has(locale), `${path}: ungültige Locale ${locale}`);
  }
}

test('nur die sechs gewünschten Slash-Commands sind registriert und API-valide', () => {
  const commands = defineCommands().map((command) => command.toJSON());
  assert.deepEqual(commands.map((command) => command.name), [
    'play', 'set_language', 'set_counting_channel', 'admin_set_bot_profile', 'help', 'adminpanel',
  ]);
  const play = commands[0];
  assert.deepEqual(play.options[0].choices.map((choice) => choice.value), [GAME_TTT, GAME_CONNECT4]);
  assert.equal(play.options[1].required, false, 'der Gegner ist optional');
  assert.equal(commands[1].options[0].choices.length, 10);
  assert.equal(commands[1].default_member_permissions, '8');
  assert.equal(commands[2].default_member_permissions, '8', 'Counting nur für Admins');
  assert.equal(commands[2].options[0].required, true);
  assert.equal(commands[2].options[1].required, false);
  assert.equal(commands[3].default_member_permissions, '8');

  for (const command of commands) {
    assertLocales(command.name_localizations, `${command.name}.name`);
    assertLocales(command.description_localizations, `${command.name}.description`);
    for (const option of command.options || []) {
      assertLocales(option.name_localizations, `${command.name}.${option.name}.name`);
      assertLocales(option.description_localizations, `${command.name}.${option.name}.description`);
      for (const choice of option.choices || []) {
        assertLocales(choice.name_localizations, `${command.name}.${option.name}.${choice.value}`);
      }
    }
  }
});

test('/set_language bestätigt sofort, auch wenn die Counting-Synchronisierung hängt', async () => {
  const { createStore } = require('../bots/minigames-bot/src/store');
  let edited = false;
  const interaction = {
    guildId: 'guild-language',
    guild: { id: 'guild-language' },
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: { getString: () => 'de' },
    deferReply: async () => {},
    editReply: async () => {
      edited = true;
      return { id: 'language-confirmation' };
    },
  };
  const ctx = {
    store: createStore(),
    countingManager: { setGuildLanguage: () => new Promise(() => {}) },
    logger: { warn() {} },
  };

  const result = await Promise.race([
    setLanguageCmd(ctx, interaction),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Command blockiert')), 250)),
  ]);
  assert.deepEqual(result, { id: 'language-confirmation' });
  assert.equal(edited, true);
  assert.equal(ctx.store.getServerLang('guild-language'), 'de');
});

/* ------------------------------------------------------------------ *
 * Offene Herausforderung & zufälliger Startspieler
 * ------------------------------------------------------------------ */

test('Ohne Gegner entsteht eine offene Runde, der jeder beitreten darf', () => {
  const open = createChallenge({ game: GAME_TTT, challengerId: 'u1', lang: 'de', now: 100 });
  assert.equal(open.opponentId, '');
  assert.ok(isOpenChallenge(open));

  // Der Herausforderer darf nicht gegen sich selbst spielen.
  assert.equal(acceptChallenge(open, 'u1', 200).error, 'self_join');

  const joined = acceptChallenge(open, 'u9', 200, () => 0.9).state;
  assert.equal(joined.status, STATUS_ACTIVE);
  assert.equal(joined.opponentId, 'u9', 'wer klickt, wird zum Gegner');
  assert.equal(joined.turn, 'u9');
});

test('Nur der Herausforderer kann seine offene Suche abbrechen', () => {
  const open = createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', now: 100 });
  assert.equal(declineChallenge(open, 'u2', 200).error, 'not_challenger');
  const cancelled = declineChallenge(open, 'u1', 200).state;
  assert.equal(cancelled.status, STATUS_CANCELLED);
  assert.equal(cancelled.turn, '');
});

test('Der Startspieler wird ausgewürfelt – nicht immer der Command-Nutzer', () => {
  const state = createChallenge({ game: GAME_TTT, challengerId: 'u1', opponentId: 'u2', now: 1 });
  assert.equal(randomStarter(state, () => 0), 'u1');
  assert.equal(randomStarter(state, () => 0.99), 'u2');
  assert.equal(acceptChallenge(state, 'u2', 2, () => 0).state.turn, 'u1');
  assert.equal(acceptChallenge(state, 'u2', 2, () => 0.99).state.turn, 'u2');

  // Über viele Runden treten beide Startspieler auf.
  const starters = new Set();
  for (let i = 0; i < 200; i += 1) starters.add(acceptChallenge(state, 'u2', 2).state.turn);
  assert.deepEqual([...starters].sort(), ['u1', 'u2']);
});

test('Die offene Runde erklärt die Suche und pingt niemanden', () => {
  const open = createChallenge({ game: GAME_TTT, challengerId: 'u1', lang: 'de', now: 100 });
  const json = buildGameContainer(open).toJSON();
  const text = extractAllText(json);
  assert.ok(text.includes('<@u1>'));
  assert.ok(text.includes('sucht jemanden'), 'Hinweis auf die offene Suche');
  assert.deepEqual(buildGamePayload(open).allowedMentions.users, []);
  assert.deepEqual(parseGameMessage(asMessage(buildGameContainer(open))), open);
});

/* ------------------------------------------------------------------ *
 * Counting-Spiel
 * ------------------------------------------------------------------ */

test('Als Zahl gilt nur eine reine Zahl', () => {
  assert.equal(parseCountingNumber('1'), 1);
  assert.equal(parseCountingNumber('  42 '), 42);
  assert.equal(parseCountingNumber('7!'), null);
  assert.equal(parseCountingNumber('7 nice'), null);
  assert.equal(parseCountingNumber('sieben'), null);
  assert.equal(parseCountingNumber(''), null);
  assert.equal(parseCountingNumber('1e3'), null);
});

test('Counting startet bei 1 und akzeptiert nur die nächste Zahl', () => {
  let state = createCountingState();
  const first = evaluateCount(state, { userId: 'a', content: '1' });
  assert.equal(first.action, 'accept');
  state = first.state;
  assert.equal(state.count, 1);

  const second = evaluateCount(state, { userId: 'b', content: '2' });
  assert.equal(second.action, 'accept');
  assert.equal(second.state.count, 2);
});

test('Niemand darf zwei Zahlen hintereinander schreiben – nur löschen, kein Neustart', () => {
  const state = evaluateCount(createCountingState(), { userId: 'a', content: '1' }).state;
  const again = evaluateCount(state, { userId: 'a', content: '2' });
  assert.equal(again.action, 'delete');
  assert.equal(again.reason, 'double');
  assert.equal(again.state.count, 1, 'Zählstand bleibt erhalten');
});

test('Text statt Zahl wird nur gelöscht', () => {
  const state = createCountingState(5, 'a');
  const result = evaluateCount(state, { userId: 'b', content: 'moin' });
  assert.equal(result.action, 'delete');
  assert.equal(result.reason, 'text');
  assert.equal(result.state.count, 5);
});

test('Falsche Zahl setzt zurück auf 0 und meldet Erwartung und Eingabe', () => {
  const state = createCountingState(5, 'a');
  const result = evaluateCount(state, { userId: 'b', content: '9' });
  assert.equal(result.action, 'reset');
  assert.equal(result.reason, 'wrong');
  assert.equal(result.expected, 6);
  assert.equal(result.got, 9);
  assert.equal(result.state.count, 0);
  assert.equal(result.state.lastUserId, '');
  assert.equal(evaluateCount(result.state, { userId: 'b', content: '1' }).action, 'accept');
});

test('Es gibt mehrere abwechslungsreiche Spott-Texte in allen Sprachen', () => {
  const vars = { user: '<@a>', expected: 6, got: 9 };
  const texts = new Set();
  for (let i = 0; i < FAIL_VARIANTS; i += 1) {
    const text = failureText('de', vars, i);
    assert.ok(text.includes('<@a>') && text.includes('6') && text.includes('9'));
    texts.add(text);
  }
  assert.equal(texts.size, FAIL_VARIANTS, 'jede Variante ist eigenständig');
  assert.equal(failureText('de', vars, FAIL_VARIANTS), failureText('de', vars, 0), 'Index läuft um');

  for (let i = 1; i <= FAIL_VARIANTS; i += 1) {
    for (const lang of ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it']) {
      assert.ok(T[`countFail${i}`][lang], `countFail${i} fehlt in ${lang}`);
    }
  }

  // Die Durchdreh-Bausteine müssen ebenfalls in allen Sprachen vorliegen.
  for (let i = 1; i <= RAGE_VARIANTS; i += 1) {
    for (const lang of ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it']) {
      assert.ok(T[`countRageTitle${i}`][lang], `countRageTitle${i} fehlt in ${lang}`);
      assert.ok(T[`countRageBody${i}`][lang], `countRageBody${i} fehlt in ${lang}`);
    }
  }
});

test('Beim Durchdrehen bleibt die Show begrenzt und erwähnt niemanden mehrfach', () => {
  assert.equal(FREAKOUT_CHANCE, 0.6, 'Standardchance ist deutlich höher als zuvor');
  assert.equal(shouldFreakout(() => 0, FREAKOUT_CHANCE), true);
  assert.equal(shouldFreakout(() => 0.99, FREAKOUT_CHANCE), false);

  const vars = { user: '<@u42>', expected: 6, got: 9 };
  const pings = pingBomb(vars);
  assert.equal(pings.split(' ').filter(Boolean).length, FREAKOUT_PINGS);
  assert.equal(pings, '<@u42>');

  const lines = buildFreakoutLines('de', { ...vars, streak: 5 });
  assert.equal(lines.length, 3, 'Titel, Puls und Nachtreter');
  assert.ok(lines[0].includes('COUNTING-ALARM'));
  assert.equal(lines.join(' ').split('<@u42>').length - 1, 1, 'höchstens eine Erwähnung');
  assert.match(lines[0], /6/);
  assert.match(lines[0], /9/);
});

test('Die sichere Ausrast-Show skaliert mit dem bisherigen Zählstand ohne Ping-Salve', () => {
  assert.equal(rageTierForCount(0), 0);
  assert.equal(rageTierForCount(9), 0);
  assert.equal(rageTierForCount(10), 1);
  assert.equal(rageTierForCount(50), 2);
  assert.equal(rageTierForCount(100), 3);

  const low = buildEscalationLines('de', {
    user: '<@u42>', expected: 6, got: 9, streak: 5,
  });
  const high = buildEscalationLines('de', {
    user: '<@u42>', expected: 101, got: 999, streak: 100,
  });
  assert.equal(low.length, 3);
  assert.equal(high.length, 3);
  assert.ok(high[0].includes('IV'));
  assert.ok(high[0].includes('🌋🌋🌋🌋'));
  assert.equal(high.join(' ').split('<@u42>').length - 1, 1, 'höchstens eine gezielte Erwähnung');
  assert.ok(high[2].includes('Kein Spam'));
});

test('Das Kanal-Thema trägt sichtbaren Hinweis und unsichtbaren Marker', () => {
  const topic = buildCountingTopic('Allgemeiner Talk', 42, 'de');
  assert.ok(topic.includes('42'), 'sichtbarer Zählstand');
  assert.ok(topic.includes('Counting-Channel'), 'sichtbarer Hinweis');
  assert.ok(topic.includes('Allgemeiner Talk'), 'bestehendes Thema bleibt erhalten');
  assert.deepEqual(parseCountingTopic(topic), { count: 42, lang: 'de' });
  assert.ok(topic.length <= TOPIC_MAX_LENGTH);

  assert.equal(parseCountingTopic('Allgemeiner Talk'), null);
  assert.equal(stripCountingTopic(topic), 'Allgemeiner Talk');
  assert.equal(stripCountingTopic(buildCountingTopic('', 0, 'de')), '');

  // Der Zählstand lässt sich aktualisieren, ohne dass sich das Thema aufbläht.
  const updated = buildCountingTopic(topic, 43, 'de');
  assert.deepEqual(parseCountingTopic(updated), { count: 43, lang: 'de' });
  assert.equal(stripCountingTopic(updated), 'Allgemeiner Talk');
});

test('Counting entfernt jede fremde Reaktion – auch dasselbe ✅/❌ wie der Bot', async () => {
  const removed = [];
  const warnings = [];
  const ctx = {
    client: { user: { id: 'minigames-bot' } },
    logger: { warn: (text) => warnings.push(text) },
    store: { withLock: async (_key, fn) => fn(), getServerLang: () => 'de' },
  };
  const manager = createCountingManager(ctx);
  const channel = { id: 'counting', topic: buildCountingTopic('', 12, 'de') };
  const makeReaction = (emoji) => ({
    emoji: { name: emoji },
    message: { guildId: 'guild', channel },
    users: { remove: async (userId) => removed.push([emoji, userId]) },
  });

  assert.equal(await manager.handleReactionAdd(makeReaction('✅'), { id: 'user-1' }), true);
  assert.equal(await manager.handleReactionAdd(makeReaction('❌'), { id: 'user-2' }), true);
  assert.equal(await manager.handleReactionAdd(makeReaction('🎉'), { id: 'user-3' }), true);
  assert.deepEqual(removed, [
    ['✅', 'user-1'],
    ['❌', 'user-2'],
    ['🎉', 'user-3'],
  ]);

  assert.equal(await manager.handleReactionAdd(makeReaction('✅'), { id: 'minigames-bot' }), false);
  assert.equal(removed.length, 3, 'die eigene Bot-Reaktion bleibt bestehen');

  const normalChannelReaction = makeReaction('✅');
  normalChannelReaction.message.channel = { id: 'normal', topic: 'Allgemeiner Chat' };
  assert.equal(await manager.handleReactionAdd(normalChannelReaction, { id: 'user-4' }), false);
  assert.equal(removed.length, 3, 'außerhalb des Counting-Channels wird nichts entfernt');
  assert.deepEqual(warnings, []);
});

test('Counting-Reaktionsschutz lädt Partials nach einem Neustart nach', async () => {
  const removed = [];
  const channel = { id: 'counting', topic: buildCountingTopic('', 3, 'de') };
  const fullReaction = {
    partial: false,
    message: {
      partial: true,
      fetch: async () => ({ guildId: 'guild', channel }),
    },
    users: { remove: async (userId) => removed.push(userId) },
  };
  const manager = createCountingManager({
    client: { user: { id: 'bot' } },
    logger: { warn() {} },
    store: { withLock: async (_key, fn) => fn() },
  });

  const handled = await manager.handleReactionAdd(
    { partial: true, fetch: async () => fullReaction },
    { id: 'user-after-restart' }
  );
  assert.equal(handled, true);
  assert.deepEqual(removed, ['user-after-restart']);
});

test('Counting stellt die Sprache nach einem Neustart dauerhaft aus dem Kanal-Thema wieder her', async () => {
  const sent = [];
  let languageConfig = null;
  const channel = {
    id: 'counting',
    guildId: 'guild',
    topic: buildCountingTopic('', 4, 'de', 12345),
    send: async (payload) => sent.push(payload.content),
    setTopic: async () => {},
  };
  const manager = createCountingManager({
    client: { user: { id: 'minigames-bot' } },
    logger: { warn() {} },
    store: {
      withLock: async (_key, fn) => fn(),
      getServerLang: () => languageConfig?.lang || null,
      getServerLanguageConfig: () => languageConfig,
      setServerLang: (_guildId, lang, changedAt) => {
        languageConfig = { lang, changedAt };
      },
    },
  }, { random: () => 0.5, freakoutChance: 0, messageDelayMs: 0 });

  await manager.handleMessage({
    guildId: 'guild',
    author: { id: 'noob', bot: false },
    content: '999',
    channel,
    react: async () => {},
  });

  assert.deepEqual(languageConfig, { lang: 'de', changedAt: 12345 });
  assert.equal(sent[0], safeFailureText('de', { user: '<@noob>', expected: 5, got: 999 }, 6));
  manager.shutdown();
});

test('Falsche Zahl dreht manchmal durch: begrenzte, sichere Showeinlage', async () => {
  const sent = [];
  const channel = {
    id: 'counting',
    guildId: 'guild',
    topic: buildCountingTopic('', 4, 'de'),
    send: async (payload) => {
      sent.push(payload.content);
      return payload;
    },
    setTopic: async () => {},
  };
  const ctx = {
    client: { user: { id: 'minigames-bot' } },
    logger: { warn() {} },
    store: { withLock: async (_key, fn) => fn(), getServerLang: () => 'de' },
  };
  // random = () => 0 erzwingt das Durchdrehen; ohne Pause bleibt der Test schnell.
  const manager = createCountingManager(ctx, {
    random: () => 0,
    freakoutChance: 1,
    messageDelayMs: 0,
  });

  const result = await manager.handleMessage({
    guildId: 'guild',
    author: { id: 'noob', bot: false },
    webhookId: null,
    system: false,
    content: '999',
    channel,
    react: async () => {},
    delete: async () => {},
  });

  assert.equal(result.action, 'reset');
  assert.equal(result.reason, 'wrong');
  assert.equal(sent.length, 3, 'Titel, Puls, Nachtreter');
  assert.equal(sent.join(' ').split('<@noob>').length - 1, 1, 'die Person wird höchstens einmal erwähnt');
  assert.ok(sent[2].includes('Kein Spam'), 'keine Mass-Pings oder Server-Spam');
  manager.shutdown();
});

function fakeVoiceChannel(id, memberIds = []) {
  return {
    id,
    name: id,
    type: ChannelType.GuildVoice,
    joinable: true,
    members: new Map(memberIds.map((memberId) => [memberId, { id: memberId }])),
    permissionsFor: () => ({ has: () => true }),
  };
}

test('Call-Auswahl nimmt den vollsten Voice-Channel und bei leeren Calls einen zufälligen', () => {
  const ctx = { client: { user: { id: 'bot' } } };
  const guild = { voiceAdapterCreator() {}, members: { me: { id: 'bot' } } };
  const empty = fakeVoiceChannel('empty');
  const busy = fakeVoiceChannel('busy', ['u1', 'u2', 'u3']);
  const medium = fakeVoiceChannel('medium', ['u4']);

  const populatedPick = pickVoiceChannel(ctx, guild, [empty, medium, busy], () => 0);
  assert.equal(populatedPick.channel.id, 'busy');
  assert.equal(populatedPick.mode, 'most-members');
  assert.equal(populatedPick.members, 3);

  const randomPick = pickVoiceChannel(
    ctx,
    guild,
    [fakeVoiceChannel('first'), fakeVoiceChannel('second')],
    () => 0.99
  );
  assert.equal(randomPick.channel.id, 'second');
  assert.equal(randomPick.mode, 'random');
});

test('Voice-Manager joint stumm/taub, erkennt die Verbindung und verlässt sie wieder', async () => {
  const channels = new Map([
    ['empty', fakeVoiceChannel('empty')],
    ['busy', fakeVoiceChannel('busy', ['u1', 'u2'])],
  ]);
  const guild = {
    id: 'g1',
    name: 'Testserver',
    voiceAdapterCreator() {},
    members: { me: { voice: { channelId: null, channel: null } } },
    channels: { cache: channels, fetch: async () => channels },
  };
  const client = Object.assign(new EventEmitter(), {
    user: { id: 'bot' },
    guilds: { cache: new Map([['g1', guild]]) },
  });

  let connection = null;
  let joinOptions = null;
  const statuses = {
    Ready: 'ready',
    Connecting: 'connecting',
    Signalling: 'signalling',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
  };
  const voice = {
    VoiceConnectionStatus: statuses,
    getVoiceConnection: () => connection,
    joinVoiceChannel: (options) => {
      joinOptions = options;
      connection = Object.assign(new EventEmitter(), {
        joinConfig: { channelId: options.channelId },
        state: { status: statuses.Ready },
        setSpeaking(value) { this.speaking = value; },
        rejoin(next) {
          this.joinConfig.channelId = next.channelId;
          this.state = { status: statuses.Ready };
          return true;
        },
        destroy() {
          const oldState = this.state;
          this.state = { status: statuses.Destroyed };
          this.emit('stateChange', oldState, this.state);
        },
      });
      return connection;
    },
    entersState: async (candidate, status) => {
      assert.equal(candidate.state.status, status);
      return candidate;
    },
  };
  const manager = createVoicePresenceManager(
    { client, logger: { warn() {} } },
    { voice, random: () => 0, watchdogIntervalMs: 1_000_000 }
  );

  const joined = await manager.joinGuild(guild);
  assert.equal(joined.ok, true);
  assert.equal(joined.channel.id, 'busy');
  assert.equal(joinOptions.selfDeaf, true);
  assert.equal(joinOptions.selfMute, true);
  assert.equal(joinOptions.group, 'minigames:bot');
  assert.equal(connection.speaking, false);
  assert.equal(manager.isConnected(guild), true);

  // Discord.js aktualisiert diesen Cache beim Leave nicht zwingend vor dem
  // nächsten Panel-Render. Der Manager darf deshalb keinen falschen Button zeigen.
  guild.members.me.voice.channelId = 'busy';
  guild.members.me.voice.channel = channels.get('busy');
  const left = await manager.leaveGuild(guild);
  assert.equal(left.ok, true);
  assert.equal(connection.state.status, statuses.Destroyed);
  assert.equal(manager.isConnected(guild), false);
  assert.equal(manager.currentChannel(guild), null);
  assert.equal(manager.desired.size, 0);
  manager.shutdown();
});

test('Voice-Manager akzeptiert den sichtbaren Call auch wenn Audio-Ready nie kommt', async () => {
  const channels = new Map([['busy', fakeVoiceChannel('busy', ['u1', 'u2'])]]);
  const guild = {
    id: 'g1',
    name: 'Testserver',
    voiceAdapterCreator() {},
    members: { me: { voice: { channelId: null, channel: null } } },
    channels: { cache: channels, fetch: async () => channels },
  };
  const client = Object.assign(new EventEmitter(), {
    user: { id: 'bot' },
    guilds: { cache: new Map([['g1', guild]]) },
  });

  const statuses = {
    Ready: 'ready',
    Connecting: 'connecting',
    Signalling: 'signalling',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
  };
  let connection = null;
  const voice = {
    VoiceConnectionStatus: statuses,
    getVoiceConnection: () => connection,
    joinVoiceChannel: (options) => {
      connection = Object.assign(new EventEmitter(), {
        joinConfig: { channelId: options.channelId },
        state: { status: statuses.Connecting },
        setSpeaking() {},
        rejoin() {
          return true;
        },
        destroy() {
          const old = this.state;
          this.state = { status: statuses.Destroyed };
          this.emit('stateChange', old, this.state);
        },
      });
      // Discord bestätigt den Bot sichtbar im Call, die Audio-Verbindung
      // (UDP) bleibt aber für immer im Connecting-Zustand hängen.
      setImmediate(() => {
        guild.members.me.voice.channelId = options.channelId;
        guild.members.me.voice.channel = channels.get(options.channelId);
      });
      return connection;
    },
    entersState: async () => {
      throw new Error('entersState darf nicht mehr der alleinige Maßstab sein');
    },
  };

  const manager = createVoicePresenceManager(
    { client, logger: { warn() {} } },
    { voice, random: () => 0, watchdogIntervalMs: 1_000_000, readyTimeoutMs: 5_000 }
  );

  const joined = await manager.joinGuild(guild);
  assert.equal(joined.ok, true, 'sichtbar im Call zählt als verbunden');
  assert.equal(joined.channel.id, 'busy');
  assert.equal(connection.state.status, statuses.Connecting, 'Verbindung bleibt bestehen, wird nicht abgerissen');
  assert.equal(manager.isConnected(guild), true);
  assert.equal(manager.currentChannel(guild).id, 'busy');
  manager.shutdown();
});

test('Minigames-Owner-Panel schaltet zwischen „Call joinen“ und „Call verlassen“ um', async () => {
  const voiceChannel = fakeVoiceChannel('voice-1', ['u1']);
  const guild = {
    id: 'g1',
    name: 'Testgilde',
    ownerId: 'owner',
    memberCount: 4,
    members: { me: { voice: { channelId: null, channel: null } } },
    channels: { cache: new Map([[voiceChannel.id, voiceChannel]]) },
  };
  let connected = false;
  const ctx = {
    client: { guilds: { cache: new Map([['g1', guild]]) } },
    store: { countGames: () => 0 },
    panelSessions: new Map(),
    voiceManager: {
      isConnected: () => connected,
      currentChannel: () => (connected ? voiceChannel : null),
    },
  };

  const joinPayload = await renderDetailPayload(ctx, 'owner', 'g1');
  const joinJson = joinPayload.components[0].toJSON();
  const joinLabels = joinJson.components
    .filter((component) => component.type === 1)
    .flatMap((row) => row.components.map((button) => button.label));
  assert.ok(joinLabels.includes('🔊 Call joinen'));
  assert.match(JSON.stringify(joinJson), /Nicht im Call/);

  connected = true;
  const leavePayload = await renderDetailPayload(ctx, 'owner', 'g1');
  const leaveJson = leavePayload.components[0].toJSON();
  const leaveLabels = leaveJson.components
    .filter((component) => component.type === 1)
    .flatMap((row) => row.components.map((button) => button.label));
  assert.ok(leaveLabels.includes('🔇 Call verlassen'));
  assert.match(JSON.stringify(leaveJson), /voice-1/);
});
