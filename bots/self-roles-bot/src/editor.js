/**
 * Der Self-Roles-Editor: Sessions, Buttons, Formulare und das
 * Veröffentlichen (inklusive automatischem Erstellen der Rollen).
 *
 * Ablauf beim Erstellen:
 *   /create_self_role [CHANNEL]
 *     → Formular (große Textbox = Beschreibung, kleines Feld = Titel)
 *     → Editor-Nachricht (ephemer) mit Kanal, Titel, Beschreibung, Modus
 *       und Rollenliste („noch keine konfiguriert“)
 *     → ➕/➖ Rollen (min. 2, max. 20), ✏️ Text, 🎚️ Auswahl-Modus
 *     → 🚀 Absenden: Rollen werden ERST JETZT erstellt (ganz unten in der
 *       Rollenliste), danach geht die Nachricht raus.
 *
 * Beim Bearbeiten (/edit_self_role) wird dieselbe Oberfläche benutzt –
 * neue Rollen werden beim Speichern angelegt, bestehende bleiben.
 */

const { PermissionFlagsBits } = require('discord.js');

const { t, langFromDiscord } = require('./languages');
const {
  buildEditorContainer,
  buildRemoveSelectContainer,
  buildRoleModal,
  buildCreateModal,
  buildSelfRoleContainer,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const {
  MIN_ROLES,
  MAX_ROLES,
  MODE_SINGLE,
  MODE_MULTI,
  sanitizeTitle,
  flattenDescription,
  sanitizeLabel,
  sanitizeRoleName,
  labelKey,
  newSessionId,
  validateDraft,
} = require('./logic');

/** Sessions verfallen nach 30 Minuten Inaktivität (RAM-Schutz). */
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_SWEEP_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function createSessionStore() {
  const sessions = new Map(); // sessionId -> session

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

function newSession({ guildId, channelId, userId, lang, title = '', description = '', mode = MODE_MULTI, roles = [], editing = null }) {
  return {
    id: newSessionId(),
    guildId,
    channelId,
    userId,
    lang,
    title,
    description,
    mode,
    roles, // [{ label, name, roleId? }]
    editing, // null | { channelId, messageId }
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

/** Kann der Bot überhaupt Rollen erstellen/vergeben? */
function botCanManageRoles(guild) {
  const me = guild?.members?.me;
  if (!me) return true; // im Zweifel probieren – Discord meldet den Fehler
  return Boolean(me.permissions?.has?.(PermissionFlagsBits.ManageRoles));
}

// ---------------------------------------------------------------------------
// Editor rendern
// ---------------------------------------------------------------------------

function editorPayload(session, { ephemeral = true } = {}) {
  const container =
    session.view === 'remove' ? buildRemoveSelectContainer(session) : buildEditorContainer(session);
  return componentsV2Payload([container], { ephemeral });
}

async function showEditor(interaction, session, { update = true } = {}) {
  const payload = editorPayload(session);
  try {
    if (update && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
      if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
      return await interaction.update(payload);
    }
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (err) {
    // Interaction schon beantwortet / abgelaufen → Fallback als followUp
    try {
      return await interaction.followUp(payload);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Rollen anlegen
// ---------------------------------------------------------------------------

/**
 * Erstellt alle noch fehlenden Rollen (die ohne roleId) GANZ UNTEN in der
 * Rollenliste. Discord legt neue Rollen ohnehin auf Position 0 (direkt über
 * @everyone) an – wir setzen die Position anschließend defensiv nochmal.
 *
 * Rückgabe: { roles: [{label, name, roleId}], created: [roleId] }
 * Bei einem Fehler wird geworfen; der Aufrufer räumt via rollbackRoles auf.
 */
async function ensureRolesCreated({ guild, roles, logger }) {
  const created = [];
  const out = [];

  for (const item of roles) {
    if (item.roleId) {
      // Bereits existierende Rolle – prüfen, ob sie noch lebt.
      const existing = guild.roles.cache.get(item.roleId) || (await guild.roles.fetch(item.roleId).catch(() => null));
      if (existing) {
        out.push({ ...item, roleId: existing.id, name: existing.name });
        continue;
      }
      // Rolle wurde gelöscht → wie eine neue behandeln
    }

    const name = sanitizeRoleName(item.name || item.label) || item.label || 'Self-Role';
    const role = await guild.roles.create({
      name,
      permissions: [],
      mentionable: true, // wie gewünscht: erwähnbar, sonst neutral
      hoist: false,
      reason: 'Self-Roles: Rolle für Self-Roles-Nachricht erstellt',
    });
    created.push(role.id);
    out.push({ ...item, roleId: role.id, name: role.name });
    logger?.info?.(`[self-roles-bot] Rolle „${role.name}“ auf „${guild.name}“ erstellt (${role.id}).`);
  }

  // Ganz unten einsortieren: Reihenfolge der Liste beibehalten
  // (erste Rolle der Liste = unterste Position).
  await positionAtBottom(guild, out.map((r) => r.roleId).filter(Boolean), logger);

  return { roles: out, created };
}

/**
 * Schiebt die übergebenen Rollen ans untere Ende der Rollenliste
 * (Position 1 … n, direkt über @everyone). Fehler sind nicht kritisch –
 * die Rollen funktionieren auch ohne perfekte Sortierung.
 */
async function positionAtBottom(guild, roleIds, logger) {
  if (!roleIds?.length) return;
  try {
    // Neueste Discord-API: Bulk-Positionierung in EINEM Request.
    const payload = roleIds
      .slice()
      .reverse() // letzte Rolle der Liste bekommt die höchste Position der Gruppe
      .map((id, index) => ({ role: id, position: index + 1 }));
    if (guild.roles.setPositions) {
      await guild.roles.setPositions(payload);
      return;
    }
  } catch (err) {
    logger?.warn?.('[self-roles-bot] Bulk-Sortierung fehlgeschlagen, versuche einzeln:', err.message);
  }
  // Fallback: einzeln setzen
  const reversed = [...roleIds].reverse();
  for (let i = 0; i < reversed.length; i++) {
    const role = guild.roles.cache.get(reversed[i]);
    if (!role) continue;
    await role.setPosition(i + 1, { reason: 'Self-Roles: ganz unten einsortiert' }).catch(() => {});
  }
}

/** Räumt frisch erstellte Rollen wieder ab, wenn das Veröffentlichen scheitert. */
async function rollbackRoles(guild, roleIds, logger) {
  for (const id of roleIds || []) {
    const role = guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
    if (!role) continue;
    await role.delete('Self-Roles: Rollback nach fehlgeschlagenem Absenden').catch(() => {});
    logger?.info?.(`[self-roles-bot] Rollback: Rolle ${id} wieder gelöscht.`);
  }
}

// ---------------------------------------------------------------------------
// Veröffentlichen / Speichern
// ---------------------------------------------------------------------------

async function publishSession(ctx, interaction, session) {
  const lang = session.lang;
  const guild = interaction.guild;

  const check = validateDraft(session);
  if (!check.ok) {
    session.notice =
      check.reason === 'min'
        ? t('errNeedTwoRoles', lang, { min: MIN_ROLES })
        : t('errTooManyRoles', lang, { max: MAX_ROLES });
    return showEditor(interaction, session);
  }

  if (!botCanManageRoles(guild)) {
    session.notice = t('errBotPerms', lang);
    return showEditor(interaction, session);
  }

  const channel = await ctx.client.channels.fetch(session.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    session.notice = t('errChannelBad', lang);
    return showEditor(interaction, session);
  }

  // Neue Nachricht? Dann Kapazität prüfen (max. 10 pro Server).
  if (!session.editing && !ctx.store.hasCapacity(guild.id)) {
    session.notice = t('errMaxMessages', lang);
    return showEditor(interaction, session);
  }

  await interaction.update(
    componentsV2Payload([smallContainer(t('editorTitle', lang), t('publishing', lang))], { ephemeral: true })
  ).catch(() => {});

  let createdIds = [];
  try {
    const { roles, created } = await ensureRolesCreated({ guild, roles: session.roles, logger: ctx.logger });
    createdIds = created;
    session.roles = roles;

    // Zähler frisch ermitteln (neue Rollen = 0, bestehende = echte Anzahl)
    await ctx.store.ensureMembers(guild, { force: false });
    const withCounts = roles.map((r) => ({
      roleId: r.roleId,
      label: r.label,
      count: ctx.store.countRoleMembers(guild, r.roleId) ?? 0,
    }));

    const container = buildSelfRoleContainer({
      title: session.title,
      description: session.description,
      roles: withCounts,
      lang,
      mode: session.mode,
    });

    let message;
    if (session.editing) {
      const existing = await channel.messages.fetch(session.editing.messageId).catch(() => null);
      if (!existing) {
        ctx.store.remove(guild.id, session.editing.channelId, session.editing.messageId);
        throw Object.assign(new Error(t('editMessageGone', lang)), { soft: true });
      }
      message = await existing.edit(componentsV2Payload([container]));
    } else {
      message = await channel.send(componentsV2Payload([container]));
    }

    const entry = {
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      lang,
      mode: session.mode,
      title: session.title,
      description: session.description,
      roles: withCounts.map((r) => ({ roleId: r.roleId, label: r.label })),
      createdAt: message.createdTimestamp || Date.now(),
    };
    ctx.store.set(entry);

    ctx.sessions.drop(session.id);

    const url = message.url || `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`;
    const body = session.editing
      ? t('savedBody', lang, { channel: `<#${channel.id}>`, url })
      : t('publishedBody', lang, { count: withCounts.length, channel: `<#${channel.id}>`, url });
    const title = session.editing ? t('savedTitle', lang) : t('publishedTitle', lang);

    return interaction.editReply(componentsV2Payload([smallContainer(title, body)]));
  } catch (err) {
    // Frisch erstellte Rollen wieder entfernen – kein Müll auf dem Server.
    if (createdIds.length) await rollbackRoles(guild, createdIds, ctx.logger).catch(() => {});
    ctx.logger.warn('[self-roles-bot] Veröffentlichen fehlgeschlagen:', err.message);

    const reason =
      err?.code === 50013 || err?.status === 403 ? t('errBotPerms', lang) : t('publishFailed', lang, { error: err.message });

    session.notice = reason;
    // Rollen-IDs der zurückgerollten Rollen wieder entfernen, damit ein
    // erneuter Versuch sauber neu erstellt.
    session.roles = session.roles.map((r) => (createdIds.includes(r.roleId) ? { ...r, roleId: null } : r));
    ctx.sessions.put(session);
    return interaction.editReply(editorPayload(session, { ephemeral: false })).catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// Button-Handler des Editors
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
    case 'add': {
      if (session.roles.length >= MAX_ROLES) {
        session.notice = t('errTooManyRoles', session.lang, { max: MAX_ROLES });
        return showEditor(interaction, session);
      }
      return interaction.showModal(buildRoleModal(session.lang, session.id));
    }

    case 'remove': {
      if (!session.roles.length) return showEditor(interaction, session);
      session.view = 'remove';
      return showEditor(interaction, session);
    }

    case 'back': {
      session.view = 'main';
      return showEditor(interaction, session);
    }

    case 'text': {
      return interaction.showModal(
        buildCreateModal(session.lang, session.channelId, {
          title: session.title,
          description: session.description,
          sessionId: session.id,
        })
      );
    }

    case 'mode': {
      session.mode = session.mode === MODE_SINGLE ? MODE_MULTI : MODE_SINGLE;
      return showEditor(interaction, session);
    }

    case 'publish': {
      return publishSession(ctx, interaction, session);
    }

    case 'cancel': {
      ctx.sessions.drop(session.id);
      return interaction.update(
        componentsV2Payload([smallContainer(null, t('cancelled', session.lang))], { ephemeral: true })
      );
    }

    default:
      return showEditor(interaction, session);
  }
}

/** Auswahl im „Rolle entfernen“-Menü. */
async function handleRemoveSelect(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errSessionExpired', langFromDiscord(interaction.locale)))], {
        ephemeral: true,
      })
    );
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', session.lang))], { ephemeral: true })
    );
  }

  const index = Number(interaction.values?.[0]);
  if (Number.isInteger(index) && index >= 0 && index < session.roles.length) {
    const [removed] = session.roles.splice(index, 1);
    session.notice = t('roleRemovedFromDraft', session.lang, { label: removed.label });
  }
  session.view = 'main';
  return showEditor(interaction, session);
}

/** Formular „Rolle hinzufügen“ abgeschickt. */
async function handleRoleModal(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errSessionExpired', langFromDiscord(interaction.locale)))], {
        ephemeral: true,
      })
    );
  }

  const lang = session.lang;
  const rawName = interaction.fields.getTextInputValue('role_name');
  const rawLabel = interaction.fields.getTextInputValue('role_label');

  const name = sanitizeRoleName(rawName);
  const label = sanitizeLabel(rawLabel) || name;

  if (!name || !label) {
    session.notice = t('errGeneric', lang);
    return showEditor(interaction, session, { update: false });
  }
  if (session.roles.length >= MAX_ROLES) {
    session.notice = t('errTooManyRoles', lang, { max: MAX_ROLES });
    return showEditor(interaction, session, { update: false });
  }
  if (session.roles.some((r) => labelKey(r.label) === labelKey(label))) {
    session.notice = t('errDuplicateLabel', lang);
    return showEditor(interaction, session, { update: false });
  }

  session.roles.push({ label, name, roleId: null });
  session.notice = t('roleAddedToDraft', lang, { label });
  session.view = 'main';

  // Modal-Submits müssen mit einer neuen Antwort beantwortet werden;
  // die ephemere Editor-Nachricht wird per update() ersetzt, wenn möglich.
  return replyFromModal(interaction, session);
}

