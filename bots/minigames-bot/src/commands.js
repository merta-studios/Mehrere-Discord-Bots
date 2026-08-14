/** Slash-Commands des Minigames-Bots. */

const {
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  RESTJSONErrorCodes,
} = require('discord.js');

const { LANGS, DISCORD_LOCALE, t, langFromDiscord } = require('./languages');
const { GAME_TTT, GAME_CONNECT4, createChallenge } = require('./games');
const {
  buildGamePayload,
  buildLanguageContainer,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');

function pick(key) {
  return Object.fromEntries(
    Object.keys(LANGS).map((code) => [DISCORD_LOCALE[code], t(key, code)])
  );
}

function localizedLanguageChoices() {
  return Object.keys(LANGS).map((code) => ({
    value: code,
    name: LANGS[code].name,
    name_localizations: Object.fromEntries(
      Object.entries(LANGS[code].names).map(([lang, name]) => [DISCORD_LOCALE[lang], name])
    ),
  }));
}

function localizedGameChoice(value, key) {
  return { name: t(key, 'de'), value, name_localizations: pick(key) };
}

function defineCommands() {
  const profileChoices = ['standard', 'server', 'owner'].map((value) => {
    const suffix = value[0].toUpperCase() + value.slice(1);
    return {
      name: t(`profileChoice${suffix}`, 'de'),
      value,
      name_localizations: pick(`profileChoice${suffix}`),
    };
  });

  return [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription(t('cmdPlayDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdPlayDesc'))
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('game')
          .setDescription(t('playGameDesc', 'de'))
          .setDescriptionLocalizations(pick('playGameDesc'))
          .setRequired(true)
          .addChoices(
            localizedGameChoice(GAME_TTT, 'gameTtt'),
            localizedGameChoice(GAME_CONNECT4, 'gameConnect4')
          )
      )
      .addUserOption((option) =>
        option
          .setName('gegner')
          .setNameLocalizations({
            'en-US': 'opponent', fr: 'adversaire', 'es-ES': 'oponente', 'pt-BR': 'adversario',
            ru: 'соперник', ja: 'あいて', ko: '상대', 'zh-CN': '对手', it: 'avversario',
          })
          .setDescription(t('playOpponentDesc', 'de'))
          .setDescriptionLocalizations(pick('playOpponentDesc'))
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('set_language')
      .setDescription(t('cmdSetLanguageDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdSetLanguageDesc'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('sprache')
          .setNameLocalizations({
            'en-US': 'language', fr: 'langue', 'es-ES': 'idioma', 'pt-BR': 'idioma',
            ru: 'язык', ja: 'げんご', ko: '언어', 'zh-CN': '语言', it: 'lingua',
          })
          .setDescription(t('setLanguageDesc', 'de'))
          .setDescriptionLocalizations(pick('setLanguageDesc'))
          .setRequired(true)
          .addChoices(...localizedLanguageChoices())
      ),

    new SlashCommandBuilder()
      .setName('set_counting_channel')
      .setDescription(t('cmdCountingDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdCountingDesc'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setNameLocalizations({
            de: 'kanal', fr: 'salon', 'es-ES': 'canal', 'pt-BR': 'canal',
            ru: 'канал', ja: 'チャンネル', ko: '채널', 'zh-CN': '频道', it: 'canale',
          })
          .setDescription(t('countingChannelDesc', 'de'))
          .setDescriptionLocalizations(pick('countingChannelDesc'))
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addBooleanOption((option) =>
        option
          .setName('aktiv')
          .setNameLocalizations({
            'en-US': 'active', fr: 'actif', 'es-ES': 'activo', 'pt-BR': 'ativo',
            ru: 'активно', ja: 'ゆうこう', ko: '활성', 'zh-CN': '启用', it: 'attivo',
          })
          .setDescription(t('countingActiveDesc', 'de'))
          .setDescriptionLocalizations(pick('countingActiveDesc'))
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('admin_set_bot_profile')
      .setDescription(t('cmdProfileDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdProfileDesc'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('image')
          .setDescription(t('profileImageDesc', 'de'))
          .setDescriptionLocalizations(pick('profileImageDesc'))
          .setRequired(true)
          .addChoices(...profileChoices)
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription(t('cmdHelpDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdHelpDesc')),

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription(t('cmdAdminPanelDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdAdminPanelDesc'))
      .setContexts(InteractionContextType.BotDM),
  ];
}

async function registerCommands(ctx) {
  const commands = defineCommands().map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(ctx.token);
  const clientId = ctx.client.user.id;

  try {
    if (ctx.devGuildId) {
      const registered = await rest.put(Routes.applicationGuildCommands(clientId, ctx.devGuildId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((command) => [command.name, command.id]));
      // Im Dev-Modus sollen alte globale Verify-Commands nicht parallel
      // sichtbar bleiben. Die gewünschten Commands leben hier nur in der Dev-Gilde.
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      ctx.logger.info(`[minigames-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert.`);
    } else {
      const registered = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      ctx.commandIds = Object.fromEntries((registered || []).map((command) => [command.name, command.id]));
      for (const guild of ctx.client.guilds.cache.values()) {
        await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] }).catch(() => {});
      }
      ctx.logger.info('[minigames-bot] Commands global registriert (bis zu 1h bis überall sichtbar).');
    }
  } catch (err) {
    ctx.logger.error('[minigames-bot] Command-Registrierung fehlgeschlagen:', err.message);
  }
}

function configuredLang(ctx, interaction) {
  return (
    (interaction.guildId && ctx.store.getServerLang(interaction.guildId)) ||
    langFromDiscord(interaction.guildLocale || interaction.locale)
  );
}

function isAdmin(interaction) {
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator));
}

function privateReply(interaction, text, lang) {
  return interaction.reply(
    componentsV2Payload([smallContainer(null, text)], { ephemeral: true, allowedMentions: { parse: [] } })
  );
}

async function handleChatInput(ctx, interaction) {
  switch (interaction.commandName) {
    case 'play': return playCmd(ctx, interaction);
    case 'set_language': return setLanguageCmd(ctx, interaction);
    case 'set_counting_channel': return setCountingChannelCmd(ctx, interaction);
    case 'admin_set_bot_profile': return profileCmd(ctx, interaction);
    case 'help': return helpCmd(ctx, interaction);
    case 'adminpanel': return openPanel(ctx, interaction);
    default: return privateReply(interaction, t('errGeneric', configuredLang(ctx, interaction)));
  }
}

async function playCmd(ctx, interaction) {
  const lang = configuredLang(ctx, interaction);
  if (!interaction.inGuild()) return privateReply(interaction, t('errGuildOnly', lang), lang);

  const game = interaction.options.getString('game');
  // Der Gegner ist optional: ohne Angabe entsteht eine offene Herausforderung,
  // bei der jede andere Person zuschlagen darf.
  const opponent = interaction.options.getUser('gegner');
  if (opponent) {
    if (opponent.id === interaction.user.id) return privateReply(interaction, t('errSelf', lang), lang);
    if (opponent.bot) return privateReply(interaction, t('errBot', lang), lang);

    const opponentMember =
      interaction.guild.members.cache.get(opponent.id) ||
      (await interaction.guild.members.fetch(opponent.id).catch(() => null));
    if (!opponentMember) return privateReply(interaction, t('errOpponentMissing', lang), lang);
  }

  const state = createChallenge({
    game,
    challengerId: interaction.user.id,
    opponentId: opponent ? opponent.id : '',
    lang,
  });

  await interaction.reply(buildGamePayload(state));
  const message = await interaction.fetchReply().catch(() => null);
  if (message) ctx.gameManager.track(message, state);
  return message;
}

async function setLanguageCmd(ctx, interaction) {
  const currentLang = configuredLang(ctx, interaction);
  if (!interaction.inGuild()) return privateReply(interaction, t('errGuildOnly', currentLang), currentLang);
  if (!isAdmin(interaction)) return privateReply(interaction, t('errNoPermission', currentLang), currentLang);

  const newLang = interaction.options.getString('sprache');
  // Discord liefert bei einer Choice normalerweise nur gültige Werte. Die
  // zusätzliche Prüfung verhindert trotzdem, dass ein manipuliertes Payload
  // eine kaputte Sprache im Store oder im Kanal-Thema hinterlässt.
  if (!newLang || !LANGS[newLang]) {
    return privateReply(interaction, t('errGeneric', currentLang), currentLang);
  }

  await interaction.deferReply();
  const changedAt = Date.now();
  ctx.store.setServerLang(interaction.guildId, newLang, changedAt);
  const label = `${LANGS[newLang].flag} ${LANGS[newLang].name}`;
  const text = t('setLangUpdated', newLang, { lang: label });

  // Wichtig: Die Antwort darf nicht auf Discord-Requests für jedes einzelne
  // Counting-Channel-Thema warten. Bei vielen Channels oder einem Discord-
  // Rate-Limit blieb die Interaction sonst minutenlang bei „denkt nach …“.
  // Die Sprache ist bereits im Store gespeichert; die Themen werden danach
  // best-effort im Hintergrund aktualisiert und beim nächsten Start erneut
  // synchronisiert.
  const response = await interaction.editReply(
    componentsV2Payload([buildLanguageContainer(interaction.guildId, newLang, text, changedAt)])
  );
  void Promise.resolve()
    .then(() => ctx.countingManager?.setGuildLanguage?.(interaction.guild, newLang, changedAt))
    .catch((err) => ctx.logger?.warn?.('[minigames-bot] Counting-Sprachen konnten nicht synchronisiert werden:', err.message));
  return response;
}

async function setCountingChannelCmd(ctx, interaction) {
  const lang = configuredLang(ctx, interaction);
  if (!interaction.inGuild()) return privateReply(interaction, t('errGuildOnly', lang), lang);
  if (!isAdmin(interaction)) return privateReply(interaction, t('errNoPermission', lang), lang);

  const channel = interaction.options.getChannel('channel');
  const enable = interaction.options.getBoolean('aktiv') ?? true;
  if (!channel || channel.type !== ChannelType.GuildText || typeof channel.setTopic !== 'function') {
    return privateReply(interaction, t('errCountingChannel', lang), lang);
  }

  const manager = ctx.countingManager;
  if (!manager) return privateReply(interaction, t('errGeneric', lang), lang);

  await interaction.deferReply();
  const wasActive = manager.isCountingChannel(channel);
  const result = await manager.setCountingChannel(channel, lang, enable);

  if (!result.ok) {
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('errCountingTopic', lang), 0xe74c3c)], {
        allowedMentions: { parse: [] },
      })
    );
  }

  const mention = `<#${channel.id}>`;
  let text;
  if (!enable) {
    text = t(wasActive ? 'countingDisabled' : 'countingNotSet', lang, { channel: mention });
  } else {
    text = t(wasActive ? 'countingAlready' : 'countingEnabled', lang, { channel: mention });
    if (result.manageMessages === false) text += `\n${t('countingNeedManageMessages', lang)}`;
  }

  return interaction.editReply(
    componentsV2Payload([smallContainer(null, text, enable ? 0x2ecc71 : 0x95a5a6)], {
      allowedMentions: { parse: [] },
    })
  );
}

