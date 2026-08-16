/**
 * Slash-Commands Definition & Handlers für den Sicherheitsbot.
 */

const {
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  InteractionContextType,
  ApplicationIntegrationType,
  ContainerBuilder,
  TextDisplayBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  RESTJSONErrorCodes,
} = require('discord.js');

const { LANGS, t, langFromDiscord, DISCORD_LOCALE } = require('./languages');
const {
  smallContainer,
  buildStatusContainer,
  buildManageUserContainer,
  buildTestReportContainer,
  buildWarningsConfigContainer,
  buildRulesConfigContainer,
  buildSensitivityContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');
const { callOpenAIModeration, evaluateModerationResult } = require('./moderation');
const {
  PRESET_THRESHOLDS,
  getDefaultThresholdMap,
  DEFAULT_WARNING_ESCALATION,
  maskApiKey,
} = require('./rules');

const ALL_COMMAND_NAMES = [
  'set_api_key',
  'set_language',
  'set_sensitivity',
  'configure_rules',
  'set_warnings',
  'status',
  'manage_user',
  'test_text',
  'admin_set_bot_profile',
  'help',
  'adminpanel',
];

const GLOBAL_COMMAND_NAMES = ['adminpanel'];
const GUILD_COMMAND_NAMES = ALL_COMMAND_NAMES.filter((n) => !GLOBAL_COMMAND_NAMES.includes(n));

function pick(key) {
  const map = {};
  for (const code of Object.keys(LANGS)) {
    map[DISCORD_LOCALE[code]] = t(key, code);
  }
  return map;
}

function defineCommands() {
  const languageChoices = Object.entries(LANGS).map(([code, lang]) => ({
    name: lang.name,
    value: code,
    name_localizations: Object.fromEntries(
      Object.entries(lang.names).map(([c, n]) => [DISCORD_LOCALE[c], n])
    ),
  }));

  const profileChoices = ['standard', 'server', 'owner'].map((v) => ({
    name: t(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`, 'de'),
    value: v,
    name_localizations: pick(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`),
  }));

  const sensitivityChoices = [
    { name: 'Strict (30%)', value: 'strict', name_localizations: pick('preset_strict') },
    { name: 'Balanced (50%)', value: 'balanced', name_localizations: pick('preset_balanced') },
    { name: 'Relaxed (75%)', value: 'relaxed', name_localizations: pick('preset_relaxed') },
  ];

  const actionChoices = [
    { name: 'Warning only', value: 'warn', name_localizations: pick('action_warn') },
    { name: '1m Timeout', value: 'timeout_60s', name_localizations: pick('action_timeout_60s') },
    { name: '5m Timeout', value: 'timeout_300s', name_localizations: pick('action_timeout_300s') },
    { name: '10m Timeout', value: 'timeout_600s', name_localizations: pick('action_timeout_600s') },
    { name: '1h Timeout', value: 'timeout_3600s', name_localizations: pick('action_timeout_3600s') },
    { name: '24h Timeout', value: 'timeout_86400s', name_localizations: pick('action_timeout_86400s') },
    { name: '7d Timeout', value: 'timeout_604800s', name_localizations: pick('action_timeout_604800s') },
  ];

  return [
    new SlashCommandBuilder()
      .setName('set_api_key')
      .setDescription('OpenAI Moderation API Key für diesen Server hinterlegen (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetApiKey'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('set_language')
      .setDescription('Ändert die Sprache des Sicherheitsbots dauerhaft (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetLanguage'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription('Gewünschte Sprache')
          .setRequired(true)
          .addChoices(...languageChoices)
      ),

    new SlashCommandBuilder()
      .setName('set_sensitivity')
      .setDescription('Schutzlevel & Strenge der Filter anpassen (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetSensitivity'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('preset')
          .setDescription('Schutzlevel wählen (Strikt / Ausgewogen / Tolerant)')
          .setRequired(false)
          .addChoices(...sensitivityChoices)
      ),

    new SlashCommandBuilder()
      .setName('configure_rules')
      .setDescription('Interaktive Konfiguration für Kategorien & Auto-Löschen (nur Admins)')
      .setDescriptionLocalizations(pick('helpConfigureRules'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('set_warnings')
      .setDescription('Verwarnungsstufen, Timeouts & Verfallszeit konfigurieren (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetWarnings'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addIntegerOption((o) =>
        o
          .setName('max_warnings')
          .setDescription('Maximale Verwarnungsanzahl (1-10)')
          .setMinValue(1)
          .setMaxValue(10)
          .setRequired(false)
      )
      .addIntegerOption((o) =>
        o
          .setName('expiry_days')
          .setDescription('Verfallszeit in Tagen für Verstöße (1-365)')
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('action_1')
          .setDescription('Maßnahme für 1. Verwarnung')
          .setRequired(false)
          .addChoices(...actionChoices)
      )
      .addStringOption((o) =>
        o
          .setName('action_2')
          .setDescription('Maßnahme für 2. Verwarnung')
          .setRequired(false)
          .addChoices(...actionChoices)
      )
      .addStringOption((o) =>
        o
          .setName('action_3')
          .setDescription('Maßnahme für 3. Verwarnung')
          .setRequired(false)
          .addChoices(...actionChoices)
      )
      .addBooleanOption((o) =>
        o
          .setName('auto_delete')
          .setDescription('Verstoßende Nachrichten automatisch löschen (Ja / Nein)')
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Zeigt deine aktiven Verwarnungen und deinen Sicherheitsstatus')
      .setDescriptionLocalizations(pick('helpStatus')),

    new SlashCommandBuilder()
      .setName('manage_user')
      .setDescription('Status eines Nutzers einsehen und Verwarnungen löschen (nur Admins)')
      .setDescriptionLocalizations(pick('helpManageUser'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) =>
        o
          .setName('user')
          .setDescription('Zu prüfender / verwaltender Benutzer')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('test_text')
      .setDescription('Überprüft Text mit OpenAI Moderation auf Regelverstöße (nur Admins)')
      .setDescriptionLocalizations(pick('helpTestText'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('text')
          .setDescription('Zu überprüfender Text')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('admin_set_bot_profile')
      .setDescription('Ändert das Server-Profilbild des Sicherheitsbots (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetProfile'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('image')
          .setDescription('Welches Bild verwendet werden soll')
          .setRequired(true)
          .addChoices(...profileChoices)
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zeigt alle Befehle und Funktionen des Sicherheitsbots')
      .setDescriptionLocalizations(pick('helpHelp')),

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im Bot-DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
  ].map((cmd) => {
    if (cmd.name === 'adminpanel') return cmd;
    return cmd
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  });
}

function guildCommandJson() {
  return defineCommands()
    .filter((c) => !GLOBAL_COMMAND_NAMES.includes(c.name))
    .map((c) => {
      const json = c.toJSON();
      // `contexts` und `integration_types` sind Felder globaler Commands. Ein
      // Guild-Command ist durch seine REST-Route bereits eindeutig auf Guild
      // Install + Guild Context begrenzt. Ohne diese global-only Felder bleibt
      // der Bulk-Guild-Payload mit Discord-Versionen strikt kompatibel.
      delete json.contexts;
      delete json.integration_types;
      delete json.dm_permission;
      return json;
    });
}

/** Global wird ausschließlich der DM-Command /adminpanel geführt. */
function allCommandJson() {
  return defineCommands()
    .filter((c) => GLOBAL_COMMAND_NAMES.includes(c.name))
    .map((c) => c.toJSON());
}

function idsFromDiscord(list) {
  return Object.fromEntries((Array.isArray(list) ? list : []).map((c) => [c.name, c.id]));
}

function hasCommandNames(ids, names) {
  return Boolean(ids) && names.every((name) => Boolean(ids[name]));
}

function normalizeGuildId(value) {
  if (value == null) return null;
  const id = String(value).trim().replace(/^<@!?(\d+)>$/, '$1');
  return id || null;
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
      const id = normalizeGuildId(guild?.id);
      if (id) ids.add(id);
    }
  } else if (cache instanceof Map) {
    for (const [cacheId, guild] of cache.entries()) {
      const id = normalizeGuildId(guild?.id || cacheId);
      if (id) ids.add(id);
    }
  }
  const devGuildId = normalizeGuildId(ctx.devGuildId);
  if (devGuildId) ids.add(devGuildId);
  return [...ids];
}

function rememberGlobalIds(ctx, ids) {
  ctx.commandIds = ids;
  ctx.store?.setCommandIds?.(ids);
}

function rememberGuildIds(ctx, guildId, ids) {
  const id = normalizeGuildId(guildId);
  if (!id) return;
  ctx.guildCommandIds = ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds : new Map();
  ctx.guildCommandIds.set(id, ids);
  ctx.store?.setGuildCommandIds?.(id, ids);
}

function errorDetail(err) {
  if (!err) return 'Unbekannter Fehler';
  let detail = err.message || String(err);
  if (err.rawError) {
    try {
      detail += ` | Discord: ${JSON.stringify(err.rawError).slice(0, 1000)}`;
    } catch {}
  }
  return detail;
}

function logRegistration(ctx, scope, response) {
  const commands = Array.isArray(response) ? response : [];
  ctx.logger?.info?.(
    `[security-bot] Command-Registrierung erfolgreich (${scope}): ` +
      commands.map((command) => `/${command.name} (${command.id})`).join(', ')
  );
}

async function registerGuildCommands(ctx, guildId, { rest } = {}) {
  const clientId = ctx.client?.user?.id;
  const id = normalizeGuildId(guildId);
  if (!clientId || !id) return null;

  const api = rest || getRest(ctx);
  const route = Routes.applicationGuildCommands(clientId, id);
  const res = await api.put(route, { body: guildCommandJson() });
  const ids = idsFromDiscord(res);
  if (!hasCommandNames(ids, GUILD_COMMAND_NAMES)) {
    const missing = GUILD_COMMAND_NAMES.filter((name) => !ids[name]);
    throw new Error(
      `Discord hat für Guild ${id} einen unvollständigen Command-Satz zurückgegeben ` +
        `(fehlt: ${missing.map((name) => `/${name}`).join(', ')})`
    );
  }

  rememberGuildIds(ctx, id, ids);
  logRegistration(ctx, `Guild ${id}`, res);
  return ids;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registriert den Sicherheits-Bot ausfallsicher.
 *
 * Server-Commands werden zuerst auf jede bekannte Guild geschrieben. Erst
 * wenn das geklappt hat, wird der globale Satz auf den reinen DM-Command
 * /adminpanel bereinigt. Damit kann ein fehlgeschlagener Guild-PUT nicht mehr
 * gleichzeitig die alten globalen Server-Commands entfernen. Transiente
 * Discord-REST-Fehler werden außerdem mehrfach versucht und ein Fehlschlag
 * wird nicht länger fälschlich als Erfolg zurückgegeben.
 */
async function registerCommands(ctx, { restFactory, retryDelays } = {}) {
  const rest = getRest(ctx, restFactory);
  const clientId = ctx.client?.user?.id;
  if (!clientId) {
    ctx.commandsRegistered = false;
    ctx.logger?.error?.('[security-bot] Registrierung abgebrochen: Keine Client-ID.');
    return false;
  }

  const delays = Array.isArray(retryDelays) && retryDelays.length
    ? retryDelays
    : [0, 5_000, 15_000, 30_000];
  const guildIds = cachedGuildIds(ctx);
  const registeredGuilds = new Set();
  let globalRegistered = false;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);

    // Fehlgeschlagene Guilds erneut versuchen; bereits erfolgreiche Guilds
    // werden im selben Registrierungsdurchlauf nicht unnötig überschrieben.
    for (const guildId of guildIds) {
      if (registeredGuilds.has(guildId)) continue;
      try {
        await registerGuildCommands(ctx, guildId, { rest });
        registeredGuilds.add(guildId);
      } catch (err) {
        ctx.logger?.warn?.(
          `[security-bot] Guild-Commands für ${guildId} fehlgeschlagen ` +
            `(Versuch ${attempt + 1}/${delays.length}): ${errorDetail(err)}`
        );
      }
    }

    // Global erst auf /adminpanel reduzieren, wenn alle Server ihren sofort
    // sichtbaren Guild-Satz besitzen. So bleiben ältere globale Commands bei
    // einem Discord-Ausfall als Sicherheitsnetz erhalten.
    if (!globalRegistered && registeredGuilds.size === guildIds.length) {
      try {
        const route = Routes.applicationCommands(clientId);
        const res = await rest.put(route, { body: allCommandJson() });
        const ids = idsFromDiscord(res);
        if (!hasCommandNames(ids, GLOBAL_COMMAND_NAMES)) {
          throw new Error('Discord hat /adminpanel nicht im globalen Command-Satz zurückgegeben.');
        }
        rememberGlobalIds(ctx, ids);
        logRegistration(ctx, 'global', res);
        globalRegistered = true;
      } catch (err) {
        ctx.logger?.error?.(
          `[security-bot] Globale Registrierung fehlgeschlagen ` +
            `(Versuch ${attempt + 1}/${delays.length}): ${errorDetail(err)}`
        );
      }
    }

    if (globalRegistered && registeredGuilds.size === guildIds.length) {
      ctx.commandsRegistered = true;
      ctx.logger?.info?.(
        `[security-bot] Alle Commands registriert: ${GUILD_COMMAND_NAMES.length} Server-Commands ` +
          `auf ${guildIds.length} Server(n) und /adminpanel global.`
      );
      return true;
    }
  }

  ctx.commandsRegistered = false;
  const missingGuilds = guildIds.filter((id) => !registeredGuilds.has(id));
  ctx.logger?.error?.(
    '[security-bot] Command-Registrierung nicht vollständig. ' +
      (missingGuilds.length ? `Fehlende Guilds: ${missingGuilds.join(', ')}. ` : '') +
      (!globalRegistered ? 'Globales /adminpanel fehlt.' : '')
  );
  return false;
}

/**
 * Liest nach der Registrierung bei Discord zurück und repariert fehlende
 * Sätze sofort. Das deckt auch den Fall ab, dass Discord einen früheren PUT
 * angenommen, aber einen leeren/veralteten Satz ausgeliefert hat.
 */
async function verifyCommandsLive(ctx) {
  const clientId = ctx.client?.user?.id;
  if (!clientId || !ctx.token) {
    ctx.commandsRegistered = false;
    return false;
  }

  const rest = getRest(ctx);
  const guildIds = cachedGuildIds(ctx);
  let guildsOk = true;

  for (const guildId of guildIds) {
    const route = Routes.applicationGuildCommands(clientId, guildId);
    try {
      const live = await rest.get(route);
      let ids = idsFromDiscord(live);
      if (!hasCommandNames(ids, GUILD_COMMAND_NAMES)) {
        const missing = GUILD_COMMAND_NAMES.filter((name) => !ids[name]);
        ctx.logger?.warn?.(
          `[security-bot] Command-Verifikation Guild ${guildId}: ` +
            `${missing.map((name) => `/${name}`).join(', ')} fehlen – registriere nach.`
        );
        ids = await registerGuildCommands(ctx, guildId, { rest });
      } else {
        rememberGuildIds(ctx, guildId, ids);
      }
      if (!hasCommandNames(ids, GUILD_COMMAND_NAMES)) guildsOk = false;
    } catch (err) {
      guildsOk = false;
      ctx.logger?.warn?.(
        `[security-bot] Command-Verifikation Guild ${guildId} fehlgeschlagen: ${errorDetail(err)}`
      );
    }
  }

  let globalOk = false;
  const globalRoute = Routes.applicationCommands(clientId);
  try {
    let live = await rest.get(globalRoute);
    let ids = idsFromDiscord(live);
    if (!hasCommandNames(ids, GLOBAL_COMMAND_NAMES) && guildsOk) {
      ctx.logger?.warn?.(
        '[security-bot] Command-Verifikation global: /adminpanel fehlt – registriere nach.'
      );
      live = await rest.put(globalRoute, { body: allCommandJson() });
      ids = idsFromDiscord(live);
    }
    globalOk = hasCommandNames(ids, GLOBAL_COMMAND_NAMES);
    if (globalOk) rememberGlobalIds(ctx, ids);
  } catch (err) {
    ctx.logger?.warn?.(
      `[security-bot] Globale Command-Verifikation fehlgeschlagen: ${errorDetail(err)}`
    );
  }

  const ok = guildsOk && globalOk;
  ctx.commandsRegistered = ok;
  if (ok) {
    ctx.logger?.info?.(
      `[security-bot] Command-Verifikation OK: alle ${GUILD_COMMAND_NAMES.length} Server-Commands ` +
        `auf ${guildIds.length} Server(n) und /adminpanel global sind live.`
    );
  } else {
    ctx.logger?.error?.(
      '[security-bot] Command-Verifikation fehlgeschlagen; die automatische Reparatur versucht es erneut.'
    );
  }
  return ok;
}

async function ensureCommandIds(ctx, guildId = null) {
  const gid = normalizeGuildId(guildId);
  const expected = gid ? GUILD_COMMAND_NAMES : GLOBAL_COMMAND_NAMES;
  const memoryIds = gid
    ? (ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(gid) : null)
    : ctx.commandIds;
  if (hasCommandNames(memoryIds, expected)) return memoryIds;

  const clientId = ctx.client?.user?.id;
  if (!clientId || !ctx.token) return memoryIds || {};

  try {
    const rest = getRest(ctx);
    const route = gid
      ? Routes.applicationGuildCommands(clientId, gid)
      : Routes.applicationCommands(clientId);
    let fetched = await rest.get(route);
    let ids = idsFromDiscord(fetched);

    if (!hasCommandNames(ids, expected)) {
      if (gid) {
        ids = await registerGuildCommands(ctx, gid, { rest });
      } else {
        fetched = await rest.put(route, { body: allCommandJson() });
        ids = idsFromDiscord(fetched);
        if (hasCommandNames(ids, expected)) rememberGlobalIds(ctx, ids);
      }
    } else if (gid) {
      rememberGuildIds(ctx, gid, ids);
    } else {
      rememberGlobalIds(ctx, ids);
    }
    return ids || {};
  } catch (err) {
    ctx.logger?.warn?.(`[security-bot] Command-IDs konnten nicht geladen/repariert werden: ${errorDetail(err)}`);
    return memoryIds || {};
  }
}

function commandMention(ctx, name, guildId = null) {
  let id = null;
  if (guildId && ctx.guildCommandIds instanceof Map) {
    id = ctx.guildCommandIds.get(String(guildId))?.[name] || null;
  }
  if (!id) id = ctx.commandIds?.[name] || null;
  return id ? `</${name}:${id}>` : `/${name}`;
}

/**
 * Chat-Input-Router für Slash-Commands.
 */
async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'set_api_key':
      return handleSetApiKey(ctx, interaction);
    case 'set_language':
      return handleSetLanguage(ctx, interaction);
    case 'set_sensitivity':
      return handleSetSensitivity(ctx, interaction);
    case 'configure_rules':
      return handleConfigureRules(ctx, interaction);
    case 'set_warnings':
      return handleSetWarnings(ctx, interaction);
    case 'status':
      return handleStatus(ctx, interaction);
    case 'manage_user':
      return handleManageUser(ctx, interaction);
    case 'test_text':
      return handleTestText(ctx, interaction);
    case 'admin_set_bot_profile':
      return handleSetProfile(ctx, interaction);
    case 'help':
      return handleHelp(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(
        componentsV2Payload([smallContainer(null, 'Unbekannter Befehl.')], { ephemeral: false })
      );
  }
}

// ----------------- Command Handlers -----------------

async function handleSetApiKey(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  const modal = new ModalBuilder()
    .setCustomId('sec_modal_api_key')
    .setTitle(t('apiKeyModalTitle', lang).slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sec_input_api_key')
          .setLabel(t('apiKeyInputLabel', lang).slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(t('apiKeyInputPlaceholder', lang).slice(0, 95))
          .setValue(cfg.openaiApiKey ? maskApiKey(cfg.openaiApiKey) : '')
          .setRequired(true)
      )
    );

  return interaction.showModal(modal);
}

async function handleSetLanguage(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const currentLang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', currentLang))], { ephemeral: false })
    );
  }

  const newLang = interaction.options.getString('language');
  if (!LANGS[newLang]) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, 'Ungültige Sprache.')], { ephemeral: false })
    );
  }

  cfg.lang = newLang;
  ctx.store.setGuild(cfg);
  await ctx.store.flush();

  const msg = t('langChanged', newLang, { name: LANGS[newLang].name });
  return interaction.reply(componentsV2Payload([smallContainer(null, msg)], { ephemeral: false }));
}

