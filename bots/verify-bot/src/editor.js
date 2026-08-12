/**
 * Der Regeln-Editor: Sessions, Buttons, Formulare und das Veröffentlichen.
 *
 * Ablauf beim Erstellen:
 *   /create_verify_rules [CHANNEL] [LOGGING] [UNVERIFIED] [VERIFIED]
 *   /create_classic_rules [CHANNEL]
 *     → Formular (große Textbox = Regeln, ggf. Button-Name), vorbefüllt,
 *       falls schon Regeln existieren
 *     → Editor-Nachricht (ephemer) mit Kanal, Modus, Regeln, Rollen, Bild/Banner
 *     → Bilder/Banner per Anhang hochladen (🖼️/🎨-Buttons), ✏️ Regeln,
 *       🔘 Button-Name
 *     → 🚀 Absenden: Nachricht wird gesendet, alte Regeln werden gelöscht.
 *
 * Der Formular-Editor (/set_verify_form → „Überprüfung mit Formular“) nutzt
 * einen zweiten Session-Typ für die Formular-Felder.
 */

const { PermissionFlagsBits } = require('discord.js');

const { t, langFromDiscord } = require('./languages');
const {
  buildEditorContainer,
  buildFieldEditorContainer,
  buildFieldRemoveSelectContainer,
  buildRulesModal,
  buildButtonModal,
  buildFieldModal,
  buildRulesContainer,
  parseRulesMessage,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const {
  MODE_VERIFY,
  MODE_CLASSIC,
  VF_NONE,
  VF_FORM,
  FIELD_LONG,
  MAX_FIELDS,
  CID,
  randId,
  sanitizeRules,
  sanitizeButtonName,
  normalizeFieldStyle,
} = require('./logic');

const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_SWEEP_MS = 5 * 60 * 1000;
const UPLOAD_TTL_MS = 90 * 1000; // Zeitfenster für Bild/Banner-Anhang

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function createSessionStore() {
  const sessions = new Map();

  function put(session) {
    session.touchedAt = Date.now();
    sessions.set(session.id, session);
    return session;
  }

  function get(id) {
    const s = sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.touchedAt > SESSION_TTL_MS) {
      sessions.delete(id);
      return null;
    }
    s.touchedAt = Date.now();
    return s;
  }

  function drop(id) {
    sessions.delete(id);
  }

  function sweep() {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.touchedAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }

  function startSweeper() {
    const timer = setInterval(sweep, SESSION_SWEEP_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { put, get, drop, sweep, startSweeper, size: () => sessions.size, _map: sessions };
}

function newRulesSession({
  guildId,
  channelId,
  userId,
  lang,
  mode,
  rules = '',
  buttonName = '',
  loggingChannelId = '',
  unverifiedRoleId = '',
  verifiedRoleId = '',
  bannerUrl = '',
  imageUrl = '',
}) {
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    guildId,
    channelId,
    userId,
    lang,
    mode,
    rules,
    buttonName,
    loggingChannelId,
    unverifiedRoleId,
    verifiedRoleId,
    bannerUrl,
    imageUrl,
    notice: '',
    touchedAt: Date.now(),
  };
}

function newFieldSession({ guildId, userId, lang, fields = [] }) {
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    guildId,
    userId,
    lang,
    fields,
    notice: '',
    view: 'main', // 'main' | 'remove'
    touchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Rechte
// ---------------------------------------------------------------------------

function isAdmin(interaction) {
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  return Boolean(perms?.has?.(PermissionFlagsBits.Administrator));
}

function botCanManageRoles(guild) {
  const me = guild?.members?.me;
  if (!me) return true;
  return Boolean(me.permissions?.has?.(PermissionFlagsBits.ManageRoles));
}

// ---------------------------------------------------------------------------
// Editor rendern
// ---------------------------------------------------------------------------

function editorPayload(session) {
  return componentsV2Payload([buildEditorContainer(session)], { ephemeral: true });
}

function fieldEditorPayload(session) {
  const container =
    session.view === 'remove' ? buildFieldRemoveSelectContainer(session) : buildFieldEditorContainer(session);
  return componentsV2Payload([container], { ephemeral: true });
}

async function showEditor(ctx, interaction, session, { update = true } = {}) {
  return showPayload(ctx, interaction, session, editorPayload(session), { update });
}

async function showFieldEditor(ctx, interaction, session, { update = true } = {}) {
  return showPayload(ctx, interaction, session, fieldEditorPayload(session), { update });
}

async function showPayload(ctx, interaction, session, payload, { update = true } = {}) {
  let resp = null;
  try {
    if (update && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      } else {
        resp = await interaction.update({ ...payload, withResponse: true });
      }
    } else if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      resp = await interaction.reply({ ...payload, withResponse: true });
    }
  } catch (err) {
    try {
      await interaction.followUp(payload);
    } catch {
      return null;
    }
  }

  // Editor-Nachricht merken, damit Anhänge die Vorschau live aktualisieren.
  const message = resp?.resource?.message;
  if (message?.id && session) {
    session.editorChannelId = message.channelId ?? session.editorChannelId;
    session.editorMessageId = message.id;
    ctx.sessions.put(session);
  }
  return message || null;
}

