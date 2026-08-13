/**
 * Slash-Commands des Self-Roles-Bots: Definition, Registrierung und
 * Chat-Input-Handler.
 *
 * Commands:
 *   /create_self_role [channel]  – Editor für eine neue Nachricht (Admins)
 *   /edit_self_role              – bestehende Nachricht bearbeiten (Admins)
 *   /admin_set_bot_profile       – Server-Profilbild des Bots (Admins)
 *   /help                        – Befehlsübersicht
 *   /adminpanel                  – Owner-Panel, nur im DM
 *
 * Beschreibungen sind in allen 10 Sprachen lokalisiert.
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
const {
  buildCreateModal,
  buildMessagePickerContainer,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');
const { isAdmin, botCanManageRoles } = require('./editor');
const { MAX_MESSAGES } = require('./logic');

/** Baut die Lokalisierungs-Map (Discord-Locale-Codes) für einen T-Key. */
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

  const profileChoices = ['standard', 'server', 'owner'].map((value) => ({
    name: t(`profileChoice${value[0].toUpperCase()}${value.slice(1)}`, 'de'),
    value,
    name_localizations: pick(`profileChoice${value[0].toUpperCase()}${value.slice(1)}`),
  }));

  return [
    new SlashCommandBuilder()
      .setName('create_self_role')
      .setDescription('Erstellt eine neue Self-Roles-Nachricht (nur Admins)')
      .setDescriptionLocalizations(pick('helpCreate'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kanal, in dem die Self-Roles-Nachricht landet')
          .setDescriptionLocalizations(pick('createChannelDesc'))
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('edit_self_role')
      .setDescription('Bearbeitet eine bestehende Self-Roles-Nachricht (nur Admins)')
      .setDescriptionLocalizations(pick('helpEdit'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('set_role_logging')
      .setDescription('Aktiviert oder deaktiviert private Benachrichtigungen bei Rollenänderungen (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetRoleLogging'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('status')
          .setNameLocalizations({
            de: 'auswahl',
            'en-US': 'selection',
            fr: 'choix',
            'es-ES': 'seleccion',
            'pt-BR': 'selecao',
            ru: 'выбор',
            ja: '選択',
            ko: '선택',
            'zh-CN': '选项',
            it: 'selezione',
          })
          .setDescription('Logging an- oder ausschalten (True/False)')
          .setDescriptionLocalizations(pick('setRoleLoggingStatusDesc'))
          .setRequired(true)
          .addChoices(
            {
              name: 'True',
              value: 'true',
              name_localizations: {
                de: 'True',
                'en-US': 'True',
                fr: 'True',
                'es-ES': 'True',
                'pt-BR': 'True',
                ru: 'True',
                ja: 'True',
                ko: 'True',
                'zh-CN': 'True',
                it: 'True',
              },
            },
            {
              name: 'False',
              value: 'false',
              name_localizations: {
                de: 'False',
                'en-US': 'False',
                fr: 'False',
                'es-ES': 'False',
                'pt-BR': 'False',
                ru: 'False',
                ja: 'False',
                ko: 'False',
                'zh-CN': 'False',
                it: 'False',
              },
            }
          )
      )
      .addStringOption((o) =>
        o
          .setName('language')
          .setNameLocalizations({
            de: 'sprache',
            'en-US': 'language',
            fr: 'langue',
            'es-ES': 'idioma',
            'pt-BR': 'idioma',
            ru: 'язык',
            ja: '言語',
            ko: '언어',
            'zh-CN': '语言',
            it: 'lingua',
          })
          .setDescription('Sprache für die Direktnachrichten (optional)')
          .setDescriptionLocalizations(pick('setRoleLoggingLangDesc'))
          .setRequired(false)
          .addChoices(...languageChoices)
      ),

    new SlashCommandBuilder()
      .setName('admin_set_bot_profile')
      .setDescription('Ändert das Profilbild des Bots auf diesem Server')
      .setDescriptionLocalizations(pick('helpSetProfile'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('image')
          .setDescription('Welches Bild soll verwendet werden?')
          .setDescriptionLocalizations(pick('profileImageDesc'))
          .setRequired(true)
          .addChoices(...profileChoices)
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zeigt alle Befehle an')
      .setDescriptionLocalizations(pick('helpHelp')),

    // Adminpanel: nur im Privatchat mit dem Bot-Owner.
    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM),
  ];
}

/** Registriert Guild-Commands direkt auf einem Server. */
async function registerGuildCommands(ctx, guildId, { rest } = {}) {
  const clientId = ctx.client?.user?.id;
  if (!clientId || !guildId) return null;
  const api = rest || new REST({ version: '10' }).setToken(ctx.token);
  const guildCmds = defineCommands()
    .filter((c) => c.name !== 'adminpanel')
    .map((c) => c.toJSON());
  try {
    const res = await api.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildCmds });
    ctx.logger?.info?.(`[self-roles-bot] Commands für Server ${guildId} registriert.`);
    return res;
  } catch (err) {
    ctx.logger?.warn?.(`[self-roles-bot] Guild-Commands für ${guildId} fehlgeschlagen: ${err.message}`);
    return null;
  }
}

/** Registriert die Commands global UND auf allen bestehenden Servern. */
async function registerCommands(ctx) {
  const commands = defineCommands().map((c) => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(ctx.token);
  const clientId = ctx.client.user.id;

  try {
    if (ctx.devGuildId) {
      const registered = await rest.put(Routes.applicationGuildCommands(clientId, ctx.devGuildId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((c) => [c.name, c.id]));
      ctx.logger.info(`[self-roles-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert.`);
    } else {
      const registered = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((c) => [c.name, c.id]));

      // Direkt auf jedem bestehenden Server als Guild-Commands registrieren,
      // damit neue Commands (wie /set_role_logging) sofort verfügbar sind!
      const guildCommands = defineCommands()
        .filter((c) => c.name !== 'adminpanel')
        .map((c) => c.toJSON());

      for (const guild of ctx.client.guilds.cache.values()) {
        await rest
          .put(Routes.applicationGuildCommands(clientId, guild.id), { body: guildCommands })
          .catch((err) => ctx.logger.warn(`[self-roles-bot] Guild-Commands für ${guild.id} fehlgeschlagen:`, err.message));
      }
      ctx.logger.info('[self-roles-bot] Commands global & auf allen bestehenden Servern registriert.');
    }
  } catch (err) {
    ctx.logger.error('[self-roles-bot] Command-Registrierung fehlgeschlagen:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'create_self_role':
      return createSelfRoleCmd(ctx, interaction);
    case 'edit_self_role':
      return editSelfRoleCmd(ctx, interaction);
    case 'set_role_logging':
      return setRoleLoggingCmd(ctx, interaction);
    case 'admin_set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', langFromDiscord(interaction.locale)))], {
          ephemeral: false,
        })
      );
  }
}

