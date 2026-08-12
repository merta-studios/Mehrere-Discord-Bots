/**
 * Level-Belohnungsrollen – Formular (Modal), Erstellung, Sortierung & Sync.
 *
 * - /level_roles (Admin) öffnet ein Formular mit zwei Feldern:
 *   1. Rollen-Format (Standard "Level {LEVEL}", {LEVEL} = Platzhalter für die Zahl)
 *   2. Level-Zahlen kommagetrennt (Standard "3,6,10,20", Tippfehler werden korrigiert)
 * - Beim Absenden werden alte Level-Rollen gelöscht (gespeicherte IDs + Namens-Muster),
 *   neue Rollen erstellt, aufsteigend nach Level sortiert und ganz unten einsortiert
 *   (mehr Level = weiter oben in der Gruppe).
 * - Bei Level Up/Down werden dem Nutzer alle fehlenden Level-Rollen gegeben
 *   (mehrere möglich), vorhandene Rollen werden NIE entfernt.
 */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { t, langFromDiscord } = require('./languages');
const { smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const {
  parseLevelList,
  formatRoleName,
  roleNamePattern,
  hasLevelPlaceholder,
  DEFAULT_ROLE_TEMPLATE,
} = require('./logic');

const MODAL_ID = 'xp_lvlroles_modal';
const FIELD_FORMAT = 'xp_lvlroles_format';
const FIELD_LEVELS = 'xp_lvlroles_levels';
const DEFAULT_LEVELS = [3, 6, 10, 20];

// Discord erlaubt max. 45 Zeichen pro TextInput-Label – als Sicherheitsnetz kürzen
function fitLabel(str) {
  return String(str).slice(0, 45);
}

function canAdmin(interaction) {
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  return Boolean(perms && perms.has(PermissionFlagsBits.Administrator));
}

function buildModal({ lang, cfg }) {
  const existingLevels = Array.isArray(cfg?.levelRoleLevels) && cfg.levelRoleLevels.length
    ? cfg.levelRoleLevels.join(',')
    : DEFAULT_LEVELS.join(',');
  const existingTemplate = (cfg && typeof cfg.levelRoleTemplate === 'string' && cfg.levelRoleTemplate) || DEFAULT_ROLE_TEMPLATE;

  const formatInput = new TextInputBuilder()
    .setCustomId(FIELD_FORMAT)
    .setLabel(fitLabel(t('levelRolesFormatLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setValue(existingTemplate)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(100);

  const levelsInput = new TextInputBuilder()
    .setCustomId(FIELD_LEVELS)
    .setLabel(fitLabel(t('levelRolesLevelsLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setValue(existingLevels)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(200);

  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle(t('levelRolesModalTitle', lang))
    .addComponents(
      new ActionRowBuilder().addComponents(formatInput),
      new ActionRowBuilder().addComponents(levelsInput)
    );
}

// ---------------------------------------------------------------------------
// Command: Formular öffnen
// ---------------------------------------------------------------------------

async function handleLevelRolesCommand(ctx, interaction) {
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!canAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }
  const cfg = ctx.store.getGuild(interaction.guildId);
  return interaction.showModal(buildModal({ lang, cfg }));
}

// ---------------------------------------------------------------------------
// Formular absenden: alte Rollen löschen, neue erstellen & sortieren
// ---------------------------------------------------------------------------

async function handleLevelRolesModalSubmit(ctx, interaction) {
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!canAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  const template = interaction.fields.getTextInputValue(FIELD_FORMAT).trim();
  const levelsRaw = interaction.fields.getTextInputValue(FIELD_LEVELS);

  if (!hasLevelPlaceholder(template)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('levelRolesNoPlaceholder', lang))], { ephemeral: false }));
  }
  const levels = parseLevelList(levelsRaw);
  if (!levels || levels.length === 0) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('levelRolesNoLevels', lang))], { ephemeral: false }));
  }

  await interaction.deferReply();
  try {
    const { created, deleted } = await applyLevelRolesSetup({ ctx, guild: interaction.guild, template, levels });

    // Konfiguration speichern (IDs pro Level, damit später synchronisiert werden kann)
    const cfg = ctx.store.getGuild(interaction.guild.id) || { guildId: interaction.guild.id };
    cfg.levelRoleTemplate = template;
    cfg.levelRoleLevels = levels;
    cfg.levelRoleIds = {};
    for (const r of created) cfg.levelRoleIds[r.level] = r.id;
    ctx.store.setGuild(cfg);
    await ctx.store.flush();

    const listText = levels.map((l) => `• ${formatRoleName(template, l)}`).join('\n');
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${t('levelRolesDoneTitle', lang)}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        t('levelRolesDone', lang, { count: created.length, deleted: deleted.length })
      ))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${t('levelRolesListTitle', lang)}\n${listText}`
      ));
    await interaction.editReply(componentsV2Payload([container]));

    // Bestehende Mitglieder nachziehen (best effort, blockiert den Admin nicht)
    void syncAllMembersLevelRoles({ ctx, guild: interaction.guild, cfg })
      .catch((e) => ctx.logger.warn('[xp-level-bot] Level-Rollen-Sync nach Setup fehlgeschlagen:', e.message));
  } catch (err) {
    ctx.logger.warn('[xp-level-bot] Level-Rollen Setup fehlgeschlagen:', err.message);
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('levelRolesBotPerms', lang, { error: err.message }))]));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Setup: alte Rollen finden/löschen, neue erstellen, ganz unten einsortieren
// ---------------------------------------------------------------------------

async function applyLevelRolesSetup({ ctx, guild, template, levels }) {
  // Sicherstellen, dass der Rollen-Cache vollständig ist
  await guild.roles.fetch().catch(() => {});

  const cfg = ctx.store.getGuild(guild.id);
  const idsToDelete = new Set();
  if (cfg?.levelRoleIds && typeof cfg.levelRoleIds === 'object') {
    for (const rid of Object.values(cfg.levelRoleIds)) if (rid) idsToDelete.add(String(rid));
  }

  // Alte Rollen finden: gespeicherte IDs + Muster des bisherigen Formats
  // (nur wenn es ein gespeichertes Format gibt – sonst wären es fremde Rollen)
  const oldPattern = cfg && typeof cfg.levelRoleTemplate === 'string' ? roleNamePattern(cfg.levelRoleTemplate) : null;

  const toDelete = [];
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue; // @everyone
    if (role.managed) continue; // verwaltete Rollen (Boosts/Bots) nie anfassen
    if (idsToDelete.has(role.id)) { toDelete.push(role); continue; }
    if (oldPattern && oldPattern.test(role.name)) { toDelete.push(role); continue; }
    // Namens-Kollision mit einer NEU zu erstellenden Rolle → ebenfalls ersetzen
    if (levels.some((lvl) => role.name === formatRoleName(template, lvl))) { toDelete.push(role); continue; }
  }
  const seen = new Set();
  const uniqueToDelete = toDelete.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  for (const role of uniqueToDelete) {
    await role.delete('Level-Rollen neu konfiguriert').catch(() => {});
  }

  // Neue Rollen aufsteigend nach Level erstellen
  const created = [];
  for (const level of levels) {
    const name = formatRoleName(template, level);
    const role = await guild.roles.create({ name, reason: 'Level-Belohnungsrolle', permissions: [] });
    created.push({ id: role.id, level, name });
  }

  // Sortieren: ganz unten in der Rollenliste, mehr Level = weiter oben
  await positionLevelRoles(guild, created);

  ctx.logger.info(`[xp-level-bot] Level-Rollen ${guild.name}: ${created.length} erstellt (${uniqueToDelete.length} alte entfernt) – Format "${template}"`);
  return { created, deleted: uniqueToDelete };
}

async function positionLevelRoles(guild, created) {
  const sorted = [...created].sort((a, b) => a.level - b.level);
  for (let i = 0; i < sorted.length; i++) {
    const role = guild.roles.cache.get(sorted[i].id);
    if (!role) continue;
    // Position i+1 = direkt über @everyone; Discord verschiebt andere Rollen automatisch
    await role.setPosition(i + 1, { reason: 'Level-Rollen sortiert (mehr Level = weiter oben)' }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Sync: fehlende Level-Rollen hinzufügen (mehrere möglich), nie entfernen
// ---------------------------------------------------------------------------

/**
 * Fügt einem Member alle Level-Rollen hinzu, die zu seinem Level passen und
 * die er noch nicht hat. Vorhandene Rollen werden NIE entfernt (auch nicht
 * bei Level-Down).
 */
async function syncMemberLevelRoles({ member, level, cfg }) {
  const roleIds = cfg?.levelRoleIds;
  if (!roleIds || typeof roleIds !== 'object' || !Object.keys(roleIds).length) return 0;
  const wanted = Object.entries(roleIds)
    .map(([lvl, rid]) => ({ lvl: Number(lvl), rid: String(rid) }))
    .filter((x) => Number.isFinite(x.lvl) && x.lvl <= level && x.rid && x.rid !== 'undefined')
    .sort((a, b) => a.lvl - b.lvl);
  if (!wanted.length) return 0;
  const missing = wanted.filter((x) => !member.roles.cache.has(x.rid));
  if (!missing.length) return 0;
  await member.roles.add(missing.map((x) => x.rid), 'Level-Belohnungsrolle (Sync)');
  return missing.length;
}

/** Holt den Member frisch und synchronisiert seine Level-Rollen. */
async function syncLevelRolesForUser({ ctx, guild, userId, level }) {
  const cfg = ctx?.store?.getGuild ? ctx.store.getGuild(guild.id) : null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return 0;
  return syncMemberLevelRoles({ member, level, cfg });
}

/** Nach dem Setup: alle bekannten Mitglieder einmal nachziehen (best effort). */
async function syncAllMembersLevelRoles({ ctx, guild, cfg }) {
  const roleIds = cfg?.levelRoleIds;
  if (!roleIds || typeof roleIds !== 'object' || !Object.keys(roleIds).length) return;
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return;
  let updated = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const u = ctx.store.getUser(guild.id, member.id);
    if (!u) continue;
    try {
      updated += await syncMemberLevelRoles({ member, level: u.level, cfg });
    } catch {
      // einzelne Mitglieder überspringen (z.B. Rechte reichen nicht für alle)
    }
  }
  ctx.logger.info(`[xp-level-bot] Level-Rollen-Sync ${guild.name}: ${updated} Rollen-Adds für Mitglieder ausgeführt`);
}

module.exports = {
  MODAL_ID,
  FIELD_FORMAT,
  FIELD_LEVELS,
  DEFAULT_LEVELS,
  buildModal,
  fitLabel,
  canAdmin,
  handleLevelRolesCommand,
  handleLevelRolesModalSubmit,
  applyLevelRolesSetup,
  positionLevelRoles,
  syncMemberLevelRoles,
  syncLevelRolesForUser,
  syncAllMembersLevelRoles,
};