/** Antwort nach einem Modal (wie beim Self-Roles-Bot). */
async function replyFromModal(ctx, interaction, session, payload) {
  let resp = null;
  try {
    if (interaction.isFromMessage?.()) resp = await interaction.update({ ...payload, withResponse: true });
  } catch {
    /* weiter unten neu antworten */
  }
  if (!resp) {
    try {
      resp = await interaction.reply({ ...payload, withResponse: true });
    } catch {
      try {
        await interaction.followUp(payload);
      } catch {
        return null;
      }
    }
  }
  const message = resp?.resource?.message;
  if (message?.id && session) {
    session.editorChannelId = message.channelId ?? session.editorChannelId;
    session.editorMessageId = message.id;
    ctx.sessions.put(session);
  }
  return message || null;
}

// ---------------------------------------------------------------------------
// Veröffentlichen
// ---------------------------------------------------------------------------

async function publishSession(ctx, interaction, session) {
  const lang = session.lang;
  const guild = interaction.guild;

  if (!session.rules || !String(session.rules).trim()) {
    session.notice = t('editorNoRules', lang);
    return showEditor(ctx, interaction, session);
  }

  if (session.mode === MODE_VERIFY && !botCanManageRoles(guild)) {
    session.notice = t('errBotPerms', lang);
    return showEditor(ctx, interaction, session);
  }

  const channel = await ctx.client.channels.fetch(session.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    session.notice = t('errChannelBad', lang);
    return showEditor(ctx, interaction, session);
  }

  await interaction
    .update(componentsV2Payload([smallContainer(t('editorTitle', lang), t('publishing', lang))], { ephemeral: true }))
    .catch(() => {});

  try {
    const config = {
      mode: session.mode,
      lang,
      rules: sanitizeRules(session.rules),
      buttonName: sanitizeButtonName(session.buttonName),
      loggingChannelId: session.loggingChannelId || '',
      unverifiedRoleId: session.unverifiedRoleId || '',
      verifiedRoleId: session.verifiedRoleId || '',
      verifyForm: VF_NONE,
      formFields: [],
      bannerUrl: session.bannerUrl || '',
      imageUrl: session.imageUrl || '',
    };
    const container = buildRulesContainer({ config });
    const message = await channel.send(componentsV2Payload([container]));

    const entry = {
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      ...config,
      createdAt: message.createdTimestamp || Date.now(),
    };
    ctx.store.set(entry);

    // Alte Regeln (überall auf dem Server) aufräumen – außer der neuen.
    await ctx.store.deleteOldRules(guild.id, { channelId: channel.id, messageId: message.id });

    ctx.sessions.drop(session.id);

    const url = message.url || `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`;
    return interaction.editReply(
      componentsV2Payload(
        [smallContainer(t('publishedTitle', lang), t('publishedBody', lang, { channel: `<#${channel.id}>`, url }))],
        { ephemeral: true }
      )
    );
  } catch (err) {
    ctx.logger.warn('[verify-bot] Veröffentlichen fehlgeschlagen:', err.message);
    session.notice = t('publishFailed', lang, { error: err.message });
    ctx.sessions.put(session);
    return interaction.editReply(editorPayload(session)).catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// Editor-Buttons
// ---------------------------------------------------------------------------

async function handleEditorButton(ctx, interaction, { action, sessionId }) {
  const session = ctx.sessions.get(sessionId);
  const fallbackLang = langFromDiscord(interaction.locale);

  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errSessionExpired', fallbackLang))], { ephemeral: true })
    );
  }
  if (session.userId !== interaction.user.id || !isAdmin(interaction)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', session.lang))], { ephemeral: true })
    );
  }

  session.notice = '';

  switch (action) {
    case 'rules':
      return interaction.showModal(buildRulesModal(session.lang, session.id, { rules: session.rules }));
    case 'button':
      return interaction.showModal(buildButtonModal(session.lang, session.id, { buttonName: session.buttonName }));
    case 'upload_image':
      return requestUpload(ctx, interaction, session, 'image');
    case 'upload_banner':
      return requestUpload(ctx, interaction, session, 'banner');
    case 'remove_image':
      session.imageUrl = '';
      return showEditor(ctx, interaction, session);
    case 'remove_banner':
      session.bannerUrl = '';
      return showEditor(ctx, interaction, session);
    case 'publish':
      return publishSession(ctx, interaction, session);
    case 'cancel':
      ctx.sessions.drop(session.id);
      return interaction.update(
        componentsV2Payload([smallContainer(null, t('cancelled', session.lang))], { ephemeral: true })
      );
    default:
      return showEditor(ctx, interaction, session);
  }
}

