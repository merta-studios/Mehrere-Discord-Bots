/** Tests des Minigames-Bots – vollständig ohne Discord-Verbindung. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const {
  GAME_TTT,
  GAME_CONNECT4,
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  STATUS_DECLINED,
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
  parseCustomId,
} = require('../bots/minigames-bot/src/games');
const {
  extractAllText,
  parseGameMessage,
  parseLanguageMessage,
  buildGameContainer,
  buildGamePayload,
  buildLanguageContainer,
} = require('../bots/minigames-bot/src/embed-builder');
const { defineCommands } = require('../bots/minigames-bot/src/commands');

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
  return acceptChallenge(pending, 'u2', now + 1).state;
}

test('Challenge-Marker speichert den vollständigen Spielstand', () => {
  const state = createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', lang: 'de', now: 50 });
  const payload = encodeGamePayload(state);
  assert.ok(payload.startsWith('mgame::v2::'));
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
  assert.equal(accepted.turn, 'u1', 'Herausforderer beginnt');

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
    101
  ).state;
  const moves = [
    ['u1', 0], ['u2', 1], ['u1', 0], ['u2', 1],
    ['u1', 0], ['u2', 1], ['u1', 0],
  ];
  for (const [user, column] of moves) state = applyMove(state, user, column).state;
  assert.equal(state.status, STATUS_WON);
  assert.equal(state.winnerId, 'u1');
  assert.deepEqual(state.winningCells, [10, 15, 20, 25]);
});

test('Vier Gewinnt erkennt waagerechte und diagonale Reihen', () => {
  let horizontal = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2
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

test('Vier Gewinnt hat fünf Spalten und alle Drop-Buttons in genau EINER Reihe', () => {
  const state = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2
  ).state;
  const json = buildGameContainer(state).toJSON();

  const rows = actionRows(json);
  const dropRows = rows.filter((row) =>
    row.components.every((component) => String(component.custom_id || '').startsWith('mg_c4_'))
  );
  assert.equal(dropRows.length, 1, 'genau eine Button-Reihe');
  assert.equal(dropRows[0].components.length, C4_COLUMNS);
  assert.equal(C4_COLUMNS, 5, 'fünf Spalten passen in eine Discord-Action-Row');
  assert.equal(customIds(json).filter((id) => id.startsWith('mg_c4_')).length, C4_COLUMNS);
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

test('Vier-Gewinnt-Brett kommt ohne Spaltennummern aus und hat gleich breite Buttons', () => {
  const state = acceptChallenge(
    createChallenge({ game: GAME_CONNECT4, challengerId: 'u1', opponentId: 'u2', now: 1 }), 'u2', 2
  ).state;
  const json = buildGameContainer(state).toJSON();
  const text = extractAllText(json);

  // Niemand soll mehr Spalten abzählen müssen.
  for (const digit of ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣']) {
    assert.ok(!text.includes(digit), `Spaltennummer ${digit} darf nicht mehr vorkommen`);
  }

  const boardRows = text.split('\n').filter((line) => line.includes('⚫'));
  assert.equal(boardRows.length, C4_ROWS);
  for (const row of boardRows) {
    assert.equal([...row].filter((char) => char === '⚫').length, C4_COLUMNS);
  }

  const labels = collectButtons(json)
    .filter((btn) => btn.custom_id.startsWith('mg_c4_'))
    .map((btn) => btn.label);
  assert.equal(labels.length, C4_COLUMNS);
  assert.equal(new Set(labels).size, 1, 'alle Drop-Buttons sehen identisch aus');
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
  assert.deepEqual(parseCustomId('mg_c4_4'), { kind: 'move', game: GAME_CONNECT4, position: 4 });
  assert.equal(parseCustomId('mg_ttt_9'), null);
  assert.equal(parseCustomId('mg_c4_5'), null, 'Vier Gewinnt hat nur fünf Spalten');
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

test('nur die fünf gewünschten Slash-Commands sind registriert und API-valide', () => {
  const commands = defineCommands().map((command) => command.toJSON());
  assert.deepEqual(commands.map((command) => command.name), [
    'play', 'set_language', 'admin_set_bot_profile', 'help', 'adminpanel',
  ]);
  const play = commands[0];
  assert.deepEqual(play.options[0].choices.map((choice) => choice.value), [GAME_TTT, GAME_CONNECT4]);
  assert.equal(commands[1].options[0].choices.length, 10);
  assert.equal(commands[1].default_member_permissions, '8');
  assert.equal(commands[2].default_member_permissions, '8');

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
