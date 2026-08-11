/**
 * Slash-Commands Love Tester – Definition, Registrierung & Handler.
 * Commands: /setup (Admin-Wizard), /test_love, /help,
 *           /admin_set_bot_profile, /adminpanel (Owner-DM).
 * Registrierung 1:1 nach dem XP-Bot-Muster (global vs. Dev-Gilde, ID-Scope).
 */

const {
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  InteractionContextType,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
  ChannelType,
} = require('discord.js');

const { LANGS, t, langFromDiscord, DISCORD_LOCALE } = require('./languages');
const { smallContainer, componentsV2Payload } = require('./embed-builder');
const { openPanel } = require('./admin-panel');
const { createSession, resolveMemberInfo } = require('./runner');
const { storyChannelCmd } = require('./endless-story');

function pick(key) {
  const map = {};
  for (const code of Object.keys(LANGS)) map[DISCORD_LOCALE[code]] = t(key, code);
  return map;
}

function defineCommands() {
  const languageChoices = Object.entries(LANGS).map(([code, lang]) => ({
    name: lang.name,
    value: code,
    name_localizations: Object.fromEntries(Object.entries(lang.names).map(([c, n]) => [DISCORD_LOCALE[c], n])),
  }));
  const profileChoices = ['standard', 'server', 'owner'].map((v) => ({
    name: t(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`, 'de'),
    value: v,
    name_localizations: pick(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`),
  }));
  return [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Richtet den Love Tester ein (Sprache, Kanäle, Groq-Key)')
      .setDescriptionLocalizations(pick('helpSetup'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('test_love')
      .setDescription('Startet einen Love-Test zwischen zwei Personen')
      .setDescriptionLocalizations(pick('helpTestLove'))
      .addUserOption((o) =>
        o.setName('user1').setDescription('Person 1 (die/der Erste)').setDescriptionLocalizations(pick('testLoveUser1Desc')).setRequired(true)
      )
      .addUserOption((o) =>
        o.setName('user2').setDescription('Person 2 (die/der andere)').setDescriptionLocalizations(pick('testLoveUser2Desc')).setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zeigt alle Befehle')
      .setDescriptionLocalizations(pick('helpHelp')),

    new SlashCommandBuilder()
      .setName('admin_set_bot_profile')
      .setDescription('Ändert das Profilbild des Bots auf diesem Server')
      .setDescriptionLocalizations(pick('helpSetProfile'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o.setName('image').setDescription('Welches Bild').setDescriptionLocalizations(pick('profileImageDesc')).setRequired(true).addChoices(...profileChoices)
      ),

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM),

    new SlashCommandBuilder()
      .setName('endless_story_channel')
      .setDescription('Startet das Endless Story Game in einem Kanal (nur Admins)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o.setName('channel')
          .setDescription('Kanal, in dem das Endless Story Game laufen soll')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      ),
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeGuildId(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim().replace(/^<@!?(\d+)>$/, '$1')
    : null;
}

function logRegistration(logger, scopeLabel, res) {
  const list = Array.isArray(res) ? res : [];
  logger?.info?.(`[love-tester-bot] Command-Registrierung erfolgreich (Scope: ${scopeLabel}) – ${list.length} Commands:`);
  for (const c of list) logger?.info?.(`[love-tester-bot]   /${c.name} -> snowflake ${c.id}`);
}

/**
 * Discord antwortet bei einem erfolgreichen PUT mit der vollständigen
 * Command-Liste. Eine leere/inkomplette Antwort ist kein erfolgreicher
 * Registrierungszustand: Würden wir sie als Erfolg markieren, würde die
 * Selbstheilung aufhören, obwohl z. B. `/test_love` noch fehlt.
 */
function commandIdsFromResponse(response, expectedCommands) {
  if (!Array.isArray(response)) {
    throw new Error('Discord lieferte keine Command-Liste zurück.');
  }

  const ids = Object.fromEntries(
    response
      .filter((command) => command && command.name && command.id)
      .map((command) => [command.name, command.id])
  );
  const missing = expectedCommands.filter((name) => !ids[name]);
  if (missing.length) {
    throw new Error(`Discord registrierte nicht alle Commands (fehlend: ${missing.join(', ')}).`);
  }
  return ids;
}

/** Registriert die Slash-Commands (global oder Dev-Gilde, mit Retry + Guild-Cleanup). */
async function registerCommands(ctx, { restFactory, retryDelays } = {}) {
  // Jeder neue Lauf beginnt als „nicht sicher registriert“. Nur ein
  // vollständiger, von Discord bestätigter PUT darf diesen Zustand auf true
  // setzen. Das ist besonders wichtig für die Self-Healing-Schleife.
  ctx.commandsRegistered = false;
  ctx.commandIdsVerifiedScope = null;
  ctx.commandIdsVerifiedAt = 0;
  const commands = defineCommands().map((c) => c.toJSON());
  const expectedCommandNames = commands.map((command) => command.name);
  const rest = restFactory ? restFactory(ctx.token) : (ctx.rest || new REST({ version: '10' }).setToken(ctx.token));
  const clientId = ctx.client?.user?.id;
  if (!clientId) {
    ctx.logger?.error?.('[love-tester-bot] Command-Registrierung abgebrochen: Kein Client-User vorhanden.');
    ctx.commandsRegistered = false;
    return false;
  }

  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const RETRY_DELAYS_MS = retryDelays || [0, 5_000, 15_000, 30_000];

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      if (devGuildId) {
        const route = Routes.applicationGuildCommands(clientId, devGuildId);
        const res = await rest.put(route, { body: commands });
        const ids = commandIdsFromResponse(res, expectedCommandNames);
        ctx.guildCommandIds = ctx.guildCommandIds || new Map();
        ctx.guildCommandIds.set(devGuildId, ids);
        if (ctx.store?.setGuildCommandIds) ctx.store.setGuildCommandIds(devGuildId, ids);
        ctx.commandIdScope = `guild:${devGuildId}`;
        if (ctx.store?.setCommandIdScope) ctx.store.setCommandIdScope(`guild:${devGuildId}`);
        ctx.commandIdsVerifiedScope = `guild:${devGuildId}`;
        ctx.commandIdsVerifiedAt = Date.now();
        logRegistration(ctx.logger, `guild ${devGuildId} (Route: ${route})`, res);
      } else {
        const route = Routes.applicationCommands(clientId);
        const res = await rest.put(route, { body: commands });
        const ids = commandIdsFromResponse(res, expectedCommandNames);
        ctx.commandIds = ids;
        if (ctx.store?.setCommandIds) ctx.store.setCommandIds(ids);
        ctx.commandIdScope = 'global';
        if (ctx.store?.setCommandIdScope) ctx.store.setCommandIdScope('global');
        ctx.commandIdsVerifiedScope = 'global';
        ctx.commandIdsVerifiedAt = Date.now();
        if (ctx.guildCommandIds instanceof Map) ctx.guildCommandIds.clear();
        if (ctx.store?.clearGuildCommandIds) ctx.store.clearGuildCommandIds();
        logRegistration(ctx.logger, `global (Route: ${route})`, res);

        for (const guild of [...(ctx.client?.guilds?.cache?.values() || [])]) {
          try {
            await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            if (ctx.store?.deleteGuildCommandIds) ctx.store.deleteGuildCommandIds(guild.id);
          } catch (cleanErr) {
            ctx.logger?.warn?.(`[love-tester-bot] Alte Guild-Commands aufräumen für Gilde ${guild.id} übersprungen: ${cleanErr.message}`);
          }
        }
      }
      ctx.commandsRegistered = true;
      return true;
    } catch (err) {
      ctx.logger?.error?.(
        `[love-tester-bot] Command-Registrierung fehlgeschlagen (Versuch ${attempt + 1}/${RETRY_DELAYS_MS.length}): ${err.message}`
      );
    }
  }
  ctx.commandsRegistered = false;
  return false;
}

/**
 * Stellt sicher, dass Command-IDs für /help-Mentions vorhanden sind.
 *
 * VERIFIZIERUNG: Gespeicherte Command-IDs werden NICHT blind vertraut,
 * sondern gegen die Discord REST API geprüft, sobald sie älter als die TTL
 * sind (max. 1 GET alle 5 Minuten pro Bot-Prozess). Verwaiste Snowflakes
 * (z.B. gelöschte/neu angelegte Commands) würden sonst in /help als
 * </name:STALE_ID> gerendert – beim Klick meldet Discord „Kein Befehl
 * gefunden".
 */
const COMMAND_ID_VERIFY_TTL_MS = 5 * 60 * 1000;

async function ensureCommandIds(ctx, guildId = null) {
  const needed = ['setup', 'test_love', 'help', 'admin_set_bot_profile', 'adminpanel', 'endless_story_channel'];
  const hasAll = (obj) => obj && typeof obj === 'object' && needed.every((name) => Boolean(obj[name]));

  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const isDevGuildCall = Boolean(devGuildId && guildId && String(guildId) === devGuildId);

  // Wurden die geladenen IDs erst kürzlich gegen Discord verifiziert?
  const verifyScope = isDevGuildCall ? `guild:${guildId}` : 'global';
  const isFresh = () =>
    ctx.commandIdsVerifiedScope === verifyScope &&
    typeof ctx.commandIdsVerifiedAt === 'number' &&
    Date.now() - ctx.commandIdsVerifiedAt < COMMAND_ID_VERIFY_TTL_MS;

  // Nur frisch verifizierte IDs werden direkt zurückgegeben – sonst weiter zu
  // Schritt 3 (REST-Verifikation).
  if (isDevGuildCall && ctx.guildCommandIds instanceof Map && hasAll(ctx.guildCommandIds.get(guildId))) {
    if (isFresh()) return ctx.guildCommandIds.get(guildId);
  }
  if (hasAll(ctx.commandIds)) {
    if (isFresh()) return ctx.commandIds;
  }

  if (isDevGuildCall && ctx.store?.getGuildCommandIds && hasAll(ctx.store.getGuildCommandIds(guildId))) {
    const storedG = ctx.store.getGuildCommandIds(guildId);
    ctx.guildCommandIds = ctx.guildCommandIds || new Map();
    ctx.guildCommandIds.set(guildId, storedG);
    if (isFresh()) return storedG;
  }
  if (ctx.store?.getCommandIds && hasAll(ctx.store.getCommandIds())) {
    ctx.commandIds = { ...(ctx.commandIds || {}), ...ctx.store.getCommandIds() };
    if (isFresh()) return ctx.commandIds;
  }

  const clientId = ctx.client?.user?.id;
  if (clientId && ctx.token) {
    try {
      const rest = ctx.rest || new REST({ version: '10' }).setToken(ctx.token);
      if (isDevGuildCall) {
        const fetched = await rest.get(Routes.applicationGuildCommands(clientId, devGuildId));
        if (Array.isArray(fetched)) {
          const ids = Object.fromEntries(fetched.map((c) => [c.name, c.id]));
          ctx.guildCommandIds = ctx.guildCommandIds || new Map();
          ctx.guildCommandIds.set(devGuildId, ids);
          if (ctx.store?.setGuildCommandIds) ctx.store.setGuildCommandIds(devGuildId, ids);
          if (hasAll(ids)) {
            ctx.commandIdsVerifiedScope = verifyScope;
            ctx.commandIdsVerifiedAt = Date.now();
            return ids;
          }
        }
      } else {
        const fetched = await rest.get(Routes.applicationCommands(clientId));
        if (Array.isArray(fetched)) {
          const ids = Object.fromEntries(fetched.map((c) => [c.name, c.id]));
          ctx.commandIds = ids;
          if (ctx.store?.setCommandIds) ctx.store.setCommandIds(ids);
          if (hasAll(ids)) {
            ctx.commandIdsVerifiedScope = verifyScope;
            ctx.commandIdsVerifiedAt = Date.now();
            return ids;
          }
        }
      }
      // Falls GET unvollständig ist, aktiv neu registrieren – nur bei echtem
      // Erfolg als verifiziert markieren (sonst versucht /help es erneut).
      const registered = await registerCommands(ctx, { retryDelays: [0] });
      if (registered) {
        if (isDevGuildCall) {
          const guildIds = ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(devGuildId) : null;
          if (guildIds && hasAll(guildIds)) {
            ctx.commandIdsVerifiedScope = verifyScope;
            ctx.commandIdsVerifiedAt = Date.now();
            return guildIds;
          }
        } else if (hasAll(ctx.commandIds)) {
          ctx.commandIdsVerifiedScope = verifyScope;
          ctx.commandIdsVerifiedAt = Date.now();
          return ctx.commandIds;
        }
      }
    } catch (err) {
      ctx.logger?.warn?.(`[love-tester-bot] ensureCommandIds fehlgeschlagen: ${err.message}`);
    }
  }
  return ctx.commandIds || {};
}

function commandMention(ctx, name, guildId = null) {
  const devGuildId = normalizeGuildId(ctx.devGuildId);
  const isDevGuild = Boolean(devGuildId && guildId && String(guildId) === devGuildId);
  let id = null;
  if (isDevGuild) {
    const guildIds = ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(guildId) : null;
    const storedGuildIds = ctx.store?.getGuildCommandIds ? ctx.store.getGuildCommandIds(guildId) : null;
    id = guildIds?.[name] || storedGuildIds?.[name];
  }
  if (!id) id = ctx.commandIds?.[name] || (ctx.store?.getCommandId ? ctx.store.getCommandId(name) : null);
  return id ? `</${name}:${id}>` : `/${name}`;
}

async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'setup':
      return setupCmd(ctx, interaction);
    case 'test_love':
      return testLoveCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'admin_set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    case 'endless_story_channel':
      return storyChannelCmd(ctx, interaction);
    default:
      return interaction.reply(componentsV2Payload([smallContainer(null, 'Unbekannter Befehl.')], { ephemeral: true }));
  }
}

// ---------------------------------------------------------------------------
// /setup – öffnet den 3-Schritte-Wizard (ephemer, nur Admin)
// ---------------------------------------------------------------------------

async function setupCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('setupNoPermission', 'en'))], { ephemeral: true }));
  }

  const token = randomToken();
  const session = {
    token,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    step: 1,
    lang: null,
    channels: [],
    groqKey: null,
  };
  ctx.setupSessions.set(token, session);

  let hint = '';
  const existing = ctx.store.getGuild(interaction.guildId);
  if (existing?.setupComplete) hint = `\n\n${t('setupReconfigureHint', existing.lang || 'de')}`;

  const { buildSetupStep1 } = require('./embed-builder');
  const container = buildSetupStep1({ lang: session.lang || 'de', session, hint });
  return interaction.reply(componentsV2Payload([container], { ephemeral: true }));
}

function randomToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// /test_love – Bestätigung (öffentlich) → Analyse
// ---------------------------------------------------------------------------

async function testLoveCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  }
  const cfg = ctx.store.getGuild(interaction.guildId);
  const lang = cfg?.lang || langFromDiscord(interaction.locale);
  if (!cfg || !cfg.setupComplete) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('loveNoSetup', lang))], { ephemeral: true }));
  }

  const u1 = interaction.options.getUser('user1');
  const u2 = interaction.options.getUser('user2');
  if (!u1 || !u2) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGeneric', lang, { error: 'user1/user2 fehlen' }))], { ephemeral: true }));
  }
  if (u1.id === u2.id) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('loveSameUser', lang))], { ephemeral: true }));
  }

  const guild = interaction.guild;
  const m1 = await guild.members.fetch(u1.id).catch(() => null);
  const m2 = await guild.members.fetch(u2.id).catch(() => null);
  if (!m1 || !m2) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('loveUserGone', lang))], { ephemeral: true }));
  }

  // Bot-Personen sind langweilig für den Love Test
  if (u1.bot || u2.bot) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('loveSameUser', lang))], { ephemeral: true }));
  }

  const token = randomToken();
  const session = createSession({
    ctx,
    interaction,
    cfg,
    user1: resolveMemberInfo(guild, u1.id),
    user2: resolveMemberInfo(guild, u2.id),
    token,
  });
  ctx.loveSessions.set(token, session);

  const { buildLoveConfirm } = require('./embed-builder');
  // ÖFFENTLICH sichtbar (nicht ephemer!) – die Buttons kontrolliert nur der Sender.
  return interaction.reply(componentsV2Payload([buildLoveConfirm({ lang, token, user1: session.user1, user2: session.user2 })]));
}

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

async function helpCmd(ctx, interaction) {
  await ensureCommandIds(ctx, interaction.guildId);
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `# ${t('helpTitle', lang)}`,
      t('helpDesc', lang),
      '',
      `**${commandMention(ctx, 'setup', interaction.guildId)}**\n${t('helpSetup', lang)}`,
      '',
      `**${commandMention(ctx, 'test_love', interaction.guildId)}**\n${t('helpTestLove', lang)}`,
      '',
      `**${commandMention(ctx, 'admin_set_bot_profile', interaction.guildId)}**\n${t('helpSetProfile', lang)}`,
      '',
      `**${commandMention(ctx, 'help', interaction.guildId)}**\n${t('helpHelp', lang)}`,
    ].join('\n'))
  );
  return interaction.reply(componentsV2Payload([container]));
}

// ---------------------------------------------------------------------------
// /admin_set_bot_profile (identisch zu den anderen Bots)
// ---------------------------------------------------------------------------

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

module.exports = {
  defineCommands,
  registerCommands,
  ensureCommandIds,
  handleChatInput,
  pick,
  commandMention,
  randomToken,
};
