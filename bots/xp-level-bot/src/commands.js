/**
 * Slash-Commands XP Bot – Definition, Registrierung & Handler
 * Commands: /setup, /rank, /help, /admin_set_bot_profile, /level_roles,
 *           /update_leaderboard, /toggle_nicknames, /sync_nicknames, /set_inactive_role, /adminpanel
 */

const {
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType,
  PermissionFlagsBits,
  InteractionContextType,
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
      .addChannelOption(o=>o.setName('mainchat').setDescription('Haupt-Chat für Level-Ups').setDescriptionLocalizations(pick('setupMainDesc')).setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o=>o.setName('language').setDescription('Sprache').setDescriptionLocalizations(pick('setupLangDesc')).setRequired(true).addChoices(...languageChoices)),

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
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM),
  ];
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
 * Registriert die Slash-Commands bei Discord.
 *
 * Registrierungslogik:
 * 1. Ist `devGuildId` konfiguriert (optional für Development), werden die Commands
 *    in der Dev-Gilde via Routes.applicationGuildCommands registriert.
 * 2. Im Produktivbetrieb (keine Dev-Gilde) werden die Commands GLOBAL via
 *    Routes.applicationCommands registriert.
 * 3. WICHTIG gegen Shadowing: Wenn Commands global registriert werden, räumen wir
 *    alte/verwaiste Guild-Commands auf bestehenden Servern mit `{ body: [] }` auf.
 *    Alte Guild-Commands (aus früheren Versionen oder versehentlicher Dev-Guild-Nutzung)
 *    überschreiben/blockieren sonst globale Commands wie `/level_roles`.
 * 4. STRENGE SCOPE-TRENNUNG (Versuch 5): Dev-Guild-Command-IDs dürfen NIE in den
 *    globalen ID-Slot (`ctx.commandIds` / `store.setCommandIds`) geschrieben werden.
 *    Sonst rendert `/help` auf normalen Servern `</level_roles:DEV_GUILD_ID>` –
 *    Discord kennt diese Snowflake dort nicht und meldet „Kein Befehl gefunden".
 *    Dev-Guild-IDs gehören ausschließlich in `ctx.guildCommandIds` /
 *    `store.setGuildCommandIds(devGuildId, ids)`.
 * 5. Nachvollziehbares Logging mit Scope (global vs. Guild-ID), Route,
 *    Command-Namen und den von Discord vergebenen Snowflake-IDs.
 */
async function registerCommands(ctx, { restFactory, retryDelays } = {}) {
  const commands = defineCommands().map((c) => c.toJSON());
  const rest = restFactory ? restFactory(ctx.token) : (ctx.rest || new REST({ version: '10' }).setToken(ctx.token));
  const clientId = ctx.client?.user?.id;
  if (!clientId) {
    ctx.logger?.error?.('[xp-level-bot] Command-Registrierung abgebrochen: Kein Client-User / Client-ID vorhanden.');
    ctx.commandsRegistered = false;
    return false;
  }

  const devGuildId = normalizeGuildId(ctx.devGuildId);

  const RETRY_DELAYS_MS = retryDelays || [0, 5_000, 15_000, 30_000];

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      if (devGuildId) {
        // ---------- Scope: Guild (nur Dev-Gilde) ----------
        const route = Routes.applicationGuildCommands(clientId, devGuildId);
        const res = await rest.put(route, { body: commands });
        const ids = Object.fromEntries((res || []).map((c) => [c.name, c.id]));

        // Dev-Guild-IDs NUR in den Guild-Slot – der globale Slot bleibt unangetastet!
        ctx.guildCommandIds = ctx.guildCommandIds || new Map();
        ctx.guildCommandIds.set(devGuildId, ids);
        if (ctx.store?.setGuildCommandIds) ctx.store.setGuildCommandIds(devGuildId, ids);
        ctx.commandIdScope = `guild:${devGuildId}`;
        if (ctx.store?.setCommandIdScope) ctx.store.setCommandIdScope(`guild:${devGuildId}`);

        logRegistration(ctx.logger, `guild ${devGuildId} (Route: ${route})`, res);
      } else {
        // ---------- Scope: Global (Produktion) ----------
        const route = Routes.applicationCommands(clientId);
        const res = await rest.put(route, { body: commands });
        const ids = Object.fromEntries((res || []).map((c) => [c.name, c.id]));

        // Globale IDs sind die einzige Quelle für `ctx.commandIds` + Store
        ctx.commandIds = ids;
        if (ctx.store?.setCommandIds) ctx.store.setCommandIds(ids);
        ctx.commandIdScope = 'global';
        if (ctx.store?.setCommandIdScope) ctx.store.setCommandIdScope('global');

        // Veraltete Guild-Command-IDs im Store löschen, damit weder
        // `ensureCommandIds` noch `commandMention` alte Dev-Guild-Snowflakes
        // als Fallback verwenden (Prüfpunkt 3).
        const staleGuildSets = ctx.store?.getAllGuildCommandIds
          ? Object.keys(ctx.store.getAllGuildCommandIds()).length
          : (ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.size : 0);
        if (ctx.guildCommandIds instanceof Map) ctx.guildCommandIds.clear();
        if (ctx.store?.clearGuildCommandIds) ctx.store.clearGuildCommandIds();
        if (staleGuildSets > 0) {
          ctx.logger?.info?.(
            `[xp-level-bot] ${staleGuildSets} veraltete Guild-Command-ID-Sätze aus dem Store entfernt – globale IDs sind jetzt die einzige Quelle.`
          );
        }

        logRegistration(ctx.logger, `global (Route: ${route})`, res);

        // Alte Guild-Commands aufräumen, damit keine veralteten Commands neue globale Commands (wie /level_roles) shadowen
        const cachedGuilds = ctx.client?.guilds?.cache?.values() ? [...ctx.client.guilds.cache.values()] : [];
        for (const guild of cachedGuilds) {
          try {
            await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            if (ctx.store?.deleteGuildCommandIds) ctx.store.deleteGuildCommandIds(guild.id);
          } catch (cleanErr) {
            ctx.logger?.warn?.(
              `[xp-level-bot] Alte Guild-Commands aufräumen für Gilde ${guild.id} übersprungen/fehlgeschlagen: ${cleanErr.message}`
            );
          }
        }
      }

      ctx.commandsRegistered = true;
      return true;
    } catch (err) {
      const detail = err?.rawError ? JSON.stringify(err.rawError).slice(0, 500) : '';
      ctx.logger?.error?.(
        `[xp-level-bot] Command-Registrierung fehlgeschlagen (Versuch ${attempt + 1}/${RETRY_DELAYS_MS.length}, Scope: ${devGuildId ? 'guild ' + devGuildId : 'global'}): ${err.message} ${detail}`
      );
    }
  }

  ctx.commandsRegistered = false; // Scheduler versucht es weiter
  return false;
}

