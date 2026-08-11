/**
 * Endless Story Game für den Love Tester Bot.
 *
 * Features:
 * - /endless_story_channel (nur Admins) öffnet ein Modal mit Situation + 3 Optionen.
 *   Danach wird die erste Story-Nachricht in den ausgewählten Channel geschickt.
 * - Jede Situation erscheint als Text (Zeilenumbrüche → Leerzeichen) mit 3
 *   Buttons. Die Buttons haben zufällig Rot/Grün/Blau.
 * - JEDER User kann einen Button klicken. Nach dem Klick wird die Nachricht
 *   so editiert, dass die Buttons deaktiviert (ausgegraut) sind. Dann wird
 *   über die Groq API die nächste Situation + 3 neue Optionen generiert und
 *   als neue Nachricht geschickt. Das geht unendlich weiter.
 * - An Groq werden die letzten 5 Situationen (inkl. gewählter Option)
 *   geschickt, damit die Geschichte konsistent bleibt.
 * - Wenn unter der letzten Story-Nachricht mehr als 3 Fremd-Nachrichten
 *   (echte User, keine Bots, keine Story-Nachrichten) stehen, werden die
 *   ältesten davon gelöscht, bis nur noch 3 da sind.
 */

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const { smallContainer, componentsV2Payload } = require('./embed-builder');
const { groqChat, GROQ_MODEL } = require('./analyzer');

const STORY_BUTTON_COLORS = [ButtonStyle.Danger, ButtonStyle.Success, ButtonStyle.Primary];
const STORY_PREFIX = 'story_';
const STORY_MARKER = '\u200Bendless-story:v1\u200B';
const STORY_HISTORY_LIMIT = 5;
const MAX_FOREIGN_MESSAGES = 3;

