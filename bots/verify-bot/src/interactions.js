/**
 * Alle Interaktionen, die keine Slash-Commands sind:
 *
 * - Grüner Verifizier-Button unter den Regeln
 *   → je nach Prüf-Modus: direkt verifizieren, Anfrage stellen oder
 *     Formular öffnen
 * - Annehmen/Ablehnen-Buttons im Log-Kanal (nur Admins)
 * - Editor-Buttons, Formular-Editor-Buttons, Auswahlmenüs & Modals
 * - Admin-Panel (Owner, nur im DM)
 *
 * Grundprinzip: NICHTS darf den Nutzer mit „Interaktion fehlgeschlagen“
 * stehen lassen. Jeder Pfad antwortet – und wenn die Registry weg ist
 * (Neustart), liest der Bot die Konfiguration frisch aus der Nachricht.
 */

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const { t, langFromDiscord } = require('./languages');
const {
  parseRulesMessage,
  parseRequestMessage,
  buildVerifyFormModal,
  buildRejectModal,
  buildRequestContainer,
  buildResolvedRequestContainer,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { MODE_VERIFY, VF_NONE, VF_SIMPLE, VF_FORM, parseCustomId } = require('./logic');
const {
  isAdmin,
  handleEditorButton,
  handleCreateModal,
  handleTextModal,
  handleButtonModal,
  handleFieldEditorButton,
  handleFieldRemoveSelect,
  handleFieldModal,
} = require('./editor');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function handleInteraction(ctx, interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const { handleChatInput } = require('./commands');
      return await handleChatInput(ctx, interaction);
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith(PANEL_PREFIX)) return await handlePanelButton(ctx, interaction);

      const parsed = parseCustomId(id);
      if (!parsed) return null;
      switch (parsed.kind) {
        case 'verify':
          return await handleVerifyButton(ctx, interaction);
        case 'approve':
          return await handleApproveButton(ctx, interaction);
        case 'reject':
          return await handleRejectButton(ctx, interaction);
        case 'editor':
          return await handleEditorButton(ctx, interaction, parsed);
        case 'fieldEditor':
          return await handleFieldEditorButton(ctx, interaction, parsed);
        default:
          return null;
      }
    }

    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id.startsWith(PANEL_PREFIX)) return await handlePanelSelect(ctx, interaction);
      const parsed = parseCustomId(id);
      if (!parsed) return null;
      if (parsed.kind === 'fieldRemoveSelect') return await handleFieldRemoveSelect(ctx, interaction, parsed);
      return null;
    }

    if (interaction.isModalSubmit()) {
      const parsed = parseCustomId(interaction.customId);
      if (!parsed) return null;
      switch (parsed.kind) {
        case 'createModal':
          return await handleCreateModal(ctx, interaction, parsed);
        case 'textModal':
          return await handleTextModal(ctx, interaction, parsed);
        case 'buttonModal':
          return await handleButtonModal(ctx, interaction, parsed);
        case 'rejectModal':
          return await handleRejectModal(ctx, interaction, parsed);
        case 'verifyFormModal':
          return await handleVerifyFormModal(ctx, interaction, parsed);
        case 'fieldModal':
          return await handleFieldModal(ctx, interaction, parsed);
        default:
          return null;
      }
    }

    return null;
  } catch (err) {
    ctx.logger.error('[verify-bot] Interaction-Fehler:', err);
    const lang = langFromDiscord(interaction.locale);
    const payload = componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true });
    try {
      if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
      return await interaction.reply(payload);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

function privatePayload(components) {
  return componentsV2Payload(components, { ephemeral: true });
}

async function safeEditReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply({ ...payload, flags: payload.flags });
  } catch {
    try {
      return await interaction.followUp(payload);
    } catch {
      return null;
    }
  }
}

async function fetchMember(guild, userId) {
  const cached = guild?.members?.cache?.get?.(userId);
  if (cached) return cached;
  return guild?.members?.fetch?.(userId).catch(() => null) || null;
}

