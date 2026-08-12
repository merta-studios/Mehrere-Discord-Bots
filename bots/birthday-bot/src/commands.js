/**
 * Slash-Commands des Geburtstags-Bots: Definition, Registrierung
 * und Chat-Input-Handler.
 *
 * Commands: /setup, /admin_set_bot_profile, /admin_set_birthday,
 *           /help, /adminpanel
 *
 * Beschreibungen sind in allen 10 Sprachen lokalisiert – jeder Nutzer
 * sieht Discord in seiner eigenen Sprache.
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
const { todayKey } = require('./logic');
const {
  buildListEmbed,
  listActionRow,
  parseListEmbed,
  smallContainer,
} = require('./embed-builder');
const { openPanel } = require('./admin-panel');
const { componentsV2Payload } = require('./message-payload');

/** Baut die Lokalisierungs-Map (Discord-Locale-Codes) für ein T-Key. */
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
      .setName('setup')
      .setDescription('Richtet die Geburtstagsliste ein (Channel + Sprache)')
      .setDescriptionLocalizations(pick('helpSetup'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription('Sprache der Geburtstagsliste')
          .setDescriptionLocalizations(pick('setupLangDesc'))
          .setRequired(true)
          .addChoices(...languageChoices)
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Pflichtfeld: Kanal, in dem die Geburtstagsliste angezeigt wird')
          .setDescriptionLocalizations(pick('setupChannelDesc'))
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addRoleOption((o) =>
        o
          .setName('birthday_role')
          .setDescription('Geburtstagsrolle: bekommt das Geburtstagskind 24h (optional)')
          .setDescriptionLocalizations(pick('setupRoleDesc'))
      ),

    // Einzel-Config-Befehle: jeweils nur eine der Einstellungen ändern,
    // nur für Admins und nur wenn die Liste bereits über /setup existiert.
    new SlashCommandBuilder()
      .setName('set_language')
      .setDescription('Ändert die Sprache der bestehenden Geburtstagsliste (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetLanguage'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription('Sprache der Geburtstagsliste')
          .setDescriptionLocalizations(pick('setupLangDesc'))
          .setRequired(true)
          .addChoices(...languageChoices)
      ),

    new SlashCommandBuilder()
      .setName('set_channel')
      .setDescription('Verschiebt die bestehende Geburtstagsliste in einen anderen Kanal (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetChannel'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kanal, in dem die Geburtstagsliste angezeigt wird')
          .setDescriptionLocalizations(pick('setupChannelDesc'))
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('set_birthday_role')
      .setDescription('Legt die Geburtstagsrolle der bestehenden Liste fest (nur Admins)')
      .setDescriptionLocalizations(pick('helpSetBirthdayRole'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption((o) =>
        o
          .setName('birthday_role')
          .setDescription('Geburtstagsrolle: bekommt das Geburtstagskind 24h')
          .setDescriptionLocalizations(pick('setupRoleDesc'))
          .setRequired(true)
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
      .setName('admin_set_birthday')
      .setDescription('Setzt den Geburtstag eines anderen Nutzers (nur Admins)')
      .setDescriptionLocalizations(pick('helpAdminSet'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) =>
        o
          .setName('user')
          .setDescription('Der Nutzer, dessen Geburtstag gesetzt wird')
          .setDescriptionLocalizations(pick('adminSetUserDesc'))
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('event')
      .setDescription('Erstellt oder löscht ein Event (nur Admins)')
      .setDescriptionLocalizations(pick('helpEvent'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Was soll passieren? create oder delete')
          .setDescriptionLocalizations(pick('eventActionDesc'))
          .setRequired(true)
          .addChoices(
            { name: 'create', value: 'create' },
            { name: 'delete', value: 'delete' }
          )
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zeigt alle Befehle an')
      .setDescriptionLocalizations(pick('helpHelp')),

    // Adminpanel ist nur im Privatchat (BotDM) mit dem Bot-Owner verfügbar und
    // wird in Server-Kanälen gar nicht erst zur Auswahl angeboten.
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
      ctx.logger.info(`[birthday-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert.`);
    } else {
      const registered = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((c) => [c.name, c.id]));
      // Alte Guild-Commands (z. B. aus der Dev-Phase) aufräumen.
      for (const guild of ctx.client.guilds.cache.values()) {
        await rest
          .put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] })
          .catch(() => {});
      }
      ctx.logger.info('[birthday-bot] Commands global registriert (bis zu 1h bis überall sichtbar).');
    }
  } catch (err) {
    ctx.logger.error('[birthday-bot] Command-Registrierung fehlgeschlagen:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'setup':
      return setupCmd(ctx, interaction);
    case 'set_language':
      return setLanguageCmd(ctx, interaction);
    case 'set_channel':
      return setChannelCmd(ctx, interaction);
    case 'set_birthday_role':
      return setBirthdayRoleCmd(ctx, interaction);
    case 'admin_set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'admin_set_birthday':
      return adminSetCmd(ctx, interaction);
    case 'event':
      return eventCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(
        componentsV2Payload([smallContainer(null, 'Unbekannter Befehl.')], { ephemeral: false })
      );
  }
}

/** /setup [language] [channel] – nur für Admins */
async function setupCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }

  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const langChoice = interaction.options.getString('language');
  const lang = langChoice || 'en';

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  if (!LANGS[lang]) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('setupLangBad', lang))], { ephemeral: false })
    );
  }

  const channel = interaction.options.getChannel('channel');
  if (!channel || !channel.isTextBased() || channel.type !== ChannelType.GuildText) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false })
    );
  }

  const botPerms = channel.permissionsFor(ctx.client.user);
  if (!botPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('errBotPerms', lang, { channel: `<#${channel.id}>` }))],
        { ephemeral: false }
      )
    );
  }

  // Acknowledge before network requests so Discord never shows a failed interaction.
  await interaction.deferReply();

  // Optionale Geburtstagsrolle: bekommt das Geburtstagskind für 24 Stunden.
  // Wird sie weggelassen, bleibt eine zuvor gewählte Rolle erhalten.
  const role = interaction.options.getRole?.('birthday_role') || null;
  if (role) {
    if (role.managed || role.id === interaction.guild.id) {
      return interaction.editReply(componentsV2Payload([smallContainer(null, t('errRoleBad', lang))]));
    }
    const me = interaction.guild.members?.me;
    if (me) {
      const canManage = me.permissions?.has(PermissionFlagsBits.ManageRoles);
      const above = (me.roles?.highest?.position ?? 0) > (role.position ?? 0);
      if (!canManage || !above) {
        return interaction.editReply(componentsV2Payload([smallContainer(null, t('errRoleBad', lang))]));
      }
    }
  }

  // Bestehende Liste suchen → Einträge + Events + Rolle übernehmen (Migration, Sprache neu).
  let birthdays = [];
  let events = [];
  let oldRoleId = null;
  let migrated = false;
  const existing = await ctx.store.findListMessage(interaction.guild);
  if (existing) {
    const parsed = parseListEmbed(existing.message);
    if (parsed) {
      birthdays = parsed.birthdays;
      events = parsed.events || [];
      oldRoleId = parsed.birthdayRoleId || null;
    }
    migrated = true;
    await existing.message.delete().catch(() => {});
  }
  const birthdayRoleId = role ? role.id : oldRoleId;

  const container = buildListEmbed({ birthdays, events, lang, birthdayRoleId });
  const msg = await channel.send(componentsV2Payload([container]));

  const today = todayKey(lang);
  ctx.store.set({
    guildId: interaction.guild.id,
    channelId: channel.id,
    messageId: msg.id,
    lang,
    birthdays,
    events,
    birthdayRoleId,
    lastRenderDay: today,
    lastBirthdayCheckDay: today,
  });

  let desc = t('setupSuccess', lang, { channel: `<#${channel.id}>` });
  if (birthdayRoleId) desc += `\n\n${t('setupRoleSet', lang, { role: `<@&${birthdayRoleId}>` })}`;
  if (migrated) {
    desc += `\n\n${t('setupFoundOld', lang)}\n${t('setupMigrated', lang, { count: birthdays.length })}`;
  }
  return interaction.editReply(componentsV2Payload([smallContainer(null, desc)]));
}

