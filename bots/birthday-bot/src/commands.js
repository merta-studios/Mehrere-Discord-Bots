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
  SeparatorBuilder,
  MessageFlags,
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
          .setDescription('Kanal für die Liste (optional, Standard: aktueller Kanal)')
          .setDescriptionLocalizations(pick('setupChannelDesc'))
          .addChannelTypes(ChannelType.GuildText)
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
      await rest.put(Routes.applicationGuildCommands(clientId, ctx.devGuildId), { body: commands });
      ctx.logger.info(`[birthday-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
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
    case 'admin_set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'admin_set_birthday':
      return adminSetCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply(
        componentsV2Payload([smallContainer(null, 'Unbekannter Befehl.')], { ephemeral: true })
      );
  }
}

/** /setup [language] [channel] – nur für Admins */
async function setupCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true })
    );
  }

  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const langChoice = interaction.options.getString('language');
  const lang = langChoice || 'en';

  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }

  if (!LANGS[lang]) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('setupLangBad', lang))], { ephemeral: true })
    );
  }

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel || !channel.isTextBased() || channel.type !== ChannelType.GuildText) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errChannelBad', lang))], { ephemeral: true })
    );
  }

  const botPerms = channel.permissionsFor(ctx.client.user);
  if (!botPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('errBotPerms', lang, { channel: `<#${channel.id}>` }))],
        { ephemeral: true }
      )
    );
  }

  // Acknowledge before network requests so Discord never shows a failed interaction.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Bestehende Liste suchen → Einträge übernehmen (Migration, Sprache neu).
  let birthdays = [];
  let migrated = false;
  const existing = await ctx.store.findListMessage(interaction.guild);
  if (existing) {
    const parsed = parseListEmbed(existing.message);
    if (parsed) birthdays = parsed.birthdays;
    migrated = true;
    await existing.message.delete().catch(() => {});
  }

  const container = buildListEmbed({ birthdays, lang });
  const msg = await channel.send(componentsV2Payload([container]));

  const today = todayKey(lang);
  ctx.store.set({
    guildId: interaction.guild.id,
    channelId: channel.id,
    messageId: msg.id,
    lang,
    birthdays,
    lastRenderDay: today,
    lastBirthdayCheckDay: today,
  });

  let desc = t('setupSuccess', lang, { channel: `<#${channel.id}>` });
  if (migrated) {
    desc += `\n\n${t('setupFoundOld', lang)}\n${t('setupMigrated', lang, { count: birthdays.length })}`;
  }
  return interaction.editReply(componentsV2Payload([smallContainer(null, desc)]));
}

/** /admin_set_bot_profile [image: standard | server | owner] */
async function profileCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true })
    );
  }
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const choice = interaction.options.getString('image');
  const label = t(`profileChoice${choice[0].toUpperCase()}${choice.slice(1)}`, lang);

  try {
    if (choice === 'standard') {
      // Standard = das globale Bot-Profilbild → Guild-Member-Avatar zurücksetzen
      await ctx.rest.patch(Routes.userGuildMember(interaction.guild.id), {
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
      // Discord REST API verlangt Data-URI (PATCH /users/@me/guilds/{guild.id}/member)
      const avatarDataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
      await ctx.rest.patch(Routes.userGuildMember(interaction.guild.id), {
        body: { avatar: avatarDataUri },
      });
    }
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('profileSet', lang, { choice: label }))])
    );
  } catch (err) {
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('errAvatar', lang, { error: err.message }))])
    );
  }
}

/** /admin_set_birthday [user] – nur Admins, ohne 7-Tage-Regel. */
async function adminSetCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true })
    );
  }
  const lang = ctx.store.get(interaction.guildId)?.lang || 'en';
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }

  const entry = ctx.store.get(interaction.guildId);
  if (!entry) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoList', lang))], { ephemeral: true })
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
          `**</setup:${interaction.commandId || 'setup'}>**\n${t('helpSetup', lang)}`,
          '',
          `**</admin_set_bot_profile:${interaction.commandId || 'admin_set_bot_profile'}>**\n${t('helpSetProfile', lang)}`,
          '',
          `**</admin_set_birthday:${interaction.commandId || 'admin_set_birthday'}>**\n${t('helpAdminSet', lang)}`,
          '',
          `**</help:${interaction.commandId || 'help'}>**\n${t('helpHelp', lang)}`,
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t('helpFooter', lang))
    );

  return interaction.reply(componentsV2Payload([container]));
}

module.exports = { defineCommands, registerCommands, handleChatInput, pick };
