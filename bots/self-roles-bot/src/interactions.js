/**
 * Alle Interaktionen, die keine Slash-Commands sind:
 *
 * - Rollen-Buttons unter den öffentlichen Self-Roles-Nachrichten
 *   (Rolle geben / „hast du schon“ + Abgeben-Button)
 * - Editor-Buttons, Auswahlmenüs & Formulare
 * - Admin-Panel (Owner, nur im DM)
 *
 * Grundprinzip: NICHTS darf den Nutzer mit „Interaktion fehlgeschlagen“
 * stehen lassen. Jeder Pfad antwortet – und wenn die Registry weg ist
 * (Neustart, Ausfall), liest der Bot die Konfiguration einfach frisch aus
 * der Nachricht (Self-Healing, siehe store/embed-builder).
 */

const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const { t, langFromDiscord } = require('./languages');
const {
  parseSelfRoleMessage,
  buildAlreadyHasContainer,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { parseCustomId, MODE_SINGLE, normalizeMode } = require('./logic');
const {
  newSession,
  showEditor,
  handleEditorButton,
  handleRemoveSelect,
  handleRoleModal,
  handleTextModal,
  isAdmin,
} = require('./editor');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');
const { sanitizeTitle, flattenDescription } = require('./logic');

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
      if (parsed.kind === 'role') return await handleRoleButton(ctx, interaction, parsed);
      if (parsed.kind === 'drop') return await handleDropButton(ctx, interaction, parsed);
      if (parsed.kind === 'editor') return await handleEditorButton(ctx, interaction, parsed);
      return null;
    }

    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id.startsWith(PANEL_PREFIX)) return await handlePanelSelect(ctx, interaction);

      const parsed = parseCustomId(id);
      if (!parsed) return null;
      if (parsed.kind === 'removeSelect') return await handleRemoveSelect(ctx, interaction, parsed);
      if (parsed.kind === 'pickMessage') return await handlePickMessage(ctx, interaction);
      return null;
    }

    if (interaction.isModalSubmit()) {
      const parsed = parseCustomId(interaction.customId);
      if (!parsed) return null;
      if (parsed.kind === 'createModal') return await handleCreateModal(ctx, interaction, parsed);
      if (parsed.kind === 'roleModal') return await handleRoleModal(ctx, interaction, parsed);
      if (parsed.kind === 'textModal') return await handleTextModal(ctx, interaction, parsed);
      return null;
    }

    return null;
  } catch (err) {
    ctx.logger.error('[self-roles-bot] Interaction-Fehler:', err);
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
// Öffentliche Rollen-Buttons
// ---------------------------------------------------------------------------

/**
 * Klick auf einen Rollen-Button:
 * - Rolle noch nicht da → geben (im Einzel-Modus fliegen andere Rollen raus)
 * - Rolle schon da     → nachfragen + Button zum Abgeben
 * Danach werden die Zähler in der Nachricht sofort aktualisiert.
 */
async function handleRoleButton(ctx, interaction, { roleId }) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', langFromDiscord(interaction.locale)))], {
        ephemeral: true,
      })
    );
  }

  // Konfiguration IMMER aus der Nachricht selbst lesen (überlebt Neustarts).
  const config = parseSelfRoleMessage(interaction.message);
  const lang = config?.lang || langFromDiscord(interaction.locale);

  if (!config || !config.roles?.length) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('messageBroken', lang))], { ephemeral: true }));
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  // Registry auffrischen, damit Scheduler & Panel die Nachricht kennen.
  const entry = ensureEntry(ctx, interaction, config);

  const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) {
    // Rolle gelöscht → Nachricht aufräumen und Bescheid geben.
    await safeRefresh(ctx, entry, { force: true });
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('roleGone', lang))]));
  }

  const member = interaction.member?.roles ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));
  }

  if (!canBotManageRole(guild, role)) {
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('errBotPerms', lang))]));
  }

  const hasRole = member.roles.cache.has(roleId);

  if (hasRole) {
    // Nachfragen: „Du hast sie schon – abgeben?“
    const container = buildAlreadyHasContainer({
      lang,
      roleId,
      channelId: interaction.channelId,
      messageId: interaction.message.id,
    });
    await safeRefresh(ctx, entry, { force: false });
    return safeEditReply(interaction, componentsV2Payload([container]));
  }

  // Rolle geben – im Einzel-Modus vorher die anderen Rollen dieser Nachricht abnehmen.
  try {
    let swappedFrom = null;
    if (normalizeMode(config.mode) === MODE_SINGLE) {
      const others = config.roles
        .map((r) => r.roleId)
        .filter((id) => id !== roleId && member.roles.cache.has(id));
      if (others.length) {
        swappedFrom = others[0];
        await member.roles.remove(others, 'Self-Roles: Einzelauswahl – alte Rolle abgelegt');
      }
    }
    await member.roles.add(roleId, 'Self-Roles: Rolle per Button gewählt');

    const text = swappedFrom
      ? t('roleSwapped', lang, { role: `<@&${roleId}>`, old: `<@&${swappedFrom}>` })
      : t('roleGiven', lang, { role: `<@&${roleId}>` });

    // Zähler sofort aktualisieren – mit Timeout-Schutz, damit die Antwort
    // auch bei einer zickigen API garantiert rausgeht.
    await safeRefresh(ctx, entry, { force: true });

    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, text)]));
  } catch (err) {
    ctx.logger.warn('[self-roles-bot] Rolle konnte nicht vergeben werden:', err.message);
    const msg =
      err?.code === 50013 || err?.status === 403
        ? t('errBotPerms', lang)
        : t('roleActionFailed', lang, { error: err.message });
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, msg)]));
  }
}

