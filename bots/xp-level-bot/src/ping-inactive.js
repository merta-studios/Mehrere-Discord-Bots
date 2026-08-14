/**
 * /ping_inactive_people [mode] – Inaktive Mitglieder ansprechen (nur Admins).
 *
 * Mode „main_channel":
 *   - Öffnet ein Formular (Modal); die Nachricht MUSS den Platzhalter
 *     {ROLEPING} enthalten (sonst Fehler beim Absenden).
 *   - Beim Absenden wird {ROLEPING} durch die Mention der eingerichteten
 *     Inaktiv-Rolle ersetzt (<@&roleId>) und die Nachricht wird in genau den
 *     Kanal gesendet, in dem der Command benutzt wurde.
 *   - Der Command-Nutzer sieht nur eine kurze (ephemere) Bestätigung.
 *
 * Mode „direct":
 *   - Formular mit einer beliebigen Nachricht (Beispiel ist vorbefüllt).
 *   - Beim Absenden bekommt JEDES Mitglied mit der Inaktiv-Rolle eine private
 *     DM mit genau dieser Nachricht – als normaler Text („nicht im Container“).
 *   - Nur der Command-Nutzer sieht den Fortschrittsbalken + Ergebnis
 *     (ephemer), inkl. wie vielen es geklappt hat und wie vielen nicht
 *     (z. B. fremde DMs ausgeschaltet).
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

const PING_MODAL_PREFIX = 'ping_inactive_modal:';
const PING_FIELD_MESSAGE = 'ping_inactive_message';
const ROLEPING = '{ROLEPING}';
/** Case-insensitiv, damit auch {roleping}/{RolePing} funktionieren. */
const ROLEPING_RE = /\{roleping\}/i;

const MODES = ['main_channel', 'direct'];

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

/** Baut das Formular. Vorbefülltes Beispiel je nach Modus. */
function buildPingModal(mode, lang) {
  const isMain = mode === 'main_channel';
  const example = isMain ? t('pingInactiveExampleMain', lang) : t('pingInactiveExampleDirect', lang);
  const input = new TextInputBuilder()
    .setCustomId(PING_FIELD_MESSAGE)
    .setLabel(fitLabel(t('pingInactiveModalMessageLabel', lang)))
    .setStyle(TextInputStyle.Paragraph)
    .setValue(example)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4000);

  return new ModalBuilder()
    .setCustomId(PING_MODAL_PREFIX + mode)
    .setTitle(fitLabel(t('pingInactiveModalTitle', lang)))
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

/** Members mit der Inaktiv-Rolle (die eigentliche Zielgruppe). */
function membersWithInactiveRole(members, roleId, excludeIds = new Set()) {
  if (!roleId) return [];
  return members.filter(
    (m) => m && !m.user?.bot && m.id && !excludeIds.has(m.id) && Boolean(m.roles?.cache?.has?.(roleId))
  );
}

/**
 * Command-Handler: /ping_inactive_people mode:<main_channel|direct>
 * Prüft Admin + eingerichtete Inaktiv-Rolle und öffnet das Formular.
 */
async function handlePingInactiveCommand(ctx, interaction) {
  if (!interaction.inGuild?.() && !interaction.guildId) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errGuildOnly', 'en'))], { ephemeral: true }));
  }
  if (!canAdmin(interaction)) {
    const lang = ctx.store.getGuild(interaction.guildId)?.lang || interaction.locale || 'de';
    return interaction.reply(componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true }));
  }

  const cfg = ctx.store.getGuild(interaction.guildId);
  const lang = cfg?.lang || interaction.locale || 'de';
  if (!cfg?.inactiveRoleId) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('pingInactiveNeedRole', lang))], { ephemeral: true })
    );
  }

  const mode = String(interaction.options.getString('mode') || '');
  if (!MODES.includes(mode)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
    );
  }

  return interaction.showModal(buildPingModal(mode, lang));
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

/**
 * Modal-Submit: main_channel → Nachricht mit {ROLEPING}→Rollen-Mention in den
 * Command-Kanal senden; direct → allen Inaktiven eine DM schicken (mit
 * Fortschrittsbalken nur für den Command-Nutzer).
 */