function randomColors() {
  // Zufällige Permutation von [Danger, Success, Primary] → Rot, Grün, Blau
  const pool = [...STORY_BUTTON_COLORS];
  const out = [];
  while (pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Normalisiert Text: Zeilenumbrüche → Leerzeichen, Mehrfach-Leerzeichen raus. */
function flattenText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Baut die Container-Payload für eine Situation mit (ggf. deaktivierten) Buttons. */
function buildSituationPayload({ situation, options, colors, disabled = false, turn = 1, chosenIndex = null }) {
  const safeSituation = flattenText(situation) || '…';
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# 📖 Endless Story — Zug ${turn}\n\n${safeSituation}${STORY_MARKER}`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  const row = new ActionRowBuilder();
  const safeOptions = (options || []).slice(0, 3);
  const safeColors = (colors || STORY_BUTTON_COLORS).slice(0, 3);
  safeOptions.forEach((opt, i) => {
    const label = flattenText(opt).slice(0, 70) || `Option ${i + 1}`;
    const btn = new ButtonBuilder()
      .setCustomId(`${STORY_PREFIX}opt_${i}`)
      .setLabel(label)
      .setStyle(safeColors[i] || ButtonStyle.Secondary)
      .setDisabled(Boolean(disabled));
    if (disabled && chosenIndex === i) btn.setLabel(`▶ ${label}`);
    row.addComponents(btn);
  });
  container.addActionRowComponents(row);
  return componentsV2Payload([container]);
}

/** Parst die KI-Antwort im strikten Format und extrahiert Situation + 3 Optionen. */
function parseAiResponse(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  // Jede OPTION-Zeile muss am Zeilenanfang stehen, damit zufällige Erwähnungen
  // ("Option 1 wäre cool") mitten im Text den Parser nicht kaputtmachen.
  const opt1Match = text.match(/^\s*OPTION\s*1\s*[:\-–—]\s*(.+)$/im);
  const opt2Match = text.match(/^\s*OPTION\s*2\s*[:\-–—]\s*(.+)$/im);
  const opt3Match = text.match(/^\s*OPTION\s*3\s*[:\-–—]\s*(.+)$/im);

  let situation = text;
  const firstOptIdx = opt1Match ? opt1Match.index : -1;
  if (firstOptIdx >= 0) {
    let s = text.slice(0, firstOptIdx);
    s = s.replace(/^\s*(?:SITUATION|SZENARIO)\s*[:\-–—]?\s*/i, '');
    situation = s;
  }
  situation = flattenText(situation);

  const o1 = flattenText(opt1Match?.[1] || '');
  const o2 = flattenText(opt2Match?.[1] || '');
  const o3 = flattenText(opt3Match?.[1] || '');

  if (!situation || !o1 || !o2 || !o3) {
    throw new Error('Ungültiges KI-Format (Situation/Optionen fehlen).');
  }
  return { situation, options: [o1, o2, o3] };
}

/** System-Prompt für die Geschichtenerzählerin. */
function buildStorySystemPrompt(lang = 'de') {
  const langLine = {
    de: 'Schreibe ALLES auf Deutsch.',
    en: 'Write EVERYTHING in English.',
    fr: 'Écris TOUT en français.',
    es: 'Escribe TODO en español.',
    pt: 'Escreva TUDO em português.',
    ru: 'Отвечай ТОЛЬКО на русском.',
    ja: '全て日本語で書いて。',
    ko: '모든 걸 한국어로 써.',
    zh: '全部用中文写。',
    it: 'Scrivi TUTTO in italiano.',
  }[lang] || 'Schreibe ALLES auf Deutsch.';

  return [
    'Du bist eine kreative, witzige Geschichtenerzählerin für ein interaktives Discord-Story-Spiel.',
    'Die Geschichte wird Zug um Zug weitergesponnen. Die User wählen jedes Mal eine von drei Optionen.',
    'Halte die Situationen spannend, überraschend, manchmal lustig, manchmal dramatisch – aber nie beleidigend oder unangemessen.',
    'Die Geschichte darf sich in JEDE Genre entwickeln (Alltag, Fantasy, Sci-Fi, Krimi, Comedy …) – folge den bisherigen Zügen, aber füge gerne Twists hinzu.',
    '',
    'ANTWORTE STRENG IN DIESEM FORMAT (genau diese Blöcke, KEINE Zusatztexte davor/danach):',
    'SITUATION:',
    '<Kurze Beschreibung der neuen Situation, wie die Geschichte weitergeht. GENAU 2–3 mittellange Sätze (keine kürzeren, keine längeren), spannend & lebendig. Keine Zeilenumbrüche im Fließtext.>',
    'OPTION 1: <Eine kurze, klare Handlungsmöglichkeit (max 50 Zeichen).>',
    'OPTION 2: <Eine zweite Handlungsmöglichkeit (max 50 Zeichen).>',
    'OPTION 3: <Eine dritte Handlungsmöglichkeit (max 50 Zeichen).>',
    '',
    'Regeln:',
    '- Die "SITUATION:"-Zeile und die "OPTION N:"-Zeilen stehen JEWEILS AM ANFANG EINER EIGENEN ZEILE.',
    '- Keine Überschriften, Einleitungen, Meta-Kommentare oder Fragen außerhalb des Formats.',
    '- Die drei Optionen müssen sich deutlich unterscheiden und zu unterschiedlichen Ausgängen führen.',
    `- ${langLine}`,
  ].join('\n');
}

/** User-Prompt mit den letzten N Situationen und der gewählten Option. */
function buildStoryUserPrompt({ history, chosenOptionText }) {
  const lines = [];
  lines.push('Bisherige Geschichte (letzte Züge, ältere zuerst):');
  history.forEach((h, i) => {
    lines.push(`Zug ${i + 1}: Situation: ${h.situation}`);
    if (h.chosenOption) lines.push(`  → Gewählt: ${h.chosenOption}`);
  });
  lines.push('');
  lines.push(`Die Gruppe hat zuletzt gewählt: „${chosenOptionText}“`);
  lines.push('Erfinde daraus die NÄCHSTE Situation und 3 neue Optionen. Folge EXAKT dem Format.');
  return lines.join('\n');
}

/** Ruft Groq auf, um den nächsten Spielzug zu generieren. */
async function generateNextTurn({ apiKey, history, chosenOptionText, lang }) {
  const sys = buildStorySystemPrompt(lang);
  const usr = buildStoryUserPrompt({ history, chosenOptionText });
  const { content } = await groqChat({
    apiKey,
    systemPrompt: sys,
    userPrompt: usr,
    model: GROQ_MODEL,
    maxTokens: 700,
    temperature: 1.15,
  });
  return parseAiResponse(content);
}

/** In-Memory State pro Gilde (History wird auch im Store persistiert). */
function getRuntimeState(ctx, guildId) {
  if (!ctx.storyGames) ctx.storyGames = new Map();
  if (!ctx.storyGames.has(guildId)) {
    ctx.storyGames.set(guildId, {
      channelId: null,
      lastMessageId: null,
      history: [],
      colors: randomColors(),
      turn: 0,
      locked: false,
    });
  }
  return ctx.storyGames.get(guildId);
}

function persistState(ctx, guildId) {
  const st = getRuntimeState(ctx, guildId);
  const cfg = ctx.store.getGuild(guildId);
  if (!cfg) return;
  cfg.endlessStoryChannelId = st.channelId || null;
  cfg.endlessStoryHistory = st.history && st.history.length
    ? st.history.slice(-STORY_HISTORY_LIMIT)
    : null;
  ctx.store.setGuild(cfg);
  void ctx.store.flush().catch(() => {});
}

function restoreFromStore(ctx, guildId) {
  const cfg = ctx.store.getGuild(guildId);
  if (!cfg) return;
  const st = getRuntimeState(ctx, guildId);
  if (!st.channelId && cfg.endlessStoryChannelId) st.channelId = cfg.endlessStoryChannelId;
  if (Array.isArray(cfg.endlessStoryHistory) && cfg.endlessStoryHistory.length && !st.history.length) {
    st.history = cfg.endlessStoryHistory.slice(-STORY_HISTORY_LIMIT);
    st.turn = st.history.length;
  }
}

/** Sendet die nächste Story-Nachricht und räumt Fremd-Nachrichten auf. */
async function sendNextSituationMessage(ctx, guildId, channel, { situation, options, colors }) {
  const st = getRuntimeState(ctx, guildId);
  st.turn += 1;
  const payload = buildSituationPayload({
    situation, options, colors, disabled: false, turn: st.turn, chosenIndex: null,
  });
  const sent = await channel.send(payload);
  st.lastMessageId = sent.id;
  st.colors = colors;
  st.history.push({ situation, options: [...options], chosenOption: null });
  if (st.history.length > STORY_HISTORY_LIMIT) {
    st.history = st.history.slice(-STORY_HISTORY_LIMIT);
  }
  persistState(ctx, guildId);
  void cleanupForeignMessages(ctx, channel, sent).catch(() => {});
  return sent;
}

/** Löscht überzählige Fremd-Nachrichten unter der letzten Story-Nachricht. */
async function cleanupForeignMessages(ctx, channel, lastStoryMsg) {
  try {
    const messages = await channel.messages.fetch({ after: lastStoryMsg.id, limit: 50 });
    if (!messages.size) return;
    const after = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const foreign = after.filter((m) => {
      if (m.author?.id === ctx.client.user?.id) return false;
      if (m.author?.bot) return false;
      if (m.system) return false;
      return true;
    });
    if (foreign.length <= MAX_FOREIGN_MESSAGES) return;
    const toDelete = foreign.slice(0, foreign.length - MAX_FOREIGN_MESSAGES);
    for (const m of toDelete) {
      try { await m.delete(); } catch { /* fehlende Rechte → ignorieren */ }
    }
  } catch (e) {
    ctx.logger?.warn?.('[love-tester-bot] story cleanup failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Slash-Command: /endless_story_channel
// ---------------------------------------------------------------------------

async function storyChannelCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Nur auf einem Server nutzbar.')], { ephemeral: true }));
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Nur Admins können das Endless-Story-Spiel einrichten.')], { ephemeral: true }));
  }
  const cfg = ctx.store.getGuild(interaction.guildId);
  if (!cfg?.setupComplete || !cfg.groqApiKey) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Bitte zuerst /setup ausführen (Groq-API-Key fehlt).')], { ephemeral: true }));
  }
  const channel = interaction.options.getChannel('channel');
  if (!channel || !channel.isTextBased()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Bitte einen gültigen Text-Kanal auswählen.')], { ephemeral: true }));
  }
  const me = channel.guild.members.me;
  const need = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'];
  const missing = need.filter((p) => !channel.permissionsFor(me)?.has(p));
  if (missing.length) {
    return interaction.reply(componentsV2Payload([smallContainer(null, `Mir fehlen Rechte in ${channel}: ${missing.join(', ')} (ManageMessages wird zum Aufräumen benötigt).`)], { ephemeral: true }));
  }

  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // Das Modal zuerst bauen: discord.js validiert dabei u. a. das harte
  // 100-Zeichen-Limit für Platzhalter. So bleibt bei einem Baufehler keine
  // unbenutzbare Session zurück.
  const modal = buildStoryModal(token);
  ctx.setupSessions.set(`story_modal_${token}`, {
    guildId: interaction.guildId,
    channelId: channel.id,
    userId: interaction.user.id,
  });
  return interaction.showModal(modal);
}

/** Baut das Startformular innerhalb aller Discord-String-Limits. */
function buildStoryModal(token) {
  return new ModalBuilder()
    .setCustomId(`love_story_modal_${token}`)
    .setTitle('Endless Story — Startsituation')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('situation')
          .setLabel('Alltags-Situation / Start-Szene')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(1500)
          // Discord erlaubt bei Textfeldern höchstens 100 Zeichen.
          .setPlaceholder('z.B. Du bist in der Bäckerei. Dein Mathelehrer kauft das letzte Croissant und schaut dich an …')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('opt1')
          .setLabel('Option 1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(80)
          .setPlaceholder('Du sagst laut: "Das ist MEIN Croissant!"')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('opt2')
          .setLabel('Option 2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(80)
          .setPlaceholder('Du grüßt freundlich und bestellst ein Brot.')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('opt3')
          .setLabel('Option 3')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(80)
          .setPlaceholder('Du tust so, als ob du ihn nicht erkennst, und rennst raus.')
      )
    );
}

async function handleStoryModal(ctx, interaction) {
  const token = interaction.customId.replace(/^love_story_modal_/, '');
  const key = `story_modal_${token}`;
  const sess = ctx.setupSessions.get(key);
  if (!sess || sess.guildId !== interaction.guildId || sess.userId !== interaction.user.id) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Modal-Session abgelaufen.')], { ephemeral: true }));
  }
  ctx.setupSessions.delete(key);

  const situation = flattenText(interaction.fields.getTextInputValue('situation'));
  const opt1 = flattenText(interaction.fields.getTextInputValue('opt1'));
  const opt2 = flattenText(interaction.fields.getTextInputValue('opt2'));
  const opt3 = flattenText(interaction.fields.getTextInputValue('opt3'));
  if (!situation || !opt1 || !opt2 || !opt3) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Bitte alle Felder ausfüllen.')], { ephemeral: true }));
  }

  const channel = interaction.guild.channels.cache.get(sess.channelId);
  if (!channel || !channel.isTextBased()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Kanal nicht mehr verfügbar.')], { ephemeral: true }));
  }

  const st = getRuntimeState(ctx, interaction.guildId);
  st.channelId = channel.id;
  st.history = [];
  st.turn = 0;
  st.locked = false;

  await interaction.deferReply({ ephemeral: true });
  try {
    await sendNextSituationMessage(ctx, interaction.guildId, channel, {
      situation,
      options: [opt1, opt2, opt3],
      colors: randomColors(),
    });
    return interaction.editReply(componentsV2Payload([smallContainer(null, `📖 Endless Story gestartet in ${channel}!`)]));
  } catch (e) {
    ctx.logger?.error?.('[love-tester-bot] story start failed:', e.message);
    return interaction.editReply(componentsV2Payload([smallContainer(null, `Fehler: ${e.message}`)]));
  }
}

