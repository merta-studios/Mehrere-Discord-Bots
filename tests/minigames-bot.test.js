/** Tests des Minigames-Bots – vollständig ohne Discord-Verbindung. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageFlags, ChannelType, Routes } = require('discord.js');

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
const {
  GAME_2048,
  SIZE,
  WIN_EXP,
  SOLO_ACTIVE,
  SOLO_WON,
  SOLO_OVER,
  SOLO_CID,
  createSoloGame,
  normalizeSoloState,
  slideLine,
  slideBoard,
  canMove,
  availableDirections,
  spawnTile,
  moveSolo,
  undoSolo,
  resumeSolo,
  restartSolo,
  encodeSoloPayload,
  decodeSoloPayload,
  parseSoloCustomId,
  tileValue,
  bestTile,
} = require('../bots/minigames-bot/src/game-2048');
const {
  buildSoloContainer,
  buildSoloPayload,
  parseSoloMessage,
  renderBoard,
  progressBar,
  formatNumber,
} = require('../bots/minigames-bot/src/solo-ui');
const {
  defineCommands,
  guildCommandJson,
  registerCommands,
  registerGuildCommands,
  setLanguageCmd,
  soloCmd,
  commandMention,
  MULTIPLAYER_COMMAND,
  SINGLEPLAYER_COMMAND,
  LEGACY_COMMAND_NAMES,
} = require('../bots/minigames-bot/src/commands');
const { handleSoloButton, soloErrorText } = require('../bots/minigames-bot/src/interactions');
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
  FREAKOUT_MESSAGE_DELAY_MS,
  MAX_RAGE_MESSAGES,
  shouldFreakout,
  pingBomb,
  buildFreakoutLines,
  buildEscalationLines,
  rageTierForCount,
  rageDelayForLine,
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

test('nur die sieben gewünschten Slash-Commands sind registriert und API-valide', () => {
  const commands = defineCommands().map((command) => command.toJSON());
  assert.deepEqual(commands.map((command) => command.name), [
    'multiplayer', 'singleplayer', 'set_language', 'set_counting_channel',
    'admin_set_bot_profile', 'help', 'adminpanel',
  ]);
  const play = commands[0];
  assert.deepEqual(play.options[0].choices.map((choice) => choice.value), [GAME_TTT, GAME_CONNECT4]);
  assert.equal(play.options[1].required, false, 'der Gegner ist optional');

  const solo = commands[1];
  assert.deepEqual(solo.options.map((option) => option.name), ['game']);
  assert.equal(solo.options[0].required, true);
  assert.deepEqual(solo.options[0].choices.map((choice) => choice.value), [GAME_2048]);
  assert.equal(solo.default_member_permissions, undefined, 'Solo darf jeder spielen');

  assert.equal(commands[2].options[0].choices.length, 10);
  assert.equal(commands[2].default_member_permissions, '8');
  assert.equal(commands[3].default_member_permissions, '8', 'Counting nur für Admins');
  assert.equal(commands[3].options[0].required, true);
  assert.equal(commands[3].options[1].required, false);
  assert.equal(commands[4].default_member_permissions, '8');

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

  // Auch alle menschlichen Durchdreh-Bausteine müssen lokalisiert sein.
  const rageLanguages = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];
  for (let i = 1; i <= RAGE_VARIANTS; i += 1) {
    for (const lang of rageLanguages) {
      assert.ok(T[`countRageTitle${i}`][lang], `countRageTitle${i} fehlt in ${lang}`);
      assert.ok(T[`countRageBody${i}`][lang], `countRageBody${i} fehlt in ${lang}`);
      assert.ok(T[`countRageSpiral${i}`][lang], `countRageSpiral${i} fehlt in ${lang}`);
      assert.ok(T[`countRageReset${i}`][lang], `countRageReset${i} fehlt in ${lang}`);
    }
  }
  for (const key of ['countRageAside', 'countRageStreakLoss', 'countRageAftershock', 'countRageCatastrophe']) {
    for (const lang of rageLanguages) assert.ok(T[key][lang], `${key} fehlt in ${lang}`);
  }
});

test('Beim Durchdrehen klingt der Bot hektisch-menschlich und erwähnt niemanden mehrfach', () => {
  assert.equal(FREAKOUT_CHANCE, 1, 'standardmäßig dreht der Bot bei jedem Zahlenfehler durch');
  assert.equal(shouldFreakout(() => 0, FREAKOUT_CHANCE), true);
  assert.equal(shouldFreakout(() => 0.99, FREAKOUT_CHANCE), true);
  assert.equal(shouldFreakout(() => 0.99, 0.6), false, 'die Chance bleibt konfigurierbar');

  const vars = { user: '<@u42>', expected: 6, got: 9 };
  const pings = pingBomb(vars);
  assert.equal(pings.split(' ').filter(Boolean).length, FREAKOUT_PINGS);
  assert.equal(pings, '<@u42>');

  const lines = buildEscalationLines('de', { ...vars, streak: 5 }, 0);
  assert.equal(lines.length, 4, 'Einstieg, Fakten, hektischer Vertipper und Neustart');
  assert.match(lines[2], /nien|nich/, 'absichtlicher Tippfehler macht den Text weniger steril');
  assert.equal(lines.join(' ').split('<@u42>').length - 1, 1, 'höchstens eine Erwähnung');
  assert.match(lines.join(' '), /6/);
  assert.match(lines.join(' '), /9/);
  assert.match(lines.at(-1), /1/);

  const legacyAlias = buildFreakoutLines('de', { ...vars, streak: 5 });
  assert.equal(legacyAlias.length, 4);
});

test('Die menschliche Ausrast-Sequenz skaliert mit dem bisherigen Zählstand ohne Ping-Salve', () => {
  assert.equal(rageTierForCount(0), 0);
  assert.equal(rageTierForCount(9), 0);
  assert.equal(rageTierForCount(10), 1);
  assert.equal(rageTierForCount(50), 2);
  assert.equal(rageTierForCount(100), 3);

  const low = buildEscalationLines('de', {
    user: '<@u42>', expected: 6, got: 9, streak: 5,
  }, 0);
  const high = buildEscalationLines('de', {
    user: '<@u42>', expected: 101, got: 999, streak: 100,
  }, 0);
  assert.equal(low.length, 4);
  assert.equal(high.length, MAX_RAGE_MESSAGES);
  assert.ok(high.some((line) => line.includes('🌋🌋🌋🌋')));
  assert.ok(high.some((line) => /100\*\* ZAHLEN/.test(line)));
  assert.equal(high.join(' ').split('<@u42>').length - 1, 1, 'höchstens eine gezielte Erwähnung');
  assert.match(high.at(-1), /1/, 'am Ende ist trotz Ausraster klar, wie es weitergeht');
});

test('Schreibpausen variieren menschlich, sind begrenzt und in Tests abschaltbar', () => {
  assert.equal(rageDelayForLine('egal', 0, () => 0.5), 0);
  const fast = rageDelayForLine('kurz', FREAKOUT_MESSAGE_DELAY_MS, () => 0);
  const slow = rageDelayForLine('eine deutlich längere Nachricht', FREAKOUT_MESSAGE_DELAY_MS, () => 1);
  assert.ok(fast >= 250);
  assert.ok(slow > fast);
  assert.ok(slow <= 1_500);
});

test('Alle Ausrast-Varianten sind vollständig, ping-sicher und Discord-tauglich', () => {
  const languages = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];
  for (const lang of languages) {
    for (const streak of [0, 10, 50, 100]) {
      for (let variant = 0; variant < RAGE_VARIANTS; variant += 1) {
        const expected = streak + 1;
        const lines = buildEscalationLines(lang, {
          user: '<@u42>', expected, got: 999, streak,
        }, variant);
        const fullText = lines.join(' ');
        assert.ok(fullText.includes(String(expected)), `${lang}/${streak}/${variant}: Erwartung fehlt`);
        assert.ok(fullText.includes('999'), `${lang}/${streak}/${variant}: Eingabe fehlt`);
        assert.equal(fullText.split('<@u42>').length - 1, 1, `${lang}/${streak}/${variant}: Pinganzahl`);
        assert.doesNotMatch(fullText, /\{\w+\}/, `${lang}/${streak}/${variant}: Platzhalter übrig`);
        assert.ok(lines.every((line) => line.length <= 2_000), `${lang}/${streak}/${variant}: Discord-Limit`);
      }
    }
  }
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

test('Falsche Zahl löst die menschliche Durchdreh-Sequenz mit Tippanzeige aus', async () => {
  const sent = [];
  let typingCalls = 0;
  const channel = {
    id: 'counting',
    guildId: 'guild',
    topic: buildCountingTopic('', 4, 'de'),
    sendTyping: async () => { typingCalls += 1; },
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
  assert.equal(sent.length, 4, 'Einstieg, Fakten, Tippfehler und Neustart');
  assert.equal(typingCalls, sent.length - 1, 'vor jeder Folgenachricht erscheint „tippt …“');
  assert.equal(sent.join(' ').split('<@noob>').length - 1, 1, 'die Person wird höchstens einmal erwähnt');
  assert.match(sent[2], /nien|nich/, 'die Sequenz enthält den gewollten hektischen Vertipper');
  assert.match(sent.at(-1), /1/, 'der Neustart bleibt eindeutig');
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

/* ------------------------------------------------------------------ *
 * 🧩 Single Player – 2048
 * ------------------------------------------------------------------ */

