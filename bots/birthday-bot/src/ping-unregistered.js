/**
 * /ping_unregistered – Erinnert alle Mitglieder ohne Geburtstagseintrag per DM (nur Admins).
 *
 * Nur DM, kein Channel-Ping. Öffnet ein Formular (Modal) mit Beispieltext,
 * beim Absenden bekommt jedes nicht erfasste Mitglied eine private DM.
 * Nur der Command-Nutzer sieht Fortschritt/Ergebnis (ephemeral).
 */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { t } = require('./languages');
const { smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');

const PING_UNREG_PREFIX = 'bday_ping_unreg_modal';
const PING_UNREG_FIELD = 'bday_ping_unreg_message';

const dmLocks = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimitError(err) {
  return err?.status === 429 || err?.httpStatus === 429 || err?.code === 429 || err?.rawError?.retry_after != null;
}
function retryAfterMs(err) {
  const sec = Number(err?.retryAfter ?? err?.rawError?.retry_after ?? 1);
  return Math.min(15_000, Math.max(250, Math.ceil(sec * 1000) + 50));
}
function canAdmin(interaction) {
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  return Boolean(perms && perms.has(PermissionFlagsBits.Administrator));
}
function fitLabel(str) {
  return String(str).slice(0, 45);
}

function buildPingUnregisteredModal(lang) {
  const example = t('pingUnregisteredExample', lang);
  const input = new TextInputBuilder()
    .setCustomId(PING_UNREG_FIELD)
    .setLabel(fitLabel(t('pingUnregisteredModalLabel', lang)))
    .setStyle(TextInputStyle.Paragraph)
    .setValue(example)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4000);

  return new ModalBuilder()
    .setCustomId(PING_UNREG_PREFIX)
    .setTitle(fitLabel(t('pingUnregisteredModalTitle', lang)))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function fetchAllMembers(guild) {
  try {
    if (typeof guild.members?.fetch === 'function') {
      const fetched = await guild.members.fetch();
      if (fetched && typeof fetched.values === 'function') return [...fetched.values()];
    }
  } catch {}
  if (guild.members?.cache && typeof guild.members.cache.values === 'function') {
    return [...guild.members.cache.values()];
  }
  return [];
}

function membersWithoutBirthday(members, birthdayUserIds, excludeIds = new Set()) {
  const set = new Set(birthdayUserIds.map(String));
  return members.filter(
    (m) => m && !m.user?.bot && m.id && !excludeIds.has(m.id) && !set.has(String(m.id))
  );
}

async function handlePingUnregisteredCommand(ctx, interaction) {
  if (!interaction.inGuild?.() && !interaction.guildId) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  }
  if (!canAdmin(interaction)) {
    const lang = ctx.store.get(interaction.guildId)?.lang || interaction.locale || 'de';
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true }));
  }
  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || interaction.locale || 'de';
  if (!entry) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('pingUnregisteredNeedSetup', lang))], { ephemeral: true })
    );
  }
  return interaction.showModal(buildPingUnregisteredModal(lang));
}

async function sendDmWithRetry(member, content) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await member.send({ content });
      return true;
    } catch (err) {
      if (attempt < 3 && isRateLimitError(err)) {
        await sleep(retryAfterMs(err));
        continue;
      }
      return false;
    }
  }
  return false;
}

async function handlePingUnregisteredModalSubmit(ctx, interaction) {
  if (interaction.customId !== PING_UNREG_PREFIX) return null;

  const message = String(interaction.fields?.getTextInputValue?.(PING_UNREG_FIELD) || '').trim();
  const guildId = interaction.guildId;
  const entry = ctx.store.get(guildId);
  const lang = entry?.lang || 'de';

  if (!entry) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('pingUnregisteredNeedSetup', lang))], { ephemeral: true })
    );
  }
  if (!message) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
    );
  }

  const lockKey = String(guildId);
  if (dmLocks.has(lockKey)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('pingUnregisteredAlreadyRunning', lang))], { ephemeral: true })
    );
  }
  dmLocks.add(lockKey);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let guild = interaction.guild;
    if (!guild) {
      guild = ctx.client?.guilds?.cache?.get(guildId) || (await ctx.client?.guilds?.fetch?.(guildId).catch(() => null));
    }
    if (!guild) {
      return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));
    }

    const members = await fetchAllMembers(guild);
    const birthdayIds = (entry.birthdays || []).map((b) => b.userId);
    const exclude = new Set([interaction.user.id, ctx.client?.user?.id]);
    const targets = membersWithoutBirthday(members, birthdayIds, exclude);

    if (targets.length === 0) {
      return interaction.editReply(
        componentsV2Payload([smallContainer(null, t('pingUnregisteredNoMembers', lang))])
      );
    }

    const stats = { total: targets.length, done: 0, ok: 0, failed: 0 };
    let lastReport = 0;
    const makeBar = (done, total, size = 12) => {
      if (!total) return '░'.repeat(size);
      const filled = Math.max(0, Math.min(size, Math.round((done / total) * size)));
      return '█'.repeat(filled) + '░'.repeat(size - filled);
    };
    const report = async () => {
      const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
      const bar = makeBar(stats.done, stats.total);
      await interaction
        .editReply(
          componentsV2Payload([
            smallContainer(
              null,
              t('pingUnregisteredProgress', lang, {
                bar,
                percent,
                done: stats.done,
                total: stats.total,
                ok: stats.ok,
                failed: stats.failed,
              })
            ),
          ])
        )
        .catch(() => {});
    };
    await report();

    for (const member of targets) {
      // Unterstützung für Platzhalter {USER} -> mention des Empfängers
      let content = message;
      if (content.includes('{USER}')) {
        content = content.split('{USER}').join(`<@${member.id}>`);
      }
      if (content.includes('{SERVER}')) {
        content = content.split('{SERVER}').join(guild.name || 'Server');
      }
      const ok = await sendDmWithRetry(member, content);
      if (ok) stats.ok += 1;
      else stats.failed += 1;
      stats.done += 1;
      if (Date.now() - lastReport >= 1500 || stats.done === stats.total) {
        lastReport = Date.now();
        await report();
      }
      await sleep(250);
    }

    return interaction.editReply(
      componentsV2Payload([
        smallContainer(null, t('pingUnregisteredDone', lang, { total: stats.total, ok: stats.ok, failed: stats.failed })),
      ])
    );
  } finally {
    dmLocks.delete(lockKey);
  }
}

function isDmRunRunning(guildId) {
  return dmLocks.has(String(guildId));
}

module.exports = {
  PING_UNREG_PREFIX,
  PING_UNREG_FIELD,
  buildPingUnregisteredModal,
  handlePingUnregisteredCommand,
  handlePingUnregisteredModalSubmit,
  membersWithoutBirthday,
  isDmRunRunning,
};
