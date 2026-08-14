/**
 * Owner-Admin-Panel (/adminpanel) des Minigames-Bots – nur im Privatchat
 * mit dem Bot-Owner, bewusst auf Deutsch (wie bei den anderen Bots).
 *
 * Verwendet moderne Container & Layout-Komponenten (Components V2).
 *
 * - Serverliste mit Seiten (◀ ▶), sortiert: erst Server ohne den
 *   Bot-Owner (🔴), dann nach Mitgliederzahl (absteigend).
 * - Server-Detail: Owner-Mention, Name, Mitglieder und laufende Battles.
 * - Buttons: Zurück, Einladung (1h, 1× nutzbar), stillen Call
 *   joinen/verlassen und Server verlassen (mit Sicherheitsabfrage).
 * - Die Call-Funktion ist durch den Panel-Guard ausschließlich für den
 *   konfigurierten Bot-Owner erreichbar.
 */

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const { t } = require('./languages');
const { smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');

const PANEL_PREFIX = 'mgap_';
const PAGE_SIZE = 5;

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function canUsePanel(ctx, interaction) {
  const ownerId = String(ctx.ownerId || '')
    .trim()
    .replace(/^<@!?(\d+)>$/, '$1');
  const isDirectMessage =
    interaction.channel?.type === ChannelType.DM ||
    (interaction.guildId == null && interaction.channel == null);

  return Boolean(ownerId) && interaction.user?.id === ownerId && isDirectMessage;
}

function deny(ctx, interaction) {
  return interaction.reply(
    componentsV2Payload([smallContainer(null, t('apNeedDm', 'de'))], { ephemeral: true })
  );
}

function sessionOf(ctx, userId) {
  if (!ctx.panelSessions.has(userId)) {
    ctx.panelSessions.set(userId, { page: 0, guildId: null, leaving: false });
  }
  return ctx.panelSessions.get(userId);
}

// ---------------------------------------------------------------------------
// Daten sammeln
// ---------------------------------------------------------------------------

async function collectServers(ctx) {
  const out = [];
  for (const guild of ctx.client.guilds.cache.values()) {
    let present = guild.members.cache.has(ctx.ownerId);
    if (!present) {
      present = await guild.members
        .fetch(ctx.ownerId)
        .then(() => true)
        .catch(() => false);
    }
    out.push({ guild, present, members: guild.memberCount });
  }
  out.sort((a, b) => Number(a.present) - Number(b.present) || b.members - a.members);
  return out;
}

// ---------------------------------------------------------------------------
// Serverliste
// ---------------------------------------------------------------------------

async function openPanel(ctx, interaction) {
  if (!canUsePanel(ctx, interaction)) return deny(ctx, interaction);
  const payload = await renderListPayload(ctx, interaction.user.id);
  return interaction.reply(payload);
}

async function renderListPayload(ctx, userId, noticePrefix = '') {
  const session = sessionOf(ctx, userId);
  const servers = await collectServers(ctx);

  const container = new ContainerBuilder();

  if (!servers.length) {
    let text = `# ${t('apTitle', 'de')}\n\n${t('apNoServers', 'de')}`;
    if (noticePrefix) text = `${noticePrefix}\n\n${text}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${PANEL_PREFIX}select`)
      .setPlaceholder(t('apSelectPlaceholder', 'de'))
      .setDisabled(true)
      .addOptions({ label: '—', value: 'none' });

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(select));

    return componentsV2Payload([container]);
  }

  const totalPages = Math.ceil(servers.length / PAGE_SIZE);
  session.page = Math.min(Math.max(session.page, 0), totalPages - 1);
  const page = session.page;

  const pageServers = servers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const lines = pageServers.map(
    (s) => `${s.present ? '🟢' : '🔴'} **${escapeMd(s.guild.name)}** · ${s.members.toLocaleString('de-DE')} Mitglieder`
  );

  let descText = `# ${t('apTitle', 'de')}\n\n${t('apServerListDesc', 'de', { count: servers.length, list: lines.join('\n') })}`;
  if (noticePrefix) descText = `${noticePrefix}\n\n${descText}`;
  descText += `\n\n*${t('apPage', 'de', { page: page + 1, total: totalPages })}*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(descText));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PANEL_PREFIX}select`)
    .setPlaceholder(t('apSelectPlaceholder', 'de'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      pageServers.map((s) => ({
        label: s.guild.name.slice(0, 90) || 'Unbenannter Server',
        value: s.guild.id,
        description: `${s.members.toLocaleString('de-DE')} Mitglieder`,
      }))
    );

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}prev`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('apBtnPrev', 'de'))
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}refresh`)
      .setStyle(ButtonStyle.Primary)
      .setLabel(t('apBtnRefresh', 'de')),
    new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}next`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('apBtnNext', 'de'))
      .setDisabled(page >= totalPages - 1)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(select), nav);

  return componentsV2Payload([container]);
}

function escapeMd(text) {
  return String(text).replace(/([\\*_`|~])/g, '\\$1');
}

