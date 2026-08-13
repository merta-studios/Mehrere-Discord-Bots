/**
 * Moderne Components-V2-Oberflächen für Herausforderungen und Spielbretter.
 *
 * Leitgedanke des Designs: **ein** Spielfeld pro Nachricht, so wenig Text wie
 * möglich und Buttons, die genau dort sitzen, wo man sie erwartet.
 * - Tic-Tac-Toe: das 3×3-Raster besteht selbst aus Buttons – kein zweites
 *   Textbrett daneben.
 * - Vier Gewinnt: 5 Spalten, damit alle fünf Drop-Buttons in eine einzige
 *   Reihe direkt unter das Brett passen (Discord erlaubt 5 Buttons pro Reihe).
 */

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
  GAME_CONNECT4,
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  STATUS_DECLINED,
  STATUS_EXPIRED,
  C4_COLUMNS,
  C4_ROWS,
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
  return `<t:${Math.floor(Number(timestamp) / 1000)}:R>`;
}

function addStateMarker(container, state) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(encodeHidden(encodeGamePayload(state)))
  );
}

/* ------------------------------------------------------------------ *
 * Symbole
 * ------------------------------------------------------------------ */

const TTT_EMPTY = '⬜';
const TTT_P1 = '❌';
const TTT_P2 = '⭕';

const C4_EMPTY = '⚫';
const C4_P1 = '🔴';
const C4_P2 = '🟡';
const C4_WIN_P1 = '🟥';
const C4_WIN_P2 = '🟨';
const C4_DROP = '⬇️';

/** Gleich breite Button-Labels: ideografische Leerräume um jedes Emoji. */
const PAD = '\u3000';
function wideLabel(emoji) {
  return `${PAD}${emoji}${PAD}`;
}

function tokenIcons(game) {
  return game === GAME_CONNECT4 ? [C4_P1, C4_P2] : [TTT_P1, TTT_P2];
}

function gameIcons(game) {
  return tokenIcons(game).join('');
}

/* ------------------------------------------------------------------ *
 * Herausforderung
 * ------------------------------------------------------------------ */

function challengeContainer(state) {
  const lang = state.lang;
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.pending);

  if (state.status === STATUS_DECLINED || state.status === STATUS_EXPIRED) {
    const key = state.status === STATUS_DECLINED ? 'declined' : 'expired';
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `## ${t(`${key}Title`, lang)}`,
          t(`${key}Body`, lang, {
            challenger: mention(state.challengerId),
            opponent: mention(state.opponentId),
          }),
        ].join('\n')
      )
    );
    addStateMarker(container, state);
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `## ${gameIcons(state.game)} ${gameName(state.game, lang)}`,
        t('challengeLine', lang, {
          challenger: mention(state.challengerId),
          opponent: mention(state.opponentId),
        }),
        t('deadlineShort', lang, { deadline: deadlineTag(state.expiresAt) }),
      ].join('\n')
    )
  );
  addStateMarker(container, state);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CID.accept).setStyle(ButtonStyle.Success).setLabel(t('btnAccept', lang)),
      new ButtonBuilder().setCustomId(CID.decline).setStyle(ButtonStyle.Secondary).setLabel(t('btnDecline', lang))
    )
  );
  return container;
}

/* ------------------------------------------------------------------ *
 * Gemeinsame Spielfeld-Bausteine
 * ------------------------------------------------------------------ */

/**
 * Kopfzeile jedes Spielfelds: Titel, beide Spieler mit ihrem Symbol und –
 * solange gespielt wird – eine klare Zug-Zeile. Bewusst knapp, damit das
 * Spielfeld selbst im Vordergrund steht.
 */