/**
 * Stellt sicher, dass die Command-IDs vor dem Rendern von /help geladen sind.
 *
 * GRUNDREGEL (Fix „/toggle_nicknames & /sync_nicknames: Kein Befehl gefunden“):
 * Persistente Store-IDs werden NIEMALS ungeprüft in /help gerendert. In der
 * Datenbank können Snowflakes aus alten Registrierungen liegen – z. B.
 * Dev-Guild-IDs, die durch einen früheren Scope-Bug im globalen Slot gelandet
 * sind, oder IDs von Commands, die Discord nach Löschen & Neuanlegen mit einer
 * neuen Snowflake versehen hat. /help zeigte solche Chips blau an, beim Klick
 * meldete Discord aber „Kein Befehl gefunden“.
 *
 * Reihenfolge:
 * 1. In-Memory-IDs – nur wenn sie in DIESEM Prozess frisch (TTL 5 min) gegen
 *    Discord verifiziert wurden.
 * 2. Autoritative Quelle: Discord REST GET. Die Antwort ERSETZT RAM + Store
 *    komplett (kein Merge, damit verwaiste IDs nicht weiterleben). Fehlen
 *    Commands bei Discord (z. B. weil produktiv noch ein alter Stand lief),
 *    wird sofort neu registriert und die frische PUT-Antwort verwendet.
 * 3. REST-Ausfall: nur IDs verwenden, die in diesem Prozess bereits einmal
 *    gegen Discord verifiziert wurden. Gibt es keine, rendert /help die
 *    Befehle als /name-Text statt als potenziell tote blaue Chips.
 *
 * SCOPE-LOGIK (Versuch 5):
 * - Auf der Dev-Gilde (guildId === devGuildId) werden Guild-Command-IDs verwendet.
 * - Auf ALLEN anderen Servern werden NUR globale Command-IDs verwendet – nie
 *   Guild-IDs einer fremden (Dev-)Gilde, sonst „Kein Befehl gefunden".
 */
const COMMAND_ID_VERIFY_TTL_MS = 5 * 60 * 1000;