/** /set_role_logging [status: True | False] [language: optional] – nur für Admins */
async function setRoleLoggingCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  const rawChoice =
    interaction.options.getString('status') ??
    interaction.options.getString('auswahl') ??
    interaction.options.getString('selection') ??
    interaction.options.getString('logging') ??
    interaction.options.getString('state') ??
    interaction.options.getBoolean('status');

  const enabled =
    rawChoice === true ||
    rawChoice === 'true' ||
    String(rawChoice).toLowerCase() === 'true';

  const langChoice =
    interaction.options.getString('language') ??
    interaction.options.getString('sprache');

  const currentSettings = ctx.store.getGuildSettings(interaction.guildId);
  const loggingLang = langChoice && LANGS[langChoice] ? langChoice : (currentSettings.lang || lang || 'de');

  // Im Store & File-Fallback speichern
  ctx.store.setGuildSettings(interaction.guildId, {
    logging: enabled,
    lang: loggingLang,
  });

  // Alle bestehenden Nachrichten dieser Gilde aktualisieren, damit der unsichtbare Marker synchron ist
  void ctx.store.refreshGuild(interaction.guildId, { force: true }).catch(() => {});

  const langName = LANGS[loggingLang]?.name || loggingLang;
  const replyText = enabled
    ? t('setRoleLoggingEnabled', lang, { server: interaction.guild?.name || 'Server', lang: langName })
    : t('setRoleLoggingDisabled', lang, { server: interaction.guild?.name || 'Server' });

  return interaction.reply(
    componentsV2Payload([smallContainer(null, replyText)], { ephemeral: false })
  );
}