/** Deterministischer Zufall für reproduzierbare Tests. */
function seededRandom(seed = 1) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

/** Baut ein Brett aus Zweierpotenzen (0 = leer) in interne Exponenten um. */
function boardOf(values) {
  return values.map((value) => (value ? Math.log2(value) : 0));
}

function soloStateOf(values, extra = {}) {
  return normalizeSoloState({
    game: GAME_2048,
    userId: 'u1',
    lang: 'de',
    board: boardOf(values),
    ...extra,
  });
}

test('2048: eine Reihe verschmilzt originalgetreu – jeder Stein nur einmal pro Zug', () => {
  // [2,2,2,2] -> [4,4] und nicht [8]
  const doubled = slideLine([1, 1, 1, 1]);
  assert.deepEqual(doubled.values, [2, 2, 0, 0]);
  assert.equal(doubled.gained, 8, '4 + 4 Punkte');

  // [4,4,2,0] -> [8,2]
  const mixed = slideLine([2, 2, 1, 0]);
  assert.deepEqual(mixed.values, [3, 1, 0, 0]);
  assert.equal(mixed.gained, 8);

  // Lücken werden geschlossen, ohne zu verschmelzen.
  const gaps = slideLine([0, 1, 0, 2]);
  assert.deepEqual(gaps.values, [1, 2, 0, 0]);
  assert.equal(gaps.gained, 0);

  // Ein bereits verschmolzener Stein verschmilzt nicht sofort weiter.
  const chain = slideLine([1, 1, 2, 0]);
  assert.deepEqual(chain.values, [2, 2, 0, 0]);
});

