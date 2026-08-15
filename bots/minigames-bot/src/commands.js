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
const { GAME_2048, createSoloGame } = require('./game-2048');
const {
  buildGamePayload,
  buildLanguageContainer,
  smallContainer,
} = require('./embed-builder');
const { buildSoloPayload } = require('./solo-ui');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');

/**
 * Der frühere `/play` heißt jetzt `/multiplayer` – dazu kommt `/singleplayer`
 * für die Solo-Spiele. `LEGACY_COMMAND_NAMES` beschreibt Commands, die es
 * früher gab und die überall gelöscht werden müssen, damit im Discord-Menü
 * keine Karteileiche zurückbleibt.
 */
const MULTIPLAYER_COMMAND = 'multiplayer';
const SINGLEPLAYER_COMMAND = 'singleplayer';
const LEGACY_COMMAND_NAMES = ['play'];

// /adminpanel lebt nur im Bot-DM und kann deshalb nicht als Guild-Command
// registriert werden – alle anderen Commands sind Server-Commands.
const DM_ONLY_COMMAND_NAMES = ['adminpanel'];

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
      .setName(MULTIPLAYER_COMMAND)
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

    // Solo-Modus: aktuell genau ein Spiel (2048), aber bewusst schon als
    // Auswahlliste angelegt, damit weitere Spiele nur eine Choice mehr sind.
    new SlashCommandBuilder()
      .setName(SINGLEPLAYER_COMMAND)
      .setDescription(t('cmdSoloDesc', 'de'))
      .setDescriptionLocalizations(pick('cmdSoloDesc'))
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('game')
          .setDescription(t('soloGameDesc', 'de'))
          .setDescriptionLocalizations(pick('soloGameDesc'))
          .setRequired(true)
          .addChoices(localizedGameChoice(GAME_2048, 'gameSolo2048'))
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

/** Alle Commands als fertiges JSON (globaler Satz inkl. /adminpanel). */
function allCommandJson() {
  return defineCommands().map((command) => command.toJSON());
}

/** Nur die Server-Commands – /adminpanel ist ein reiner DM-Command. */
function guildCommandJson() {
  return allCommandJson().filter((command) => !DM_ONLY_COMMAND_NAMES.includes(command.name));
}

function idsFromDiscord(response) {
  return Object.fromEntries((Array.isArray(response) ? response : []).map((c) => [c.name, c.id]));
}

function getRest(ctx) {
  return ctx.rest || new REST({ version: '10' }).setToken(ctx.token);
}

function rememberGuildIds(ctx, guildId, ids) {
  if (!(ctx.guildCommandIds instanceof Map)) ctx.guildCommandIds = new Map();
  ctx.guildCommandIds.set(String(guildId), ids);
  return ids;
}

/**
 * Schreibt die Server-Commands in EINE Gilde.
 *
 * Guild-Commands sind sofort sichtbar (kein 1-Stunden-Propagationsfenster)
 * und ein PUT ersetzt den kompletten Guild-Satz. Genau deshalb verschwindet
 * damit auch das alte `/play` sofort von jedem Server, auf dem der Bot
 * bereits ist, und `/multiplayer` + `/singleplayer` sind sofort da.
 */
async function registerGuildCommands(ctx, guildId, { rest } = {}) {
  const clientId = ctx.client?.user?.id;
  const id = String(guildId || '').trim();
  if (!clientId || !id) return null;
  const api = rest || getRest(ctx);
  const registered = await api.put(Routes.applicationGuildCommands(clientId, id), {
    body: guildCommandJson(),
  });
  return rememberGuildIds(ctx, id, idsFromDiscord(registered));
}

/**
 * Registriert die Slash-Commands bei Discord.
 *
 * 1. Global wird der komplette Satz geschrieben. Der PUT ersetzt den alten
 *    globalen Satz vollständig – das entfernt automatisch das umbenannte
 *    `/play`. Global heißt: auch Server, die der Bot gerade nicht im Cache
 *    hat, bekommen die Commands (nur eben mit Propagationsverzögerung).
 * 2. Zusätzlich werden die Server-Commands als Guild-Commands auf JEDEN
 *    Server geschrieben, auf dem der Bot bereits ist. Dadurch sind
 *    `/multiplayer` und `/singleplayer` dort SOFORT im Menü und `/play`
 *    sofort weg – ohne auf Discords globale Verteilung zu warten.
 * 3. Mit `MINIGAMES_BOT_GUILD_ID` bleibt es beim Dev-Verhalten: Commands nur
 *    in der Dev-Gilde, global geleert.
 */