/** /create_self_role [channel] – öffnet das Formular. */
async function createSelfRoleCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }
  if (!ctx.store.hasCapacity(interaction.guildId)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errMaxMessages', lang))], { ephemeral: false }));
  }
  if (!botCanManageRoles(interaction.guild)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errBotPerms', lang))], { ephemeral: false }));
  }

  const channel = interaction.options.getChannel('channel');
  if (!channel?.isTextBased?.()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  }
  const me = interaction.guild?.members?.me;
  if (me && channel.permissionsFor?.(me)?.has(PermissionFlagsBits.SendMessages) === false) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  }

  return interaction.showModal(buildCreateModal(lang, channel.id));
}

/** /edit_self_role – Auswahl aller bestehenden Nachrichten. */
async function editSelfRoleCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  await interaction.deferReply();

  // Registry könnte nach einem Neustart leer sein → live nachscannen.
  let entries = ctx.store.list(interaction.guildId);
  if (!entries.length) {
    await ctx.store.scanGuild(interaction.guild).catch(() => {});
    entries = ctx.store.list(interaction.guildId);
  }

  if (!entries.length) {
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('editNoMessages', lang))]));
  }

  const items = entries.slice(0, MAX_MESSAGES).map((e) => ({
    channelId: e.channelId,
    messageId: e.messageId,
    title: e.title || '🎭',
    roleCount: e.roles?.length || 0,
    channelName: ctx.client.channels.cache.get(e.channelId)?.name || e.channelId,
  }));

  return interaction.editReply(componentsV2Payload([buildMessagePickerContainer({ lang, entries: items })]));
}

/** /admin_set_bot_profile [image: standard | server | owner] */
async function profileCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  await interaction.deferReply();
  const choice = interaction.options.getString('image');
  const label = t(`profileChoice${choice[0].toUpperCase()}${choice.slice(1)}`, lang);

  try {
    if (choice === 'standard') {
      // Standard = globales Bot-Profilbild → Guild-Member-Avatar zurücksetzen.
      // WICHTIG: Für Bots lautet die Route PATCH /guilds/{guild.id}/members/@me.
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), { body: { avatar: null } });
    } else {
      let url = null;
      if (choice === 'server') {
        url = interaction.guild.iconURL({ size: 256, extension: 'png', forceStatic: true });
        if (!url) {
          return interaction.editReply(componentsV2Payload([smallContainer(null, t('errServerNoIcon', lang))]));
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
      const contentType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      const avatarDataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), { body: { avatar: avatarDataUri } });
    }
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('profileSet', lang, { choice: label }))]));
  } catch (err) {
    const msg =
      err?.code === RESTJSONErrorCodes.MissingPermissions || err?.status === 403
        ? t('errAvatarPerms', lang)
        : t('errAvatar', lang, { error: err.message });
    return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
  }
}

function commandMention(ctx, name) {
  return ctx.commandIds?.[name] ? `</${name}:${ctx.commandIds[name]}>` : `/${name}`;
}

/** /help – Befehlsübersicht (ohne /adminpanel). */
async function helpCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `# ${t('helpTitle', lang)}`,
        t('helpDesc', lang),
        '',
        `**${commandMention(ctx, 'create_self_role')}**\n${t('helpCreate', lang)}`,
        '',
        `**${commandMention(ctx, 'edit_self_role')}**\n${t('helpEdit', lang)}`,
        '',
        `**${commandMention(ctx, 'set_role_logging')}**\n${t('helpSetRoleLogging', lang)}`,
        '',
        `**${commandMention(ctx, 'admin_set_bot_profile')}**\n${t('helpSetProfile', lang)}`,
        '',
        `**${commandMention(ctx, 'help')}**\n${t('helpHelp', lang)}`,
        '',
        t('helpFooter', lang),
        t('helpLanguageHint', lang),
      ].join('\n')
    )
  );

  return interaction.reply(componentsV2Payload([container]));
}

module.exports = { defineCommands, registerCommands, registerGuildCommands, handleChatInput, pick };