/** Fordert einen Bild-/Banner-Anhang an (Discord-Modals können keine Dateien). */
async function requestUpload(ctx, interaction, session, target) {
  const lang = session.lang;
  const key = `${interaction.channelId}:${interaction.user.id}`;
  ctx.uploads.set(key, { sessionId: session.id, target, expiresAt: Date.now() + UPLOAD_TTL_MS });
  ctx.sessions.put(session);

  const label = target === 'image' ? t('btnUploadImage', lang) : t('btnUploadBanner', lang);
  return interaction.reply(
    componentsV2Payload([smallContainer(`📎 ${label}`, uploadHint(lang))], { ephemeral: true })
  );
}

function uploadHint(lang) {
  const map = {
    de: 'Schick jetzt das Bild als **Datei-Anhang** in diesen Kanal (max. 90 Sekunden). Ich schnapp es mir und räume deine Nachricht danach weg. 🕵️',
    en: 'Now send the image as a **file attachment** in this channel (max. 90 seconds). I’ll grab it and clean up your message afterwards. 🕵️',
    fr: 'Envoie maintenant l’image en **pièce jointe** dans ce salon (max. 90 s). Je la récupère et nettoie ton message. 🕵️',
    es: 'Envía ahora la imagen como **adjunto** en este canal (máx. 90 s). La tomo y limpio tu mensaje. 🕵️',
    pt: 'Agora envie a imagem como **anexo** neste canal (máx. 90 s). Eu pego e limpo sua mensagem. 🕵️',
    ru: 'Отправь картинку **вложением** в этот канал (до 90 сек.). Я заберу её и уберу твоё сообщение. 🕵️',
    ja: '今からこのチャンネルに画像を**添付ファイル**で送ってね（90秒以内）。受け取ってメッセージは片付けるよ。🕵️',
    ko: '이제 이 채널에 이미지를 **파일 첨부**로 보내주세요 (90초 이내). 받아서 메시지는 정리할게요. 🕵️',
    zh: '现在请将图片作为**文件附件**发到这个频道（90 秒内）。我会取走并清理你的消息。🕵️',
    it: 'Ora invia l’immagine come **allegato** in questo canale (max. 90 s). La prendo e pulisco il tuo messaggio. 🕵️',
  };
  return map[lang] || map.en;
}

