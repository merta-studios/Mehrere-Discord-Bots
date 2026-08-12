/**
 * Geplante XP-Belohnungen im Haupt-Chat.
 *
 * Pro Server entstehen täglich 2–4 deterministische Termine (Server-ID +
 * lokales Datum). Geprüft wird an ZWEI Stellen, damit ein hängender
 * Ready-Handler oder ein toter setInterval die Drops nicht wieder verschluckt:
 *   1. eigener Minuten-Scheduler (unabhängig vom Leaderboard)
 *   2. jede echte Chat-Nachricht (gedrosselt) – genau dann sind Leute online
 *      und können „schnell sein“
 *
 * Überfällige Termine: der jüngste wird nachgeholt, ältere ohne Spam
 * abgeschlossen. firedSlots ohne lastSentAt gelten als unzuverlässig und
 * werden verworfen (genau das hat nach dem letzten „Fix“ den ganzen Tag
 * leer gefegt).
 *
 * Senden: zuerst Components V2, bei Ablehnung klassisches Embed + Button,
 * zuletzt Plain-Text + Button. Ein offener Drop bleibt in
 * `bonusState.activeDrop` und überlebt Restarts.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  rollBonusXp,
  todayKey,
  seededRngForDay,
  planDailyBonusSlots,
  currentMinuteOfDay,
  applyXpGain,
  BONUS_CLAIM_MS,
} = require('./logic');
const { t } = require('./languages');
const {
  buildBonusDropEmbed,
  buildBonusClaimedEmbed,
  buildBonusExpiredEmbed,
  smallContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');

const BONUS_CLAIM_PREFIX = 'xp_bonus_claim_';
// v3: firedSlots älterer Versionen sind untrusted (wurden als „gesendet“
// markiert, ohne dass je eine Nachricht im Chat landete).
const BONUS_PLAN_VERSION = 3;
const BONUS_ACTIVITY_KICK_MS = 10_000;

function randomDropId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function serializedDrop(drop) {
  return {
    dropId: drop.dropId,
    guildId: drop.guildId,
    channelId: drop.channelId,
    messageId: drop.messageId,
    xp: drop.xp,
    lang: drop.lang,
    createdAt: drop.createdAt,
  };
}

function asMinute(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFiredSlots(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(asMinute).filter((n) => n !== null))].sort((a, b) => a - b);
}

function hasSlot(list, slot) {
  const want = asMinute(slot);
  if (want === null) return false;
  return normalizeFiredSlots(list).includes(want);
}

function dropIsExpired(drop, nowMs = Date.now()) {
  const created = Number(drop?.createdAt);
  if (!Number.isFinite(created) || created <= 0) return true;
  return nowMs - created >= BONUS_CLAIM_MS;
}

function prettySlot(minute) {
  const m = asMinute(minute);
  if (m === null) return '?';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function claimButton(lang, dropId, { disabled = false } = {}) {
  return new ButtonBuilder()
    .setCustomId(`${BONUS_CLAIM_PREFIX}${dropId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel(t('bonusBtn', lang))
    .setDisabled(disabled);
}

function classicBonusPayload({ title, body, dropId, lang, disabled = false }) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${body}\n\u200Bxp-bonus:${dropId}\u200B`),
    ],
    components: [new ActionRowBuilder().addComponents(claimButton(lang, dropId, { disabled }))],
  };
}

function createBonusDropper({ ctx, onLevelChange, onXpOnly, rng = Math.random }) {
  // guildId -> { activeDrop }
  const states = new Map();
  // dropId -> vollständig hydrierter Drop für den Button-Handler
  const drops = new Map();
  // guildId -> letzter Activity-Kick (damit Chatten den Scheduler ergänzt)
  const lastActivityKick = new Map();

  function stateFor(guildId) {
    let state = states.get(guildId);
    if (!state) {
      state = { activeDrop: null };
      states.set(guildId, state);
    }
    return state;
  }

  /** Persistierter Tageszustand; nur einen noch GÜLTIGEN offenen Drop bewahren. */
  function dayState(cfg, dayKey) {
    let state = cfg.bonusState;
    if (!state || state.dayKey !== dayKey) {
      const open = state?.activeDrop && !dropIsExpired(state.activeDrop) ? state.activeDrop : null;
      state = {
        dayKey,
        planVersion: BONUS_PLAN_VERSION,
        firedSlots: [],
        activeDrop: open,
        lastSentAt: 0,
      };
      cfg.bonusState = state;
      ctx.store.setGuild(cfg);
    }
    state.firedSlots = normalizeFiredSlots(state.firedSlots);
    return state;
  }

  function persistOpenDrop(cfg, drop) {
    const state = cfg.bonusState || {
      dayKey: todayKey(cfg.lang || 'de'),
      planVersion: BONUS_PLAN_VERSION,
      firedSlots: [],
      lastSentAt: 0,
    };
    state.activeDrop = drop ? serializedDrop(drop) : null;
    if (drop) state.lastSentAt = Date.now();
    cfg.bonusState = state;
    ctx.store.setGuild(cfg);
    void ctx.store.flush().catch(() => {});
  }

  function armExpiry(drop) {
    const remaining = Math.max(0, BONUS_CLAIM_MS - (Date.now() - drop.createdAt));
    drop.expiryTimer = setTimeout(() => void expireDrop(drop.dropId).catch(() => {}), remaining);
    drop.expiryTimer.unref?.();
  }

  /**
   * Stellt einen offenen Drop aus Turso/File wieder her. Das ist sowohl beim
   * ersten Scheduler-Tick nach Neustart als auch direkt beim Button-Klick nötig.
   */
  async function restorePersistedDrop(cfg, message = null) {
    const data = cfg?.bonusState?.activeDrop;
    if (!data?.dropId) return null;

    const existing = drops.get(data.dropId);
    if (existing) return existing;

    const drop = {
      ...data,
      claimedBy: null,
      message: message || null,
      expiryTimer: null,
    };
    if (dropIsExpired(drop)) {
      // Erst hydrieren, damit expireDrop auch die alte Discord-Nachricht umbauen kann.
      drops.set(drop.dropId, drop);
      stateFor(drop.guildId).activeDrop = drop;
      await expireDrop(drop.dropId);
      return null;
    }

    drops.set(drop.dropId, drop);
    stateFor(drop.guildId).activeDrop = drop;
    armExpiry(drop);
    ctx.logger.info?.(`[xp-level-bot] Offenen Bonus-Drop ${drop.dropId} nach Neustart wiederhergestellt`);
    return drop;
  }

  function unstickFiredSlots(daySt, cfg, guild) {
    const untrustedVersion = daySt.planVersion !== BONUS_PLAN_VERSION;
    const untrustedSlots = !daySt.lastSentAt && daySt.firedSlots.length > 0;
    if (!untrustedVersion && !untrustedSlots) return false;
    ctx.logger.warn?.(
      `[xp-level-bot] Bonus-Plan ${guild?.name || cfg.guildId}: untrusted firedSlots ` +
        `(v${daySt.planVersion ?? '?'} → v${BONUS_PLAN_VERSION}, lastSentAt=${daySt.lastSentAt || 0}, ` +
        `slots=${JSON.stringify(daySt.firedSlots)}) – setze zurück`
    );
    daySt.firedSlots = [];
    daySt.planVersion = BONUS_PLAN_VERSION;
    daySt.lastSentAt = 0;
    cfg.bonusState = daySt;
    ctx.store.setGuild(cfg);
    void ctx.store.flush().catch(() => {});
    return true;
  }

  /**
   * Scheduler- und Chat-Einstieg. Der jüngste fällige/verpasste Slot wird
   * gesendet. Sind mehrere Termine wegen Downtime überfällig, wird nur der
   * jüngste nachgeholt und der ältere Rückstand ohne Spam abgeschlossen.
   */
  async function checkScheduled(cfg, guild, now = new Date()) {
    if (!cfg?.guildId) return false;
    const mainId = String(cfg.mainChannelId || '').trim();
    const boardId = String(cfg.leaderboardChannelId || '').trim();
    if (!mainId && !boardId) return false;

    const lang = cfg.lang || 'de';
    const dayKey = todayKey(lang, now);
    const daySt = dayState(cfg, dayKey);

    const runtimeState = stateFor(cfg.guildId);
    if (runtimeState.activeDrop && dropIsExpired(runtimeState.activeDrop)) {
      await expireDrop(runtimeState.activeDrop.dropId);
    }
    if (!runtimeState.activeDrop && daySt.activeDrop) {
      await restorePersistedDrop(cfg);
    }
    if (runtimeState.activeDrop && !dropIsExpired(runtimeState.activeDrop)) return false;

    const plan = planDailyBonusSlots(cfg.guildId, dayKey, seededRngForDay(cfg.guildId, dayKey));
    unstickFiredSlots(daySt, cfg, guild);

    const minuteOfDay = currentMinuteOfDay(lang, now);
    if (!Number.isFinite(minuteOfDay)) {
      ctx.logger.warn?.(
        `[xp-level-bot] Bonus: ungültige Ortszeit für ${guild?.name || cfg.guildId} (lang=${lang})`
      );
      return false;
    }
    if (!daySt.loggedPlan) {
      ctx.logger.info?.(
        `[xp-level-bot] Bonus-Plan ${guild?.name || cfg.guildId} ${dayKey}: ` +
          `${plan.map(prettySlot).join(', ') || '–'} (jetzt ${prettySlot(minuteOfDay)})`
      );
      daySt.loggedPlan = true;
      cfg.bonusState = daySt;
      ctx.store.setGuild(cfg);
    }
    const ready = plan
      .filter((slot) => slot <= minuteOfDay && !hasSlot(daySt.firedSlots, slot))
      .sort((a, b) => a - b);
    if (!ready.length) return false;

    // Nur den jüngsten überfälligen Slot senden. Ältere Rückstände werden erst
    // NACH erfolgreichem Send als übersprungen markiert.
    const due = ready[ready.length - 1];
    const skipped = ready.slice(0, -1);
    return sendDrop(cfg, guild, daySt, due, skipped);
  }

  /**
   * Von messageCreate: prüft fällige Drops, sobald wirklich jemand schreibt.
   * Gedrosselt, damit ein aktiver Chat den Discord-Rate-Limit nicht sprengt.
   */
  function kickFromActivity(cfg, guild, now = new Date()) {
    if (!cfg?.guildId) return Promise.resolve(false);
    const ts = Date.now();
    const last = lastActivityKick.get(cfg.guildId) || 0;
    if (ts - last < BONUS_ACTIVITY_KICK_MS) return Promise.resolve(false);
    lastActivityKick.set(cfg.guildId, ts);
    return checkScheduled(cfg, guild, now).catch((err) => {
      ctx.logger.warn?.(`[xp-level-bot] Bonus-Kick fehlgeschlagen: ${err?.message || err}`);
      return false;
    });
  }

  async function fetchTextChannel(channelId, guild) {
    const id = String(channelId || '').trim();
    if (!id) return null;
    const cached = guild?.channels?.cache?.get?.(id);
    if (cached?.isTextBased?.()) return cached;
    try {
      const channel = await ctx.client.channels.fetch(id);
      if (channel?.isTextBased?.()) return channel;
    } catch {}
    try {
      const channel = await guild?.channels?.fetch?.(id);
      if (channel?.isTextBased?.()) return channel;
    } catch {}
    return null;
  }

  async function resolveMainChannel(cfg, guild) {
    const main = await fetchTextChannel(cfg.mainChannelId, guild);
    if (main) return main;
    // Fallback: lieber im Leaderboard-Kanal posten als den ganzen Tag ausfallen.
    return fetchTextChannel(cfg.leaderboardChannelId, guild);
  }

  async function sendBonusMessage(channel, { lang, xp, dropId, guildName }) {
    const label = guildName || channel?.id || '?';
    try {
      return await channel.send(componentsV2Payload([buildBonusDropEmbed({ lang, xp, dropId })]));
    } catch (err) {
      ctx.logger.warn?.(
        `[xp-level-bot] Bonus V2-Send fehlgeschlagen (${label}): ${err?.message || err} – versuche klassisches Embed`
      );
    }
    try {
      return await channel.send(
        classicBonusPayload({
          title: t('bonusTitle', lang),
          body: t('bonusBody', lang, { xp }),
          dropId,
          lang,
        })
      );
    } catch (err) {
      ctx.logger.warn?.(
        `[xp-level-bot] Bonus Embed-Send fehlgeschlagen (${label}): ${err?.message || err} – versuche Plain-Text`
      );
    }
    try {
      return await channel.send({
        content: `# ${t('bonusTitle', lang)}\n${t('bonusBody', lang, { xp })}\n\u200Bxp-bonus:${dropId}\u200B`,
        components: [new ActionRowBuilder().addComponents(claimButton(lang, dropId))],
      });
    } catch (err) {
      ctx.logger.warn?.(`[xp-level-bot] Bonus-Drop Send komplett fehlgeschlagen (${label}): ${err?.message || err}`);
      return null;
    }
  }

  async function sendDrop(cfg, guild, daySt, slot, skippedSlots = []) {
    const lang = cfg.lang || 'de';
    const channel = await resolveMainChannel(cfg, guild);
    if (!channel) {
      ctx.logger.warn(`[xp-level-bot] Bonus-Hauptkanal ${cfg.mainChannelId} in ${guild?.name || cfg.guildId} nicht erreichbar`);
      return false;
    }

    const xp = rollBonusXp(rng);
    const dropId = randomDropId();
    const sent = await sendBonusMessage(channel, { lang, xp, dropId, guildName: guild?.name });
    if (!sent) return false;

    const drop = {
      dropId,
      guildId: cfg.guildId,
      channelId: channel.id || cfg.mainChannelId,
      messageId: sent.id,
      xp,
      lang,
      claimedBy: null,
      createdAt: Date.now(),
      message: sent,
      expiryTimer: null,
    };
    armExpiry(drop);
    stateFor(cfg.guildId).activeDrop = drop;
    drops.set(dropId, drop);

    // Erst nach erfolgreichem Discord-Send abschließen. So werden Sendefehler
    // beim nächsten Tick / der nächsten Nachricht automatisch erneut versucht.
    daySt.firedSlots = normalizeFiredSlots([...daySt.firedSlots, ...skippedSlots, slot]);
    daySt.planVersion = BONUS_PLAN_VERSION;
    cfg.bonusState = daySt;
    persistOpenDrop(cfg, drop);

    const catchup = skippedSlots.length || currentMinuteOfDay(lang, new Date()) > slot
      ? `, Nachholung; ${skippedSlots.length} älter übersprungen`
      : '';
    ctx.logger.info(
      `[xp-level-bot] Bonus-Drop in ${guild?.name || cfg.guildId}: ${xp} XP, Slot ${prettySlot(slot)} (${daySt.dayKey}${catchup})`
    );
    return true;
  }

  async function fetchDropMessage(drop) {
    let channel = null;
    try { channel = await ctx.client.channels.fetch(drop.channelId); } catch {}
    if (!channel?.isTextBased?.()) return null;
    return channel.messages.fetch(drop.messageId).catch(() => null);
  }

  function clearPersistedDrop(drop) {
    const cfg = ctx.store.getGuild(drop.guildId);
    if (cfg?.bonusState?.activeDrop?.dropId === drop.dropId) persistOpenDrop(cfg, null);
  }

  function cleanupGuildSlot(drop) {
    if (drop.expiryTimer) clearTimeout(drop.expiryTimer);
    const state = states.get(drop.guildId);
    if (state?.activeDrop?.dropId === drop.dropId) state.activeDrop = null;
    drops.delete(drop.dropId);
    clearPersistedDrop(drop);
  }

  async function editDropMessage(message, { kind, lang, xp, dropId, claimerId }) {
    const v2 = kind === 'claimed'
      ? buildBonusClaimedEmbed({ lang, xp, claimerId, dropId })
      : buildBonusExpiredEmbed({ lang, xp, dropId });
    try {
      await message.edit(componentsV2Payload([v2]));
      return;
    } catch (err) {
      ctx.logger.warn?.(
        `[xp-level-bot] Bonus-${kind} V2-Edit fehlgeschlagen: ${err?.message || err} – versuche klassisches Embed`
      );
    }
    const classic = classicBonusPayload({
      title: t(kind === 'claimed' ? 'bonusClaimedTitle' : 'bonusExpiredTitle', lang),
      body: kind === 'claimed'
        ? t('bonusClaimedBody', lang, { user: `<@${claimerId}>`, xp })
        : t('bonusExpiredBody', lang, { xp }),
      dropId,
      lang,
      disabled: true,
    });
    try {
      await message.edit(classic);
    } catch (err) {
      ctx.logger.warn?.(`[xp-level-bot] Bonus-${kind} Edit komplett fehlgeschlagen: ${err?.message || err}`);
    }
  }

  /** Drop ohne Gewinner verfallen lassen und den Button deaktivieren. */
  async function expireDrop(dropId) {
    const drop = drops.get(dropId);
    if (!drop || drop.claimedBy) return;
    cleanupGuildSlot(drop);
    try {
      const message = drop.message || (await fetchDropMessage(drop));
      if (message) {
        await editDropMessage(message, { kind: 'expired', lang: drop.lang, xp: drop.xp, dropId });
      }
    } catch (err) {
      ctx.logger.warn?.(`[xp-level-bot] Bonus-Verfallsnachricht ${dropId} konnte nicht editiert werden: ${err?.message || err}`);
    }
    ctx.logger.info(`[xp-level-bot] Bonus-Drop ${dropId} verfallen (1 Stunde abgelaufen)`);
  }

  /** Der erste atomar verarbeitete Button-Klick gewinnt. */
  async function handleClaim(interaction) {
    const dropId = interaction.customId.slice(BONUS_CLAIM_PREFIX.length);
    let drop = drops.get(dropId);
    const storedCfg = ctx.store.getGuild(interaction.guildId);

    // Nach Neustart direkt aus der Persistenz hydrieren – der Button bleibt gültig.
    if (!drop && storedCfg?.bonusState?.activeDrop?.dropId === dropId) {
      drop = await restorePersistedDrop(storedCfg, interaction.message || null);
    }

    if (!drop || drop.claimedBy || Date.now() - drop.createdAt >= BONUS_CLAIM_MS) {
      if (drop && !drop.claimedBy) await expireDrop(drop.dropId);
      const lang = storedCfg?.lang || 'en';
      try {
        return await interaction.reply(
          componentsV2Payload([smallContainer(null, t('bonusGone', lang))], { ephemeral: false })
        );
      } catch {
        return interaction.reply({ content: t('bonusGone', lang) }).catch(() => {});
      }
    }

    // Vor dem ersten await setzen: Im JS-Event-Loop kann kein zweiter Handler gewinnen.
    drop.claimedBy = interaction.user.id;
    cleanupGuildSlot(drop);

    const cfg = storedCfg || ctx.store.getGuild(drop.guildId);
    const lang = drop.lang || cfg?.lang || 'en';
    const user = ctx.store.ensureUser(drop.guildId, interaction.user.id);
    const res = applyXpGain(user, drop.xp);
    user.level = res.level;
    user.xp = res.xp;
    user.lastActivity = Date.now();
    user.inactiveDays = 0;
    ctx.store.setUser(user);
    const levelFlush = res.leveled ? ctx.store.flush().catch(() => {}) : null;

    try {
      await interaction.update(
        componentsV2Payload([
          buildBonusClaimedEmbed({ lang, xp: drop.xp, claimerId: interaction.user.id, dropId }),
        ])
      );
    } catch {
      await interaction.update(
        classicBonusPayload({
          title: t('bonusClaimedTitle', lang),
          body: t('bonusClaimedBody', lang, { user: `<@${interaction.user.id}>`, xp: drop.xp }),
          dropId,
          lang,
          disabled: true,
        })
      ).catch((err) => {
        ctx.logger.warn?.(`[xp-level-bot] Bonus-Claim Update fehlgeschlagen: ${err?.message || err}`);
      });
    }
    await interaction
      .followUp(
        componentsV2Payload([smallContainer(null, t('bonusClaimedYou', lang, { xp: drop.xp }))], {
          ephemeral: false,
        })
      )
      .catch(() => {});

    const guild = ctx.client.guilds.cache.get(drop.guildId) || interaction.guild;
    if (guild && cfg) {
      const sourceMsg = interaction.message && typeof interaction.message.reply === 'function'
        ? interaction.message
        : drop.message;
      try {
        if (res.leveledUp || res.leveledDown) {
          if (onLevelChange) await onLevelChange(guild, cfg, user, res, sourceMsg);
        } else if (onXpOnly) {
          await onXpOnly(guild, cfg, user, interaction.user.id);
        }
      } catch (err) {
        ctx.logger.warn('[xp-level-bot] Bonus Level-Up-Nachbereitung fehlgeschlagen:', err?.message || err);
      }
    }
    if (levelFlush) await levelFlush;
  }

  return {
    checkScheduled,
    kickFromActivity,
    handleClaim,
    expireDrop,
    restorePersistedDrop,
    states,
    drops,
  };
}

module.exports = { createBonusDropper, BONUS_CLAIM_PREFIX, BONUS_PLAN_VERSION, BONUS_ACTIVITY_KICK_MS };