// ---------------------------------------------------------------------------
// Button-Klick
// ---------------------------------------------------------------------------

async function handleStoryButton(ctx, interaction) {
  if (!interaction.inGuild()) return;
  const m = interaction.customId.match(/^story_opt_(\d+)$/);
  if (!m) return null;
  const chosenIndex = Number(m[1]);

  const cfg = ctx.store.getGuild(interaction.guildId);
  const lang = cfg?.lang || 'de';
  restoreFromStore(ctx, interaction.guildId);
  const st = getRuntimeState(ctx, interaction.guildId);

  if (!st.channelId || st.channelId !== interaction.channel.id || !st.lastMessageId) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Gerade läuft kein Endless-Story-Spiel in diesem Kanal.')], { ephemeral: true }));
  }
  if (interaction.message.id !== st.lastMessageId) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Diese Runde ist bereits vorbei – warte auf die nächste Situation.')], { ephemeral: true }));
  }
  if (st.locked) {
    return interaction.reply(componentsV2Payload([smallContainer(null, 'Es läuft gerade eine Auswertung, bitte kurz warten…')], { ephemeral: true }));
  }
  st.locked = true;

  const currentEntry = st.history[st.history.length - 1];
  if (!currentEntry) { st.locked = false; return null; }
  const chosenOption = currentEntry.options?.[chosenIndex];
  if (!chosenOption) { st.locked = false; return null; }

  try {
    const disabledPayload = buildSituationPayload({
      situation: currentEntry.situation,
      options: currentEntry.options,
      colors: st.colors,
      disabled: true,
      turn: st.turn,
      chosenIndex,
    });
    await interaction.update(disabledPayload);

    currentEntry.chosenOption = chosenOption;
    const historyForPrompt = st.history.slice(-STORY_HISTORY_LIMIT);

    if (!cfg?.groqApiKey) {
      st.locked = false;
      return interaction.followUp(componentsV2Payload([smallContainer(null, 'Groq-API-Key fehlt – /setup ausführen.')], { ephemeral: true })).catch(() => {});
    }

    let next;
    try {
      next = await generateNextTurn({
        apiKey: cfg.groqApiKey,
        history: historyForPrompt,
        chosenOptionText: chosenOption,
        lang,
      });
    } catch (err) {
      st.locked = false;
      ctx.logger?.error?.('[love-tester-bot] story groq error:', err.message);
      return interaction.followUp(
        componentsV2Payload([smallContainer(null, `⚠️ Die KI hat gerade keinen Bock (${err.message}). Die Runde ist beendet – starte bei Bedarf mit /endless_story_channel neu.`)], { ephemeral: true })
      ).catch(() => {});
    }

    const channel = interaction.channel;
    await sendNextSituationMessage(ctx, interaction.guildId, channel, {
      situation: next.situation,
      options: next.options,
      colors: randomColors(),
    });
    st.locked = false;
    return null;
  } catch (e) {
    st.locked = false;
    ctx.logger?.error?.('[love-tester-bot] story button error:', e.message);
    try {
      const errPayload = componentsV2Payload([smallContainer(null, `Fehler: ${e.message}`)], { ephemeral: true });
      if (!interaction.replied && !interaction.deferred) return await interaction.reply(errPayload);
      return await interaction.followUp(errPayload).catch(() => {});
    } catch { return null; }
  }
}