async function updateListConfig(ctx, interaction, changes) {
  if (!interaction.inGuild()) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false }));
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false }));
  if (!entry) return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoList', lang))], { ephemeral: false }));
  const channel = changes.channel || await ctx.client.channels.fetch(entry.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.type !== ChannelType.GuildText) return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: false }));
  const botPerms = channel.permissionsFor(ctx.client.user);
  if (!botPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return interaction.reply(componentsV2Payload([smallContainer(null, t('errBotPerms', lang, { channel: `<#${channel.id}>` }))], { ephemeral: false }));
  const oldChannel = await ctx.client.channels.fetch(entry.channelId).catch(() => null);
  const oldMsg = oldChannel?.messages ? await oldChannel.messages.fetch(entry.messageId).catch(() => null) : null;
  const parsed = oldMsg ? parseListEmbed(oldMsg) : { birthdays: entry.birthdays || [], events: entry.events || [], birthdayRoleId: entry.birthdayRoleId || null };
  const next = { ...entry, channelId: channel.id, lang: changes.lang || entry.lang, birthdays: parsed.birthdays, events: parsed.events || [], birthdayRoleId: changes.birthdayRoleId ?? parsed.birthdayRoleId ?? null };
  const container = buildListEmbed({ birthdays: next.birthdays, events: next.events, lang: next.lang, birthdayRoleId: next.birthdayRoleId });
  await interaction.deferReply();
  const msg = await channel.send(componentsV2Payload([container]));
  if (oldMsg) await oldMsg.delete().catch(() => {});
  next.messageId = msg.id;
  next.lastRenderDay = todayKey(next.lang); next.lastBirthdayCheckDay = entry.lastBirthdayCheckDay;
  ctx.store.set(next);
  return interaction.editReply(componentsV2Payload([smallContainer(null, t('setupSuccess', next.lang, { channel: `<#${channel.id}>` }))]));
}
async function setLanguageCmd(ctx, interaction) { const lang = interaction.options.getString('language'); return updateListConfig(ctx, interaction, { lang }); }
async function setChannelCmd(ctx, interaction) { const channel = interaction.options.getChannel('channel'); return updateListConfig(ctx, interaction, { channel }); }
async function setBirthdayRoleCmd(ctx, interaction) {
  const role = interaction.options.getRole('birthday_role');
  if (!role || role.managed || role.id === interaction.guildId) return interaction.reply(componentsV2Payload([smallContainer(null, t('errRoleBad', 'de'))], { ephemeral: false }));
  const me = interaction.guild?.members?.me;
  if (me && (!me.permissions?.has(PermissionFlagsBits.ManageRoles) || (me.roles?.highest?.position ?? 0) <= (role.position ?? 0))) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errRoleBad', 'de'))], { ephemeral: false }));
  }
  return updateListConfig(ctx, interaction, { birthdayRoleId: role.id });
}

