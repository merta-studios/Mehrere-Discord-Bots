/**
 * Container & Embeds für den Love Tester – Components V2, gleiche Optik
 * wie Birthday- und XP-Bot (kein Farbrand, Trennlinien, Buttons im Container).
 */

const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const { t } = require('./languages');
const { componentsV2Payload } = require('./message-payload');

/** Kleinster Helfer-Container (wie bei den anderen Bots). */
function smallContainer(title, desc) {
  const container = new ContainerBuilder();
  let text = '';
  if (title) text += `# ${title}\n\n`;
  if (desc) text += desc;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trim() || '…'));
  return container;
}

/** Key maskieren für die Anzeige: gsk_…letzte4 */
function maskKey(key) {
  if (!key) return '—';
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Setup-Wizard (3 Schritte)
// ---------------------------------------------------------------------------

function setupNavRow(lang, token, { back = false, next = true, keyBtn = false, confirm = false } = {}) {
  const buttons = [];
  if (keyBtn) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`love_setup_${token}_key`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t('btnEnterKey', lang))
    );
  }
  if (back) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`love_setup_${token}_back`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnBack', lang))
    );
  }
  if (confirm) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`love_setup_${token}_confirm`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnConfirm', lang))
    );
  }
  if (next) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`love_setup_${token}_next`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t('btnNext', lang))
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`love_setup_${token}_cancel`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('btnCancel', lang))
  );
  return new ActionRowBuilder().addComponents(...buttons);
}

/** Schritt 1: Sprach-Auswahl. */
function buildSetupStep1({ lang, session, hint = '' }) {
  const { LANGS } = require('./languages');
  const container = new ContainerBuilder();
  const select = new StringSelectMenuBuilder()
    .setCustomId(`love_setup_${session.token}_lang`)
    .setPlaceholder(t('setupLangSelectPlaceholder', lang).slice(0, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      Object.entries(LANGS).map(([code, l]) => ({
        label: `${l.flag} ${l.name}`.slice(0, 100),
        value: code,
      }))
    );
  let desc = t('setupStep1Desc', lang);
  if (hint) desc += hint;
  if (session.lang) desc += `\n\n${t('setupCurrentLang', lang, { lang: `${LANGS[session.lang].flag} ${LANGS[session.lang].name}` })}`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('setupStepTitle', lang, { n: 1 })}\n\n${desc}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  container.addActionRowComponents(setupNavRow(lang, session.token, { back: false, next: true }));
  return container;
}

/** Schritt 2: Kanal-Auswahl (mehrere Kanäle möglich). */
function buildSetupStep2({ lang, session }) {
  const container = new ContainerBuilder();
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`love_setup_${session.token}_ch`)
    .setPlaceholder(t('setupChannelSelectPlaceholder', lang).slice(0, 150))
    .setMinValues(1)
    .setMaxValues(25)
    .setChannelTypes(ChannelType.GuildText);

  let desc = t('setupStep2Desc', lang);
  if (session.channels && session.channels.length) {
    desc += `\n\n${t('setupChannelsSelected', lang, { count: session.channels.length, list: session.channels.map((id) => `<#${id}>`).join(' ') })}`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('setupStepTitle', lang, { n: 2 })}\n\n${desc}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  container.addActionRowComponents(setupNavRow(lang, session.token, { back: true, next: true }));
  return container;
}

/** Schritt 3: Groq-API-Key + Zusammenfassung. */
function buildSetupStep3({ lang, session }) {
  const { LANGS } = require('./languages');
  const container = new ContainerBuilder();

  let desc = t('setupStep3Desc', lang);
  desc += '\n\n';
  if (session.lang) desc += `${t('setupCurrentLang', lang, { lang: `${LANGS[session.lang].flag} ${LANGS[session.lang].name}` })}\n`;
  if (session.channels && session.channels.length) {
    desc += `${t('setupChannelsSelected', lang, { count: session.channels.length, list: session.channels.map((id) => `<#${id}>`).join(' ') })}\n`;
  }
  if (session.groqKey) {
    desc += `\n${t('setupCurrentKey', lang, { key: `\`${maskKey(session.groqKey)}\`` })}\n`;
    desc += `\n${t('setupKeyEntered', lang, { key: `\`${maskKey(session.groqKey)}\`` })}`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('setupStepTitle', lang, { n: 3 })}\n\n${desc}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(setupNavRow(lang, session.token, { back: true, next: false, keyBtn: true, confirm: Boolean(session.groqKey) }));
  return container;
}

/** Setup-Erfolg. */
function buildSetupSuccess({ lang, session }) {
  const { LANGS } = require('./languages');
  const channels = (session.channels || []).map((id) => `<#${id}>`).join(', ') || '—';
  const langName = session.lang ? `${LANGS[session.lang].flag} ${LANGS[session.lang].name}` : '—';
  const desc = t('setupSuccess', lang, {
    lang: langName,
    channels,
    key: `\`${maskKey(session.groqKey)}\``,
  });
  return smallContainer(null, desc);
}