async function handleSetSensitivity(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  const preset = interaction.options.getString('preset');
  if (preset && PRESET_THRESHOLDS[preset] !== undefined) {
    cfg.sensitivity = preset;
    cfg.categoryThresholds = getDefaultThresholdMap(preset);
    ctx.store.setGuild(cfg);
    await ctx.store.flush();
  }

  const container = buildSensitivityContainer({ lang, guildConfig: cfg });
  return interaction.reply(componentsV2Payload([container], { ephemeral: false }));
}

async function handleConfigureRules(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  const container = buildRulesConfigContainer({ lang, guildConfig: cfg });
  return interaction.reply(componentsV2Payload([container], { ephemeral: false }));
}

async function handleSetWarnings(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  const maxOpt = interaction.options.getInteger('max_warnings');
  const expOpt = interaction.options.getInteger('expiry_days');
  const act1 = interaction.options.getString('action_1');
  const act2 = interaction.options.getString('action_2');
  const act3 = interaction.options.getString('action_3');
  const autoDelOpt = interaction.options.getBoolean('auto_delete');

  let mutated = false;
  if (maxOpt != null) {
    cfg.maxWarnings = maxOpt;
    mutated = true;
  }
  if (expOpt != null) {
    cfg.violationExpiryDays = expOpt;
    mutated = true;
  }
  if (autoDelOpt != null) {
    cfg.defaultAutoDelete = autoDelOpt;
    mutated = true;
  }

  if (act1 || act2 || act3) {
    const list = [...(cfg.warningActions || DEFAULT_WARNING_ESCALATION)];
    if (act1) {
      const idx = list.findIndex((e) => e.warning === 1);
      if (idx >= 0) list[idx] = { ...list[idx], action: act1 };
      else list.push({ warning: 1, action: act1, timeoutSeconds: 0 });
    }
    if (act2) {
      const idx = list.findIndex((e) => e.warning === 2);
      if (idx >= 0) list[idx] = { ...list[idx], action: act2 };
      else list.push({ warning: 2, action: act2, timeoutSeconds: 600 });
    }
    if (act3) {
      const idx = list.findIndex((e) => e.warning === 3);
      if (idx >= 0) list[idx] = { ...list[idx], action: act3 };
      else list.push({ warning: 3, action: act3, timeoutSeconds: 86400 });
    }
    cfg.warningActions = list;
    mutated = true;
  }

  if (mutated) {
    ctx.store.setGuild(cfg);
    await ctx.store.flush();
  }

  const container = buildWarningsConfigContainer({ lang, guildConfig: cfg });
  return interaction.reply(componentsV2Payload([container], { ephemeral: false }));
}

