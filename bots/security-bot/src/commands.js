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
    .map((c) => c.toJSON());
}

function allCommandJson() {
  return defineCommands()
    .filter((c) => GLOBAL_COMMAND_NAMES.includes(c.name))
    .map((c) => c.toJSON());
}

function idsFromDiscord(list) {
  return Object.fromEntries((Array.isArray(list) ? list : []).map((c) => [c.name, c.id]));
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
  }
  if (ctx.devGuildId) ids.add(String(ctx.devGuildId));
  return [...ids];
}

async function registerGuildCommands(ctx, guildId, { rest } = {}) {
  const clientId = ctx.client?.user?.id;
  const id = typeof guildId === 'string' ? guildId.trim().replace(/^<@!?(\d+)>$/, '$1') : null;
  if (!clientId || !id) return null;
  const api = rest || getRest(ctx);
  const route = Routes.applicationGuildCommands(clientId, id);
  const res = await api.put(route, { body: guildCommandJson() });
  const ids = idsFromDiscord(res);
  ctx.guildCommandIds = ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds : new Map();
  ctx.guildCommandIds.set(id, ids);
  ctx.store?.setGuildCommandIds?.(id, ids);
  return ids;
}

async function registerCommands(ctx, { restFactory } = {}) {
  const rest = getRest(ctx, restFactory);
  const clientId = ctx.client?.user?.id;
  if (!clientId) {
    ctx.logger?.error?.('[security-bot] Registrierung abgebrochen: Keine Client-ID.');
    return false;
  }

  try {
    const route = Routes.applicationCommands(clientId);
    const res = await rest.put(route, { body: allCommandJson() });
    const ids = idsFromDiscord(res);
    ctx.commandIds = ids;
    ctx.store?.setCommandIds?.(ids);
  } catch (err) {
    ctx.logger?.error?.('[security-bot] Globale Registrierung fehlgeschlagen:', err.message);
  }

  for (const guildId of cachedGuildIds(ctx)) {
    try {
      await registerGuildCommands(ctx, guildId, { rest });
    } catch (err) {
      ctx.logger?.warn?.(`[security-bot] Guild-Commands für ${guildId} fehlgeschlagen:`, err.message);
    }
  }
  return true;
}

async function ensureCommandIds(ctx, guildId = null) {
  const gid = guildId ? String(guildId) : null;
  const mem = gid
    ? (ctx.guildCommandIds instanceof Map ? ctx.guildCommandIds.get(gid) : null)
    : ctx.commandIds;
  if (mem && Object.keys(mem).length > 0) return mem;

  const clientId = ctx.client?.user?.id;
  if (clientId && ctx.token) {
    try {
      const rest = ctx.rest || getRest(ctx);
      if (gid) {
        const fetched = await rest.get(Routes.applicationGuildCommands(clientId, gid));
        const ids = idsFromDiscord(fetched);
        if (ctx.guildCommandIds instanceof Map) ctx.guildCommandIds.set(gid, ids);
        ctx.store?.setGuildCommandIds?.(gid, ids);
        return ids;
      }
      const fetched = await rest.get(Routes.applicationCommands(clientId));
      const ids = idsFromDiscord(fetched);
      ctx.commandIds = ids;
      ctx.store?.setCommandIds?.(ids);
      return ids;
    } catch {}
  }
  return {};
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
  registerCommands,
  registerGuildCommands,
  ensureCommandIds,
  handleChatInput,
  pick,
  commandMention,
  ALL_COMMAND_NAMES,
  GLOBAL_COMMAND_NAMES,
  GUILD_COMMAND_NAMES,
};