async function profileCmd(ctx, interaction) {
  const lang = configuredLang(ctx, interaction);
  if (!interaction.inGuild()) return privateReply(interaction, t('errGuildOnly', lang), lang);
  if (!isAdmin(interaction)) return privateReply(interaction, t('errNoPermission', lang), lang);

  await interaction.deferReply();
  const choice = interaction.options.getString('image');
  const suffix = choice[0].toUpperCase() + choice.slice(1);
  const label = t(`profileChoice${suffix}`, lang);

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
      } else {
        const owner = await interaction.guild.fetchOwner();
        url = owner?.user?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
      }
      if (!url) throw new Error('Bild-URL fehlt');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get('content-type')?.split(';')[0] || 'image/png';
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), {
        body: { avatar: `data:${type};base64,${buffer.toString('base64')}` },
      });
    }
    return interaction.editReply(
      componentsV2Payload([smallContainer(null, t('profileSet', lang, { choice: label }), 0x2ecc71)])
    );
  } catch (err) {
    const text =
      err?.code === RESTJSONErrorCodes.MissingPermissions || err?.status === 403
        ? t('errAvatarPerms', lang)
        : t('errAvatar', lang, { error: err.message });
    return interaction.editReply(componentsV2Payload([smallContainer(null, text, 0xe74c3c)]));
  }
}