async function handleStatus(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  const activeViolations = ctx.store.getViolations(interaction.guildId, interaction.user.id, { activeOnly: true });
  const member = interaction.member;
  const isTimedOut = Boolean(
    member?.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now()
  );
  const timeoutUntil = isTimedOut ? new Date(member.communicationDisabledUntil).getTime() : null;

  const container = buildStatusContainer({
    lang,
    userId: interaction.user.id,
    activeViolations,
    maxWarnings: cfg.maxWarnings || 3,
    isTimedOut,
    timeoutUntil,
  });

  return interaction.reply(componentsV2Payload([container], { ephemeral: false }));
}

async function handleManageUser(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  const targetUser = interaction.options.getUser('user');
  if (!targetUser) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, 'Benutzer nicht gefunden.')], { ephemeral: false })
    );
  }

  const activeViolations = ctx.store.getViolations(interaction.guildId, targetUser.id, { activeOnly: true });
  const allViolations = ctx.store.getViolations(interaction.guildId, targetUser.id, { activeOnly: false });

  let member = null;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {}

  const isTimedOut = Boolean(
    member?.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now()
  );
  const timeoutUntil = isTimedOut ? new Date(member.communicationDisabledUntil).getTime() : null;

  const container = buildManageUserContainer({
    lang,
    targetUser,
    activeViolations,
    allViolations,
    maxWarnings: cfg.maxWarnings || 3,
    isTimedOut,
    timeoutUntil,
  });

  return interaction.reply(componentsV2Payload([container], { ephemeral: false }));
}

