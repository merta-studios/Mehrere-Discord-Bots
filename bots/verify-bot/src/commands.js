/**
 * Slash-Commands des Verify-Bots: Definition, Registrierung und
 * Chat-Input-Handler.
 *
 * Commands:
 *   /create_verify_rules [channel] [logging] [unverified] [verified]
 *   /create_classic_rules [channel]
 *   /set_verify_form [choice]
 *   /set_language [language]
 *   /admin_set_bot_profile [image]
 *   /help
 *   /adminpanel (nur DM)
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
  RESTJSONErrorCodes,
} = require('discord.js');

const { LANGS, t, langFromDiscord, DISCORD_LOCALE } = require('./languages');
const { buildCreateModal, smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');
const { isAdmin, updateEntryConfig, newFieldSession, showFieldEditor } = require('./editor');
const { MODE_VERIFY, MODE_CLASSIC, VF_NONE, VF_SIMPLE, VF_FORM } = require('./logic');

function pick(key) {
  const map = {};
  for (const code of Object.keys(LANGS)) {
    map[DISCORD_LOCALE[code]] = t(key, code);
  }
  return map;
}

function defineCommands() {
  const profileChoices = ['standard', 'server', 'owner'].map((value) => ({
    name: t(`profileChoice${value[0].toUpperCase()}${value.slice(1)}`, 'de'),
    value,
    name_localizations: pick(`profileChoice${value[0].toUpperCase()}${value.slice(1)}`),
  }));

  const verifyFormChoices = [
    { value: VF_NONE, name: t('vfChoiceNone', 'de'), name_localizations: pick('vfChoiceNone') },
    { value: VF_SIMPLE, name: t('vfChoiceSimple', 'de'), name_localizations: pick('vfChoiceSimple') },
    { value: VF_FORM, name: t('vfChoiceForm', 'de'), name_localizations: pick('vfChoiceForm') },
  ];

  const languageChoices = Object.keys(LANGS).map((code) => ({
    value: code,
    name: LANGS[code].name,
    name_localizations: LANGS[code].names,
  }));

  return [
    new SlashCommandBuilder()
      .setName('create_verify_rules')
      .setDescription('Erstellt eine Verify-Regel-Nachricht mit Button & Rollen (nur Admins)')
      .setDescriptionLocalizations(pick('helpCreateVerify'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kanal, in dem die Regeln landen')
          .setDescriptionLocalizations(pick('createChannelDesc'))
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName('logging_channel')
          .setDescription('Kanal, in dem Verifizierungen geloggt werden')
          .setDescriptionLocalizations(pick('createLoggingDesc'))
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addRoleOption((o) =>
        o
          .setName('unverified_role')
          .setDescription('Rolle für noch nicht verifizierte Nutzer')
          .setDescriptionLocalizations(pick('createUnverifiedDesc'))
          .setRequired(true)
      )
      .addRoleOption((o) =>
        o
          .setName('verified_role')
          .setDescription('Rolle für verifizierte Nutzer')
          .setDescriptionLocalizations(pick('createVerifiedDesc'))
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('create_classic_rules')
      .setDescription('Erstellt eine klassische Regel-Nachricht ohne Button (nur Admins)')
      .setDescriptionLocalizations(pick('helpCreateClassic'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kanal, in dem die Regeln landen')
          .setDescriptionLocalizations(pick('createChannelDesc'))
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('set_verify_form')
      .setDescription('Legt fest, wie verifiziert wird (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetVerifyForm'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('auswahl')
          .setDescription('Wie soll verifiziert werden?')
          .setDescriptionLocalizations(pick('setVerifyFormDesc'))
          .setRequired(true)
          .addChoices(...verifyFormChoices)
      ),

    new SlashCommandBuilder()
      .setName('set_language')
      .setDescription('Stellt die Sprache des Bots auf diesem Server ein (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetLanguage'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('sprache')
          .setDescription('Welche Sprache soll der Bot sprechen?')
          .setDescriptionLocalizations(pick('setLanguageDesc'))
          .setRequired(true)
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

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM),
  ];
}

/** Registriert die Commands global (oder in einer Dev-Gilde). */
async function registerCommands(ctx) {
  const commands = defineCommands().map((c) => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(ctx.token);
  const clientId = ctx.client.user.id;

  try {
    if (ctx.devGuildId) {
      const registered = await rest.put(Routes.applicationGuildCommands(clientId, ctx.devGuildId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((c) => [c.name, c.id]));
      ctx.logger.info(`[verify-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert.`);
    } else {
      const registered = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((c) => [c.name, c.id]));
      for (const guild of ctx.client.guilds.cache.values()) {
        await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] }).catch(() => {});
      }
      ctx.logger.info('[verify-bot] Commands global registriert (bis zu 1h bis überall sichtbar).');
    }
  } catch (err) {
    ctx.logger.error('[verify-bot] Command-Registrierung fehlgeschlagen:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'create_verify_rules':
      return createRulesCmd(ctx, interaction, MODE_VERIFY);
    case 'create_classic_rules':
      return createRulesCmd(ctx, interaction, MODE_CLASSIC);
    case 'set_verify_form':
      return setVerifyFormCmd(ctx, interaction);
    case 'set_language':
      return setLanguageCmd(ctx, interaction);
    case 'admin_set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', langFromDiscord(interaction.locale)))])
      );
  }
}