/** Verarbeitet einen Anhang, der für einen Upload erwartet wurde. */
async function handleUploadMessage(ctx, message) {
  if (!message?.guildId || message.author?.bot) return;
  const key = `${message.channelId}:${message.author.id}`;
  const pending = ctx.uploads.get(key);
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    ctx.uploads.delete(key);
    return;
  }
  const attachment = message.attachments?.first?.();
  if (!attachment) return;

  ctx.uploads.delete(key);
  const session = ctx.sessions.get(pending.sessionId);
  if (!session) return;

  const url = attachment.url || attachment.proxyURL;
  if (pending.target === 'image') session.imageUrl = url;
  else session.bannerUrl = url;
  ctx.sessions.put(session);

  await message.delete().catch(() => {});

  // Editor-Vorschau live aktualisieren, falls wir die Nachricht kennen.
  if (session.editorChannelId && session.editorMessageId) {
    const ch = await ctx.client.channels.fetch(session.editorChannelId).catch(() => null);
    const editorMsg = await ch?.messages?.fetch(session.editorMessageId).catch(() => null);
    if (editorMsg) {
      await editorMsg.edit(editorPayload(session)).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Formulare (Modals) der Regel-Erstellung
// ---------------------------------------------------------------------------

/** /create_*_rules – Formular abgeschickt → Editor öffnen. */
async function handleCreateModal(ctx, interaction, { modalKind, channelId }) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild() || !isAdmin(interaction)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }

  const mode = modalKind === 'classic' ? MODE_CLASSIC : MODE_VERIFY;
  const opts = ctx.createOpts?.get?.(interaction.user.id) || {};
  ctx.createOpts?.delete?.(interaction.user.id);

  const session = newRulesSession({
    guildId: interaction.guildId,
    channelId,
    userId: interaction.user.id,
    lang,
    mode,
    rules: sanitizeRules(interaction.fields.getTextInputValue('rules')),
    buttonName: sanitizeButtonName(mode === MODE_VERIFY ? interaction.fields.getTextInputValue('button_name') : ''),
    loggingChannelId: opts.loggingChannelId || '',
    unverifiedRoleId: opts.unverifiedRoleId || '',
    verifiedRoleId: opts.verifiedRoleId || '',
  });
  ctx.sessions.put(session);
  return showEditor(ctx, interaction, session, { update: false });
}

/** Regeln-Text bearbeitet. */
async function handleTextModal(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return expired(interaction);

  session.rules = sanitizeRules(interaction.fields.getTextInputValue('rules'));
  session.notice = '';
  return replyFromModal(ctx, interaction, session, editorPayload(session));
}

/** Button-Name bearbeitet. */
async function handleButtonModal(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return expired(interaction);

  session.buttonName = sanitizeButtonName(interaction.fields.getTextInputValue('button_name'));
  session.notice = '';
  return replyFromModal(ctx, interaction, session, editorPayload(session));
}

async function expired(interaction) {
  const lang = langFromDiscord(interaction.locale);
  return interaction.reply(
    componentsV2Payload([smallContainer(null, t('errSessionExpired', lang))], { ephemeral: true })
  );
}

// ---------------------------------------------------------------------------
// Formular-Editor (Überprüfung mit Formular)
// ---------------------------------------------------------------------------

async function handleFieldEditorButton(ctx, interaction, { action, sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return expired(interaction);
  if (session.userId !== interaction.user.id || !isAdmin(interaction)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', session.lang))], { ephemeral: true })
    );
  }

  session.notice = '';

  switch (action) {
    case 'add': {
      if (session.fields.length >= MAX_FIELDS) {
        session.notice = t('errGeneric', session.lang);
        return showFieldEditor(ctx, interaction, session);
      }
      return interaction.showModal(buildFieldModal(session.lang, session.id));
    }
    case 'remove': {
      if (!session.fields.length) return showFieldEditor(ctx, interaction, session);
      session.view = 'remove';
      return showFieldEditor(ctx, interaction, session);
    }
    case 'back': {
      session.view = 'main';
      return showFieldEditor(ctx, interaction, session);
    }
    case 'save': {
      return saveFields(ctx, interaction, session);
    }
    case 'cancel': {
      ctx.sessions.drop(session.id);
      return interaction.update(
        componentsV2Payload([smallContainer(null, t('cancelled', session.lang))], { ephemeral: true })
      );
    }
    default:
      return showFieldEditor(ctx, interaction, session);
  }
}

async function saveFields(ctx, interaction, session) {
  const lang = session.lang;
  const guild = interaction.guild;

  await interaction.deferUpdate().catch(() => {});

  let verifyEntries = ctx.store.verifyMessages(guild.id);
  if (!verifyEntries.length) {
    await ctx.store.scanGuild(guild).catch(() => {});
    verifyEntries = ctx.store.verifyMessages(guild.id);
  }
  if (!verifyEntries.length) {
    session.notice = t('vfNeedVerify', lang);
    return showFieldEditor(ctx, interaction, session);
  }

  let ok = 0;
  for (const entry of verifyEntries) {
    const updated = await updateEntryConfig(ctx, guild, entry, {
      verifyForm: VF_FORM,
      formFields: session.fields.map((f) => ({ ...f })),
    });
    if (updated) ok += 1;
  }

  ctx.sessions.drop(session.id);
  return interaction
    .editReply(
      componentsV2Payload([smallContainer(t('feSaved', lang), `${ok} / ${verifyEntries.length}`)], { ephemeral: true })
    )
    .catch(() => null);
}