// ---------------------------------------------------------------------------
// Server-Detail
// ---------------------------------------------------------------------------

async function renderDetailPayload(ctx, userId, guildId) {
  const session = sessionOf(ctx, userId);
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) {
    session.guildId = null;
    return renderListPayload(ctx, userId);
  }

  const games = ctx.store.countGames(guildId);
  // Der Voice-Manager ist die einzige Wahrheitsquelle. Der Discord.js-Cache
  // (`guild.members.me.voice`) kann nach einem Join/Leave noch veraltet sein
  // und würde sonst den falschen Button anzeigen.
  const voiceChannel = ctx.voiceManager?.currentChannel?.(guild) || null;
  const voiceConnected = ctx.voiceManager?.isConnected?.(guild) || false;
  const voiceStatus = voiceConnected
    ? voiceChannel?.id
      ? `🔊 <#${voiceChannel.id}>`
      : '🔊 Verbunden'
    : 'Nicht im Call';

  const lines = [
    `# ${t('apDetailTitle', 'de')}`,
    '',
    t('apDetailName', 'de', { name: guild.name }),
    t('apDetailOwner', 'de', { mention: `<@${guild.ownerId}>` }),
    t('apDetailMembers', 'de', { count: guild.memberCount.toLocaleString('de-DE') }),
    t('apDetailVoice', 'de', { status: voiceStatus }),
    '',
    t('apDetailGames', 'de', { count: games }),
  ];

  if (session.leaving) {
    lines.push('', `⚠️ ${t('apLeaveAsk', 'de', { name: guild.name })}`);
  } else {
    if (session.voiceNotice) lines.push('', session.voiceNotice);
    if (session.inviteUrl) {
      lines.push('', `**${t('apInviteSent', 'de')}**`, t('apInviteLink', 'de', { url: session.inviteUrl }));
    } else if (session.inviteError) {
      lines.push('', session.inviteError);
    }
  }

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join('\n'))
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const buttons = [];
  if (session.leaving) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}leave_confirm`)
        .setStyle(ButtonStyle.Danger)
        .setLabel(t('apBtnLeaveConfirm', 'de')),
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}leave_cancel`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('apBtnLeaveCancel', 'de'))
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}back`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('apBtnBack', 'de')),
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}invite`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t('apBtnInvite', 'de')),
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}voice`)
        .setStyle(voiceConnected ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setLabel(t(voiceConnected ? 'apBtnCallLeave' : 'apBtnCallJoin', 'de')),
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}leave`)
        .setStyle(ButtonStyle.Danger)
        .setLabel(t('apBtnLeave', 'de'))
    );
  }

  container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));

  return componentsV2Payload([container]);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