async function ensureCommandIds(ctx, guildId = null) {
  const needed = ['setup', 'rank', 'help', 'admin_set_bot_profile', 'level_roles', 'update_leaderboard', 'toggle_nicknames', 'sync_nicknames', 'set_inactive_role', 'adminpanel'];
  const hasAll = (obj) => obj && typeof obj === 'object' && needed.every((name) => Boolean(obj[name]));

  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const isDevGuildCall = Boolean(devGuildId && guildId && String(guildId) === devGuildId);

  // Wurden die geladenen IDs erst kürzlich gegen Discord verifiziert?
  const verifyScope = isDevGuildCall ? `guild:${guildId}` : 'global';
  const isFresh = () =>
    ctx.commandIdsVerifiedScope === verifyScope &&
    typeof ctx.commandIdsVerifiedAt === 'number' &&
    Date.now() - ctx.commandIdsVerifiedAt < COMMAND_ID_VERIFY_TTL_MS;
  const markVerified = (ids) => {
    ctx.commandIdsVerifiedScope = verifyScope;
    ctx.commandIdsVerifiedAt = Date.now();
    ctx.commandIdsVerifiedIds = ids; // letzte geprüfte IDs = einziger Offline-Fallback
  };

  const memoryIds = () =>
    isDevGuildCall
      ? (ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(guildId) : null)
      : ctx.commandIds;

  // 1. In-Memory Check – nur zurückgeben, wenn frisch verifiziert.
  const mem = memoryIds();
  if (hasAll(mem) && isFresh()) return mem;

  // 2. Autoritativer Check gegen Discord REST. WICHTIG: Der persistente Store
  //    wird hier bewusst NICHT als Zwischenquelle eingelesen – ungeprüfte
  //    Store-IDs erzeugten genau die gemeldeten toten </name:alt>-Chips von
  //    /toggle_nicknames und /sync_nicknames.
  const clientId = ctx.client?.user?.id;
  const token = ctx.token;
  if (clientId && token) {
    try {
      const rest = ctx.rest || new REST({ version: '10' }).setToken(token);

      let fetched = null;
      if (isDevGuildCall) {
        // Nur auf der Dev-Gilde selbst die Guild-Commands laden – und nur in den
        // Guild-Slot schreiben, nie in den globalen Slot.
        fetched = await rest.get(Routes.applicationGuildCommands(clientId, devGuildId));
        if (Array.isArray(fetched)) {
          const ids = Object.fromEntries(fetched.map((c) => [c.name, c.id]));
          ctx.guildCommandIds = ctx.guildCommandIds || new Map();
          ctx.guildCommandIds.set(devGuildId, ids);
          if (ctx.store?.setGuildCommandIds) ctx.store.setGuildCommandIds(devGuildId, ids);
          markVerified(ids);
          if (hasAll(ids)) return ids;
        }
      } else {
        // Normaler Server / Produktion: IMMER die globalen Commands laden.
        fetched = await rest.get(Routes.applicationCommands(clientId));
        if (Array.isArray(fetched)) {
          const ids = Object.fromEntries(fetched.map((c) => [c.name, c.id]));
          ctx.commandIds = ids;
          if (ctx.store?.setCommandIds) ctx.store.setCommandIds(ids);
          markVerified(ids);
          if (hasAll(ids)) return ids;
        }
      }

      // Fehlen Commands auf Discord (z. B. /toggle_nicknames oder
      // /sync_nicknames), aktiv neu registrieren und die frischen IDs verwenden.
      // Nur bei echtem Erfolg als vollständig verifiziert markieren – sonst
      // versucht der nächste /help-Aufruf es erneut.
      const registered = await registerCommands(ctx, { retryDelays: [0] });
      if (registered) {
        const fresh = memoryIds();
        if (hasAll(fresh)) {
          markVerified(fresh);
          return fresh;
        }
      }

      // Registrierung konnten nicht alle Namen herstellen: die soeben per GET
      // verifizierten (echten) IDs zurückgeben – fehlende Befehle werden dann
      // als /name-Text gerendert statt mit falscher Snowflake.
      if (Array.isArray(fetched)) {
        return Object.fromEntries(fetched.map((c) => [c.name, c.id]));
      }
    } catch (err) {
      ctx.logger?.warn?.(`[xp-level-bot] ensureCommandIds: Fetch/Register fehlgeschlagen: ${err.message}`);
    }
  }

  // 3. REST nicht erreichbar: NUR die zuletzt in diesem Prozess verifizierten
  //    IDs dieses Scopes verwenden. NIEMALS ungeprüfte Store-IDs – die waren
  //    die Ursache für die toten blauen Chips.
  const last = ctx.commandIdsVerifiedIds;
  if (ctx.commandIdsVerifiedScope === verifyScope && last && typeof last === 'object') return last;
  return {};
}