/** „Rolle wieder abgeben“ aus der ephemeren Nachfrage. */
async function handleDropButton(ctx, interaction, { roleId, channelId, messageId }) {
  const guild = interaction.guild;
  const lang = guildLang(ctx, guild?.id, channelId, messageId) || langFromDiscord(interaction.locale);

  if (!guild) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: true }));
  }

  await interaction.deferUpdate().catch(() => {});

  const member = interaction.member?.roles ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));
  }

  if (!member.roles.cache.has(roleId)) {
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('roleNotHad', lang))]));
  }

  const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) {
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('roleGone', lang))]));
  }
  if (!canBotManageRole(guild, role)) {
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, t('errBotPerms', lang))]));
  }

  try {
    await member.roles.remove(roleId, 'Self-Roles: Rolle per Button abgegeben');
    const entry = ctx.store.get(guild.id, channelId, messageId);
    if (entry) await safeRefresh(ctx, entry, { force: true });
    else await ctx.store.refreshForRole(guild.id, roleId, { force: true }).catch(() => {});
    return safeEditReply(
      interaction,
      componentsV2Payload([smallContainer(null, t('roleRemoved', lang, { role: `<@&${roleId}>` }))])
    );
  } catch (err) {
    ctx.logger.warn('[self-roles-bot] Rolle konnte nicht entfernt werden:', err.message);
    const msg =
      err?.code === 50013 || err?.status === 403
        ? t('errBotPerms', lang)
        : t('roleActionFailed', lang, { error: err.message });
    return safeEditReply(interaction, componentsV2Payload([smallContainer(null, msg)]));
  }
}

// ---------------------------------------------------------------------------
// /create_self_role – Formular abgeschickt → Editor öffnen
// ---------------------------------------------------------------------------

async function handleCreateModal(ctx, interaction, { channelId }) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild() || !isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true }));
  }
  if (!ctx.store.hasCapacity(interaction.guildId)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errMaxMessages', lang))], { ephemeral: true }));
  }

  const title = sanitizeTitle(interaction.fields.getTextInputValue('title'));
  const description = flattenDescription(interaction.fields.getTextInputValue('description'));

  const session = newSession({
    guildId: interaction.guildId,
    channelId,
    userId: interaction.user.id,
    lang,
    title,
    description,
  });
  ctx.sessions.put(session);

  return showEditor(interaction, session, { update: false });
}

// ---------------------------------------------------------------------------
// /edit_self_role – Nachricht ausgewählt → Editor mit Bestand öffnen
// ---------------------------------------------------------------------------