async function registerCommands(ctx) {
  const rest = getRest(ctx);
  const clientId = ctx.client?.user?.id;
  if (!clientId) {
    ctx.logger?.error?.('[minigames-bot] Command-Registrierung abgebrochen: keine Client-ID.');
    return false;
  }

  try {
    if (ctx.devGuildId) {
      const registered = await rest.put(Routes.applicationGuildCommands(clientId, ctx.devGuildId), {
        body: allCommandJson(),
      });
      ctx.commandIds = idsFromDiscord(registered);
      rememberGuildIds(ctx, ctx.devGuildId, ctx.commandIds);
      // Im Dev-Modus sollen alte globale Commands (inkl. /play) nicht
      // parallel sichtbar bleiben.
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      ctx.logger.info(`[minigames-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert.`);
      return true;
    }

    const registered = await rest.put(Routes.applicationCommands(clientId), { body: allCommandJson() });
    ctx.commandIds = idsFromDiscord(registered);
    ctx.logger.info(
      `[minigames-bot] ${Object.keys(ctx.commandIds).length} Commands global registriert ` +
        `(altes /${LEGACY_COMMAND_NAMES.join(', /')} dabei entfernt).`
    );

    // Sofort-Sichtbarkeit auf allen bestehenden Servern.
    const guildIds = [...ctx.client.guilds.cache.keys()];
    let ok = 0;
    for (const guildId of guildIds) {
      try {
        await registerGuildCommands(ctx, guildId, { rest });
        ok += 1;
      } catch (err) {
        ctx.logger.warn(`[minigames-bot] Guild-Commands für ${guildId} fehlgeschlagen: ${err.message}`);
      }
    }
    if (guildIds.length) {
      ctx.logger.info(
        `[minigames-bot] Server-Commands sofort auf ${ok}/${guildIds.length} bestehenden Server(n) aktualisiert ` +
          '– /multiplayer & /singleplayer sind dort ohne Wartezeit nutzbar.'
      );
    }
    return true;
  } catch (err) {
    ctx.logger.error('[minigames-bot] Command-Registrierung fehlgeschlagen:', err.message);
    return false;
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
    // `play` bleibt als Fallback verdrahtet: solange Discord den alten
    // globalen Command noch nicht überall gelöscht hat, funktioniert ein
    // Klick darauf weiterhin, statt in einer Fehlermeldung zu enden.
    case 'play':
    case MULTIPLAYER_COMMAND: return playCmd(ctx, interaction);
    case SINGLEPLAYER_COMMAND: return soloCmd(ctx, interaction);
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

/**
 * `/singleplayer` – startet eine Solo-Runde im aktuellen Channel.
 *
 * Der Spielstand steckt wie bei den Battles unsichtbar in der Nachricht,
 * die Runde überlebt also Neustarts. Nur die startende Person darf die
 * Buttons bedienen; alle anderen sehen nur zu.
 */
async function soloCmd(ctx, interaction) {
  const lang = configuredLang(ctx, interaction);
  if (!interaction.inGuild()) return privateReply(interaction, t('errGuildOnly', lang), lang);

  const game = interaction.options.getString('game') || GAME_2048;
  if (game !== GAME_2048) return privateReply(interaction, t('errGeneric', lang), lang);

  const state = createSoloGame({ game, userId: interaction.user.id, lang });
  await interaction.reply(buildSoloPayload(state));
  return interaction.fetchReply().catch(() => null);
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

/**
 * Klickbare Command-Mention `</name:id>`.
 *
 * Auf einem Server gelten die Guild-Commands (sie überschatten die globalen),
 * deshalb werden deren IDs bevorzugt – sonst würde /help auf eine ID zeigen,
 * die in dieser Gilde gar nicht gilt.
 */
function commandMention(ctx, name, guildId = null) {
  let id = null;
  if (guildId && ctx.guildCommandIds instanceof Map) {
    id = ctx.guildCommandIds.get(String(guildId))?.[name] || null;
  }
  if (!id) id = ctx.commandIds?.[name] || null;
  return id ? `</${name}:${id}>` : `/${name}`;
}

async function helpCmd(ctx, interaction) {
  const lang = configuredLang(ctx, interaction);
  const guildId = interaction.guildId || null;
  const lines = [
    `# ${t('helpTitle', lang)}`,
    '',
    t('helpDesc', lang),
    '',
    `## ⚔️ ${commandMention(ctx, MULTIPLAYER_COMMAND, guildId)}`,
    t('helpPlay', lang),
    '',
    `## 🧩 ${commandMention(ctx, SINGLEPLAYER_COMMAND, guildId)}`,
    t('helpSolo', lang),
    '',
    `## 🌍 ${commandMention(ctx, 'set_language', guildId)}`,
    t('helpSetLanguage', lang),
    '',
    `## 🔢 ${commandMention(ctx, 'set_counting_channel', guildId)}`,
    t('helpCounting', lang),
    '',
    `## 🖼️ ${commandMention(ctx, 'admin_set_bot_profile', guildId)}`,
    t('helpProfile', lang),
    '',
    `## ❓ ${commandMention(ctx, 'help', guildId)}`,
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
  allCommandJson,
  guildCommandJson,
  registerCommands,
  registerGuildCommands,
  handleChatInput,
  playCmd,
  soloCmd,
  setLanguageCmd,
  setCountingChannelCmd,
  profileCmd,
  helpCmd,
  commandMention,
  configuredLang,
  isAdmin,
  pick,
  MULTIPLAYER_COMMAND,
  SINGLEPLAYER_COMMAND,
  LEGACY_COMMAND_NAMES,
  DM_ONLY_COMMAND_NAMES,
};
