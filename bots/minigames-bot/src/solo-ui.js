/**
 * 🧩 Oberfläche des Single-Player-Modus (Components V2).
 *
 * Ziel: 2048 soll im Discord-Channel **richtig gut aussehen** – nicht nur
 * eine Zahlenwüste. Deshalb:
 * - Das Brett steckt in einem `ansi`-Codeblock. Auf Desktop/Web bekommt jeder
 *   Stein seine eigene Farbe im Stil des Originals; auf Mobilgeräten rendert
 *   Discord denselben Block sauber monospaced (nur ohne Farbe), das Layout
 *   bleibt also überall exakt bündig.
 * - Kopfzeile mit Punktestand, letztem Punktgewinn (+48), bestem Stein,
 *   Zugzähler und einem Fortschrittsbalken bis 2048.
 * - Der neu erschienene Stein ist unterstrichen, frisch verschmolzene Steine
 *   sind hervorgehoben – man sieht auf einen Blick, was der Zug bewirkt hat.
 * - Steuerung als echtes Steuerkreuz (⬆️ ⬅️ ⬇️ ➡️) plus Rückgängig und
 *   Neustart. Richtungen, in die nichts geht, werden automatisch deaktiviert.
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
  SIZE,
  GAME_2048,
  WIN_EXP,
  SOLO_ACTIVE,
  SOLO_WON,
  SOLO_OVER,
  SOLO_CID,
  tileValue,
  highestExp,
  availableDirections,
  encodeSoloPayload,
  decodeSoloPayload,
} = require('./game-2048');
const { encodeHidden, decodeHidden } = require('./zw-marker');
const { componentsV2Payload } = require('./message-payload');
const { extractAllText } = require('./embed-builder');

const SOLO_COLORS = {
  [SOLO_ACTIVE]: 0xedc22e, // das warme Gold der 2048-Kachel
  [SOLO_WON]: 0x2ecc71,
  [SOLO_OVER]: 0xe74c3c,
};

/* ------------------------------------------------------------------ *
 * ANSI-Farbwelt
 * ------------------------------------------------------------------ */

const ESC = '\u001b';
const RESET = `${ESC}[0m`;

/**
 * Discord unterstützt in `ansi`-Blöcken acht Vorder- und acht
 * Hintergrundfarben. Diese Tabelle bildet die klassische 2048-Palette so
 * nah wie möglich darauf ab: helle Steine unten, warme in der Mitte,
 * tiefe/kräftige Farben für die großen Brocken.
 */
const TILE_STYLES = {
  1: '1;30;47',  //    2 – weiß
  2: '1;30;46',  //    4 – hellgrau
  3: '1;30;43',  //    8 – türkisgrau
  4: '1;37;42',  //   16 – marmorblau
  5: '1;37;41',  //   32 – orange
  6: '1;33;41',  //   64 – orange, gelbe Schrift
  7: '1;37;45',  //  128 – indigo
  8: '1;33;45',  //  256 – indigo, gelbe Schrift
  9: '1;37;44',  //  512 – grau
  10: '1;36;40', // 1024 – dunkelblau, cyan
  11: '1;33;40', // 2048 – dunkelblau, gold
};
const TILE_STYLE_BEYOND = '1;32;40'; // 4096 und alles darüber
const EMPTY_STYLE = '0;30';

const CELL_WIDTH = 6;

function center(text, width = CELL_WIDTH) {
  const value = String(text);
  if (value.length >= width) return value.slice(0, width);
  const left = Math.floor((width - value.length) / 2);
  return ' '.repeat(left) + value + ' '.repeat(width - value.length - left);
}

function styleFor(exp) {
  return TILE_STYLES[exp] || TILE_STYLE_BEYOND;
}

/**
 * Beschriftung einer Kachel.
 *
 * Frisch verschmolzene Steine bekommen `[…]` um die Zahl. Das ist Absicht:
 * Auf Mobilgeräten rendert Discord ANSI-Blöcke ohne Farbe, dort wäre eine
 * rein farbliche Hervorhebung unsichtbar. Passt die Klammer nicht mehr in
 * die Zellenbreite (fünfstellige Steine), entfällt sie automatisch.
 */