function commandMention(ctx, name) {
  return ctx.commandIds?.[name] ? `</${name}:${ctx.commandIds[name]}>` : `/${name}`;
}

async function helpCmd(ctx, interaction) {
  const lang = configuredLang(ctx, interaction);
  const lines = [
    `# ${t('helpTitle', lang)}`,
    '',
    t('helpDesc', lang),
    '',
    `## ⚔️ ${commandMention(ctx, 'play')}`,
    t('helpPlay', lang),
    '',
    `## 🌍 ${commandMention(ctx, 'set_language')}`,
    t('helpSetLanguage', lang),
    '',
    `## 🔢 ${commandMention(ctx, 'set_counting_channel')}`,
    t('helpCounting', lang),
    '',
    `## 🖼️ ${commandMention(ctx, 'admin_set_bot_profile')}`,
    t('helpProfile', lang),
    '',
    `## ❓ ${commandMention(ctx, 'help')}`,
    t('helpHelp', lang),
    '',
    t('helpFooter', lang),
  ];
  const container = new ContainerBuilder()
    .setAccentColor(0x9b59b6)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return interaction.reply(componentsV2Payload([container], { allowedMentions: { parse: [] } }));
}

module.exports = {
  defineCommands,
  registerCommands,
  handleChatInput,
  playCmd,
  setLanguageCmd,
  setCountingChannelCmd,
  profileCmd,
  helpCmd,
  configuredLang,
  isAdmin,
  pick,
};
