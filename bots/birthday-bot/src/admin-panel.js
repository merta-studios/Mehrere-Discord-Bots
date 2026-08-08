/**
 * Owner-Admin-Panel (/adminpanel) – nur im Privatchat mit dem
 * Bot-Owner, bewusst auf Deutsch.
 *
 * - Serverliste mit Seiten (◀ ▶), sortiert: erst Server ohne den
 *   Bot-Owner (🔴), dann nach Mitgliederzahl (absteigend).
 * - Server-Detail: Owner-Mention, Name, Bild, Mitglieder,
 *   Geburtstagsliste (eingerichtet? wie viele Einträge?)
 * - Buttons: Zurück, Einladung (1h, 1× nutzbar), Verlassen
 *   (mit Sicherheitsabfrage).
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const { t } = require('./languages');
const { COLORS, smallEmbed } = require('./embed-builder');

const PANEL_PREFIX = 'ap_';
const PAGE_SIZE = 5;

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function canUsePanel(ctx, interaction) {
  if (!ctx.ownerId) return false;
  if (interaction.user.id !== ctx.ownerId) return false;
  return interaction.channel?.type === ChannelType.DM;
}

function deny(ctx, interaction) {
  return interaction.reply({
    embeds: [smallEmbed(COLORS.error, null, t('apNeedDm', 'de'))],
    ephemeral: true,
  });
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
  // Erst alle Server, auf denen der Owner NICHT ist (🔴), dann nach Größe.
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

async function renderListPayload(ctx, userId) {
  const session = sessionOf(ctx, userId);
  const servers = await collectServers(ctx);

  if (!servers.length) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.panel)
      .setTitle(t('apTitle', 'de'))
      .setDescription(t('apNoServers', 'de'))
      .setThumbnail(ctx.client.user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: t('apPage', 'de', { page: 1, total: 1 }) });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${PANEL_PREFIX}select`)
      .setPlaceholder(t('apSelectPlaceholder', 'de'))
      .setDisabled(true)
      .addOptions({ label: '—', value: 'none' });

    return {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
    };
  }

  const totalPages = Math.ceil(servers.length / PAGE_SIZE);
  session.page = Math.min(Math.max(session.page, 0), totalPages - 1);
  const page = session.page;

  const pageServers = servers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const lines = pageServers.map(
    (s) => `${s.present ? '🟢' : '🔴'} **${escapeMd(s.guild.name)}** · ${s.members.toLocaleString('de-DE')} Mitglieder`
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.panel)
    .setTitle(t('apTitle', 'de'))
    .setDescription(t('apServerListDesc', 'de', { count: servers.length, list: lines.join('\n') }))
    .setThumbnail(ctx.client.user.displayAvatarURL({ size: 128 }))
    .setFooter({ text: t('apPage', 'de', { page: page + 1, total: totalPages }) });

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

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      nav,
    ],
  };
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

  const entry = ctx.store.get(guildId);
  const setup = !!entry;

  const embed = new EmbedBuilder()
    .setColor(COLORS.panel)
    .setTitle(t('apDetailTitle', 'de'))
    .setThumbnail(guild.iconURL({ size: 256 }) || ctx.client.user.displayAvatarURL({ size: 256 }))
    .setDescription(
      [
        t('apDetailName', 'de', { name: guild.name }),
        t('apDetailOwner', 'de', { mention: `<@${guild.ownerId}>` }),
        t('apDetailMembers', 'de', { count: guild.memberCount.toLocaleString('de-DE') }),
        '',
        t('apDetailSetup', 'de', { status: setup ? t('apSetupYes', 'de') : t('apSetupNo', 'de') }),
        setup ? t('apDetailBdays', 'de', { count: entry.birthdays.length }) : '',
      ].join('\n')
    );

  if (session.leaving) {
    embed.setDescription(
      `${embed.data.description}\n\n⚠️ ${t('apLeaveAsk', 'de', { name: guild.name })}`
    );
  } else if (session.inviteUrl) {
    embed.addFields({ name: t('apInviteSent', 'de'), value: t('apInviteLink', 'de', { url: session.inviteUrl }) });
  }

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
        .setCustomId(`${PANEL_PREFIX}leave`)
        .setStyle(ButtonStyle.Danger)
        .setLabel(t('apBtnLeave', 'de'))
    );
  }

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(...buttons)],
  };
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
      try {
        const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
        const channel =
          channels.find(
            (c) =>
              c.type === ChannelType.GuildText &&
              c.permissionsFor(ctx.client.user)?.has(PermissionFlagsBits.CreateInstantInvite)
          ) || guild.systemChannel;
        if (!channel) throw new Error('Kein passender Channel gefunden.');
        const invite = await channel.createInvite({
          maxAge: 3600, // 1 Stunde
          maxUses: 1, // 1× nutzbar
          reason: 'Admin-Panel: Einladung an den Bot-Owner',
        });
        session.inviteUrl = invite.url;
      } catch (err) {
        session.inviteError = t('apInviteFailed', 'de', { error: err.message });
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
      ctx.store.delete(guild.id);
      await guild.leave().catch(() => {});
      session.guildId = null;
      session.leaving = false;
      const payload = await renderListPayload(ctx, userId);
      payload.embeds[0] = EmbedBuilder.from(payload.embeds[0]).setDescription(
        `${t('apLeft', 'de', { name })}\n\n${payload.embeds[0].data.description || ''}`
      );
      return interaction.editReply(payload);
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

  await interaction.deferUpdate();
  return interaction.editReply(await renderDetailPayload(ctx, interaction.user.id, guildId));
}

// ---------------------------------------------------------------------------
// Join-Notice an den Owner
// ---------------------------------------------------------------------------

async function sendJoinNotice(ctx, guild) {
  if (!ctx.ownerId) return;
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    const ownerUser = await ctx.client.users.fetch(ctx.ownerId);
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('👋 Neuer Server!')
      .setDescription(
        t('apJoinNotice', 'de', {
          name: guild.name,
          members: guild.memberCount.toLocaleString('de-DE'),
          owner: owner ? `<@${owner.id}>` : '?',
        })
      )
      .setThumbnail(guild.iconURL({ size: 128 }))
      .setTimestamp();
    await ownerUser.send({ embeds: [embed] });
  } catch (err) {
    ctx.logger.warn('[birthday-bot] Join-Notice konnte nicht gesendet werden:', err.message);
  }
}

module.exports = {
  PANEL_PREFIX,
  openPanel,
  handlePanelButton,
  handlePanelSelect,
  sendJoinNotice,
};