async function handlePickMessage(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild() || !isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true }));
  }

  const [channelId, messageId] = String(interaction.values?.[0] || '').split(':');
  if (!channelId || !messageId) {
    return interaction.update(componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true }));
  }

  const resolved = await ctx.store.resolveMessage(interaction.guild, channelId, messageId);
  if (!resolved?.message) {
    ctx.store.remove(interaction.guildId, channelId, messageId);
    return interaction.update(
      componentsV2Payload([smallContainer(null, t('editMessageGone', lang))], { ephemeral: true })
    );
  }

  const config = parseSelfRoleMessage(resolved.message);
  if (!config) {
    return interaction.update(componentsV2Payload([smallContainer(null, t('messageBroken', lang))], { ephemeral: true }));
  }

  // Rollennamen für die Editor-Anzeige nachschlagen (falls die Rolle noch existiert).
  await interaction.guild.roles.fetch().catch(() => {});
  const roles = config.roles
    .map((r) => {
      const role = interaction.guild.roles.cache.get(r.roleId);
      return { label: r.label, name: role?.name || r.label, roleId: role ? r.roleId : null };
    })
    .filter((r) => r.label);

  const session = newSession({
    guildId: interaction.guildId,
    channelId,
    userId: interaction.user.id,
    lang: config.lang || lang,
    title: config.title,
    description: config.description,
    mode: config.mode,
    roles,
    editing: { channelId, messageId },
  });
  ctx.sessions.put(session);

  return showEditor(interaction, session);
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/** Sorgt dafür, dass die Nachricht in der Registry steht (Self-Healing). */
function ensureEntry(ctx, interaction, config) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const messageId = interaction.message.id;

  let entry = ctx.store.get(guildId, channelId, messageId);
  if (!entry) {
    entry = {
      guildId,
      channelId,
      messageId,
      lang: config.lang || 'en',
      mode: normalizeMode(config.mode),
      title: config.title || '',
      description: config.description || '',
      roles: config.roles.map((r) => ({ roleId: r.roleId, label: r.label })),
      createdAt: interaction.message.createdTimestamp || Date.now(),
    };
    ctx.store.set(entry);
    ctx.logger.info(`[self-roles-bot] Nachricht ${messageId} per Klick in die Registry aufgenommen (Recovery).`);
  } else {
    entry.lang = config.lang || entry.lang;
    entry.mode = normalizeMode(config.mode || entry.mode);
    entry.roles = config.roles.map((r) => ({ roleId: r.roleId, label: r.label }));
  }
  return entry;
}

/**
 * Refresh, der niemals wirft (Buttons dürfen nie an Update-Fehlern sterben)
 * und niemals ewig hängt: Nach `timeoutMs` antworten wir dem Nutzer trotzdem,
 * der Refresh läuft im Hintergrund weiter (und der Scheduler bügelt notfalls nach).
 */
async function safeRefresh(ctx, entry, options = {}, timeoutMs = 2500) {
  if (!entry) return null;
  const task = (async () => {
    try {
      return await ctx.store.refreshEntry(entry, options);
    } catch (err) {
      ctx.logger.warn('[self-roles-bot] Refresh fehlgeschlagen:', err.message);
      return null;
    }
  })();

  if (!timeoutMs) return task;

  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });
  const result = await Promise.race([task, guard]);
  clearTimeout(timer);
  if (result === 'timeout') {
    ctx.logger.warn('[self-roles-bot] Zähler-Update dauert länger – läuft im Hintergrund weiter.');
    return null;
  }
  return result;
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

function guildLang(ctx, guildId, channelId, messageId) {
  if (!guildId) return null;
  return ctx.store.get(guildId, channelId, messageId)?.lang || null;
}

/** Darf der Bot diese konkrete Rolle vergeben (Hierarchie + Recht)? */
function canBotManageRole(guild, role) {
  const me = guild?.members?.me;
  if (!me) return true;
  if (!me.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return false;
  const myHighest = me.roles?.highest?.position ?? 0;
  return myHighest > (role?.position ?? 0);
}

module.exports = {
  handleInteraction,
  handleRoleButton,
  handleDropButton,
  handleCreateModal,
  handlePickMessage,
  ensureEntry,
  canBotManageRole,
};