/** Kann der Bot diese konkrete Rolle vergeben (Hierarchie + Recht)? */
function canBotManageRole(guild, role) {
  const me = guild?.members?.me;
  if (!me) return true;
  if (!me.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return false;
  const myHighest = me.roles?.highest?.position ?? 0;
  return myHighest > (role?.position ?? 0);
}

async function notifyUser(ctx, userId, text) {
  try {
    const user = ctx.client.users.cache.get(userId) || (await ctx.client.users.fetch(userId).catch(() => null));
    if (!user) return;
    const dm = await user.createDM().catch(() => null);
    if (!dm) return;
    const container = smallContainer(null, text);
    await dm.send(componentsV2Payload([container])).catch(() => dm.send({ content: text }).catch(() => {}));
  } catch {
    /* DM optional – nie den Ablauf sprengen */
  }
}

async function logToChannel(ctx, guild, channelId, text) {
  if (!channelId) return null;
  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel.send(componentsV2Payload([smallContainer(null, text)])).catch(() => null);
}

/** Gibt es bereits eine offene Anfrage dieses Nutzers im Log-Kanal? */
async function hasOpenRequest(ctx, guild, loggingChannelId, userId) {
  if (ctx.pending.has(`${guild.id}:${userId}`)) return true;
  if (!loggingChannelId) return false;
  const channel = await ctx.client.channels.fetch(loggingChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return false;
  for (const m of messages.values()) {
    if (m.author?.id !== ctx.client.user?.id) continue;
    const req = parseRequestMessage(m);
    if (req && req.status === 'open' && req.userId === userId) return true;
  }
  return false;
}

async function createRequest(ctx, interaction, config, answers = []) {
  const guild = interaction.guild;
  const channel = await ctx.client.channels.fetch(config.loggingChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error('log-channel-missing');

  const req = {
    userId: interaction.user.id,
    guildId: guild.id,
    rulesMessageId: interaction.message?.id || '',
    rulesChannelId: interaction.channelId,
    loggingChannelId: channel.id,
    verifiedRoleId: config.verifiedRoleId,
    unverifiedRoleId: config.unverifiedRoleId,
    lang: config.lang,
    requestedAt: Date.now(),
    status: 'open',
  };
  const container = buildRequestContainer({ lang: config.lang, user: interaction.user.id, answers, req });
  const message = await channel.send(componentsV2Payload([container]));
  ctx.pending.set(`${guild.id}:${interaction.user.id}`, { channelId: channel.id, messageId: message.id });
  return message;
}

async function applyRoles(ctx, guild, config, userId) {
  const member = await fetchMember(guild, userId);
  if (!member) return { ok: false, error: 'member-missing' };

  const unverified = guild.roles.cache.get(config.unverifiedRoleId) || (await guild.roles.fetch(config.unverifiedRoleId).catch(() => null));
  const verified = guild.roles.cache.get(config.verifiedRoleId) || (await guild.roles.fetch(config.verifiedRoleId).catch(() => null));
  if (!verified) return { ok: false, error: 'role-missing' };
  if (unverified && !canBotManageRole(guild, unverified)) return { ok: false, error: 'perms' };
  if (!canBotManageRole(guild, verified)) return { ok: false, error: 'perms' };

  try {
    if (unverified && member.roles.cache.has(unverified.id)) {
      await member.roles.remove(unverified.id, 'Verify: verifiziert');
    }
    await member.roles.add(verified.id, 'Verify: verifiziert');
  } catch (err) {
    if (err?.code === 50013 || err?.status === 403) return { ok: false, error: 'perms' };
    return { ok: false, error: err.message };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Grüner Verifizier-Button
// ---------------------------------------------------------------------------

async function handleVerifyButton(ctx, interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply(
      privatePayload([smallContainer(null, t('errGuildOnly', langFromDiscord(interaction.locale)))])
    );
  }

  const config = parseRulesMessage(interaction.message);
  const lang = config?.lang || langFromDiscord(interaction.locale);

  if (!config || config.mode !== MODE_VERIFY) {
    return interaction.reply(privatePayload([smallContainer(null, t('errGeneric', lang))]));
  }

  const member = await fetchMember(guild, interaction.user.id);
  if (!member) {
    return interaction.reply(privatePayload([smallContainer(null, t('errGeneric', lang))]));
  }

  // Nur mit der UNVERIFIED-Rolle darf man sich verifizieren.
  if (config.unverifiedRoleId && !member.roles.cache.has(config.unverifiedRoleId)) {
    return interaction.reply(
      privatePayload([smallContainer(null, t('verifyNeedRole', lang, { role: `<@&${config.unverifiedRoleId}>` }))])
    );
  }
  // Bereits verifiziert → nichts mehr tun (Rollenabgleich).
  if (config.verifiedRoleId && member.roles.cache.has(config.verifiedRoleId)) {
    return interaction.reply(privatePayload([smallContainer(null, t('verifyAlready', lang))]));
  }

  // Formular-Modus → Modal öffnen (kein Defer davor). Ohne Felder fällt er
  // automatisch auf den einfachen Prüf-Modus zurück.
  if (config.verifyForm === VF_FORM && (config.formFields || []).length) {
    if (ctx.pending.has(`${guild.id}:${interaction.user.id}`)) {
      return interaction.reply(privatePayload([smallContainer(null, t('verifyPending', lang))]));
    }
    return interaction.showModal(
      buildVerifyFormModal(lang, interaction.channelId, interaction.message.id, config.formFields || [])
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral, ephemeral: true }).catch(() => {});

  // Prüf-Modus (mit oder ohne Formular, ohne Felder) → Anfrage stellen.
  if (config.verifyForm === VF_SIMPLE || config.verifyForm === VF_FORM) {
    const open = await hasOpenRequest(ctx, guild, config.loggingChannelId, interaction.user.id);
    if (open) return safeEditReply(interaction, privatePayload([smallContainer(null, t('verifyPending', lang))]));
    try {
      await createRequest(ctx, interaction, config, []);
    } catch {
      return safeEditReply(interaction, privatePayload([smallContainer(null, t('errChannelBad', lang))]));
    }
    return safeEditReply(interaction, privatePayload([smallContainer(null, t('verifyRequestSent', lang))]));
  }

  // Keine Überprüfung → direkt verifizieren.
  const result = await applyRoles(ctx, guild, config, interaction.user.id);
  if (!result.ok) {
    const msg = result.error === 'perms' ? t('errBotPerms', lang) : t('errGeneric', lang);
    return safeEditReply(interaction, privatePayload([smallContainer(null, msg)]));
  }

  await logToChannel(
    ctx,
    guild,
    config.loggingChannelId,
    t('logVerified', lang, {
      user: `<@${interaction.user.id}>`,
      unverified: `<@&${config.unverifiedRoleId}>`,
      verified: `<@&${config.verifiedRoleId}>`,
    })
  );
  await notifyUser(
    ctx,
    interaction.user.id,
    t('acceptNotice', lang, { verified: `<@&${config.verifiedRoleId}>` })
  );
  return safeEditReply(
    interaction,
    privatePayload([smallContainer(null, t('verifySuccess', lang, { role: `<@&${config.verifiedRoleId}>` }))])
  );
}

// ---------------------------------------------------------------------------
// Annehmen / Ablehnen (Log-Kanal, nur Admins)
// ---------------------------------------------------------------------------

async function handleApproveButton(ctx, interaction) {
  const guild = interaction.guild;
  const fallbackLang = langFromDiscord(interaction.locale);

  if (!isAdmin(interaction)) {
    return interaction.reply(privatePayload([smallContainer(null, t('errNotAdmin', fallbackLang))]));
  }

  const req = parseRequestMessage(interaction.message);
  if (!req || req.status !== 'open') {
    return interaction.reply(privatePayload([smallContainer(null, t('errGeneric', fallbackLang))]));
  }

  await interaction.deferUpdate().catch(() => {});

  const lang = req.lang || fallbackLang;
  const config = {
    unverifiedRoleId: req.unverifiedRoleId,
    verifiedRoleId: req.verifiedRoleId,
  };
  const result = await applyRoles(ctx, guild, config, req.userId);
  if (!result.ok) {
    const msg = result.error === 'perms' ? t('errBotPerms', lang) : t('errGeneric', lang);
    // Anfrage-Nachricht intakt lassen – nur dem Admin eine Fehlermeldung zeigen.
    return interaction.followUp(privatePayload([smallContainer(null, msg)])).catch(() => null);
  }

  ctx.pending.delete(`${guild.id}:${req.userId}`);

  const statusText = t('requestApproved', lang, { user: `<@${req.userId}>`, admin: `<@${interaction.user.id}>` });
  await interaction
    .editReply(componentsV2Payload([buildResolvedRequestContainer({ original: interaction.message, statusText })]))
    .catch(() => null);

  await notifyUser(ctx, req.userId, t('acceptNotice', lang, { verified: `<@&${req.verifiedRoleId}>` }));
}

async function handleRejectButton(ctx, interaction) {
  const guild = interaction.guild;
  const fallbackLang = langFromDiscord(interaction.locale);

  if (!isAdmin(interaction)) {
    return interaction.reply(privatePayload([smallContainer(null, t('errNotAdmin', fallbackLang))]));
  }

  const req = parseRequestMessage(interaction.message);
  if (!req || req.status !== 'open') {
    return interaction.reply(privatePayload([smallContainer(null, t('errGeneric', fallbackLang))]));
  }

  return interaction.showModal(buildRejectModal(req.lang || fallbackLang, interaction.channelId, interaction.message.id));
}

async function handleRejectModal(ctx, interaction, { channelId, messageId }) {
  const guild = interaction.guild;
  const fallbackLang = langFromDiscord(interaction.locale);

  if (!isAdmin(interaction)) {
    return interaction.reply(privatePayload([smallContainer(null, t('errNotAdmin', fallbackLang))]));
  }

  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  const message = await channel?.messages?.fetch(messageId).catch(() => null);
  const req = message ? parseRequestMessage(message) : null;
  if (!req || req.status !== 'open') {
    return interaction.reply(privatePayload([smallContainer(null, t('errGeneric', fallbackLang))]));
  }

  const lang = req.lang || fallbackLang;
  const reason = String(interaction.fields.getTextInputValue('reason') || '').trim() || t('rejectNoReason', lang);

  await interaction.deferUpdate().catch(() => {});

  ctx.pending.delete(`${guild.id}:${req.userId}`);

  // Anonym benachrichtigen – ohne zu verraten, wer abgelehnt hat.
  await notifyUser(ctx, req.userId, t('rejectNotice', lang, { reason }));

  const statusText = t('requestRejected', lang, { user: `<@${req.userId}>`, admin: `<@${interaction.user.id}>` });
  return interaction
    .editReply(componentsV2Payload([buildResolvedRequestContainer({ original: interaction.message || message, statusText })]))
    .catch(() => null);
}

async function handleVerifyFormModal(ctx, interaction, { channelId, messageId }) {
  const guild = interaction.guild;
  const fallbackLang = langFromDiscord(interaction.locale);

  const rulesChannel = await ctx.client.channels.fetch(channelId).catch(() => null);
  const rulesMessage = await rulesChannel?.messages?.fetch(messageId).catch(() => null);
  const config = rulesMessage ? parseRulesMessage(rulesMessage) : null;
  const lang = config?.lang || fallbackLang;

  if (!config || config.mode !== MODE_VERIFY) {
    return interaction.reply(privatePayload([smallContainer(null, t('errGeneric', lang))]));
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral, ephemeral: true }).catch(() => {});

  const open = await hasOpenRequest(ctx, guild, config.loggingChannelId, interaction.user.id);
  if (open) return safeEditReply(interaction, privatePayload([smallContainer(null, t('verifyPending', lang))]));

  const answers = (config.formFields || []).map((f) => ({
    question: f.question,
    answer: interaction.fields.getTextInputValue(`vf_${f.id}`) || '',
  }));

  try {
    await createRequest(ctx, { ...interaction, message: rulesMessage }, config, answers);
  } catch {
    return safeEditReply(interaction, privatePayload([smallContainer(null, t('errChannelBad', lang))]));
  }
  return safeEditReply(interaction, privatePayload([smallContainer(null, t('verifyRequestSent', lang))]));
}

module.exports = {
  handleInteraction,
  handleVerifyButton,
  handleApproveButton,
  handleRejectButton,
  handleRejectModal,
  handleVerifyFormModal,
};