function cellLabel(exp, isMerged) {
  const value = String(tileValue(exp));
  if (isMerged && value.length + 2 <= CELL_WIDTH) return `[${value}]`;
  return value;
}

function renderCell(exp, { isNew = false, isMerged = false } = {}) {
  if (!exp) return `${ESC}[${EMPTY_STYLE}m${center('·')}${RESET}`;
  // Der frisch gesetzte Stein wird unterstrichen, damit man sofort sieht,
  // welcher Stein durch den letzten Zug dazugekommen ist.
  const codes = `${isNew ? '4;' : ''}${styleFor(exp)}`;
  return `${ESC}[${codes}m${center(cellLabel(exp, isMerged))}${RESET}`;
}

const LINE_TOP = `┏${Array(SIZE).fill('━'.repeat(CELL_WIDTH)).join('┳')}┓`;
const LINE_MID = `┣${Array(SIZE).fill('━'.repeat(CELL_WIDTH)).join('╋')}┫`;
const LINE_BOTTOM = `┗${Array(SIZE).fill('━'.repeat(CELL_WIDTH)).join('┻')}┛`;

/** Baut das komplette 4×4-Brett als `ansi`-Codeblock. */
function renderBoard(state) {
  const rows = [];
  for (let row = 0; row < SIZE; row += 1) {
    const cells = [];
    for (let col = 0; col < SIZE; col += 1) {
      const index = row * SIZE + col;
      cells.push(
        renderCell(state.board[index], {
          isNew: state.newCell === index,
          isMerged: state.mergedCells.includes(index),
        })
      );
    }
    rows.push(`┃${cells.join('┃')}┃`);
    if (row < SIZE - 1) rows.push(LINE_MID);
  }
  return ['```ansi', LINE_TOP, ...rows, LINE_BOTTOM, '```'].join('\n');
}

/* ------------------------------------------------------------------ *
 * Kopfzeile
 * ------------------------------------------------------------------ */

const BAR_SEGMENTS = 10;

/** Fortschritt vom Stein 2 (Exponent 1) bis 2048 (Exponent 11). */
function progressBar(exp) {
  const reached = Math.max(0, Math.min(BAR_SEGMENTS, exp - 1));
  return `${'▰'.repeat(reached)}${'▱'.repeat(BAR_SEGMENTS - reached)}`;
}

/** Kleiner Rang, der mit dem besten Stein mitwächst – reine Spielfreude. */
function rankKey(exp) {
  if (exp >= 13) return 'soloRank7';
  if (exp >= 12) return 'soloRank6';
  if (exp >= WIN_EXP) return 'soloRank5';
  if (exp >= 9) return 'soloRank4';
  if (exp >= 7) return 'soloRank3';
  if (exp >= 5) return 'soloRank2';
  return 'soloRank1';
}