/** Formular „Titel & Text“ abgeschickt. */
async function handleTextModal(ctx, interaction, { sessionId }) {
  const session = ctx.sessions.get(sessionId);
  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errSessionExpired', langFromDiscord(interaction.locale)))], {
        ephemeral: true,
      })
    );
  }

  session.title = sanitizeTitle(interaction.fields.getTextInputValue('title'));
  session.description = flattenDescription(interaction.fields.getTextInputValue('description'));
  session.notice = '';
  session.view = 'main';

  return replyFromModal(interaction, session);
}

/**
 * Antwort nach einem Modal: Discord erlaubt hier update() nur, wenn das
 * Modal aus einer Komponenten-Interaktion geöffnet wurde. Wir versuchen
 * update() (ersetzt die ephemere Editor-Nachricht in-place) und fallen
 * sonst auf eine neue ephemere Antwort zurück.
 */
async function replyFromModal(interaction, session) {
  const payload = editorPayload(session);
  try {
    if (interaction.isFromMessage?.()) return await interaction.update(payload);
  } catch {
    /* weiter unten neu antworten */
  }
  try {
    return await interaction.reply(payload);
  } catch {
    try {
      return await interaction.followUp(payload);
    } catch {
      return null;
    }
  }
}

module.exports = {
  SESSION_TTL_MS,
  createSessionStore,
  newSession,
  isAdmin,
  botCanManageRoles,
  editorPayload,
  showEditor,
  ensureRolesCreated,
  positionAtBottom,
  rollbackRoles,
  publishSession,
  handleEditorButton,
  handleRemoveSelect,
  handleRoleModal,
  handleTextModal,
  replyFromModal,
};
