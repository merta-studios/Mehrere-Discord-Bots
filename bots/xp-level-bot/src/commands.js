/**
 * Slash-Commands XP Bot – Definition, Registrierung & Handler
 * Commands: /setup, /rank, /help, /admin_set_bot_profile, /level_roles,
 *           /update_leaderboard, /toggle_nicknames, /sync_nicknames,
 *           /set_inactive_role, /ping_inactive_people, /adminpanel
 */

const {
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType,
  PermissionFlagsBits,
  InteractionContextType,
  ApplicationIntegrationType,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
} = require('discord.js');

const { LANGS, t, langFromDiscord, DISCORD_LOCALE } = require('./languages');
const { buildRankEmbed, smallContainer, buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');
const { handleLevelRolesCommand } = require('./level-roles');
const { handlePingInactiveCommand } = require('./ping-inactive');

/**
 * Alle Slash-Commands inkl. Owner-DM-Panel.
 * WICHTIG (Fix „Commands doppelt registriert“):
 * - GLOBAL wird NUR /adminpanel registriert (Bot-DM).
 * - ALLE anderen Commands werden ausschließlich als GUILD-Commands auf jeden
 *   Server geschrieben (sofort sichtbar, keine doppelten Einträge mehr durch
 *   globalen + Guild-Command mit demselben Namen).
 */
const ALL_COMMAND_NAMES = [
  'setup', 'rank', 'help', 'admin_set_bot_profile', 'level_roles',
  'update_leaderboard', 'toggle_nicknames', 'sync_nicknames', 'set_inactive_role',
  'ping_inactive_people', 'adminpanel',
];
/** Nur global registrierte Commands (DM-only). */
const GLOBAL_COMMAND_NAMES = ['adminpanel'];
/** Commands, die auf einem Server existieren müssen (ohne /adminpanel). */
const GUILD_COMMAND_NAMES = ALL_COMMAND_NAMES.filter((n) => !GLOBAL_COMMAND_NAMES.includes(n));

function pick(key) {
  const map = {};
  for (const code of Object.keys(LANGS)) map[DISCORD_LOCALE[code]] = t(key, code);
  return map;
}

function defineCommands() {
  const languageChoices = Object.entries(LANGS).map(([code, lang]) => ({
    name: lang.name,
    value: code,
    name_localizations: Object.fromEntries(Object.entries(lang.names).map(([c,n])=>[DISCORD_LOCALE[c],n])),
  }));
  const profileChoices = ['standard','server','owner'].map(v=>({
    name: t(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`, 'de'),
    value: v,
    name_localizations: pick(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`),
  }));
  return [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Richtet das XP-System ein (Leaderboard + Haupt-Chat + Sprache)')
      .setDescriptionLocalizations(pick('helpSetup'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o=>o.setName('leaderboard').setDescription('Kanal für das wöchentliche Leaderboard').setDescriptionLocalizations(pick('setupLeaderDesc')).setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o=>o.setName('levelchat').setDescription('Kanal für Level-Veränderungen').setDescriptionLocalizations(pick('setupMainDesc')).setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o=>o.setName('language').setDescription('Sprache').setDescriptionLocalizations(pick('setupLangDesc')).setRequired(true).addChoices(...languageChoices))
      .addBooleanOption(o=>o.setName('only_level_chat').setDescription('Level-Nachrichten nur hier? (Nein = auch andere Kanäle, Standard)').setDescriptionLocalizations(pick('setupLevelScopeDesc'))),

    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Zeigt deinen Rank, Level und XP')
      .setDescriptionLocalizations(pick('helpRank')),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zeigt alle Befehle')
      .setDescriptionLocalizations(pick('helpHelp')),

    new SlashCommandBuilder()
      .setName('admin_set_bot_profile')
      .setDescription('Ändert das Profilbild des Bots auf diesem Server')
      .setDescriptionLocalizations(pick('helpSetProfile'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o=>o.setName('image').setDescription('Welches Bild').setDescriptionLocalizations(pick('profileImageDesc')).setRequired(true).addChoices(...profileChoices)),

    new SlashCommandBuilder()
      .setName('level_roles')
      .setDescription('Passt die Level-Belohnungsrollen an (Formular)')
      .setDescriptionLocalizations(pick('levelRolesHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('update_leaderboard')
      .setDescription('Aktualisiert das Leaderboard sofort (5 Min. Cooldown)')
      .setDescriptionLocalizations(pick('updateLeaderboardHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('toggle_nicknames')
      .setDescription('Schaltet Level-Tags in Nicknames an oder aus. Nur Admins, erst nach /setup.')
      .setDescriptionLocalizations(pick('toggleNicknamesHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addBooleanOption((o) => o
        .setName('enabled')
        .setDescription('An = Tags setzen, Aus = keine Tags mehr')
        .setDescriptionLocalizations(pick('toggleNicknamesEnabledDesc'))
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('sync_nicknames')
      .setDescription('Gleicht alle Server-Nicknames mit den Level-Tags ab. Nur Admins, nach /setup.')
      .setDescriptionLocalizations(pick('syncNicknamesHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('set_inactive_role')
      .setDescription('Inaktiv-Rolle für Nutzer ohne XP seit N Tagen. Nur Admins, nach /setup.')
      .setDescriptionLocalizations(pick('setInactiveRoleHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) => o
        .setName('mode')
        .setDescription('An oder aus')
        .setDescriptionLocalizations(pick('setInactiveRoleModeDesc'))
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'on', name_localizations: pick('setInactiveRoleModeOn') },
          { name: 'Off', value: 'off', name_localizations: pick('setInactiveRoleModeOff') },
        ))
      .addIntegerOption((o) => o
        .setName('inactive_days')
        .setDescription('Tage ohne XP, ab denen die Rolle vergeben wird')
        .setDescriptionLocalizations(pick('setInactiveRoleDaysDesc'))
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365))
      .addRoleOption((o) => o
        .setName('role')
        .setDescription('Rolle für inaktive Mitglieder')
        .setDescriptionLocalizations(pick('setInactiveRoleRoleDesc'))
        .setRequired(false)),

    new SlashCommandBuilder()
      .setName('ping_inactive_people')
      .setDescription('Pingt inaktive Mitglieder: Main Channel (Rollen-Ping) oder Direct (DM). Nur Admins.')
      .setDescriptionLocalizations(pick('pingInactiveHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) => o
        .setName('mode')
        .setDescription('Wie sollen die inaktiven Mitglieder erreicht werden?')
        .setDescriptionLocalizations(pick('pingInactiveModeDesc'))
        .setRequired(true)
        .addChoices(
          { name: 'Main Channel', value: 'main_channel', name_localizations: pick('pingInactiveModeMainChannel') },
          { name: 'Direct', value: 'direct', name_localizations: pick('pingInactiveModeDirect') },
        )),

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
  ].map((cmd) => {
    // Expliziter Guild-Scope für alle Server-Commands. Ohne contexts/integration_types
    // kann ein neu hinzugefügter Command (z. B. /set_inactive_role) global
    // existieren, auf dem Server aber als „Dieser Befehl ist nicht verfügbar“
    // scheitern – besonders wenn alte Guild-Commands die Globalen überschatten.
    if (cmd.name === 'adminpanel') return cmd;
    return cmd
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  });
}

function guildCommandJson() {
  return defineCommands()
    .filter((c) => !GLOBAL_COMMAND_NAMES.includes(c.name))
    .map((c) => c.toJSON());
}

/**
 * Globaler Payload: NUR die DM-Commands (/adminpanel).
 * Server-Commands global zu registrieren hat die doppelten Einträge im
 * /-Menü verursacht – sie werden stattdessen pro Gilde geschrieben.
 */
function allCommandJson() {
  return defineCommands()
    .filter((c) => GLOBAL_COMMAND_NAMES.includes(c.name))
    .map((c) => c.toJSON());
}

function idsFromDiscord(list) {
  return Object.fromEntries((Array.isArray(list) ? list : []).map((c) => [c.name, c.id]));
}

function rememberGuildIds(ctx, guildId, ids) {
  if (!guildId || !ids) return;
  const key = String(guildId);
  ctx.guildCommandIds = ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds : new Map();
  ctx.guildCommandIds.set(key, ids);
  if (ctx.store?.setGuildCommandIds) ctx.store.setGuildCommandIds(key, ids);
}

function rememberGlobalIds(ctx, ids) {
  ctx.commandIds = ids;
  if (ctx.store?.setCommandIds) ctx.store.setCommandIds(ids);
  ctx.commandIdScope = 'global';
  if (ctx.store?.setCommandIdScope) ctx.store.setCommandIdScope('global');
}

function getRest(ctx, restFactory) {
  if (restFactory) return restFactory(ctx.token);
  return ctx.rest || new REST({ version: '10' }).setToken(ctx.token);
}

function cachedGuildIds(ctx) {
  const ids = new Set();
  const cache = ctx.client?.guilds?.cache;
  if (cache?.values) {
    for (const guild of cache.values()) {
      if (guild?.id) ids.add(String(guild.id));
    }
  } else if (cache instanceof Map) {
    for (const [id, guild] of cache.entries()) ids.add(String(guild?.id || id));
  }
  const extra = normalizeGuildId(ctx.devGuildId);
  if (extra) ids.add(extra);
  return [...ids];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalisiert eine Guild-ID (trimmt, entfernt <@!123>-Mention-Form). */
function normalizeGuildId(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim().replace(/^<@!?(\d+)>$/, '$1')
    : null;
}

/** Loggt die Registrierung pro Befehl mit Scope + Discord-Snowflake (insbesondere /level_roles). */
function logRegistration(logger, scopeLabel, res) {
  const list = Array.isArray(res) ? res : [];
  logger?.info?.(
    `[xp-level-bot] Command-Registrierung erfolgreich (Scope: ${scopeLabel}) – ${list.length} Commands:`
  );
  for (const c of list) {
    logger?.info?.(`[xp-level-bot]   /${c.name} -> snowflake ${c.id}`);
  }
}

/**
 * Schreibt die Server-Commands (ohne /adminpanel) in EINE Gilde.
 * Guild-Commands sind sofort sichtbar und überschreiben einen veralteten
 * Guild-Satz (PUT ersetzt komplett) – so kommen neue Commands wie
 * /set_inactive_role & /ping_inactive_people sofort auf bestehende Server.
 */
async function registerGuildCommands(ctx, guildId, { rest, restFactory } = {}) {
  const clientId = ctx.client?.user?.id;
  const id = normalizeGuildId(guildId) || (typeof guildId === 'string' && guildId.trim() ? guildId.trim() : null);
  if (!clientId || !id) return null;
  const api = rest || getRest(ctx, restFactory);
  const route = Routes.applicationGuildCommands(clientId, id);
  const res = await api.put(route, { body: guildCommandJson() });
  const ids = idsFromDiscord(res);
  rememberGuildIds(ctx, id, ids);
  logRegistration(ctx.logger, `guild ${id} (Route: ${route})`, res);
  return ids;
}

/**
 * Registriert die Slash-Commands bei Discord.
 *
 * Design (Fix „Commands doppelt registriert“ + „/set_inactive_role existiert nicht“):
 * 1. Global wird NUR /adminpanel registriert (Bot-DM). Der globale PUT ersetzt
 *    dabei den kompletten globalen Satz – dadurch werden automatisch ALLE
 *    alten globalen Kopien der Server-Commands gelöscht, die auf manchen
 *    Servern als Duplikate im /-Menü erschienen sind.
 * 2. Die 10 Server-Commands (inkl. /set_inactive_role und
 *    /ping_inactive_people) werden als Guild-Commands auf JEDEN Server
 *    geschrieben (PUT ersetzt den kompletten Guild-Satz – sofort sichtbar,
 *    kein 1h-Propagations-Timeout, kein Duplikat, weil es global keine
 *    gleichnamigen Commands mehr gibt).
 * 3. /adminpanel bleibt nur global (Bot-DM). Auf Gilden wird er nicht gelegt.
 * 4. /help verwendet auf einem Server immer die IDs DIESER Gilde – nie die
 *    einer fremden Dev-Gilde.
 */
async function registerCommands(ctx, { restFactory, retryDelays } = {}) {
  const rest = getRest(ctx, restFactory);
  const clientId = ctx.client?.user?.id;
  if (!clientId) {
    ctx.logger?.error?.('[xp-level-bot] Command-Registrierung abgebrochen: Kein Client-User / Client-ID vorhanden.');
    ctx.commandsRegistered = false;
    return false;
  }

  const RETRY_DELAYS_MS = retryDelays || [0, 5_000, 15_000, 30_000];

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    let globalOk = false;
    let guildOk = 0;
    try {
      const route = Routes.applicationCommands(clientId);
      const res = await rest.put(route, { body: allCommandJson() });
      const ids = idsFromDiscord(res);
      rememberGlobalIds(ctx, ids);
      logRegistration(ctx.logger, `global (Route: ${route})`, res);
      globalOk = true;
    } catch (err) {
      const detail = err?.rawError ? JSON.stringify(err.rawError).slice(0, 500) : '';
      ctx.logger?.error?.(
        `[xp-level-bot] Globale Command-Registrierung fehlgeschlagen (Versuch ${attempt + 1}/${RETRY_DELAYS_MS.length}): ${err.message} ${detail}`
      );
    }

    for (const guildId of cachedGuildIds(ctx)) {
      try {
        await registerGuildCommands(ctx, guildId, { rest });
        guildOk += 1;
      } catch (err) {
        ctx.logger?.warn?.(
          `[xp-level-bot] Guild-Commands für ${guildId} fehlgeschlagen: ${err.message}`
        );
      }
    }

    if (globalOk || guildOk > 0) {
      ctx.commandsRegistered = true;
      return true;
    }
  }

  ctx.commandsRegistered = false; // Scheduler versucht es weiter
  return false;
}

/**
 * Stellt sicher, dass die Command-IDs vor dem Rendern von /help geladen sind.
 *
 * Persistente Store-IDs werden NIEMALS ungeprüft in /help gerendert.
 *
 * Auf einem Server zählen die Guild-Commands (sofort sichtbar, überschatten
 * Globale). Fehlt dort z. B. /set_inactive_role, wird der aktuelle Satz
 * sofort in DIESE Gilde geschrieben und die frischen IDs verwendet.
 *
 * Ohne guildId (DM) gelten die globalen IDs inkl. /adminpanel.
 */
const COMMAND_ID_VERIFY_TTL_MS = 5 * 60 * 1000;

function hasNames(obj, names) {
  return obj && typeof obj === 'object' && names.every((name) => Boolean(obj[name]));
}

async function ensureCommandIds(ctx, guildId = null) {
  const neededGuild = GUILD_COMMAND_NAMES;
  const neededGlobal = GLOBAL_COMMAND_NAMES; // nur DM-Commands (/adminpanel) sind global
  const gid = guildId ? String(guildId) : null;
  const verifyScope = gid ? `guild:${gid}` : 'global';
  const needed = gid ? neededGuild : neededGlobal;

  const isFresh = () =>
    ctx.commandIdsVerifiedScope === verifyScope &&
    typeof ctx.commandIdsVerifiedAt === 'number' &&
    Date.now() - ctx.commandIdsVerifiedAt < COMMAND_ID_VERIFY_TTL_MS;
  const markVerified = (ids) => {
    ctx.commandIdsVerifiedScope = verifyScope;
    ctx.commandIdsVerifiedAt = Date.now();
    ctx.commandIdsVerifiedIds = ids;
  };

  const memoryIds = () =>
    gid
      ? (ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(gid) : null)
      : ctx.commandIds;

  const mem = memoryIds();
  if (hasNames(mem, needed) && isFresh()) return mem;

  const clientId = ctx.client?.user?.id;
  const token = ctx.token;
  if (clientId && token) {
    try {
      const rest = ctx.rest || getRest(ctx);

      if (gid) {
        let fetched = await rest.get(Routes.applicationGuildCommands(clientId, gid));
        let ids = idsFromDiscord(fetched);
        rememberGuildIds(ctx, gid, ids);
        if (hasNames(ids, neededGuild)) {
          markVerified(ids);
          return ids;
        }

        ctx.logger?.warn?.(
          `[xp-level-bot] Guild ${gid} fehlen Commands (${neededGuild.filter((n) => !ids[n]).map((n) => `/${n}`).join(', ') || 'unvollständig'}) – schreibe aktuellen Satz...`
        );
        try {
          ids = await registerGuildCommands(ctx, gid, { rest });
        } catch (err) {
          ctx.logger?.warn?.(`[xp-level-bot] Guild-PUT ${gid} fehlgeschlagen: ${err.message}`);
        }
        if (hasNames(ids, neededGuild)) {
          markVerified(ids);
          return ids;
        }

        // Zusätzlich global heilen (neuer Command soll überall ankommen)
        await registerCommands(ctx, { restFactory: () => rest, retryDelays: [0] }).catch(() => {});
        const after = memoryIds();
        if (hasNames(after, neededGuild)) {
          markVerified(after);
          return after;
        }
        return ids || {};
      }

      let fetched = await rest.get(Routes.applicationCommands(clientId));
      let ids = idsFromDiscord(fetched);
      rememberGlobalIds(ctx, ids);
      if (hasNames(ids, neededGlobal)) {
        markVerified(ids);
        return ids;
      }

      const registered = await registerCommands(ctx, { restFactory: () => rest, retryDelays: [0] });
      if (registered) {
        const fresh = memoryIds();
        if (hasNames(fresh, neededGlobal)) {
          markVerified(fresh);
          return fresh;
        }
      }
      return ids;
    } catch (err) {
      ctx.logger?.warn?.(`[xp-level-bot] ensureCommandIds: Fetch/Register fehlgeschlagen: ${err.message}`);
    }
  }

  const last = ctx.commandIdsVerifiedIds;
  if (ctx.commandIdsVerifiedScope === verifyScope && last && typeof last === 'object') return last;
  return {};
}

/**
 * Erzeugt eine klickbare Command-Mention im Format </name:id>.
 *
 * Auf einem Server: IDs DIESER Gilde (Guild-Commands gelten dort).
 * IDs einer anderen/Dev-Gilde werden niemals auf einem fremden Server gerendert.
 * Ohne passende Guild-ID: globale ID, sonst Text-Fallback /name.
 */
function commandMention(ctx, name, guildId = null) {
  let id = null;
  if (guildId && ctx.guildCommandIds instanceof Map) {
    id = ctx.guildCommandIds.get(String(guildId))?.[name] || null;
  }
  if (!id) id = ctx.commandIds?.[name] || null;
  return id ? `</${name}:${id}>` : `/${name}`;
}

async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'setup':
      return setupCmd(ctx, interaction);
    case 'rank':
      return rankCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'admin_set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'level_roles':
      return handleLevelRolesCommand(ctx, interaction);
    case 'update_leaderboard':
      return updateLeaderboardCmd(ctx, interaction);
    case 'toggle_nicknames':
      return toggleNicknamesCmd(ctx, interaction);
    case 'sync_nicknames':
      return syncNicknamesCmd(ctx, interaction);
    case 'set_inactive_role':
      return setInactiveRoleCmd(ctx, interaction);
    case 'ping_inactive_people':
      return handlePingInactiveCommand(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(componentsV2Payload([smallContainer(null, 'Unbekannter Befehl.')], { ephemeral: false }));
  }
}

async function setupCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }));
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const langChoice = interaction.options.getString('language');
  const lang = langChoice || 'en';
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }
  if (!LANGS[lang]) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('setupLangBad', lang))], { ephemeral: false }));
  }

  const leader = interaction.options.getChannel('leaderboard');
  const main = interaction.options.getChannel('levelchat');
  const onlyLevelChat = interaction.options.getBoolean('only_level_chat') === true;
  if (!leader || leader.type !== ChannelType.GuildText) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  }
  if (!main || main.type !== ChannelType.GuildText) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  }

  for (const ch of [leader, main]) {
    const permsBot = ch.permissionsFor(ctx.client.user);
    if (!permsBot?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('errBotPerms', lang, { channel: `<#${ch.id}>` }))], { ephemeral: false }));
    }
  }

  await interaction.deferReply();

  let existing = ctx.store.getGuild(interaction.guild.id);
  const alreadyUsers = existing ? ctx.store.getUsersForGuild(interaction.guild.id) : [];

  let oldMsg = null;
  if (existing && existing.leaderboardChannelId) {
    try {
      const ch = await ctx.client.channels.fetch(existing.leaderboardChannelId).catch(() => null);
      if (ch && ch.isTextBased() && existing.leaderboardMessageId) {
        oldMsg = await ch.messages.fetch(existing.leaderboardMessageId).catch(() => null);
      }
    } catch {}
    if (!oldMsg) {
      try {
        const found = await ctx.store.findLeaderboardMessage(interaction.guild, ctx.client);
        if (found) oldMsg = found.message;
      } catch {}
    }
  }
  if (oldMsg) await oldMsg.delete().catch(() => {});

  const now = new Date();
  const entries = ctx.store.getLeaderboard(interaction.guild.id, 15);
  const container = buildLeaderboardEmbed({ lang, entries, now, guildName: interaction.guild.name });
  const msg = await leader.send(componentsV2Payload([container])).catch((e) => {
    ctx.logger?.error?.('[xp-level-bot] Leaderboard send failed', e.message);
    return null;
  });
  if (!msg) return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));

  const createdAt = now.getTime();
  const cfg = {
    ...(existing || {}),
    guildId: interaction.guild.id,
    leaderboardChannelId: leader.id,
    mainChannelId: main.id,
    levelMessagesMainOnly: onlyLevelChat,
    lang,
    leaderboardMessageId: msg.id,
    lastDailyDecay: todayKeyForLang(lang),
    // /setup hat das Board gerade erfolgreich gesendet. Beide unabhängigen
    // Timer starten daher exakt hier; spätere Level-Ups ändern nur das erste Feld.
    lastLeaderboardRefresh: createdAt,
    lastLeaderboardUpdate: createdAt,
    lastHourlyLeaderboardRefresh: createdAt,
    nicknamesEnabled: existing?.nicknamesEnabled !== false,
  };
  ctx.store.setGuild(cfg);
  // Invite-Baseline direkt beim /setup aufbauen. Ohne diesen Sync wäre der
  // erste Beitritt nach einer erstmaligen Einrichtung nicht zuordenbar.
  await ctx.inviteTracker?.syncGuild?.(interaction.guild);
  await ctx.store.flush();

  const desc = t('setupSuccess', lang, { leader: `<#${leader.id}>`, main: `<#${main.id}>`, lang: LANGS[lang].name });
  let extra = '';
  if (existing) extra = `\n\n${t('setupFoundOld', lang)} (${alreadyUsers.length} Nutzer behalten ✨)`;
  return interaction.editReply(componentsV2Payload([smallContainer(null, desc + extra)]));
}