async function handlePingModalSubmit(ctx, interaction) {
  const mode = String(interaction.customId || '').replace(PING_MODAL_PREFIX, '');
  if (!MODES.includes(mode)) return null;

  const message = String(interaction.fields?.getTextInputValue?.(PING_FIELD_MESSAGE) || '').trim();
  const guildId = interaction.guildId;
  const cfg = ctx.store.getGuild(guildId);
  const lang = cfg?.lang || 'de';
  const roleId = cfg?.inactiveRoleId;

  if (!cfg || !roleId) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('pingInactiveNeedRole', lang))], { ephemeral: true })
    );
  }

  if (!message) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
    );
  }

  if (mode === 'main_channel') {
    if (!ROLEPING_RE.test(message)) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('pingInactiveNeedPlaceholder', lang))], { ephemeral: true })
      );
    }
    const channel = interaction.channel;
    if (!channel || typeof channel.send !== 'function') {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
      );
    }
    const content = message.replace(ROLEPING_RE, `<@&${roleId}>`);
    try {
      await channel.send({ content });
    } catch (err) {
      ctx.logger?.warn?.('[xp-level-bot] ping_inactive_people channel send fail:', err.message);
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
      );
    }
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('pingInactiveSentChannel', lang, { role: `<@&${roleId}>` }))],
        { ephemeral: true }
      )
    );
  }

  // ---- Mode direct ----
  const lockKey = String(guildId);
  if (dmLocks.has(lockKey)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('pingInactiveAlreadyRunning', lang))], { ephemeral: true })
    );
  }
  dmLocks.add(lockKey);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let guild = interaction.guild;
    if (!guild) {
      guild = ctx.client?.guilds?.cache?.get(guildId)
        || (await ctx.client?.guilds?.fetch?.(guildId).catch(() => null));
    }
    if (!guild) {
      return interaction.editReply(componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));
    }

    const members = await fetchAllMembers(guild);
    const exclude = new Set([interaction.user.id, ctx.client?.user?.id]);
    const targets = membersWithInactiveRole(members, roleId, exclude);

    if (targets.length === 0) {
      return interaction.editReply(
        componentsV2Payload([smallContainer(null, t('pingInactiveNoMembers', lang))])
      );
    }

    const stats = { total: targets.length, done: 0, ok: 0, failed: 0 };
    let lastReport = 0;
    const report = async () => {
      const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
      const bar = makeBar(stats.done, stats.total);
      await interaction
        .editReply(
          componentsV2Payload(
            [smallContainer(null, t('pingInactiveProgress', lang, { bar, percent, done: stats.done, total: stats.total, ok: stats.ok, failed: stats.failed }))]
          )
        )
        .catch(() => {});
    };
    await report();

    for (const member of targets) {
      const ok = await sendDmWithRetry(member, message);
      if (ok) stats.ok += 1;
      else stats.failed += 1;
      stats.done += 1;
      if (Date.now() - lastReport >= 1500 || stats.done === stats.total) {
        lastReport = Date.now();
        await report();
      }
      await sleep(250); // DM-Rate-Limit schonen (~4/s)
    }

    return interaction.editReply(
      componentsV2Payload(
        [smallContainer(null, t('pingInactiveDone', lang, { total: stats.total, ok: stats.ok, failed: stats.failed }))]
      )
    );
  } finally {
    dmLocks.delete(lockKey);
  }
}

function makeBar(done, total, size = 12) {
  if (!total) return '░'.repeat(size);
  const filled = Math.max(0, Math.min(size, Math.round((done / total) * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

function isDmRunRunning(guildId) {
  return dmLocks.has(String(guildId));
}

module.exports = {
  PING_MODAL_PREFIX,
  PING_FIELD_MESSAGE,
  ROLEPING,
  MODES,
  buildPingModal,
  handlePingInactiveCommand,
  handlePingModalSubmit,
  membersWithInactiveRole,
  isDmRunRunning,
};
