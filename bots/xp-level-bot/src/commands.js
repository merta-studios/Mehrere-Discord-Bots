/**
 * Slash-Commands XP Bot – Definition & Handler
 * Commands: /setup, /rank, /help, /admin_set_bot_profile, /level_roles, /adminpanel
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
const { buildRankEmbed, smallContainer, buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { openPanel } = require('./admin-panel');
const { handleLevelRolesCommand } = require('./level-roles');

function pick(key) {
  const map = {};
  for (const code of Object.keys(LANGS)) map[DISCORD_LOCALE[code]] = t(key, code);
  return map;
}

function defineCommands() {
  const languageChoices = Object.entries(LANGS).map(([code, lang]) => ({
    name: lang.name,
    value: code,
    name_localizations: Object.fromEntries(Object.entries(lang.names).map(([c,n])=>[DISCORD_LOCALE[c],n])),
  }));
  const profileChoices = ['standard','server','owner'].map(v=>({
    name: t(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`, 'de'),
    value: v,
    name_localizations: pick(`profileChoice${v[0].toUpperCase()}${v.slice(1)}`),
  }));
  return [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Richtet das XP-System ein (Leaderboard + Haupt-Chat + Sprache)')
      .setDescriptionLocalizations(pick('helpSetup'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o=>o.setName('leaderboard').setDescription('Kanal für das wöchentliche Leaderboard').setDescriptionLocalizations(pick('setupLeaderDesc')).setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o=>o.setName('mainchat').setDescription('Haupt-Chat für Level-Ups').setDescriptionLocalizations(pick('setupMainDesc')).setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o=>o.setName('language').setDescription('Sprache').setDescriptionLocalizations(pick('setupLangDesc')).setRequired(true).addChoices(...languageChoices)),

    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Zeigt deinen Rank, Level und XP')
      .setDescriptionLocalizations(pick('helpRank')),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zeigt alle Befehle')
      .setDescriptionLocalizations(pick('helpHelp')),

    new SlashCommandBuilder()
      .setName('admin_set_bot_profile')
      .setDescription('Ändert das Profilbild des Bots auf diesem Server')
      .setDescriptionLocalizations(pick('helpSetProfile'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o=>o.setName('image').setDescription('Welches Bild').setDescriptionLocalizations(pick('profileImageDesc')).setRequired(true).addChoices(...profileChoices)),

    new SlashCommandBuilder()
      .setName('level_roles')
      .setDescription('Passt die Level-Belohnungsrollen an (Formular)')
      .setDescriptionLocalizations(pick('levelRolesHelp'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Owner-Admin-Panel (nur im DM)')
      .setDescriptionLocalizations(pick('helpAdminPanel'))
      .setContexts(InteractionContextType.BotDM),
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Registriert die Slash-Commands bei Discord. Geschehene Fehler (Rate-Limit,
 * Discord-Hickup beim Hosting-Restart) wurden früher nur geloggt – neue
 * Commands (z.B. /level_roles) fehlten danach dauerhaft, obwohl sie im /help
 * auftauchten. Deshalb: mehrere Versuche mit Abstand + Erfolgs-Flag, das der
 * Scheduler nutzt, um es regelmäßig erneut zu versuchen, bis es klappt.
 */
async function registerCommands(ctx, { restFactory, retryDelays } = {}) {
  const commands = defineCommands().map(c=>c.toJSON());
  const rest = restFactory ? restFactory(ctx.token) : new REST({version:'10'}).setToken(ctx.token);
  const clientId = ctx.client.user.id;
  const RETRY_DELAYS_MS = retryDelays || [0, 15_000, 60_000, 5 * 60_000];
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      if (ctx.devGuildId) {
        const res = await rest.put(Routes.applicationGuildCommands(clientId, ctx.devGuildId), {body: commands});
        ctx.commandIds = Object.fromEntries((res || []).map((c) => [c.name, c.id]));
        ctx.logger.info(`[xp-level-bot] Commands in Dev-Gilde ${ctx.devGuildId} registriert: ${registeredNames(res)}`);
      } else {
        const res = await rest.put(Routes.applicationCommands(clientId), {body: commands});
        ctx.commandIds = Object.fromEntries((res || []).map((c) => [c.name, c.id]));
        for (const guild of ctx.client.guilds.cache.values()) {
          await rest.put(Routes.applicationGuildCommands(clientId, guild.id), {body: []}).catch(()=>{});
        }
        ctx.logger.info(`[xp-level-bot] Commands global registriert (bis zu 1h bis überall sichtbar): ${registeredNames(res)}`);
      }
      ctx.commandsRegistered = true;
      return true;
    } catch(err){
      const detail = err?.rawError ? JSON.stringify(err.rawError).slice(0, 500) : '';
      ctx.logger.error(`[xp-level-bot] Command-Reg fehlgeschlagen (Versuch ${attempt + 1}/${RETRY_DELAYS_MS.length}): ${err.message} ${detail}`);
    }
  }
  ctx.commandsRegistered = false; // Scheduler versucht es weiter alle 15 Minuten
  return false;
}