function battleHeader(state) {
  const lang = state.lang;
  const [icon1, icon2] = tokenIcons(state.game);
  const lines = [
    `## ${gameIcons(state.game)} ${gameName(state.game, lang)}`,
    `${icon1} ${mention(state.challengerId)}　${PAD}${icon2} ${mention(state.opponentId)}`,
  ];
  if (state.status === STATUS_ACTIVE) {
    const icon = state.turn === state.challengerId ? icon1 : icon2;
    lines.push(t('turn', lang, { player: `${mention(state.turn)} ${icon}` }));
  }
  return lines.join('\n');
}

function outcomeText(state) {
  const lang = state.lang;
  if (state.status === STATUS_WON) {
    return `### ${t('winnerShort', lang, { winner: mention(state.winnerId) })}\n${t('rematchShort', lang)}`;
  }
  if (state.status === STATUS_DRAW) {
    return `### ${t('drawShort', lang)}\n${t('rematchShort', lang)}`;
  }
  return '';
}

function addOutcome(container, state) {
  if (state.status !== STATUS_WON && state.status !== STATUS_DRAW) return;
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(outcomeText(state)));
}

/* ------------------------------------------------------------------ *
 * Tic-Tac-Toe – genau ein Spielfeld, nämlich die Buttons
 * ------------------------------------------------------------------ */

function tttGlyph(state, cell) {
  const token = state.board[cell];
  if (token === 1) return TTT_P1;
  if (token === 2) return TTT_P2;
  return TTT_EMPTY;
}

function tttCellButton(state, cell) {
  const token = state.board[cell];
  const win = state.winningCells.includes(cell);
  let style = ButtonStyle.Secondary;
  if (win) style = ButtonStyle.Success;
  return new ButtonBuilder()
    .setCustomId(CID.tttMove(cell))
    .setStyle(style)
    .setLabel(wideLabel(tttGlyph(state, cell)))
    .setDisabled(state.status !== STATUS_ACTIVE || Boolean(token));
}

function tttContainer(state) {
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.active);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(battleHeader(state)));
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
  addOutcome(container, state);
  return container;
}

/* ------------------------------------------------------------------ *
 * Vier Gewinnt – 5 Spalten, 5 Buttons, eine Reihe
 * ------------------------------------------------------------------ */

function c4Glyph(board, cell, winningCells = []) {
  const token = board[cell];
  const win = winningCells.includes(cell);
  if (token === 1) return win ? C4_WIN_P1 : C4_P1;
  if (token === 2) return win ? C4_WIN_P2 : C4_P2;
  return C4_EMPTY;
}

/**
 * 5×6-Raster ohne Spaltennummern – die Buttons stehen direkt darunter.
 * Die vier Gewinnsteine werden als Quadrate hervorgehoben.
 */
function connect4Board(board, winningCells = []) {
  const rows = [];
  for (let row = 0; row < C4_ROWS; row += 1) {
    const cells = [];
    for (let col = 0; col < C4_COLUMNS; col += 1) {
      cells.push(c4Glyph(board, row * C4_COLUMNS + col, winningCells));
    }
    rows.push(cells.join(PAD));
  }
  return rows.join('\n');
}

/**
 * Ein Drop-Button pro Spalte. Weil es genau fünf Spalten gibt, passen alle
 * Buttons in eine Action-Row und stehen dadurch bündig unter „ihrer“ Spalte.
 */
function columnButton(state, column) {
  const full = Boolean(state.board[column]);
  return new ButtonBuilder()
    .setCustomId(CID.connect4Move(column))
    .setStyle(full ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setLabel(wideLabel(C4_DROP))
    .setDisabled(state.status !== STATUS_ACTIVE || full);
}

function connect4Container(state) {
  const container = new ContainerBuilder().setAccentColor(COLORS[state.status] || COLORS.active);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${battleHeader(state)}\n\n${connect4Board(state.board, state.winningCells)}`)
  );
  addStateMarker(container, state);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      ...Array.from({ length: C4_COLUMNS }, (_, column) => columnButton(state, column))
    )
  );
  addOutcome(container, state);
  return container;
}

/* ------------------------------------------------------------------ *
 * Zusammenbau
 * ------------------------------------------------------------------ */

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
