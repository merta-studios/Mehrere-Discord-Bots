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
      new ButtonBuilder().setCustomId(CID.accept).setStyle(ButtonStyle.Success).setLabel(t('btnAccept', lang)),
      new ButtonBuilder().setCustomId(CID.decline).setStyle(ButtonStyle.Secondary).setLabel(t('btnDecline', lang))
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

function battleHeader(state) {
  const lang = state.lang;
  const title = t(state.game === GAME_CONNECT4 ? 'c4Title' : 'tttTitle', lang);
  const symbols = state.game === GAME_CONNECT4
    ? `🔴 ${mention(state.challengerId)}   •   🟡 ${mention(state.opponentId)}`
    : `❌ ${mention(state.challengerId)}   •   ⭕ ${mention(state.opponentId)}`;
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

function tttCellButton(state, cell) {
  const token = state.board[cell];
  const complete = state.status !== STATUS_ACTIVE;
  let style = ButtonStyle.Secondary;
  if (token === 1) style = ButtonStyle.Danger;
  if (token === 2) style = ButtonStyle.Primary;
  if (state.winningCells.includes(cell)) style = ButtonStyle.Success;
  return new ButtonBuilder()
    .setCustomId(CID.tttMove(cell))
    .setStyle(style)
    .setLabel(token === 1 ? '❌' : token === 2 ? '⭕' : '·')
    .setDisabled(complete || Boolean(token));
}

function tttContainer(state) {
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.active);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(battleHeader(state)));
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

function connect4Board(board) {
  const lines = ['╭  1  2  3  4  5  6  7  ╮'];
  for (let row = 0; row < 6; row += 1) {
    const cells = board.slice(row * 7, row * 7 + 7).map((token) => (token === 1 ? '🔴' : token === 2 ? '🟡' : '⚫'));
    lines.push(`│ ${cells.join(' ')} │`);
  }
  lines.push('╰━━━━━━━━━━━━━━━━━━━━━╯');
  return lines.join('\n');
}

function columnButton(state, column) {
  const full = Boolean(state.board[column]);
  return new ButtonBuilder()
    .setCustomId(CID.connect4Move(column))
    .setStyle(column % 2 === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setLabel(`▼ ${column + 1}`)
    .setDisabled(state.status !== STATUS_ACTIVE || full);
}

function connect4Container(state) {
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.active);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${battleHeader(state)}\n\n${connect4Board(state.board)}`)
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