// ---------------------------------------------------------------------------
// /test_love
// ---------------------------------------------------------------------------

/** Datenschutz-Bestätigung (öffentlich sichtbar, Buttons nur für den Sender). */
function participantLine(user1, user2) {
  const mention = (user) => user?.id ? `<@${user.id}>` : (user?.displayName || user?.name || '?');
  return `**${mention(user1)}  ↔  ${mention(user2)}**`;
}

function buildLoveConfirm({ lang, token, user1, user2 }) {
  const container = new ContainerBuilder();
  const desc = t('loveConfirmBody', lang, {
    u1: `**<@${user1.id}>**`,
    u2: `**<@${user2.id}>**`,
  });
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('loveTestTitle', lang, { u1: user1.displayName, u2: user2.displayName })}\n\n${participantLine(user1, user2)}\n\n${desc}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`love_accept_${token}`).setStyle(ButtonStyle.Success).setLabel(t('btnAccept', lang)),
      new ButtonBuilder().setCustomId(`love_decline_${token}`).setStyle(ButtonStyle.Secondary).setLabel(t('btnDecline', lang))
    )
  );
  return container;
}

/** Analyse-Fortschritt (wird laufend bearbeitet). */
function buildProgress({ lang, token, pct, phase, user1, user2 }) {
  const container = new ContainerBuilder();
  const bar = progressBar(pct);
  const participants = user1 && user2 ? `${participantLine(user1, user2)}\n\n` : '';
  const text = `# ${t('loveTestTitle', lang, { u1: user1?.displayName || '❔', u2: user2?.displayName || '❔' })}\n\n${participants}${bar}\n${t('analysingProgress', lang, { pct, phase })}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trim()));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`love_stop_${token}`).setStyle(ButtonStyle.Secondary).setLabel(t('btnStop', lang))
    )
  );
  return container;
}

function progressBar(pct, segments = 12) {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * segments);
  return '🟥'.repeat(filled) + '⬜'.repeat(segments - filled);
}

/** Ergebnis-Container: KI-Text (enthält die „### XX %“-Zeile) + Footer. */
function buildResult({ lang, token, aiText, user1, user2 }) {
  const container = new ContainerBuilder();
  const participants = user1 && user2 ? `${participantLine(user1, user2)}\n\n` : '';
  const body = `${t('loveResultTitle', lang)}\n\n${participants}${aiText}\n${t('loveResultFooter', lang)}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  return container;
}

/** Fehler-Container mit Retry / Weiter analysieren / Abbrechen. */
function buildError({ lang, token, message, canContinue }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('errTitle', lang)}\n\n${message}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`love_retry_${token}`).setStyle(ButtonStyle.Primary).setLabel(t('btnRetry', lang)),
    new ButtonBuilder().setCustomId(`love_more_${token}`).setStyle(ButtonStyle.Secondary).setLabel(t('btnContinue', lang)).setDisabled(!canContinue),
    new ButtonBuilder().setCustomId(`love_stop_${token}`).setStyle(ButtonStyle.Danger).setLabel(t('btnStop', lang))
  );
  container.addActionRowComponents(row);
  return container;
}

/** Abgebrochen / abgelehnt. */
function buildStopped({ lang, text }) {
  return smallContainer(null, text);
}

module.exports = {
  smallContainer,
  maskKey,
  buildSetupStep1,
  buildSetupStep2,
  buildSetupStep3,
  buildSetupSuccess,
  buildLoveConfirm,
  buildProgress,
  buildResult,
  buildError,
  buildStopped,
  progressBar,
  componentsV2Payload,
};