/**
 * Erzeugt eine klickbare Command-Mention im Format </name:id>.
 * Fallback auf /name nur dann, wenn keine VERIFIZIERTE ID auffindbar ist.
 *
 * WICHTIG (Fix „/toggle_nicknames & /sync_nicknames: Kein Befehl gefunden“):
 * Es gibt bewusst KEINEN Fallback auf den persistenten Store. /help ruft vor
 * dem Rendern immer ensureCommandIds auf, das ctx.commandIds /
 * ctx.guildCommandIds ausschließlich mit IDs füllt, die gegen die Discord
 * REST API geprüft (oder frisch registriert) wurden. Ungeprüfte Store-IDs
 * hatten früher blaue, aber tote Chips erzeugt.
 *
 * SCOPE-LOGIK (Versuch 5, Prüfpunkt 1):
 * - Guild-Command-IDs (aus `ctx.guildCommandIds`) dürfen AUSSCHLIESSLICH auf
 *   der Dev-Gilde selbst verwendet werden (guildId === devGuildId).
 * - Auf normalen Servern (guildId !== devGuildId) wird NIE eine Guild-Command-ID
 *   aus einer anderen (Dev-)Gilde gerendert – sonst meldet Discord beim Klick
 *   „Kein Befehl gefunden”. Dort zählt zwingend die GLOBALE Command-ID.
 */
function commandMention(ctx, name, guildId = null) {
  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const isDevGuild = Boolean(devGuildId && guildId && String(guildId) === devGuildId);

  let id = null;
  if (isDevGuild && ctx.guildCommandIds instanceof Map) {
    // Nur auf der Dev-Gilde selbst dürfen Guild-Command-IDs verwendet werden.
    id = ctx.guildCommandIds.get(guildId)?.[name] || null;
  }
  if (!id) {
    // Auf allen normalen Servern: ausschließlich die globale Command-ID.
    id = ctx.commandIds?.[name] || null;
  }

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
  const main = interaction.options.getChannel('mainchat');
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
 * Start-Verifikation (Fix „/toggle_nicknames & /sync_nicknames nicht gefunden"):
 * Prüft per REST, ob Discord wirklich ALLE definierten Commands serviert, und
 * loggt das Ergebnis laut und deutlich. Fehlen welche (z. B. weil produktiv
 * noch ein alter Stand lief oder XP_BOT_GUILD_ID gesetzt ist), ist das im Log
 * sofort sichtbar – statt erst beim nächsten „Kein Befehl gefunden“-Klick.
 * Fehlende Commands werden dabei sofort nachregistriert.
 */
async function verifyCommandsLive(ctx) {
  const clientId = ctx.client?.user?.id;
  if (!clientId || !ctx.token) return false;
  const expected = defineCommands()
    .map((c) => c.toJSON())
    .map((c) => c.name);
  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const scopeLabel = devGuildId ? `guild ${devGuildId}` : 'global';
  try {
    const rest = ctx.rest || new REST({ version: '10' }).setToken(ctx.token);
    const route = devGuildId
      ? Routes.applicationGuildCommands(clientId, devGuildId)
      : Routes.applicationCommands(clientId);
    let live = await rest.get(route);
    let liveNames = new Set((Array.isArray(live) ? live : []).map((c) => c.name));
    let missing = expected.filter((n) => !liveNames.has(n));
    if (missing.length > 0) {
      ctx.logger?.warn?.(
        `[xp-level-bot] Command-Verifikation (Scope: ${scopeLabel}): Discord fehlen ${missing
          .map((n) => `/${n}`)
          .join(', ')} – registriere sofort nach...`
      );
      const ok = await registerCommands(ctx, { retryDelays: [0] });
      if (ok) {
        live = await rest.get(route).catch(() => null);
        liveNames = new Set((Array.isArray(live) ? live : []).map((c) => c.name));
        missing = expected.filter((n) => !liveNames.has(n));
      }
    }
    if (missing.length === 0) {
      ctx.logger?.info?.(
        `[xp-level-bot] Command-Verifikation OK (Scope: ${scopeLabel}) – alle ${expected.length} Commands live: ${expected
          .map((n) => `/${n}`)
          .join(', ')}`
      );
      return true;
    }
    ctx.logger?.error?.(
      `[xp-level-bot] Command-Verifikation FEHLGESCHLAGEN (Scope: ${scopeLabel}) – Discord kennt diese Commands NICHT: ${missing
        .map((n) => `/${n}`)
        .join(', ')}. /help versucht bei jedem Aufruf eine Reparatur.`
    );
    return false;
  } catch (err) {
    ctx.logger?.warn?.(`[xp-level-bot] Command-Verifikation übersprungen/fehlgeschlagen: ${err.message}`);
    return false;
  }
}

module.exports = {
  defineCommands,
  registerCommands,
  ensureCommandIds,
  verifyCommandsLive,
  handleChatInput,
  pick,
  commandMention,
};
