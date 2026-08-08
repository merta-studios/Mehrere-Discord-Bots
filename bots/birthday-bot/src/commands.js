/**
 * Slash-Commands des Geburtstags-Bots: Definition, Registrierung
 * und Chat-Input-Handler.
 *
 * Commands: /setup, /set_bot_profile, /admin_set_birthday,
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
  EmbedBuilder,
} = require('discord.js');

const { LANGS, t, langFromDiscord, DISCORD_LOCALE } = require('./languages');
const { todayKey } = require('./logic');
const {
  buildListEmbed,
  listActionRow,
  parseListEmbed,
  smallEmbed,
  COLORS,
} = require('./embed-builder');
const { openPanel } = require('./admin-panel');

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
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kanal für die Liste (optional, Standard: aktueller Kanal)')
          .setDescriptionLocalizations(pick('setupChannelDesc'))
          .addChannelTypes(ChannelType.GuildText)
      )
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription('Sprache der Geburtstagsliste')
          .setDescriptionLocalizations(pick('setupLangDesc'))
          .setRequired(true)
          .addChoices(...languageChoices)
      ),

    new SlashCommandBuilder()
      .setName('set_bot_profile')
      .setDescription('Ändert das Profilbild des Bots auf diesem Server')
      .setDescriptionLocalizations(pick('helpSetProfile'))
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

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel')),
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
    case 'set_bot_profile':
      return profileCmd(ctx, interaction);
    case 'admin_set_birthday':
      return adminSetCmd(ctx, interaction);
    case 'help':
      return helpCmd(ctx, interaction);
    case 'adminpanel':
      return openPanel(ctx, interaction);
    default:
      return interaction.reply({ content: 'Unbekannter Befehl.', ephemeral: true });
  }
}

/** /setup [channel] [language] */
async function setupCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errGuildOnly', 'en'))],
      ephemeral: true,
    });
  }
  const lang = interaction.options.getString('language');
  if (!LANGS[lang]) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('setupLangBad', lang || 'en'))],
      ephemeral: true,
    });
  }

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel || !channel.isTextBased() || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errChannelBad', lang))],
      ephemeral: true,
    });
  }

  const perms = channel.permissionsFor(ctx.client.user);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errBotPerms', lang, { channel: `<#${channel.id}>` }))],
      ephemeral: true,
    });
  }

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

  const msg = await channel.send({
    embeds: [buildListEmbed({ birthdays, lang })],
    components: [listActionRow(lang)],
  });

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
  return interaction.reply({
    embeds: [smallEmbed(COLORS.success, null, desc)],
    ephemeral: true,
  });
}

/** /set_bot_profile [image: standard | server | owner] */
async function profileCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errGuildOnly', 'en'))],
      ephemeral: true,
    });
  }
  const choice = interaction.options.getString('image');
  const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  const label = t(`profileChoice${choice[0].toUpperCase()}${choice.slice(1)}`, lang);

  try {
    let avatarBase64 = null;
    if (choice === 'standard') {
      // Standard = das globale Bot-Profilbild → guild-avatar zurücksetzen.
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, ctx.client.user.id), {
        body: { avatar: null },
      });
    } else {
      let url = null;
      if (choice === 'server') {
        url = interaction.guild.iconURL({ size: 256, extension: 'png' });
        if (!url) {
          return interaction.reply({
            embeds: [smallEmbed(COLORS.error, null, t('errServerNoIcon', lang))],
            ephemeral: true,
          });
        }
      } else if (choice === 'owner') {
        const owner = await interaction.guild.fetchOwner();
        url = owner.displayAvatarURL({ size: 256, extension: 'png' });
      }
      const res = await fetch(url);
      const buffer = Buffer.from(await res.arrayBuffer());
      avatarBase64 = buffer.toString('base64');
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, ctx.client.user.id), {
        body: { avatar: avatarBase64 },
      });
    }
    return interaction.reply({
      embeds: [smallEmbed(COLORS.success, null, t('profileSet', lang, { choice: label }))],
      ephemeral: true,
    });
  } catch (err) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errAvatar', lang, { error: err.message }))],
      ephemeral: true,
    });
  }
}

/** /admin_set_birthday [user] – nur Admins, ohne 7-Tage-Regel. */
async function adminSetCmd(ctx, interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errGuildOnly', 'en'))],
      ephemeral: true,
    });
  }
  const lang = ctx.store.get(interaction.guildId)?.lang || 'en';
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errNoPermission', lang))],
      ephemeral: true,
    });
  }

  const entry = ctx.store.get(interaction.guildId);
  if (!entry) {
    return interaction.reply({
      embeds: [smallEmbed(COLORS.error, null, t('errNoList', lang))],
      ephemeral: true,
    });
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

/** /help */
async function helpCmd(ctx, interaction) {
  const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);

  const embed = new EmbedBuilder()
    .setColor(COLORS.help)
    .setTitle(t('helpTitle', lang))
    .setDescription(t('helpDesc', lang))
    .addFields(
      { name: '/setup', value: t('helpSetup', lang) },
      { name: '/set_bot_profile', value: t('helpSetProfile', lang) },
      { name: '/admin_set_birthday', value: t('helpAdminSet', lang) },
      { name: '/help', value: t('helpHelp', lang) },
      { name: '/adminpanel', value: t('helpAdminPanel', lang) }
    )
    .setFooter({ text: t('helpFooter', lang) });

  return interaction.reply({ embeds: [embed] });
}

module.exports = { defineCommands, registerCommands, handleChatInput, pick };