async function handleTestText(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  if (!cfg.openaiApiKey) {
    await ensureCommandIds(ctx, interaction.guildId);
    const setKeyMention = commandMention(ctx, 'set_api_key', interaction.guildId);
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, `⚠️ Kein OpenAI API Key hinterlegt. Bitte nutze ${setKeyMention}.`)],
        { ephemeral: false }
      )
    );
  }

  const textToTest = interaction.options.getString('text');
  await interaction.deferReply();

  const modRes = await callOpenAIModeration({
    apiKey: cfg.openaiApiKey,
    text: textToTest,
  });

  if (!modRes.ok) {
    return interaction.editReply(
      componentsV2Payload([
        smallContainer('❌ Test fehlgeschlagen', `OpenAI API Fehler: \`${modRes.error || modRes.message}\``),
      ])
    );
  }

  const evalRes = evaluateModerationResult({ data: modRes.data, guildConfig: cfg });
  const container = buildTestReportContainer({
    lang,
    text: textToTest,
    evalRes,
    guildConfig: cfg,
  });

  return interaction.editReply(componentsV2Payload([container]));
}

async function handleSetProfile(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

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
        if (!url) {
          return interaction.editReply(
            componentsV2Payload([smallContainer(null, t('errServerNoIcon', lang))])
          );
        }
      } else if (choice === 'owner') {
        const owner = await interaction.guild.fetchOwner();
        url =
          owner?.user?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true }) ||
          owner?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
      }
      if (!url) throw new Error('Bild-URL konnte nicht ermittelt werden.');

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Avatar konnte nicht geladen werden (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      const dataUri = `data:${ct};base64,${buffer.toString('base64')}`;

      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), { body: { avatar: dataUri } });
    }
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('profileSet', lang, { choice: label }))])
    );
  } catch (err) {
    const msg =
      err?.code === RESTJSONErrorCodes.MissingPermissions || err?.status === 403
        ? t('errAvatarPerms', lang)
        : t('errAvatar', lang, { error: err.message });
    return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
  }
}