async function rankCmd(ctx, interaction) {
  const guildId = interaction.guildId;
  if (!guildId) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }));
  const cfg = ctx.store.getGuild(guildId);
  const lang = cfg?.lang || langFromDiscord(interaction.locale);
  if (!cfg || !cfg.leaderboardChannelId) return interaction.reply(componentsV2Payload([smallContainer(null, t('rankNoSetup', lang))], { ephemeral: false }));

  const userId = interaction.user.id;
  let rankInfo = ctx.store.getRank(guildId, userId);
  if (!rankInfo) {
    const u = ctx.store.getUser(guildId, userId);
    if (!u) {
      const r = buildRankEmbed({ lang, userId, rankInfo: null });
      return interaction.reply(componentsV2Payload([r.container], { ephemeral: false }));
    }
    rankInfo = { rank: ctx.store.getUsersForGuild(guildId).length, total: ctx.store.getUsersForGuild(guildId).length, user: u };
    const full = ctx.store.getRank(guildId, userId);
    if (full) rankInfo = full;
  }
  const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });
  const { container } = buildRankEmbed({ lang, userId, rankInfo, avatarUrl, now: new Date() });
  return interaction.reply(componentsV2Payload([container]));
}

async function helpCmd(ctx, interaction) {
  // Command-IDs sicherstellen, damit Mentions </name:id> immer klickbar sind
  await ensureCommandIds(ctx, interaction.guildId);

  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `# ${t('helpTitle', lang)}`,
      t('helpDesc', lang),
      '',
      `🎁 ${t('helpBonus', lang)}`,
      '',
      `**${commandMention(ctx, 'setup', interaction.guildId)}**\n${t('helpSetup', lang)}`,
      '',
      `**${commandMention(ctx, 'rank', interaction.guildId)}**\n${t('helpRank', lang)}`,
      '',
      `**${commandMention(ctx, 'admin_set_bot_profile', interaction.guildId)}**\n${t('helpSetProfile', lang)}`,
      '',
      `**${commandMention(ctx, 'level_roles', interaction.guildId)}**\n${t('levelRolesHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'update_leaderboard', interaction.guildId)}**\n${t('updateLeaderboardHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'toggle_nicknames', interaction.guildId)}**\n${t('toggleNicknamesHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'sync_nicknames', interaction.guildId)}**\n${t('syncNicknamesHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'set_inactive_role', interaction.guildId)}**\n${t('setInactiveRoleHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'ping_inactive_people', interaction.guildId)}**\n${t('pingInactiveHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'help', interaction.guildId)}**\n${t('helpHelp', lang)}`,
    ].join('\n'))
  );
  return interaction.reply(componentsV2Payload([container]));
}