/** Gemeinsamer Handler für /create_verify_rules & /create_classic_rules. */
async function createRulesCmd(ctx, interaction, mode) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  const channel = interaction.options.getChannel('channel');
  if (!channel?.isTextBased?.()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  }
  const me = interaction.guild?.members?.me;
  if (me && channel.permissionsFor?.(me)?.has(PermissionFlagsBits.SendMessages) === false) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  }

  let loggingChannelId = '';
  let unverifiedRoleId = '';
  let verifiedRoleId = '';

  if (mode === MODE_VERIFY) {
    const loggingChannel = interaction.options.getChannel('logging_channel');
    const unverifiedRole = interaction.options.getRole('unverified_role');
    const verifiedRole = interaction.options.getRole('verified_role');

    if (!loggingChannel?.isTextBased?.()) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
    }
    if (!unverifiedRole || !verifiedRole) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('errRolesMissing', lang))], { ephemeral: false }));
    }
    loggingChannelId = loggingChannel.id;
    unverifiedRoleId = unverifiedRole.id;
    verifiedRoleId = verifiedRole.id;
  }

  // Falls schon Regeln existieren: Inhalt vorbefüllen (zum Bearbeiten).
  let prefill = {};
  const entries = ctx.store.list(interaction.guildId);
  if (entries.length) {
    const existing = entries[0];
    prefill = { rules: existing.rules || '', buttonName: existing.buttonName || '' };
  }

  const modal = buildCreateModal(lang, mode === MODE_CLASSIC ? 'classic' : 'verify', channel.id, prefill);

  // Modal-Custom-ID hält nur den Kanal; die übrigen Optionen merken wir uns
  // in einer kurzlebigen Pending-Map (die Modal-Interaktion überliefert nur
  // die Custom-ID + Texteingaben).
  ctx.createOpts.set(`${interaction.user.id}`, {
    mode,
    channelId: channel.id,
    loggingChannelId,
    unverifiedRoleId,
    verifiedRoleId,
  });

  return interaction.showModal(modal);
}

/** /set_verify_form [auswahl] */
async function setVerifyFormCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  await interaction.deferReply();

  let verifyEntries = ctx.store.verifyMessages(interaction.guildId);
  if (!verifyEntries.length) {
    await ctx.store.scanGuild(interaction.guild).catch(() => {});
    verifyEntries = ctx.store.verifyMessages(interaction.guildId);
  }
  if (!verifyEntries.length) {
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('vfNeedVerify', lang))]));
  }

  const choice = interaction.options.getString('auswahl');

  // Formular-Modus → Formular-Editor öffnen (Felder konfigurieren).
  if (choice === VF_FORM) {
    const existingFields = verifyEntries[0]?.formFields?.length ? verifyEntries[0].formFields : [];
    const session = newFieldSession({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      lang,
      fields: existingFields.map((f) => ({ ...f })),
    });
    ctx.sessions.put(session);
    return showFieldEditor(ctx, interaction, session, { update: false });
  }

  const verifyForm = choice === VF_SIMPLE ? VF_SIMPLE : VF_NONE;
  let ok = 0;
  for (const entry of verifyEntries) {
    const updated = await updateEntryConfig(ctx, interaction.guild, entry, { verifyForm, formFields: [] });
    if (updated) ok += 1;
  }

  const modeLabel =
    verifyForm === VF_SIMPLE ? t('vfChoiceSimple', lang) : verifyForm === VF_FORM ? t('vfChoiceForm', lang) : t('vfChoiceNone', lang);
  return interaction.editReply(
    componentsV2Payload([smallContainer(null, t('vfUpdated', lang, { mode: modeLabel }))], { ephemeral: false })
  );
}

/** /set_language [sprache] */
async function setLanguageCmd(ctx, interaction) {
  const lang = langFromDiscord(interaction.locale);

  if (!interaction.inGuild()) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', lang))], { ephemeral: false }));
  }
  if (!isAdmin(interaction)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  }

  await interaction.deferReply();

  const newLang = interaction.options.getString('sprache');
  ctx.store.setServerLang(interaction.guildId, newLang);

  // Sprache auch in alle bestehenden Nachrichten schreiben (die sind die DB).
  let entries = ctx.store.list(interaction.guildId);
  if (!entries.length) {
    await ctx.store.scanGuild(interaction.guild).catch(() => {});
    entries = ctx.store.list(interaction.guildId);
  }
  for (const entry of entries) {
    await updateEntryConfig(ctx, interaction.guild, entry, { lang: newLang });
  }

  return interaction.editReply(
    componentsV2Payload([smallContainer(null, t('setLangUpdated', lang, { lang: LANGS[newLang]?.flag ? `${LANGS[newLang].flag} ${LANGS[newLang].name}` : newLang }))], { ephemeral: false })
  );
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
        `**${commandMention(ctx, 'create_verify_rules')}**\n${t('helpCreateVerify', lang)}`,
        '',
        `**${commandMention(ctx, 'create_classic_rules')}**\n${t('helpCreateClassic', lang)}`,
        '',
        `**${commandMention(ctx, 'set_verify_form')}**\n${t('helpSetVerifyForm', lang)}`,
        '',
        `**${commandMention(ctx, 'set_language')}**\n${t('helpSetLanguage', lang)}`,
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

module.exports = { defineCommands, registerCommands, handleChatInput, pick };