/** Schreibt Teile der Konfiguration in eine bestehende Nachricht zurück. */
async function updateEntryConfig(ctx, guild, entry, patch) {
  const channel = await ctx.client.channels.fetch(entry.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(entry.messageId).catch(() => null);
  if (!message) {
    ctx.store.remove(guild.id, entry.channelId, entry.messageId);
    return false;
  }

  // Konfiguration IMMER frisch aus der Nachricht lesen (Self-Healing),
  // dann nur die gewünschten Teile überschreiben.
  const fresh = parseRulesMessage(message) || {};
  const merged = {
    mode: entry.mode || fresh.mode,
    lang: patch.lang || fresh.lang || entry.lang,
    rules: fresh.rules || entry.rules,
    buttonName: fresh.buttonName || entry.buttonName,
    loggingChannelId: fresh.loggingChannelId || entry.loggingChannelId,
    unverifiedRoleId: fresh.unverifiedRoleId || entry.unverifiedRoleId,
    verifiedRoleId: fresh.verifiedRoleId || entry.verifiedRoleId,
    verifyForm: patch.verifyForm !== undefined ? patch.verifyForm : fresh.verifyForm || entry.verifyForm,
    formFields: patch.formFields !== undefined ? patch.formFields : fresh.formFields || entry.formFields,
    bannerUrl: fresh.bannerUrl || entry.bannerUrl,
    imageUrl: fresh.imageUrl || entry.imageUrl,
  };
  const container = buildRulesContainer({ config: merged });
  try {
    await message.edit(componentsV2Payload([container]));
  } catch (err) {
    if (err?.code === 10008 || err?.code === 50001) {
      ctx.store.remove(guild.id, entry.channelId, entry.messageId);
    } else {
      ctx.logger.warn('[verify-bot] Regeln-Update fehlgeschlagen:', err.message);
    }
    return false;
  }
  ctx.store.set({ ...entry, ...merged });
  return true;
}

async function handleFieldRemoveSelect(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return expired(interaction);
  if (session.userId !== interaction.user.id) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', session.lang))], { ephemeral: true })
    );
  }

  const index = Number(interaction.values?.[0]);
  if (Number.isInteger(index) && index >= 0 && index < session.fields.length) {
    session.fields.splice(index, 1);
  }
  session.view = 'main';
  return showFieldEditor(ctx, interaction, session);
}

async function handleFieldModal(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return expired(interaction);

  const lang = session.lang;
  const question = String(interaction.fields.getTextInputValue('question') || '').trim();
  const placeholder = String(interaction.fields.getTextInputValue('placeholder') || '').trim();
  const value = String(interaction.fields.getTextInputValue('value') || '').trim();
  const styleRaw = String(interaction.fields.getTextInputValue('style') || '').trim().toLowerCase();
  const requiredRaw = String(interaction.fields.getTextInputValue('required') || '').trim().toLowerCase();

  if (!question) {
    session.notice = t('errGeneric', lang);
    return replyFromModal(ctx, interaction, session, fieldEditorPayload(session));
  }

  session.fields.push({
    id: randId(),
    question,
    placeholder,
    value,
    style: normalizeFieldStyle(styleRaw === 'long' ? FIELD_LONG : 'short'),
    required: requiredRaw === 'yes' || requiredRaw === 'ja' || requiredRaw === 'true' || requiredRaw === '1',
  });
  session.notice = '';
  session.view = 'main';
  return replyFromModal(ctx, interaction, session, fieldEditorPayload(session));
}

module.exports = {
  SESSION_TTL_MS,
  UPLOAD_TTL_MS,
  createSessionStore,
  newRulesSession,
  newFieldSession,
  isAdmin,
  botCanManageRoles,
  editorPayload,
  fieldEditorPayload,
  showEditor,
  showFieldEditor,
  publishSession,
  handleEditorButton,
  handleCreateModal,
  handleTextModal,
  handleButtonModal,
  handleUploadMessage,
  handleFieldEditorButton,
  handleFieldRemoveSelect,
  handleFieldModal,
  updateEntryConfig,
};