async function profileCmd(ctx, interaction) {
  if (!interaction.inGuild()) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }));
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  await interaction.deferReply();
  const choice = interaction.options.getString('image');
  const label = t(`profileChoice${choice[0].toUpperCase()}${choice.slice(1)}`, lang);
  try {
    if (choice === 'standard') {
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), { body: { avatar: null } });
    } else {
      let url = null;
      if (choice === 'server') {
        url = interaction.guild.iconURL({ size: 256, extension: 'png', forceStatic: true });
        if (!url) return interaction.editReply(componentsV2Payload([smallContainer(null, t('errServerNoIcon', lang))]));
      } else if (choice === 'owner') {
        const owner = await interaction.guild.fetchOwner();
        url = owner?.user?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true }) || owner?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
      }
      if (!url) throw new Error('Bild-URL konnte nicht ermittelt werden.');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Avatar konnte nicht geladen werden (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      const dataUri = `data:${ct};base64,${buffer.toString('base64')}`;
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), { body: { avatar: dataUri } });
    }
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('profileSet', lang, { choice: label }))]));
  } catch (err) {
    const msg = err?.code === RESTJSONErrorCodes.MissingPermissions || err?.status === 403 ? t('errAvatarPerms', lang) : t('errAvatar', lang, { error: err.message });
    return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
  }
}

