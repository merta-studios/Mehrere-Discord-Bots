/**
 * Geplante XP-Belohnungen im Haupt-Chat.
 *
 * Pro Server entstehen täglich 2–4 deterministische Termine (Server-ID +
 * lokales Datum). Der Scheduler prüft unabhängig vom Leaderboard minütlich.
 * Überfällige Termine werden nicht mehr nach wenigen Minuten für immer
 * verworfen: Nach Schlaf/Deployment wird der jüngste verpasste Termin einmalig
 * nachgeholt; ältere Rückstände werden als übersprungen markiert, damit keine
 * Geschenk-Flut entsteht.
 *
 * Ein offener Drop wird vollständig in `bonusState.activeDrop` persistiert.
 * Dadurch funktioniert sein Button auch nach einem Bot-/Render-Neustart weiter.
 */

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
const BONUS_PLAN_VERSION = 2; // v2: alle Slots liegen eindeutig im selben Kalendertag

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

function createBonusDropper({ ctx, onLevelChange, onXpOnly, rng = Math.random }) {
  // guildId -> { activeDrop }
  const states = new Map();
  // dropId -> vollständig hydrierter Drop für den Button-Handler
  const drops = new Map();

  function stateFor(guildId) {
    let state = states.get(guildId);
    if (!state) {
      state = { activeDrop: null };
      states.set(guildId, state);
    }
    return state;
  }

  /** Persistierter Tageszustand; einen noch gültigen offenen Drop bewahren. */
  function dayState(cfg, dayKey) {
    let state = cfg.bonusState;
    if (!state || state.dayKey !== dayKey) {
      const open = state?.activeDrop || null;
      state = { dayKey, planVersion: BONUS_PLAN_VERSION, firedSlots: [], activeDrop: open };
      cfg.bonusState = state;
      ctx.store.setGuild(cfg);
    }
    if (!Array.isArray(state.firedSlots)) state.firedSlots = [];
    return state;
  }

  function persistOpenDrop(cfg, drop) {
    const state = cfg.bonusState || {
      dayKey: todayKey(cfg.lang || 'de'),
      planVersion: BONUS_PLAN_VERSION,
      firedSlots: [],
    };
    state.activeDrop = drop ? serializedDrop(drop) : null;
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
    if (Date.now() - drop.createdAt >= BONUS_CLAIM_MS) {
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

  /**
   * Minütlicher Scheduler-Einstieg. Der jüngste fällige/verpasste Slot wird
   * gesendet. Sind mehrere Termine wegen Downtime überfällig, wird nur der
   * jüngste nachgeholt und der ältere Rückstand ohne Spam abgeschlossen.
   */
  async function checkScheduled(cfg, guild, now = new Date()) {
    if (!cfg?.guildId || !cfg.mainChannelId || !cfg.leaderboardChannelId) return false;
    const lang = cfg.lang || 'de';
    const dayKey = todayKey(lang, now);
    const daySt = dayState(cfg, dayKey);

    const runtimeState = stateFor(cfg.guildId);
    if (!runtimeState.activeDrop && daySt.activeDrop) {
      await restorePersistedDrop(cfg);
    }
    if (runtimeState.activeDrop) return false;

    const plan = planDailyBonusSlots(cfg.guildId, dayKey, seededRngForDay(cfg.guildId, dayKey));
    if (daySt.planVersion !== BONUS_PLAN_VERSION) {
      // Einmalige Migration vom alten 06:00–00:30-Plan: Die exakten Minuten
      // haben sich leicht verschoben. Bereits gesendete ANZAHL auf die ersten
      // neuen Slots abbilden, damit am Deployment-Tag nichts doppelt erscheint.
      const alreadySent = Math.min(daySt.firedSlots.length, plan.length);
      daySt.firedSlots = plan.slice(0, alreadySent);
      daySt.planVersion = BONUS_PLAN_VERSION;
      cfg.bonusState = daySt;
      ctx.store.setGuild(cfg);
      void ctx.store.flush().catch(() => {});
    }
    const minuteOfDay = currentMinuteOfDay(lang, now);
    const ready = plan
      .filter((slot) => slot <= minuteOfDay && !daySt.firedSlots.includes(slot))
      .sort((a, b) => a - b);
    if (!ready.length) return false;

    const due = ready[ready.length - 1];
    const skipped = ready.slice(0, -1);
    return sendDrop(cfg, guild, daySt, due, skipped);
  }

  async function resolveMainChannel(cfg, guild) {
    const cached = guild?.channels?.cache?.get?.(cfg.mainChannelId);
    if (cached?.isTextBased?.()) return cached;
    try {
      const channel = await ctx.client.channels.fetch(cfg.mainChannelId);
      if (channel?.isTextBased?.()) return channel;
    } catch {}
    try {
      const channel = await guild.channels.fetch(cfg.mainChannelId);
      if (channel?.isTextBased?.()) return channel;
    } catch {}
    return null;
  }

  async function sendDrop(cfg, guild, daySt, slot, skippedSlots = []) {
    const lang = cfg.lang || 'de';
    const channel = await resolveMainChannel(cfg, guild);
    if (!channel) {
      ctx.logger.warn(`[xp-level-bot] Bonus-Hauptkanal ${cfg.mainChannelId} in ${guild.name} nicht erreichbar`);
      return false;
    }

    const xp = rollBonusXp(rng);
    const dropId = randomDropId();
    const sent = await channel
      .send(componentsV2Payload([buildBonusDropEmbed({ lang, xp, dropId })]))
      .catch((err) => {
        ctx.logger.warn(`[xp-level-bot] Bonus-Drop Send fehlgeschlagen (${guild.name}): ${err?.message || err}`);
        return null;
      });
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
    // beim nächsten Minutentick automatisch erneut versucht.
    daySt.firedSlots.push(...skippedSlots, slot);
    daySt.firedSlots = [...new Set(daySt.firedSlots)].sort((a, b) => a - b);
    cfg.bonusState = daySt;
    persistOpenDrop(cfg, drop);

    const catchup = skippedSlots.length || currentMinuteOfDay(lang, new Date()) > slot
      ? `, Nachholung; ${skippedSlots.length} älter übersprungen`
      : '';
    ctx.logger.info(
      `[xp-level-bot] Bonus-Drop in ${guild.name}: ${xp} XP, Slot ${slot} (${daySt.dayKey}${catchup})`
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

  /** Drop ohne Gewinner verfallen lassen und den Button deaktivieren. */
  async function expireDrop(dropId) {
    const drop = drops.get(dropId);
    if (!drop || drop.claimedBy) return;
    cleanupGuildSlot(drop);
    try {
      const message = drop.message || (await fetchDropMessage(drop));
      if (message) {
        await message.edit(
          componentsV2Payload([buildBonusExpiredEmbed({ lang: drop.lang, xp: drop.xp, dropId })])
        );
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
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('bonusGone', lang))], { ephemeral: true })
      );
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

    await interaction.update(
      componentsV2Payload([
        buildBonusClaimedEmbed({ lang, xp: drop.xp, claimerId: interaction.user.id, dropId }),
      ])
    );
    await interaction
      .followUp(
        componentsV2Payload([smallContainer(null, t('bonusClaimedYou', lang, { xp: drop.xp }))], {
          ephemeral: true,
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
    handleClaim,
    expireDrop,
    restorePersistedDrop,
    states,
    drops,
  };
}

module.exports = { createBonusDropper, BONUS_CLAIM_PREFIX };