test('2048: Züge in alle vier Richtungen schieben korrekt', () => {
  const board = boardOf([
    2, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);

  const left = slideBoard(board, 'left');
  assert.equal(left.board[0], 2, 'links: die 4 landet ganz links');
  assert.equal(left.gained, 4);
  assert.deepEqual(left.mergedCells, [0]);

  const right = slideBoard(board, 'right');
  assert.equal(right.board[3], 2, 'rechts: die 4 landet ganz rechts');
  assert.deepEqual(right.mergedCells, [3]);

  const column = boardOf([
    4, 0, 0, 0,
    4, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  assert.equal(slideBoard(column, 'up').board[0], 3, 'hoch: 8 oben');
  assert.equal(slideBoard(column, 'down').board[12], 3, 'runter: 8 unten');
  assert.equal(slideBoard(column, 'left').moved, false, 'links bewegt sich nichts');
});

test('2048: eine neue Runde startet mit genau zwei Steinen (2 oder 4)', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const state = createSoloGame({ userId: 'u1', random: seededRandom(seed) });
    const tiles = state.board.filter(Boolean);
    assert.equal(tiles.length, 2, 'genau zwei Startsteine');
    for (const exp of tiles) assert.ok(exp === 1 || exp === 2, 'nur 2 oder 4');
    assert.equal(state.score, 0);
    assert.equal(state.moves, 0);
    assert.equal(state.status, SOLO_ACTIVE);
    assert.equal(state.previous, null, 'am Anfang gibt es nichts zurückzunehmen');
    assert.ok(state.board[state.newCell] > 0, 'der markierte neue Stein existiert');
  }
});

test('2048: ein Zug erzeugt Punkte, einen neuen Stein und einen Undo-Punkt', () => {
  const state = soloStateOf([
    2, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const result = moveSolo(state, 'u1', 'left', { random: seededRandom(7) });
  assert.equal(result.error, undefined);
  assert.equal(result.gained, 4);
  assert.equal(result.state.score, 4);
  assert.equal(result.state.moves, 1);
  assert.equal(tileValue(result.state.board[0]), 4);
  assert.ok(result.state.mergedCells.includes(0));
  assert.equal(result.state.board.filter(Boolean).length, 2, 'ein Stein rückt nach');
  assert.ok(result.state.previous, 'der Zug kann zurückgenommen werden');
});

test('2048: nur der Besitzer darf spielen, und leere Züge werden abgewiesen', () => {
  const state = createSoloGame({ userId: 'owner', random: seededRandom(3) });
  assert.equal(moveSolo(state, 'someone-else', 'left').error, 'not_owner');
  assert.equal(undoSolo(state, 'someone-else').error, 'not_owner');
  assert.equal(restartSolo(state, 'someone-else').error, 'not_owner');
  assert.equal(moveSolo(state, 'owner', 'diagonal').error, 'invalid_move');

  const blocked = soloStateOf([
    2, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], { userId: 'owner' });
  assert.equal(moveSolo(blocked, 'owner', 'up').error, 'no_move', 'oben ist schon alles');
});

test('2048: Rückgängig stellt Brett, Punkte und Zugzahl exakt wieder her', () => {
  const start = soloStateOf([
    2, 2, 4, 8,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], { score: 100, moves: 10 });

  const moved = moveSolo(start, 'u1', 'left', { random: seededRandom(11) }).state;
  assert.notDeepEqual(moved.board, start.board);

  const undone = undoSolo(moved, 'u1').state;
  assert.deepEqual(undone.board, start.board);
  assert.equal(undone.score, 100);
  assert.equal(undone.moves, 10);
  assert.equal(undone.previous, null, 'nur ein Schritt zurück');
  assert.equal(undoSolo(undone, 'u1').error, 'no_undo');
});

test('2048: der 2048er-Stein feiert einmal und danach geht es endlos weiter', () => {
  const almost = soloStateOf([
    1024, 1024, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const won = moveSolo(almost, 'u1', 'left', { random: seededRandom(5) });
  assert.equal(won.state.status, SOLO_WON);
  assert.equal(won.justWon, true);
  assert.equal(won.state.reachedWin, true);
  assert.equal(bestTile(won.state.board), 2048);
  assert.equal(won.state.score, 2048, 'die Verschmelzung bringt 2048 Punkte');

  // Weiterspielen beendet den Sieg-Bildschirm, ohne die Runde zu verlieren.
  const resumed = resumeSolo(won.state, 'u1').state;
  assert.equal(resumed.status, SOLO_ACTIVE);
  assert.equal(resumed.reachedWin, true);
  assert.equal(resumeSolo(resumed, 'u1').error, 'not_won');

  // Der Sieg wird nicht ein zweites Mal gefeiert.
  const next = moveSolo(resumed, 'u1', 'left', { random: seededRandom(9) });
  assert.notEqual(next.state.status, SOLO_WON);
  assert.equal(next.justWon, false);
});

test('2048: ein volles Brett ohne Nachbarpaare beendet die Runde', () => {
  const full = boardOf([
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  ]);
  assert.equal(canMove(full), false);
  assert.deepEqual(availableDirections(full), []);

  // Ein einziges Paar reicht, damit es weitergeht.
  const withPair = [...full];
  withPair[15] = withPair[14];
  assert.equal(canMove(withPair), true);

  // Eine echte Partie bis zum Ende: irgendwann ist kein Zug mehr möglich,
  // und genau dann – nicht früher – kippt der Status auf „vorbei“.
  const random = seededRandom(2024);
  let state = createSoloGame({ userId: 'u1', lang: 'de', random });
  let guard = 0;
  while (state.status !== SOLO_OVER && guard < 5000) {
    guard += 1;
    const directions = availableDirections(state.board);
    assert.ok(directions.length, 'solange nicht „vorbei“, muss es einen Zug geben');
    const result = moveSolo(state, 'u1', directions[guard % directions.length], { random });
    assert.equal(result.error, undefined);
    state = result.state;
  }
  const over = { state };
  assert.equal(state.status, SOLO_OVER, 'die Partie endet zuverlässig');
  assert.equal(canMove(state.board), false);
  assert.equal(state.board.filter(Boolean).length, 16, 'das Brett ist voll');
  assert.ok(state.score > 0 && state.moves > 0);
  assert.ok(over.state.finishedAt > 0);
  assert.equal(moveSolo(over.state, 'u1', 'left').error, 'game_over');

  // Neustart macht in derselben Nachricht ein frisches Brett auf.
  const fresh = restartSolo(over.state, 'u1', { random: seededRandom(4) }).state;
  assert.equal(fresh.status, SOLO_ACTIVE);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.board.filter(Boolean).length, 2);
  assert.equal(fresh.userId, 'u1');
  assert.equal(fresh.lang, 'de');
});

test('2048: neue Steine sind zu ~90 % eine 2 und landen nur auf freien Feldern', () => {
  const random = seededRandom(42);
  let fours = 0;
  const rounds = 600;
  for (let i = 0; i < rounds; i += 1) {
    const board = boardOf([
      2, 4, 8, 16,
      32, 64, 128, 256,
      512, 1024, 2, 4,
      8, 16, 32, 0,
    ]);
    const spawned = spawnTile(board, random);
    assert.equal(spawned.index, 15, 'nur das eine freie Feld kommt in Frage');
    if (spawned.board[15] === 2) fours += 1;
  }
  const share = fours / rounds;
  assert.ok(share > 0.02 && share < 0.2, `4er-Anteil unplausibel: ${share}`);

  // Ohne freies Feld passiert nichts.
  const fullBoard = boardOf([
    2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2, 4, 8, 16, 32, 64,
  ]);
  assert.equal(spawnTile(fullBoard, random).index, -1);
});

test('2048: der Spielstand überlebt als unsichtbarer Marker in der Nachricht', () => {
  const random = seededRandom(21);
  let state = createSoloGame({ userId: 'u42', lang: 'fr', random });
  for (let i = 0; i < 30; i += 1) {
    const directions = availableDirections(state.board);
    if (!directions.length) break;
    const result = moveSolo(state, 'u42', directions[0], { random });
    if (result.error) break;
    state = result.state;
  }

  const encoded = encodeSoloPayload(state);
  assert.deepEqual(decodeSoloPayload(`irgendwas ${encoded} und danach`), state);
  assert.equal(decodeSoloPayload('kein Marker'), null);
  assert.equal(decodeSoloPayload(`${encoded.slice(0, 12)}%%%`), null);

  // Der echte Weg: Marker unsichtbar in der Container-Nachricht.
  const message = asMessage(buildSoloContainer(state));
  const parsed = parseSoloMessage(message);
  assert.deepEqual(parsed, state);
  assert.equal(parseSoloMessage({ content: 'nichts', components: [], embeds: [] }), null);

  // Der Battle-Parser darf einen Solo-Marker niemals als Battle lesen.
  assert.equal(parseGameMessage(message), null);
});

test('2048: kaputte oder manipulierte Marker-Daten werden hart bereinigt', () => {
  const broken = normalizeSoloState({
    game: GAME_2048,
    userId: 'u1',
    lang: 'klingonisch',
    board: [99, -3, 'x', null, 1, 1, 1, 1],
    score: -50,
    moves: 'viele',
    status: 'schummeln',
    newCell: 999,
    mergedCells: [1, 77, -4],
  });
  assert.equal(broken.lang, 'en', 'unbekannte Sprache fällt auf Englisch zurück');
  assert.equal(broken.board.length, SIZE * SIZE, 'das Brett hat immer 16 Felder');
  assert.ok(broken.board.every((exp) => exp >= 0 && exp <= 31));
  assert.equal(broken.score, 0);
  assert.equal(broken.moves, 0);
  assert.equal(broken.status, SOLO_ACTIVE);
  assert.equal(broken.newCell, -1);
  assert.deepEqual(broken.mergedCells, [1]);

  assert.equal(normalizeSoloState(null), null);
  assert.equal(normalizeSoloState({ game: 'tictactoe', userId: 'u1' }), null, 'kein Battle als Solo');
  assert.equal(normalizeSoloState({ game: GAME_2048, userId: '' }), null);
});

test('2048: das Spielfeld ist ein bündiger ansi-Block mit farbigen Kacheln', () => {
  const state = soloStateOf([
    2, 4, 8, 16,
    32, 64, 128, 256,
    512, 1024, 2048, 4096,
    0, 0, 0, 0,
  ], { newCell: 12, mergedCells: [10] });

  const board = renderBoard(state);
  assert.ok(board.startsWith('```ansi'), 'Discord färbt nur ansi-Blöcke ein');
  assert.ok(board.endsWith('```'));
  assert.match(board, /\u001b\[[0-9;]+m/, 'es gibt echte ANSI-Sequenzen');
  assert.match(board, /\[2048\]/, 'frisch verschmolzene Steine sind auch ohne Farbe erkennbar');

  // Ohne Farbcodes müssen alle Brettzeilen exakt gleich breit sein –
  // sonst franst das Feld auf dem Handy aus.
  const plain = board
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .slice(1, -1);
  const widths = new Set(plain.map((line) => [...line].length));
  assert.equal(widths.size, 1, `ungleiche Zeilenbreiten: ${[...widths].join(', ')}`);
  assert.equal(plain.length, SIZE * 2 + 1, '4 Reihen + Rahmenlinien');
});

test('2048: die Oberfläche zeigt Punkte, Fortschritt und ein Steuerkreuz', () => {
  const state = soloStateOf([
    2, 4, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], { score: 12345, moves: 42, lastGain: 8 });

  const json = buildSoloContainer(state).toJSON();
  const text = JSON.stringify(json);
  assert.match(text, /12 345/, 'Punkte werden gruppiert dargestellt');
  assert.match(text, /\+8/, 'der letzte Punktgewinn wird gezeigt');
  assert.match(text, /<@u1>/, 'die spielende Person steht im Kopf');

  const rows = json.components.filter((component) => component.type === 1);
  assert.equal(rows.length, 3, 'zwei Steuer-Reihen und eine Aktions-Reihe');
  const ids = rows.flatMap((row) => row.components.map((button) => button.custom_id));
  for (const direction of ['up', 'down', 'left', 'right']) {
    assert.ok(ids.includes(SOLO_CID.move(direction)), `${direction} fehlt`);
  }
  assert.ok(ids.includes(SOLO_CID.undo));
  assert.ok(ids.includes(SOLO_CID.restart));

  // Platzhalter formen das Kreuz und sind immer tot.
  const pads = rows.flatMap((row) => row.components).filter((b) => /pad\d$/.test(b.custom_id));
  assert.equal(pads.length, 2);
  assert.ok(pads.every((button) => button.disabled));

  // Undo ist ohne vorherigen Zug deaktiviert.
  const undo = rows.flatMap((row) => row.components).find((b) => b.custom_id === SOLO_CID.undo);
  assert.equal(undo.disabled, true);

  assert.equal(progressBar(1), '▱▱▱▱▱▱▱▱▱▱');
  assert.equal(progressBar(WIN_EXP), '▰▰▰▰▰▰▰▰▰▰');
  assert.equal(formatNumber(1234567), '1 234 567');
});

test('2048: unmögliche Richtungen und beendete Runden deaktivieren die Buttons', () => {
  // Alles liegt schon oben links – hoch und links geht nichts mehr.
  const state = soloStateOf([
    2, 4, 8, 16,
    4, 8, 16, 2,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const buttons = buildSoloContainer(state)
    .toJSON()
    .components.filter((component) => component.type === 1)
    .flatMap((row) => row.components);
  const byId = Object.fromEntries(buttons.map((button) => [button.custom_id, button]));
  assert.equal(byId[SOLO_CID.move('up')].disabled, true, 'oben ist dicht');
  assert.equal(byId[SOLO_CID.move('down')].disabled, false);

  const over = soloStateOf([
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  ], { status: SOLO_OVER });
  const overButtons = buildSoloContainer(over)
    .toJSON()
    .components.filter((component) => component.type === 1)
    .flatMap((row) => row.components);
  for (const button of overButtons) {
    if (button.custom_id === SOLO_CID.restart) {
      assert.equal(button.disabled, undefined, 'Neustart bleibt klickbar');
    } else if (button.custom_id.includes('_2048_')) {
      assert.equal(button.disabled, true, `${button.custom_id} sollte tot sein`);
    }
  }
});

test('2048: das Payload nutzt Components V2 und pingt niemanden ungefragt', () => {
  const state = createSoloGame({ userId: 'u1', random: seededRandom(6) });
  const payload = buildSoloPayload(state);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(payload.allowedMentions.users, ['u1']);
  assert.deepEqual(payload.allowedMentions.parse, []);
  assert.deepEqual(payload.allowedMentions.roles, []);
});

test('2048: Custom-IDs werden strikt geparst und kollidieren nicht mit Battles', () => {
  assert.deepEqual(parseSoloCustomId(SOLO_CID.move('up')), {
    kind: 'move', game: GAME_2048, direction: 'up',
  });
  assert.deepEqual(parseSoloCustomId(SOLO_CID.undo), { kind: 'undo', game: GAME_2048 });
  assert.deepEqual(parseSoloCustomId(SOLO_CID.restart), { kind: 'restart', game: GAME_2048 });
  assert.deepEqual(parseSoloCustomId(SOLO_CID.resume), { kind: 'resume', game: GAME_2048 });
  assert.deepEqual(parseSoloCustomId(SOLO_CID.pad(1)), { kind: 'noop', game: GAME_2048 });
  assert.equal(parseSoloCustomId('mg_s_2048_diagonal'), null);
  assert.equal(parseSoloCustomId('mg_accept'), null, 'Battle-Buttons gehören nicht hierher');
  assert.equal(parseCustomId(SOLO_CID.move('left')), null, 'und umgekehrt genauso');
});

/* ------------------------------------------------------------------ *
 * /singleplayer & Button-Fluss
 * ------------------------------------------------------------------ */

function soloInteraction({ userId = 'u1', guildId = 'g1', game = GAME_2048 } = {}) {
  const sent = {};
  return {
    sent,
    interaction: {
      guildId,
      channelId: 'c1',
      locale: 'de',
      user: { id: userId },
      inGuild: () => Boolean(guildId),
      options: { getString: () => game },
      reply: async (payload) => {
        sent.payload = payload;
        return payload;
      },
      fetchReply: async () => ({
        id: 'm1',
        guildId,
        channelId: 'c1',
        content: '',
        embeds: [],
        components: (sent.payload?.components || []).map((c) => (c.toJSON ? c.toJSON() : c)),
      }),
    },
  };
}

test('/singleplayer startet 2048 im Channel und merkt sich die Runde in der Nachricht', async () => {
  const { createStore } = require('../bots/minigames-bot/src/store');
  const { interaction, sent } = soloInteraction({ userId: 'player-1' });
  const ctx = { store: createStore(), logger: { warn() {} } };

  const message = await soloCmd(ctx, interaction);
  assert.equal(sent.payload.flags, MessageFlags.IsComponentsV2);

  const state = parseSoloMessage(message);
  assert.ok(state, 'der Spielstand steckt unsichtbar in der Antwort');
  assert.equal(state.userId, 'player-1');
  assert.equal(state.game, GAME_2048);
  assert.equal(state.board.filter(Boolean).length, 2);
});

test('/singleplayer läuft nur auf Servern und lehnt unbekannte Spiele ab', async () => {
  const { createStore } = require('../bots/minigames-bot/src/store');
  const ctx = { store: createStore(), logger: { warn() {} } };

  const dm = soloInteraction({ guildId: null });
  await soloCmd(ctx, dm.interaction);
  assert.match(JSON.stringify(dm.sent.payload), /nur auf einem Server/);
  assert.equal(dm.sent.payload.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);

  const bogus = soloInteraction({ game: 'minesweeper' });
  await soloCmd(ctx, bogus.interaction);
  assert.ok(bogus.sent.payload.flags & MessageFlags.Ephemeral, 'privat abgelehnt');
});

test('2048-Buttons: der Zug landet in derselben Nachricht, Fremde werden abgewiesen', async () => {
  const { createStore } = require('../bots/minigames-bot/src/store');
  const start = soloStateOf([
    2, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], { userId: 'owner' });

  let current = buildSoloPayload(start);
  const message = {
    id: 'm1',
    guildId: 'g1',
    channelId: 'c1',
    content: '',
    embeds: [],
    get components() {
      return current.components.map((c) => (c.toJSON ? c.toJSON() : c));
    },
    edit: async (payload) => {
      current = payload;
      return message;
    },
  };

  const ctx = { store: createStore(), logger: { warn() {}, error() {} } };
  const replies = [];
  let deferred = 0;
  const clickAs = (userId, customId) =>
    handleSoloButton(ctx, {
      guildId: 'g1',
      channelId: 'c1',
      locale: 'de',
      user: { id: userId },
      message,
      customId,
      channel: { messages: { fetch: async () => message } },
      deferUpdate: async () => { deferred += 1; },
      reply: async (payload) => { replies.push(payload); },
    }, parseSoloCustomId(customId));

  await clickAs('owner', SOLO_CID.move('left'));
  const afterMove = parseSoloMessage(message);
  assert.equal(afterMove.score, 4, 'die Verschmelzung wurde gespeichert');
  assert.equal(afterMove.moves, 1);
  assert.equal(deferred, 1);

  // Ein Fremder bekommt nur eine private Absage – die Nachricht bleibt gleich.
  await clickAs('stranger', SOLO_CID.move('right'));
  assert.equal(replies.length, 1);
  assert.match(JSON.stringify(replies[0]), /jemand anderem/);
  assert.deepEqual(parseSoloMessage(message).board, afterMove.board);

  // Undo bringt exakt den Startzustand zurück.
  await clickAs('owner', SOLO_CID.undo);
  const afterUndo = parseSoloMessage(message);
  assert.deepEqual(afterUndo.board, start.board);
  assert.equal(afterUndo.score, 0);

  // Die Platzhalter des Steuerkreuzes tun nichts.
  await clickAs('owner', SOLO_CID.pad(1));
  assert.equal(replies.length, 1, 'kein zusätzlicher Hinweis');

  // Neustart erzeugt ein frisches Brett in derselben Nachricht.
  await clickAs('owner', SOLO_CID.restart);
  const restarted = parseSoloMessage(message);
  assert.equal(restarted.score, 0);
  assert.equal(restarted.moves, 0);
  assert.equal(restarted.userId, 'owner');
});

test('2048-Fehlertexte sind sprechend und in der Serversprache', () => {
  assert.match(soloErrorText('not_owner', 'de'), /jemand anderem/);
  assert.match(soloErrorText('no_move', 'de'), /bewegt sich nichts/);
  assert.match(soloErrorText('no_undo', 'en'), /no move to undo/i);
  assert.match(soloErrorText('game_over', 'de'), /vorbei/);
  assert.match(soloErrorText('was-auch-immer', 'de'), /nicht mehr lesbar/);
});

/* ------------------------------------------------------------------ *
 * Command-Registrierung auf ALLEN bestehenden Servern
 * ------------------------------------------------------------------ */

function registrationCtx(guildIds = []) {
  const calls = [];
  return {
    calls,
    ctx: {
      token: 'token',
      client: {
        user: { id: 'bot-1' },
        guilds: { cache: new Map(guildIds.map((id) => [id, { id, name: `Guild ${id}` }])) },
      },
      logger: { info() {}, warn() {}, error() {} },
      commandIds: {},
      guildCommandIds: new Map(),
      rest: {
        put: async (route, { body }) => {
          calls.push({ route, names: body.map((command) => command.name) });
          return body.map((command, index) => ({ name: command.name, id: `${route}-${index}` }));
        },
      },
    },
  };
}

test('Die Commands werden global UND sofort auf jeden bestehenden Server geschrieben', async () => {
  const { ctx, calls } = registrationCtx(['g1', 'g2', 'g3']);
  const ok = await registerCommands(ctx);
  assert.equal(ok, true);

  const globalCall = calls.find((call) => call.route === Routes.applicationCommands('bot-1'));
  assert.ok(globalCall, 'der globale Satz wird geschrieben');
  assert.ok(globalCall.names.includes(SINGLEPLAYER_COMMAND));
  assert.ok(globalCall.names.includes(MULTIPLAYER_COMMAND));
  for (const legacy of LEGACY_COMMAND_NAMES) {
    assert.ok(!globalCall.names.includes(legacy), `/${legacy} muss verschwinden`);
  }

  // Jeder bereits bespielte Server bekommt die Commands sofort.
  for (const guildId of ['g1', 'g2', 'g3']) {
    const call = calls.find((c) => c.route === Routes.applicationGuildCommands('bot-1', guildId));
    assert.ok(call, `Guild ${guildId} wurde übersprungen`);
    assert.ok(call.names.includes(MULTIPLAYER_COMMAND));
    assert.ok(call.names.includes(SINGLEPLAYER_COMMAND));
    assert.ok(!call.names.includes('play'), 'das alte /play wird ersetzt');
    assert.ok(!call.names.includes('adminpanel'), '/adminpanel bleibt ein DM-Command');
    assert.ok(ctx.guildCommandIds.get(guildId)[SINGLEPLAYER_COMMAND], 'IDs werden gemerkt');
  }

  // /help verlinkt auf einem Server die dort gültigen Guild-IDs.
  const mention = commandMention(ctx, SINGLEPLAYER_COMMAND, 'g2');
  assert.match(mention, new RegExp(`^</${SINGLEPLAYER_COMMAND}:`));
  assert.equal(commandMention(ctx, 'gibt-es-nicht', 'g2'), '/gibt-es-nicht');
});

test('Ein einzelner Server-Ausfall stoppt die Registrierung nicht', async () => {
  const { ctx, calls } = registrationCtx(['ok-1', 'kaputt', 'ok-2']);
  const put = ctx.rest.put;
  ctx.rest.put = async (route, options) => {
    if (route.includes('kaputt')) throw new Error('Missing Access');
    return put(route, options);
  };

  assert.equal(await registerCommands(ctx), true);
  assert.ok(calls.some((call) => call.route.includes('ok-1')));
  assert.ok(calls.some((call) => call.route.includes('ok-2')));
  assert.equal(ctx.guildCommandIds.has('kaputt'), false);
});

test('Mit Dev-Gilde bleiben die Commands lokal und der globale Satz wird geleert', async () => {
  const { ctx, calls } = registrationCtx(['g1']);
  ctx.devGuildId = 'dev-guild';
  assert.equal(await registerCommands(ctx), true);

  const devCall = calls.find((call) => call.route === Routes.applicationGuildCommands('bot-1', 'dev-guild'));
  assert.ok(devCall);
  assert.ok(devCall.names.includes('adminpanel'), 'in der Dev-Gilde liegt alles zusammen');
  const globalCall = calls.find((call) => call.route === Routes.applicationCommands('bot-1'));
  assert.deepEqual(globalCall.names, [], 'global wird geleert');
});

test('registerGuildCommands schreibt genau die Server-Commands einer Gilde', async () => {
  const { ctx, calls } = registrationCtx([]);
  const ids = await registerGuildCommands(ctx, 'neu-dazugekommen');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].names, guildCommandJson().map((command) => command.name));
  assert.ok(ids[MULTIPLAYER_COMMAND] && ids[SINGLEPLAYER_COMMAND]);
  assert.equal(await registerGuildCommands(ctx, ''), null, 'ohne Guild-ID passiert nichts');
});