async function handlePanelButton(ctx, interaction) {
  if (!canUsePanel(ctx, interaction)) return deny(ctx, interaction);

  const id = interaction.customId;
  const session = sessionOf(ctx, interaction.user.id);
  const userId = interaction.user.id;

  switch (id) {
    case `${PANEL_PREFIX}prev`:
    case `${PANEL_PREFIX}next`: {
      await interaction.deferUpdate();
      session.page += id.endsWith('next') ? 1 : -1;
      return interaction.editReply(await renderListPayload(ctx, userId));
    }

    case `${PANEL_PREFIX}refresh`: {
      await interaction.deferUpdate();
      return interaction.editReply(await renderListPayload(ctx, userId));
    }

    case `${PANEL_PREFIX}back`: {
      await interaction.deferUpdate();
      session.guildId = null;
      session.leaving = false;
      return interaction.editReply(await renderListPayload(ctx, userId));
    }

    case `${PANEL_PREFIX}invite`: {
      await interaction.deferUpdate();
      const guild = ctx.client.guilds.cache.get(session.guildId);
      if (!guild) {
        session.guildId = null;
        return interaction.editReply(await renderListPayload(ctx, userId));
      }
      session.inviteError = null;
      try {
        const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
        const channel =
          channels.find(
            (c) =>
              c?.type === ChannelType.GuildText &&
              c.permissionsFor(ctx.client.user)?.has(PermissionFlagsBits.CreateInstantInvite)
          ) || guild.systemChannel;
        if (!channel) throw new Error('Kein passender Channel gefunden.');
        const invite = await channel.createInvite({
          maxAge: 3600,
          maxUses: 1,
          reason: 'Admin-Panel: Einladung an den Bot-Owner',
        });
        session.inviteUrl = invite.url;
      } catch (err) {
        session.inviteError = t('apInviteFailed', 'de', { error: err.message });
      }
      return interaction.editReply(await renderDetailPayload(ctx, userId, session.guildId));
    }

    case `${PANEL_PREFIX}voice`: {
      await interaction.deferUpdate();
      const guild = ctx.client.guilds.cache.get(session.guildId);
      if (!guild) {
        session.guildId = null;
        return interaction.editReply(await renderListPayload(ctx, userId));
      }

      session.voiceNotice = null;
      if (!ctx.voiceManager) {
        session.voiceNotice = t('apCallFailed', 'de', { error: 'Voice-Manager nicht verfügbar.' });
      } else if (ctx.voiceManager.isConnected(guild)) {
        const result = await ctx.voiceManager.leaveGuild(guild);
        session.voiceNotice = result.ok
          ? t('apCallLeft', 'de')
          : t('apCallFailed', 'de', { error: result.error });
      } else {
        const result = await ctx.voiceManager.joinGuild(guild);
        session.voiceNotice = result.ok
          ? t('apCallJoined', 'de', {
              channel: result.channel?.id ? `<#${result.channel.id}>` : 'dem ausgewählten Call',
            })
          : t('apCallFailed', 'de', { error: result.error });
      }
      return interaction.editReply(await renderDetailPayload(ctx, userId, session.guildId));
    }

    case `${PANEL_PREFIX}leave`: {
      await interaction.deferUpdate();
      session.leaving = true;
      return interaction.editReply(await renderDetailPayload(ctx, userId, session.guildId));
    }

    case `${PANEL_PREFIX}leave_cancel`: {
      await interaction.deferUpdate();
      session.leaving = false;
      return interaction.editReply(await renderDetailPayload(ctx, userId, session.guildId));
    }

    case `${PANEL_PREFIX}leave_confirm`: {
      await interaction.deferUpdate();
      const guild = ctx.client.guilds.cache.get(session.guildId);
      if (!guild) {
        session.guildId = null;
        return interaction.editReply(await renderListPayload(ctx, userId));
      }
      const name = guild.name;
      ctx.voiceManager?.forgetGuild?.(guild.id);
      if (ctx.gameManager?.deleteGuild) ctx.gameManager.deleteGuild(guild.id);
      else ctx.store.deleteGuild(guild.id);
      await guild.leave().catch(() => {});
      session.guildId = null;
      session.leaving = false;
      return interaction.editReply(await renderListPayload(ctx, userId, t('apLeft', 'de', { name })));
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Select-Menü
// ---------------------------------------------------------------------------

async function handlePanelSelect(ctx, interaction) {
  if (!canUsePanel(ctx, interaction)) return deny(ctx, interaction);

  const guildId = interaction.values?.[0];
  if (!guildId || guildId === 'none') return null;

  const session = sessionOf(ctx, interaction.user.id);
  session.guildId = guildId;
  session.leaving = false;
  session.inviteUrl = null;
  session.inviteError = null;
  session.voiceNotice = null;

  await interaction.deferUpdate();
  return interaction.editReply(await renderDetailPayload(ctx, interaction.user.id, guildId));
}

// ---------------------------------------------------------------------------
// Join-Notice an den Owner
// ---------------------------------------------------------------------------

async function sendJoinNotice(ctx, guild) {
  if (!ctx.ownerId) {
    ctx.logger.warn('[minigames-bot] Join-Notice übersprungen: keine Owner-ID konfiguriert.');
    return;
  }
  try {
    const notice = t('apJoinNotice', 'de', {
      name: guild.name,
      members: guild.memberCount.toLocaleString('de-DE'),
      owner: guild.ownerId ? `<@${guild.ownerId}>` : '?',
    });
    const ownerUser = ctx.client.users.cache.get(ctx.ownerId) || (await ctx.client.users.fetch(ctx.ownerId));
    const dm = await ownerUser.createDM();
    const container = smallContainer('👋 Neuer Server!', notice);
    try {
      await dm.send(componentsV2Payload([container]));
    } catch (componentErr) {
      await dm.send({ content: `👋 Neuer Server!\n\n${notice.replace(/\*\*/g, '')}` });
      ctx.logger.warn('[minigames-bot] Join-Notice nur als Text gesendet:', componentErr.message);
    }
    ctx.logger.info(`[minigames-bot] Join-Notice an Owner für ${guild.name} gesendet.`);
  } catch (err) {
    ctx.logger.warn('[minigames-bot] Join-Notice konnte nicht gesendet werden:', err.message);
  }
}

module.exports = {
  PANEL_PREFIX,
  openPanel,
  handlePanelButton,
  handlePanelSelect,
  sendJoinNotice,
  renderListPayload,
  renderDetailPayload,
  canUsePanel,
};
