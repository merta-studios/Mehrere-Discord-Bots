/**
 * Slash-Commands XP Bot – Definition, Registrierung & Handler
 * Commands: /setup, /rank, /help, /admin_set_bot_profile, /level_roles, /adminpanel
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
 * Reihenfolge: Memory -> persistenter Store -> Discord REST GET Fallback -> Auto-Re-Register Fallback.
 *
 * SCOPE-LOGIK (Versuch 5):
 * - Auf der Dev-Gilde (guildId === devGuildId) werden Guild-Command-IDs verwendet.
 * - Auf ALLEN anderen Servern werden NUR globale Command-IDs verwendet – nie
 *   Guild-IDs einer fremden (Dev-)Gilde, sonst „Kein Befehl gefunden".
 */
async function ensureCommandIds(ctx, guildId = null) {
  const needed = ['setup', 'rank', 'help', 'admin_set_bot_profile', 'level_roles', 'adminpanel'];
  const hasAll = (obj) => obj && typeof obj === 'object' && needed.every((name) => Boolean(obj[name]));

  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const isDevGuildCall = Boolean(devGuildId && guildId && String(guildId) === devGuildId);

  // 1. In-Memory Check (Guild-Slot zuerst, aber NUR auf der Dev-Gilde)
  if (isDevGuildCall && ctx.guildCommandIds instanceof Map && hasAll(ctx.guildCommandIds.get(guildId))) {
    return ctx.guildCommandIds.get(guildId);
  }
  if (hasAll(ctx.commandIds)) {
    return ctx.commandIds;
  }

  // 2. Store Check (übersteht Bot-Restarts sofort ohne REST-Aufruf)
  if (isDevGuildCall && ctx.store?.getGuildCommandIds && hasAll(ctx.store.getGuildCommandIds(guildId))) {
    const storedG = ctx.store.getGuildCommandIds(guildId);
    ctx.guildCommandIds = ctx.guildCommandIds || new Map();
    ctx.guildCommandIds.set(guildId, storedG);
    return storedG;
  }
  if (ctx.store?.getCommandIds && hasAll(ctx.store.getCommandIds())) {
    ctx.commandIds = { ...(ctx.commandIds || {}), ...ctx.store.getCommandIds() };
    return ctx.commandIds;
  }

  // 3. Fallback: Command-IDs direkt von der Discord REST API abrufen
  const clientId = ctx.client?.user?.id;
  const token = ctx.token;
  if (clientId && token) {
    try {
      const rest = ctx.rest || new REST({ version: '10' }).setToken(token);

      if (isDevGuildCall) {
        // Nur auf der Dev-Gilde selbst die Guild-Commands laden – und nur in den
        // Guild-Slot schreiben, nie in den globalen Slot.
        const fetched = await rest.get(Routes.applicationGuildCommands(clientId, devGuildId));
        if (Array.isArray(fetched) && fetched.length > 0) {
          const ids = Object.fromEntries(fetched.map((c) => [c.name, c.id]));
          ctx.guildCommandIds = ctx.guildCommandIds || new Map();
          ctx.guildCommandIds.set(devGuildId, ids);
          if (ctx.store?.setGuildCommandIds) ctx.store.setGuildCommandIds(devGuildId, ids);
          if (hasAll(ids)) return ids;
        }
      } else {
        // Normaler Server / Produktion: IMMER die globalen Commands laden.
        const fetched = await rest.get(Routes.applicationCommands(clientId));
        if (Array.isArray(fetched) && fetched.length > 0) {
          const ids = Object.fromEntries(fetched.map((c) => [c.name, c.id]));
          ctx.commandIds = ids;
          if (ctx.store?.setCommandIds) ctx.store.setCommandIds(ids);
          if (hasAll(ids)) return ids;
        }
      }

      // Falls GET immer noch unvollständig ist (z.B. /level_roles fehlt auf Discord),
      // aktiv neu registrieren
      await registerCommands(ctx, { retryDelays: [0] });
      if (hasAll(ctx.commandIds)) return ctx.commandIds;
    } catch (err) {
      ctx.logger?.warn?.(`[xp-level-bot] ensureCommandIds: Fetch/Register fehlgeschlagen: ${err.message}`);
    }
  }

  return ctx.commandIds || {};
}