async function handleHelp(ctx, interaction) {
  await ensureCommandIds(ctx, interaction.guildId);
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `# ${t('helpTitle', lang)}`,
        t('helpDesc', lang),
        '',
        `**${commandMention(ctx, 'set_api_key', interaction.guildId)}**\n${t('helpSetApiKey', lang)}`,
        '',
        `**${commandMention(ctx, 'set_language', interaction.guildId)}**\n${t('helpSetLanguage', lang)}`,
        '',
        `**${commandMention(ctx, 'set_sensitivity', interaction.guildId)}**\n${t('helpSetSensitivity', lang)}`,
        '',
        `**${commandMention(ctx, 'configure_rules', interaction.guildId)}**\n${t('helpConfigureRules', lang)}`,
        '',
        `**${commandMention(ctx, 'set_warnings', interaction.guildId)}**\n${t('helpSetWarnings', lang)}`,
        '',
        `**${commandMention(ctx, 'status', interaction.guildId)}**\n${t('helpStatus', lang)}`,
        '',
        `**${commandMention(ctx, 'manage_user', interaction.guildId)}**\n${t('helpManageUser', lang)}`,
        '',
        `**${commandMention(ctx, 'test_text', interaction.guildId)}**\n${t('helpTestText', lang)}`,
        '',
        `**${commandMention(ctx, 'admin_set_bot_profile', interaction.guildId)}**\n${t('helpSetProfile', lang)}`,
        '',
        `**${commandMention(ctx, 'help', interaction.guildId)}**\n${t('helpHelp', lang)}`,
      ].join('\n')
    )
  );

  return interaction.reply(componentsV2Payload([container]));
}

module.exports = {
  defineCommands,
  guildCommandJson,
  allCommandJson,
  registerCommands,
  registerGuildCommands,
  verifyCommandsLive,
  ensureCommandIds,
  handleChatInput,
  pick,
  commandMention,
  ALL_COMMAND_NAMES,
  GLOBAL_COMMAND_NAMES,
  GUILD_COMMAND_NAMES,
};