/** Message-Create-Handler für das automatische Aufräumen von Fremd-Nachrichten. */
function attachMessageHandler(ctx) {
  if (ctx._storyMessageHandlerAttached) return;
  ctx._storyMessageHandlerAttached = true;
  ctx.client.on('messageCreate', async (msg) => {
    try {
      if (!msg.guild) return;
      if (msg.author?.id === ctx.client.user?.id) return;
      if (msg.author?.bot) return;
      if (msg.system) return;
      const cfg = ctx.store.getGuild(msg.guild.id);
      if (!cfg) return;
      restoreFromStore(ctx, msg.guild.id);
      const st = getRuntimeState(ctx, msg.guild.id);
      if (!st.channelId || st.channelId !== msg.channel.id || !st.lastMessageId) return;
      if (msg.id <= st.lastMessageId) return;
      const channel = msg.channel;
      const lastMsg = await channel.messages.fetch(st.lastMessageId).catch(() => null);
      if (lastMsg) void cleanupForeignMessages(ctx, channel, lastMsg);
    } catch (e) {
      ctx.logger?.warn?.('[love-tester-bot] story messageCreate error:', e.message);
    }
  });
}

module.exports = {
  STORY_PREFIX,
  storyChannelCmd,
  handleStoryButton,
  handleStoryModal,
  attachMessageHandler,
  buildStoryModal,
  buildSituationPayload,
  parseAiResponse,
  flattenText,
  randomColors,
};