/**
 * /update_leaderboard – Admin: Leaderboard SOFORT neu rendern.
 * Cooldown: 5 Minuten pro Server (Anti-Spam). Der Cooldown lebt im
 * Scheduler-Modul (Map) und übersteht auch einen fehlgeschlagenen Edit.
 */
async function updateLeaderboardCmd(ctx, interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }));
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.getGuild(guildId);
  const lang = cfg?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }
  if (!cfg || !cfg.leaderboardChannelId) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('rankNoSetup', lang))], { ephemeral: false }));
  }

  const { isManualRefreshDue, noteManualRefresh } = require('./scheduler');
  const now = Date.now();
  const remainingMs = isManualRefreshDue(guildId, now);
  if (remainingMs > 0) {
    const minutes = Math.ceil(remainingMs / 60_000);
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('updateLeaderboardCooldown', lang, { minutes }))],
        { ephemeral: false }
      )
    );
  }

  await interaction.deferReply();

  let guild = interaction.guild;
  if (!guild) {
    guild = ctx.client.guilds.cache.get(guildId) || (await ctx.client.guilds.fetch(guildId).catch(() => null));
  }
  if (!guild) {
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));
  }

  const { refreshLeaderboard } = require('./scheduler');
  const ok = await refreshLeaderboard(ctx, cfg, guild, new Date(), { isHourly: false, manual: true });
  if (ok) {
    noteManualRefresh(guildId, now);
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('updateLeaderboardDone', lang))])
    );
  }
  return interaction.editReply(
    componentsV2Payload([smallContainer(null, t('updateLeaderboardFailed', lang))])
  );
}