/**
 * /event [action: create|delete] – nur für Admins.
 * create öffnet das Formular (Name + Tag + Monat, jedes Datum erlaubt),
 * delete öffnet ein Auswahlmenü der eingetragenen Events.
 */
async function eventCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }
  if (!entry) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoList', lang))], { ephemeral: false })
    );
  }

  const action = interaction.options.getString('action');
  if (action === 'create') {
    const { buildEventModal } = require('./embed-builder');
    return interaction.showModal(buildEventModal(entry.lang));
  }
  if (action === 'delete') {
    const events = entry.events || [];
    if (!events.length) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('eventNoEvents', lang))], { ephemeral: false })
      );
    }
    const { buildEventDeleteEmbed } = require('./embed-builder');
    return interaction.reply(
      componentsV2Payload([buildEventDeleteEmbed({ lang, events })], { ephemeral: false })
    );
  }
  return interaction.reply(
    componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: false })
  );
}

/** /admin_set_bot_profile [image: standard | server | owner] */
async function profileCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
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
      // Standard = das globale Bot-Profilbild → Guild-Member-Avatar zurücksetzen.
      // WICHTIG: Für Bots lautet die Route PATCH /guilds/{guild.id}/members/@me
      // ("Modify Current Member"). PATCH /users/@me/guilds/{guild.id}/member ist
      // nur für OAuth2-User-Tokens gedacht und liefert für Bots 405 Method Not Allowed.
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), {
        body: { avatar: null },
      });
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
      const contentType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      // Serverseitiges Bot-Profilbild: Discord REST API verlangt einen Data-URI
      // via PATCH /guilds/{guild.id}/members/@me (unterstützt Avatar/Banner für
      // Bots seit dem API-Changelog vom 27.09.2022 – Guild-Member-Avatare für Bots).
      const avatarDataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), {
        body: { avatar: avatarDataUri },
      });
    }
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('profileSet', lang, { choice: label }))])
    );
  } catch (err) {
    // 50013 Missing Permissions → dem Bot fehlt z. B. „Nickname ändern“
    const msg =
      err?.code === RESTJSONErrorCodes.MissingPermissions || err?.status === 403
        ? t('errAvatarPerms', lang)
        : t('errAvatar', lang, { error: err.message });
    return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
  }
}

