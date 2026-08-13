/** Moderne Components-V2-Oberflächen für Herausforderungen und Spielbretter. */

const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { t } = require('./languages');
const {
  GAME_TTT,
  GAME_CONNECT4,
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  STATUS_DECLINED,
  STATUS_EXPIRED,
  CID,
  encodeGamePayload,
  decodeGamePayload,
  encodeLanguagePayload,
  decodeLanguagePayload,
} = require('./games');
const { encodeHidden, decodeHidden } = require('./zw-marker');
const { componentsV2Payload } = require('./message-payload');

const COLORS = {
  pending: 0xf1c40f,
  active: 0x5865f2,
  won: 0x2ecc71,
  draw: 0x95a5a6,
  declined: 0xe74c3c,
  expired: 0x7f8c8d,
};

function extractAllText(obj, depth = 0) {
  if (!obj || depth > 12) return '';
  if (typeof obj === 'string') return `${obj}\n`;
  if (Array.isArray(obj)) return obj.map((item) => extractAllText(item, depth + 1)).join('');
  if (typeof obj !== 'object') return '';
  let out = '';
  if (typeof obj.content === 'string') out += `${obj.content}\n`;
  if (typeof obj.data?.content === 'string') out += `${obj.data.content}\n`;
  if (obj.components) out += extractAllText(obj.components, depth + 1);
  if (obj.embeds) out += extractAllText(obj.embeds, depth + 1);
  return out;
}

function hiddenPayloadFromMessage(message) {
  const text = extractAllText(message);
  return `${decodeHidden(text).join('|')}|${text}`;
}

function parseGameMessage(message) {
  return decodeGamePayload(hiddenPayloadFromMessage(message));
}

function parseLanguageMessage(message) {
  return decodeLanguagePayload(hiddenPayloadFromMessage(message));
}

function gameName(game, lang) {
  return t(game === GAME_CONNECT4 ? 'gameConnect4' : 'gameTtt', lang);
}

function mention(userId) {
  return `<@${userId}>`;
}

function deadlineTag(timestamp) {
  return `<t:${Math.floor(Number(timestamp) / 1000)}:F>`;
}

function addStateMarker(container, state) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(encodeHidden(encodeGamePayload(state)))
  );
}

function challengeContainer(state) {
  const lang = state.lang;
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.pending);

  if (state.status === STATUS_DECLINED) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t('declinedTitle', lang)}\n\n${t('declinedBody', lang, {
          challenger: mention(state.challengerId),
          opponent: mention(state.opponentId),
        })}`
      )
    );
    addStateMarker(container, state);
    return container;
  }

  if (state.status === STATUS_EXPIRED) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${t('expiredTitle', lang)}\n\n${t('expiredBody', lang, {
          challenger: mention(state.challengerId),
          opponent: mention(state.opponentId),
        })}`
      )
    );
    addStateMarker(container, state);
    return container;
  }

  const body = [
    `# ${t('challengeTitle', lang)}`,
    '',
    `## ⚡ ${gameName(state.game, lang)}`,
    '',
    t('challengeBody', lang, {
      challenger: mention(state.challengerId),
      opponent: mention(state.opponentId),
      game: gameName(state.game, lang),
    }),
    '',
    t('challengeDeadline', lang, { deadline: deadlineTag(state.expiresAt) }),
  ].join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  addStateMarker(container, state);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CID.accept).setStyle(ButtonStyle.Success).setLabel(`   ${t('btnAccept', lang)}   `),
      new ButtonBuilder().setCustomId(CID.decline).setStyle(ButtonStyle.Danger).setLabel(`   ${t('btnDecline', lang)}   `)
    )
  );
  return container;
}

function outcomeText(state) {
  const lang = state.lang;
  if (state.status === STATUS_WON) {
    const loserId = state.winnerId === state.challengerId ? state.opponentId : state.challengerId;
    return [
      `# ${t('winnerTitle', lang)}`,
      '',
      t('winnerBody', lang, { winner: mention(state.winnerId), loser: mention(loserId) }),
      '',
      t('rematch', lang),
    ].join('\n');
  }
  if (state.status === STATUS_DRAW) {
    return [`# ${t('drawTitle', lang)}`, '', t('drawBody', lang), '', t('rematch', lang)].join('\n');
  }
  return '';
}

/** Gleich breite Button-Labels: ideografische Leerräume + immer ein Emoji. */
const PAD = '\u3000';
function wideLabel(emoji) {
  return `${PAD}${emoji}${PAD}`;
}

const TTT_EMPTY = '⬜';
const TTT_P1 = '❌';
const TTT_P2 = '⭕';
const TTT_WIN_P1 = '❎';
const TTT_WIN_P2 = '🔵';

const C4_EMPTY = '⬛';
const C4_P1 = '🔴';
const C4_P2 = '🟡';
const C4_WIN_P1 = '🟥';
const C4_WIN_P2 = '🟨';
const C4_COLS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

function battleHeader(state) {
  const lang = state.lang;
  const title = t(state.game === GAME_CONNECT4 ? 'c4Title' : 'tttTitle', lang);
  const symbols = state.game === GAME_CONNECT4
    ? `${C4_P1} ${mention(state.challengerId)}\n${C4_P2} ${mention(state.opponentId)}`
    : `${TTT_P1} ${mention(state.challengerId)}\n${TTT_P2} ${mention(state.opponentId)}`;
  const lines = [
    `# ${title}`,
    '',
    `## ${t('battleVs', lang, {
      challenger: mention(state.challengerId),
      opponent: mention(state.opponentId),
    })}`,
    '',
    symbols,
  ];
  if (state.status === STATUS_ACTIVE) lines.push('', t('turn', lang, { player: mention(state.turn) }));
  return lines.join('\n');
}