/**
 * Gemeinsame Gates für Admin-Commands, die /setup voraussetzen.
 * Gibt entweder `{ error: payload }` oder `{ cfg, lang, guildId }` zurück.
 */
function requireAdminSetup(ctx, interaction) {
  if (!interaction.inGuild?.() && !interaction.guildId) {
    return { error: componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }) };
  }
  const guildId = interaction.guildId;
  if (!guildId) {
    return { error: componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }) };
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.getGuild(guildId);
  const lang = cfg?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return { error: componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }) };
  }
  if (!cfg || !cfg.leaderboardChannelId) {
    return { error: componentsV2Payload([smallContainer(null, t('errNoSetup', lang))], { ephemeral: false }) };
  }
  return { cfg, lang, guildId };
}

function progressBar(done, total, size = 12) {
  if (!total) return '░'.repeat(size);
  const filled = Math.max(0, Math.min(size, Math.round((done / total) * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

function formatSyncProgress(lang, stats) {
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  return t('syncNicknamesProgress', lang, {
    bar: progressBar(stats.done, stats.total),
    percent,
    done: stats.done,
    total: stats.total,
    updated: stats.updated,
    unchanged: stats.unchanged,
    failed: stats.failed,
  });
}

function formatSyncDone(lang, stats) {
  return t('syncNicknamesDone', lang, {
    mode: stats.enabled ? t('syncNicknamesModeOn', lang) : t('syncNicknamesModeOff', lang),
    total: stats.total,
    updated: stats.updated,
    unchanged: stats.unchanged,
    failed: stats.failed,
  });
}

/**
 * /toggle_nicknames enabled:<bool> – Admin: Nickname-Tags an/aus.
 * Standard ist an. Nur nach einmaligem /setup änderbar.
 */
async function toggleNicknamesCmd(ctx, interaction) {
  const gate = requireAdminSetup(ctx, interaction);
  if (gate.error) return interaction.reply(gate.error);

  const enabled = interaction.options.getBoolean('enabled') === true;
  gate.cfg.nicknamesEnabled = enabled;
  ctx.store.setGuild(gate.cfg);
  await ctx.store.flush();

  const msg = enabled ? t('toggleNicknamesOn', gate.lang) : t('toggleNicknamesOff', gate.lang);
  return interaction.reply(componentsV2Payload([smallContainer(null, msg)], { ephemeral: false }));
}

/**
 * /sync_nicknames – Admin: alle Mitglieder durchgehen und Tags setzen oder entfernen.
 * Zeigt sofort den Discord-Ladebildschirm (defer) und danach einen Fortschrittsbalken,
 * weil große Server viele Nickname-Updates brauchen können.
 */
async function syncNicknamesCmd(ctx, interaction) {
  const gate = requireAdminSetup(ctx, interaction);
  if (gate.error) return interaction.reply(gate.error);

  const { isSyncRunning, withSyncLock, syncAllNicknames } = require('./nicknames');
  if (isSyncRunning(gate.guildId)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('syncNicknamesAlreadyRunning', gate.lang))], { ephemeral: false })
    );
  }

  // Sofort deferren → Discord zeigt in der Command-Übersicht den Ladebildschirm.
  await interaction.deferReply();

  let guild = interaction.guild;
  if (!guild) {
    guild = ctx.client?.guilds?.cache?.get(gate.guildId)
      || (await ctx.client?.guilds?.fetch?.(gate.guildId).catch(() => null));
  }
  if (!guild) {
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', gate.lang))]));
  }

  await interaction.editReply(
    componentsV2Payload([smallContainer(null, t('syncNicknamesFetching', gate.lang))])
  ).catch(() => {});

  const result = await withSyncLock(guild.id, () =>
    syncAllNicknames(ctx, guild, gate.lang, {
      onProgress: async (stats) => {
        await interaction.editReply(
          componentsV2Payload([smallContainer(null, formatSyncProgress(gate.lang, stats))])
        ).catch(() => {});
      },
    })
  );

  if (result?.alreadyRunning) {
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('syncNicknamesAlreadyRunning', gate.lang))])
    );
  }

  return interaction.editReply(
    componentsV2Payload([smallContainer(null, formatSyncDone(gate.lang, result))])
  );
}