/** Discord gibt die registrierten Commands zurück – Namen fürs Log (Beweis, dass z.B. /level_roles angelegt wurde). */
function registeredNames(res) {
  if (Array.isArray(res) && res.length) return res.map((c) => c.name).join(', ');
  return 'unbekannt';
}

async function handleChatInput(ctx, interaction) {
  switch(interaction.commandName){
    case 'setup': return setupCmd(ctx, interaction);
    case 'rank': return rankCmd(ctx, interaction);
    case 'help': return helpCmd(ctx, interaction);
    case 'admin_set_bot_profile': return profileCmd(ctx, interaction);
    case 'level_roles': return handleLevelRolesCommand(ctx, interaction);
    case 'adminpanel': return openPanel(ctx, interaction);
    default: return interaction.reply(componentsV2Payload([smallContainer(null,'Unbekannter Befehl.')],{ephemeral:true}));
  }
}

async function setupCmd(ctx, interaction){
  if (!interaction.inGuild()) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly','en'))],{ephemeral:true}));
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const langChoice = interaction.options.getString('language');
  const lang = langChoice || 'en';
  if (!perms?.has(PermissionFlagsBits.Administrator)) return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))],{ephemeral:true}));
  if (!LANGS[lang]) return interaction.reply(componentsV2Payload([smallContainer(null, t('setupLangBad', lang))],{ephemeral:true}));

  const leader = interaction.options.getChannel('leaderboard');
  const main = interaction.options.getChannel('mainchat');
  if (!leader || leader.type !== ChannelType.GuildText) return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))],{ephemeral:true}));
  if (!main || main.type !== ChannelType.GuildText) return interaction.reply(componentsV2Payload([smallContainer(null, t('errChannelBad', lang))],{ephemeral:true}));

  for (const ch of [leader, main]) {
    const permsBot = ch.permissionsFor(ctx.client.user);
    if (!permsBot?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.reply(componentsV2Payload([smallContainer(null, t('errBotPerms', lang, {channel:`<#${ch.id}>`}))],{ephemeral:true}));
    }
  }

  await interaction.deferReply({flags: MessageFlags.Ephemeral});

  // Check existing config – übernehmen? Migrating
  let existing = ctx.store.getGuild(interaction.guild.id);
  const alreadyUsers = existing ? ctx.store.getUsersForGuild(interaction.guild.id) : [];

  // Try to find old leaderboard message to delete
  let oldMsg = null;
  if (existing && existing.leaderboardChannelId) {
    try {
      const ch = await ctx.client.channels.fetch(existing.leaderboardChannelId).catch(()=>null);
      if (ch && ch.isTextBased() && existing.leaderboardMessageId) {
        oldMsg = await ch.messages.fetch(existing.leaderboardMessageId).catch(()=>null);
      }
    } catch {}
    // also scan for marker if messageId unknown
    if (!oldMsg) {
      try {
        const found = await ctx.store.findLeaderboardMessage(interaction.guild, ctx.client);
        if (found) oldMsg = found.message;
      } catch {}
    }
  }
  if (oldMsg) await oldMsg.delete().catch(()=>{});

  const now = new Date();
  const entries = ctx.store.getLeaderboard(interaction.guild.id, 15);
  const container = buildLeaderboardEmbed({ lang, entries, now, guildName: interaction.guild.name });
  const msg = await leader.send(componentsV2Payload([container])).catch(e=>{
    ctx.logger.error('[xp-level-bot] Leaderboard send failed', e.message);
    return null;
  });
  if (!msg) return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));

  const cfg = {
    guildId: interaction.guild.id,
    leaderboardChannelId: leader.id,
    mainChannelId: main.id,
    lang,
    leaderboardMessageId: msg.id,
    lastDailyDecay: todayKeyForLang(lang),
  };
  ctx.store.setGuild(cfg);
  await ctx.store.flush();

  // Schedule immediate nick updates? Not needed

  const desc = t('setupSuccess', lang, { leader:`<#${leader.id}>`, main:`<#${main.id}>`, lang: LANGS[lang].name });
  let extra = '';
  if (existing) extra = `\n\n${t('setupFoundOld', lang)} (${alreadyUsers.length} Nutzer behalten ✨)`;
  return interaction.editReply(componentsV2Payload([smallContainer(null, desc+extra)]));
}