function tttGlyph(state, cell) {
  const token = state.board[cell];
  const win = state.winningCells.includes(cell);
  if (token === 1) return win ? TTT_WIN_P1 : TTT_P1;
  if (token === 2) return win ? TTT_WIN_P2 : TTT_P2;
  return TTT_EMPTY;
}

function tttBoard(state) {
  const rows = [];
  for (let row = 0; row < 3; row += 1) {
    const cells = [0, 1, 2].map((col) => tttGlyph(state, row * 3 + col));
    rows.push(cells.join(' ┃ '));
    if (row < 2) rows.push('━━━━╋━━━━╋━━━━');
  }
  return rows.join('\n');
}

function tttCellButton(state, cell) {
  const token = state.board[cell];
  const complete = state.status !== STATUS_ACTIVE;
  const win = state.winningCells.includes(cell);
  let style = ButtonStyle.Secondary;
  if (token === 1) style = ButtonStyle.Danger;
  if (token === 2) style = ButtonStyle.Primary;
  if (win) style = ButtonStyle.Success;
  return new ButtonBuilder()
    .setCustomId(CID.tttMove(cell))
    .setStyle(style)
    .setLabel(wideLabel(tttGlyph(state, cell)))
    .setDisabled(complete || Boolean(token));
}

function tttContainer(state) {
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.active);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${battleHeader(state)}\n\n${tttBoard(state)}`)
  );
  if (state.status === STATUS_WON || state.status === STATUS_DRAW) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(outcomeText(state)));
  }
  addStateMarker(container, state);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  for (let row = 0; row < 3; row += 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        tttCellButton(state, row * 3),
        tttCellButton(state, row * 3 + 1),
        tttCellButton(state, row * 3 + 2)
      )
    );
  }
  return container;
}

function c4Glyph(board, cell, winningCells = []) {
  const token = board[cell];
  const win = winningCells.includes(cell);
  if (token === 1) return win ? C4_WIN_P1 : C4_P1;
  if (token === 2) return win ? C4_WIN_P2 : C4_P2;
  return C4_EMPTY;
}

function connect4Board(board, winningCells = []) {
  const header = C4_COLS.join(' ');
  const rows = [];
  for (let row = 0; row < 6; row += 1) {
    const cells = [];
    for (let col = 0; col < 7; col += 1) {
      cells.push(c4Glyph(board, row * 7 + col, winningCells));
    }
    rows.push(cells.join(' '));
  }
  return [header, ...rows].join('\n');
}

function columnButton(state, column) {
  const full = Boolean(state.board[column]);
  const style = full
    ? ButtonStyle.Secondary
    : column % 2 === 0
      ? ButtonStyle.Primary
      : ButtonStyle.Success;
  return new ButtonBuilder()
    .setCustomId(CID.connect4Move(column))
    .setStyle(style)
    .setLabel(wideLabel(C4_COLS[column]))
    .setDisabled(state.status !== STATUS_ACTIVE || full);
}

function connect4Container(state) {
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.active);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${battleHeader(state)}\n\n${connect4Board(state.board, state.winningCells)}`
    )
  );
  if (state.status === STATUS_ACTIVE) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`*${t('c4Drop', state.lang)}*`));
  } else if (state.status === STATUS_WON || state.status === STATUS_DRAW) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(outcomeText(state)));
  }
  addStateMarker(container, state);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(...[0, 1, 2, 3].map((column) => columnButton(state, column))),
    new ActionRowBuilder().addComponents(...[4, 5, 6].map((column) => columnButton(state, column)))
  );
  return container;
}

function buildGameContainer(state) {
  if (state.status === STATUS_PENDING || state.status === STATUS_DECLINED || state.status === STATUS_EXPIRED) {
    return challengeContainer(state);
  }
  return state.game === GAME_CONNECT4 ? connect4Container(state) : tttContainer(state);
}

function buildGamePayload(state) {
  // Bei der Anfrage wird gezielt nur der Gegner gepingt. Der Herausforderer
  // bleibt zwar als Mention sichtbar, bekommt aber keine unnötige Eigen-Ping.
  const pingedUsers = state.status === STATUS_PENDING
    ? [state.opponentId]
    : [state.challengerId, state.opponentId];
  return componentsV2Payload([buildGameContainer(state)], {
    allowedMentions: { users: pingedUsers, roles: [], parse: [] },
  });
}

function buildLanguageContainer(guildId, lang, text, changedAt = Date.now()) {
  const container = new ContainerBuilder()
    .setAccentColor(0x3498db)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(text),
      new TextDisplayBuilder().setContent(encodeHidden(encodeLanguagePayload(guildId, lang, changedAt)))
    );
  return container;
}

function smallContainer(title, desc, color = 0x5865f2) {
  const text = `${title ? `# ${title}\n\n` : ''}${desc || '…'}`;
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

module.exports = {
  COLORS,
  extractAllText,
  parseGameMessage,
  parseLanguageMessage,
  gameName,
  connect4Board,
  buildGameContainer,
  buildGamePayload,
  buildLanguageContainer,
  smallContainer,
};