function formatNumber(value) {
  // Tausenderpunkte ohne Locale-Abhängigkeit: gleiche Optik in allen Sprachen.
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function headerText(state) {
  const lang = state.lang;
  const exp = highestExp(state.board);
  const best = tileValue(exp);
  const gain = state.lastGain > 0 ? ` \`+${formatNumber(state.lastGain)}\`` : '';

  const lines = [
    `## 🧩 ${t('gameSolo2048', lang)}`,
    t('soloPlayerLine', lang, { player: `<@${state.userId}>`, rank: t(rankKey(exp), lang) }),
    `> 🏆 **${formatNumber(state.score)}**${gain}　🧱 **${formatNumber(best)}**　🎮 **${formatNumber(state.moves)}**`,
    `> ${progressBar(exp)} ${exp >= WIN_EXP ? '🏁 2048 ✅' : `→ **2048**`}`,
  ];
  return lines.join('\n');
}

function footerText(state) {
  const lang = state.lang;
  if (state.status === SOLO_WON) {
    return `### ${t('soloWinTitle', lang)}\n${t('soloWinBody', lang, { score: formatNumber(state.score) })}`;
  }
  if (state.status === SOLO_OVER) {
    const exp = highestExp(state.board);
    return `### ${t('soloOverTitle', lang)}\n${t('soloOverBody', lang, {
      score: formatNumber(state.score),
      best: formatNumber(tileValue(exp)),
      moves: formatNumber(state.moves),
    })}`;
  }
  return t('soloHint', lang);
}

/* ------------------------------------------------------------------ *
 * Steuerkreuz
 * ------------------------------------------------------------------ */

const PAD = '\u3000';
// U+3000 allein sieht zwar leer aus, wird von Discord aber als reiner
// Leerraum getrimmt. Damit war das Button-Label anschließend leer und die
// komplette /singleplayer-Antwort wurde als „Invalid Form Body“ abgewiesen.
// U+2800 ist ein unsichtbares Braille-Zeichen, aber ausdrücklich KEIN
// Unicode-Leerraum. Der Platzhalter bleibt damit unsichtbar und API-gültig.
const BUTTON_BLANK = '\u2800';

function padButton(slot) {
  // Unsichtbarer, dauerhaft deaktivierter Platzhalter: nur so entsteht aus
  // Discords 5er-Reihen ein optisch sauberes Steuerkreuz. Die breiten Räume
  // halten die Button-Größe, BUTTON_BLANK verhindert ein leeres Label.
  return new ButtonBuilder()
    .setCustomId(SOLO_CID.pad(slot))
    .setStyle(ButtonStyle.Secondary)
    .setLabel(`${PAD}${BUTTON_BLANK}${PAD}`)
    .setDisabled(true);
}

function directionButton(state, direction, emoji, possible) {
  return new ButtonBuilder()
    .setCustomId(SOLO_CID.move(direction))
    .setStyle(ButtonStyle.Primary)
    .setLabel(`${PAD}${emoji}${PAD}`)
    .setDisabled(state.status === SOLO_OVER || state.status === SOLO_WON || !possible.includes(direction));
}

function soloControls(state) {
  const rows = [];
  const possible = state.status === SOLO_ACTIVE ? availableDirections(state.board) : [];

  rows.push(
    new ActionRowBuilder().addComponents(
      padButton(1),
      directionButton(state, 'up', '⬆️', possible),
      padButton(2)
    )
  );
  rows.push(
    new ActionRowBuilder().addComponents(
      directionButton(state, 'left', '⬅️', possible),
      directionButton(state, 'down', '⬇️', possible),
      directionButton(state, 'right', '➡️', possible)
    )
  );

  const extra = [];
  if (state.status === SOLO_WON) {
    extra.push(
      new ButtonBuilder()
        .setCustomId(SOLO_CID.resume)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('soloBtnContinue', state.lang))
    );
  }
  extra.push(
    new ButtonBuilder()
      .setCustomId(SOLO_CID.undo)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('soloBtnUndo', state.lang))
      .setDisabled(!state.previous)
  );
  extra.push(
    new ButtonBuilder()
      .setCustomId(SOLO_CID.restart)
      .setStyle(state.status === SOLO_OVER ? ButtonStyle.Success : ButtonStyle.Danger)
      .setLabel(t('soloBtnRestart', state.lang))
  );
  rows.push(new ActionRowBuilder().addComponents(...extra));
  return rows;
}

/* ------------------------------------------------------------------ *
 * Zusammenbau
 * ------------------------------------------------------------------ */

function addSoloMarker(container, state) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(encodeHidden(encodeSoloPayload(state)))
  );
}

function buildSoloContainer(state) {
  const container = new ContainerBuilder().setAccentColor(SOLO_COLORS[state.status] || SOLO_COLORS[SOLO_ACTIVE]);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${headerText(state)}\n${renderBoard(state)}`)
  );
  addSoloMarker(container, state);
  for (const row of soloControls(state)) container.addActionRowComponents(row);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(state)));
  return container;
}

function buildSoloPayload(state) {
  return componentsV2Payload([buildSoloContainer(state)], {
    allowedMentions: { users: [state.userId], roles: [], parse: [] },
  });
}

/** Liest den unsichtbaren Solo-Marker aus einer bestehenden Nachricht. */
function parseSoloMessage(message) {
  const text = extractAllText(message);
  return decodeSoloPayload(`${decodeHidden(text).join('|')}|${text}`);
}

module.exports = {
  SOLO_COLORS,
  CELL_WIDTH,
  center,
  renderCell,
  renderBoard,
  progressBar,
  rankKey,
  formatNumber,
  headerText,
  footerText,
  soloControls,
  buildSoloContainer,
  buildSoloPayload,
  parseSoloMessage,
  GAME_2048,
};