async function rankCmd(ctx, interaction){
  const guildId = interaction.guildId;
  if (!guildId) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly','en'))],{ephemeral:true}));
  const cfg = ctx.store.getGuild(guildId);
  const lang = cfg?.lang || langFromDiscord(interaction.locale);
  if (!cfg || !cfg.leaderboardChannelId) return interaction.reply(componentsV2Payload([smallContainer(null, t('rankNoSetup', lang))],{ephemeral:true}));

  const userId = interaction.user.id;
  let rankInfo = ctx.store.getRank(guildId, userId);
  if (!rankInfo) {
    // User not yet in store -> create placeholder? Show rankNotFound with placeholder lvl1
    const u = ctx.store.getUser(guildId, userId);
    if (!u) {
      // Show not found container
      const r = buildRankEmbed({ lang, userId, rankInfo:null });
      return interaction.reply(componentsV2Payload([r.container],{ephemeral:true}));
    }
    rankInfo = { rank: ctx.store.getUsersForGuild(guildId).length, total: ctx.store.getUsersForGuild(guildId).length, user: u };
    // Actually need proper rank, but user exists
    const full = ctx.store.getRank(guildId, userId);
    if (full) rankInfo = full;
  }
  const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });
  const { container } = buildRankEmbed({ lang, userId, rankInfo, avatarUrl, now: new Date() });
  // Öffentliche Nachricht – für alle sichtbar (nicht nur für den Command-Benutzer)
  return interaction.reply(componentsV2Payload([container]));
}

async function helpCmd(ctx, interaction){
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `# ${t('helpTitle', lang)}`,
      t('helpDesc', lang),
      '',
      `**${commandMention(ctx, 'setup')}**\n${t('helpSetup', lang)}`,
      '',
      `**${commandMention(ctx, 'rank')}**\n${t('helpRank', lang)}`,
      '',
      `**${commandMention(ctx, 'admin_set_bot_profile')}**\n${t('helpSetProfile', lang)}`,
      '',
      `**${commandMention(ctx, 'level_roles')}**\n${t('levelRolesHelp', lang)}`,
      '',
      `**${commandMention(ctx, 'help')}**\n${t('helpHelp', lang)}`,
    ].join('\n'))
  );
  return interaction.reply(componentsV2Payload([container]));
}

async function profileCmd(ctx, interaction){
  if (!interaction.inGuild()) return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly','en'))],{ephemeral:true}));
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  if (!perms?.has(PermissionFlagsBits.Administrator)) return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))],{ephemeral:true}));
  await interaction.deferReply({flags: MessageFlags.Ephemeral});
  const choice = interaction.options.getString('image');
  const label = t(`profileChoice${choice[0].toUpperCase()}${choice.slice(1)}`, lang);
  try {
    if (choice === 'standard') {
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), {body:{avatar:null}});
    } else {
      let url=null;
      if (choice==='server'){
        url = interaction.guild.iconURL({size:256, extension:'png', forceStatic:true});
        if(!url) return interaction.editReply(componentsV2Payload([smallContainer(null, t('errServerNoIcon', lang))]));
      } else if (choice==='owner'){
        const owner = await interaction.guild.fetchOwner();
        url = owner?.user?.displayAvatarURL({size:256, extension:'png', forceStatic:true}) || owner?.displayAvatarURL({size:256, extension:'png', forceStatic:true});
      }
      if (!url) throw new Error('Bild-URL konnte nicht ermittelt werden.');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Avatar konnte nicht geladen werden (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      const dataUri = `data:${ct};base64,${buffer.toString('base64')}`;
      await ctx.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), {body:{avatar:dataUri}});
    }
    return interaction.editReply(componentsV2Payload([smallContainer(null, t('profileSet', lang, {choice:label}))]));
  } catch(err){
    const msg = err?.code===RESTJSONErrorCodes.MissingPermissions || err?.status===403 ? t('errAvatarPerms', lang) : t('errAvatar', lang, {error: err.message});
    return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
  }
}

function todayKeyForLang(lang){
  const { tzParts } = require('./logic');
  const { tzOf } = require('./languages');
  const pad = n=>String(n).padStart(2,'0');
  const t = tzParts(tzOf(lang));
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

module.exports = { defineCommands, registerCommands, handleChatInput, pick };