function formatInactiveSyncProgress(lang, stats) {
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  return t('setInactiveRoleProgress', lang, {
    bar: progressBar(stats.done, stats.total),
    percent,
    done: stats.done,
    total: stats.total,
    updated: stats.updated,
    unchanged: stats.unchanged,
    failed: stats.failed,
  });
}

function formatInactiveSyncDone(lang, stats, cfg) {
  return t('setInactiveRoleDone', lang, {
    mode: stats.enabled ? t('setInactiveRoleModeLabelOn', lang) : t('setInactiveRoleModeLabelOff', lang),
    days: cfg.inactiveRoleDays || '–',
    role: cfg.inactiveRoleId ? `<@&${cfg.inactiveRoleId}>` : '–',
    total: stats.total,
    updated: stats.updated,
    unchanged: stats.unchanged,
    failed: stats.failed,
  });
}

/**
 * /set_inactive_role mode:<on|off> [inactive_days] [role]
 * Admin: Inaktiv-Rolle an/aus. Bei Anschalten (und generell bei Nutzung)
 * werden alle Mitglieder wie bei /sync_nicknames abgeglichen.
 */
async function setInactiveRoleCmd(ctx, interaction) {
  const gate = requireAdminSetup(ctx, interaction);
  if (gate.error) return interaction.reply(gate.error);

  const mode = String(interaction.options.getString('mode') || '').toLowerCase();
  const enabled = mode === 'on';
  const daysOpt = interaction.options.getInteger('inactive_days');
  const roleOpt = interaction.options.getRole('role');

  const days = daysOpt != null
    ? require('./inactive-role').parseInactiveRoleDays(daysOpt)
    : require('./inactive-role').parseInactiveRoleDays(gate.cfg.inactiveRoleDays);
  const role = roleOpt || (gate.cfg.inactiveRoleId
    ? interaction.guild?.roles?.cache?.get(gate.cfg.inactiveRoleId) || { id: gate.cfg.inactiveRoleId, managed: false, position: 0 }
    : null);

  if (enabled) {
    if (!days) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('setInactiveRoleNeedOnArgs', gate.lang))], { ephemeral: false }));
    }
    if (!role?.id) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('setInactiveRoleNeedOnArgs', gate.lang))], { ephemeral: false }));
    }
    if (role.id === gate.guildId || role.managed) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('setInactiveRoleBadRole', gate.lang))], { ephemeral: false }));
    }
  }

  const {
    isSyncRunning,
    withSyncLock,
    syncAllInactiveRoles,
    canManageInactiveRole,
  } = require('./inactive-role');

  if (isSyncRunning(gate.guildId)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('setInactiveRoleAlreadyRunning', gate.lang))], { ephemeral: false })
    );
  }

  if (role?.id && interaction.guild && !canManageInactiveRole(interaction.guild, role) && enabled) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('setInactiveRoleBadRole', gate.lang))], { ephemeral: false }));
  }

  gate.cfg.inactiveRoleEnabled = enabled;
  if (days) gate.cfg.inactiveRoleDays = days;
  if (role?.id) gate.cfg.inactiveRoleId = role.id;
  ctx.store.setGuild(gate.cfg);
  await ctx.store.flush();

  await interaction.deferReply();

  let guild = interaction.guild;
  if (!guild) {
    guild = ctx.client?.guilds?.cache?.get(gate.guildId)
      || (await ctx.client?.guilds?.fetch?.(gate.guildId).catch(() => null));
  }
  if (!guild) {
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', gate.lang))]));
  }

  const intro = enabled
    ? t('setInactiveRoleOn', gate.lang, { days: gate.cfg.inactiveRoleDays, role: `<@&${gate.cfg.inactiveRoleId}>` })
    : t('setInactiveRoleOff', gate.lang);
  await interaction.editReply(
    componentsV2Payload([smallContainer(null, `${intro}\n\n${t('setInactiveRoleFetching', gate.lang)}`)])
  ).catch(() => {});

  const result = await withSyncLock(guild.id, () =>
    syncAllInactiveRoles(ctx, guild, gate.lang, {
      cfg: gate.cfg,
      onProgress: async (stats) => {
        await interaction.editReply(
          componentsV2Payload([smallContainer(null, formatInactiveSyncProgress(gate.lang, stats))])
        ).catch(() => {});
      },
    })
  );

  if (result?.alreadyRunning) {
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('setInactiveRoleAlreadyRunning', gate.lang))])
    );
  }

  return interaction.editReply(
    componentsV2Payload([smallContainer(null, formatInactiveSyncDone(gate.lang, result, gate.cfg))])
  );
}