/**
 * Erzeugt eine klickbare Command-Mention im Format </name:id>.
 * Fallback auf /name nur dann, wenn wirklich keine ID auffindbar ist.
 *
 * SCOPE-LOGIK (Versuch 5, Prüfpunkt 1):
 * - Guild-Command-IDs (aus `ctx.guildCommandIds` / Store) dürfen AUSSCHLIESSLICH
 *   auf der Dev-Gilde selbst verwendet werden (guildId === devGuildId).
 * - Auf normalen Servern (guildId !== devGuildId) wird NIE eine Guild-Command-ID
 *   aus einer anderen (Dev-)Gilde gerendert – sonst meldet Discord beim Klick
 *   „Kein Befehl gefunden". Dort zählt zwingend die GLOBALE Command-ID.
 */
function commandMention(ctx, name, guildId = null) {
  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const isDevGuild = Boolean(devGuildId && guildId && String(guildId) === devGuildId);

  let id = null;
  if (isDevGuild) {
    // Nur auf der Dev-Gilde selbst dürfen Guild-Command-IDs verwendet werden.
    const guildIds = ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(guildId) : null;
    const storedGuildIds = ctx.store?.getGuildCommandIds ? ctx.store.getGuildCommandIds(guildId) : null;
    id = guildIds?.[name] || storedGuildIds?.[name];
  }
  if (!id) {
    // Auf allen normalen Servern: ausschließlich die globale Command-ID.
    id = ctx.commandIds?.[name] || (ctx.store?.getCommandId ? ctx.store.getCommandId(name) : null);
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
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(componentsV2Payload([smallContainer(null, 'Unbekannter Befehl.')], { ephemeral: true }));
  }
}

async function setupCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const langChoice = interaction.options.getString('language');
  const lang = langChoice || 'en';
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true }));
  }
  if (!LANGS[lang]) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('setupLangBad', lang))], { ephemeral: true }));
  }

  const leader = interaction.options.getChannel('leaderboard');
  const main = interaction.options.getChannel('mainchat');
  if (!leader || leader.type !== ChannelType.GuildText) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: true }));
  }
  if (!main || main.type !== ChannelType.GuildText) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: true }));
  }

  for (const ch of [leader, main]) {
    const permsBot = ch.permissionsFor(ctx.client.user);
    if (!permsBot?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('errBotPerms', lang, { channel: `<#${ch.id}>` }))], { ephemeral: true }));
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  if (!guildId) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  const cfg = ctx.store.getGuild(guildId);
  const lang = cfg?.lang || langFromDiscord(interaction.locale);
  if (!cfg || !cfg.leaderboardChannelId) return interaction.reply(componentsV2Payload([smallContainer(null, t('rankNoSetup', lang))], { ephemeral: true }));

  const userId = interaction.user.id;
  let rankInfo = ctx.store.getRank(guildId, userId);
  if (!rankInfo) {
    const u = ctx.store.getUser(guildId, userId);
    if (!u) {
      const r = buildRankEmbed({ lang, userId, rankInfo: null });
      return interaction.reply(componentsV2Payload([r.container], { ephemeral: true }));
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
      `**${commandMention(ctx, 'setup', interaction.guildId)}**\n${t('helpSetup', lang)}`,
      '',
      `**${commandMention(ctx, 'rank', interaction.guildId)}**\n${t('helpRank', lang)}`,
      '',
      `**${commandMention(ctx, 'admin_set_bot_profile', interaction.guildId)}**\n${t('helpSetProfile', lang)}`,
      '',
      `**${commandMention(ctx, 'level_roles', interaction.guildId)}**\n${t('levelRolesHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'help', interaction.guildId)}**\n${t('helpHelp', lang)}`,
    ].join('\n'))
  );
  return interaction.reply(componentsV2Payload([container]));
}

async function profileCmd(ctx, interaction) {
  if (!interaction.inGuild()) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true }));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

function todayKeyForLang(lang) {
  const { tzParts } = require('./logic');
  const { tzOf } = require('./languages');
  const pad = (n) => String(n).padStart(2, '0');
  const time = tzParts(tzOf(lang));
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

module.exports = {
  defineCommands,
  registerCommands,
  ensureCommandIds,
  handleChatInput,
  pick,
  commandMention,
};