/** /admin_set_birthday [user] – nur Admins, ohne 7-Tage-Regel. */
async function adminSetCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: false })
    );
  }
  const lang = ctx.store.get(interaction.guildId)?.lang || 'en';
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: false })
    );
  }

  const entry = ctx.store.get(interaction.guildId);
  if (!entry) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoList', lang))], { ephemeral: false })
    );
  }

  const target = interaction.options.getUser('user');
  const modalLang = entry.lang;

  ctx.pendingAdmin.set(interaction.user.id, {
    targetId: target.id,
    guildId: interaction.guild.id,
  });

  const { buildAdminModal } = require('./embed-builder');
  return interaction.showModal(buildAdminModal(modalLang, target.username));
}

function commandMention(ctx, name) { return ctx.commandIds?.[name] ? `</${name}:${ctx.commandIds[name]}>` : `/${name}`; }

/** /help – Befehlsübersicht (ohne /adminpanel, da dieses nur für den Owner im DM bestimmt ist) */
async function helpCmd(ctx, interaction) {
  const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `# ${t('helpTitle', lang)}`,
          t('helpDesc', lang),
          '',
          `**${commandMention(ctx, 'setup')}**\n${t('helpSetup', lang)}`,
          '',
          `**${commandMention(ctx, 'set_language')}**\n${t('helpSetLanguage', lang)}`,
          '',
          `**${commandMention(ctx, 'set_channel')}**\n${t('helpSetChannel', lang)}`,
          '',
          `**${commandMention(ctx, 'set_birthday_role')}**\n${t('helpSetBirthdayRole', lang)}`,
          '',
          `**${commandMention(ctx, 'event')}**\n${t('helpEvent', lang)}`,
          '',
          `**${commandMention(ctx, 'admin_set_bot_profile')}**\n${t('helpSetProfile', lang)}`,
          '',
          `**${commandMention(ctx, 'admin_set_birthday')}**\n${t('helpAdminSet', lang)}`,
          '',
          `**${commandMention(ctx, 'help')}**\n${t('helpHelp', lang)}`,
        ].join('\n')
      )
    );

  return interaction.reply(componentsV2Payload([container]));
}

module.exports = { defineCommands, registerCommands, handleChatInput, pick };