function todayKeyForLang(lang) {
  const { tzParts } = require('./logic');
  const { tzOf } = require('./languages');
  const pad = (n) => String(n).padStart(2, '0');
  const time = tzParts(tzOf(lang));
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

/**
 * Start-Verifikation: prüft global UND auf jeder gecachten Gilde, ob
 * /set_inactive_role & Co. wirklich live sind. Fehlende werden nachgelegt.
 */
async function verifyCommandsLive(ctx) {
  const clientId = ctx.client?.user?.id;
  if (!clientId || !ctx.token) return false;
  const rest = ctx.rest || getRest(ctx);
  let ok = true;
  try {
    const route = Routes.applicationCommands(clientId);
    let live = await rest.get(route);
    let liveNames = new Set((Array.isArray(live) ? live : []).map((c) => c.name));
    let missing = GLOBAL_COMMAND_NAMES.filter((n) => !liveNames.has(n));
    if (missing.length > 0) {
      ctx.logger?.warn?.(
        `[xp-level-bot] Command-Verifikation (Scope: global): Discord fehlen ${missing.map((n) => `/${n}`).join(', ')} – registriere sofort nach...`
      );
      await registerCommands(ctx, { restFactory: () => rest, retryDelays: [0] });
      live = await rest.get(route).catch(() => null);
      liveNames = new Set((Array.isArray(live) ? live : []).map((c) => c.name));
      missing = GLOBAL_COMMAND_NAMES.filter((n) => !liveNames.has(n));
    }
    if (missing.length === 0) {
      ctx.logger?.info?.(
        `[xp-level-bot] Command-Verifikation OK (Scope: global) – DM-Commands live: ${GLOBAL_COMMAND_NAMES.map((n) => `/${n}`).join(', ')}`
      );
    } else {
      ok = false;
      ctx.logger?.error?.(
        `[xp-level-bot] Command-Verifikation FEHLGESCHLAGEN (Scope: global) – Discord kennt diese Commands NICHT: ${missing.map((n) => `/${n}`).join(', ')}.`
      );
    }
  } catch (err) {
    ok = false;
    ctx.logger?.warn?.(`[xp-level-bot] Command-Verifikation global fehlgeschlagen: ${err.message}`);
  }

  for (const guildId of cachedGuildIds(ctx)) {
    try {
      const route = Routes.applicationGuildCommands(clientId, guildId);
      let live = await rest.get(route);
      let liveNames = new Set((Array.isArray(live) ? live : []).map((c) => c.name));
      let missing = GUILD_COMMAND_NAMES.filter((n) => !liveNames.has(n));
      if (missing.length > 0) {
        ctx.logger?.warn?.(
          `[xp-level-bot] Command-Verifikation (Scope: guild ${guildId}): fehlen ${missing.map((n) => `/${n}`).join(', ')} – schreibe Guild-Satz...`
        );
        await registerGuildCommands(ctx, guildId, { rest });
        live = await rest.get(route).catch(() => null);
        liveNames = new Set((Array.isArray(live) ? live : []).map((c) => c.name));
        missing = GUILD_COMMAND_NAMES.filter((n) => !liveNames.has(n));
      }
      if (missing.length === 0) {
        ctx.logger?.info?.(
          `[xp-level-bot] Command-Verifikation OK (Scope: guild ${guildId}) – ${GUILD_COMMAND_NAMES.length} Server-Commands inkl. /set_inactive_role & /ping_inactive_people`
        );
      } else {
        ok = false;
        ctx.logger?.error?.(
          `[xp-level-bot] Command-Verifikation FEHLGESCHLAGEN (Scope: guild ${guildId}): ${missing.map((n) => `/${n}`).join(', ')}`
        );
      }
    } catch (err) {
      ok = false;
      ctx.logger?.warn?.(`[xp-level-bot] Command-Verifikation guild ${guildId} fehlgeschlagen: ${err.message}`);
    }
  }
  return ok;
}

module.exports = {
  defineCommands,
  registerCommands,
  registerGuildCommands,
  ensureCommandIds,
  verifyCommandsLive,
  handleChatInput,
  pick,
  commandMention,
  ALL_COMMAND_NAMES,
  GLOBAL_COMMAND_NAMES,
  GUILD_COMMAND_NAMES,
};
