/**
 * Bonus-Belohnungen – geplante XP-Geschenke im Haupt-Chat.
 *
 * Statt Aktivitäts-Bursts (mit 35% Zufallsschwelle) gibt es jetzt für jeden
 * Server 2–4 FEST GEPLANTE Drops pro Kalendertag (in der Sprach-Zeitzone):
 * - Anzahl + Uhrzeiten werden deterministisch aus (Guild-ID + Tag) abgeleitet
 *   → über Neustarts stabil, und für jeden Server unterschiedlich
 * - alle Termine liegen mindestens 1 Stunde auseinander
 * - nur zwischen 06:00 und 00:30 Uhr Ortszeit (kein mitten in der Nacht)
 * - ein Drop ist 1 Stunde lang einsammelbar (BONUS_CLAIM_MS) und verfällt dann
 *
 * Ausgelöst wird das über `checkScheduled(cfg, guild, now)`, das der Scheduler
 * minütlich pro Gilde aufruft. Der Drop ist ein Container mit „Einsammeln“-
 * Button: Der ERSTE Klick gewinnt die (vorher ausgewürfelte) XP-Zahl. Danach
 * wird der Button deaktiviert und im Text steht mit Ping, wer schneller war.
 * Ungenutzte Drops verfallen nach 1 Stunde. Wer einsammelt, gilt als aktiv –
 * sein täglicher XP-Schwund (Decay) fällt damit zurück auf die Basis von 10%.
 */

const {
  rollBonusXp,
  todayKey,
  seededRngForDay,
  planDailyBonusSlots,
  currentMinuteOfDay,
  isSlotDue,
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

function randomDropId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * @param {object} opts.ctx Bot-Kontext (client, store, logger, …)
 * @param {Function} opts.onLevelChange Callback (guild, cfg, user, res, sourceMsg)
 *        für Level-Up/Down-Nebenwirkungen (Nickname, Rollen, Leaderboard, Ansage)
 * @param {Function} opts.onXpOnly optionaler Callback für XP-Gewinn ohne Level-Change
 * @param {Function} opts.rng injizierbar für Tests (XP-Würfel)
 */
function createBonusDropper({ ctx, onLevelChange, onXpOnly, rng = Math.random }) {
  // guildId -> { activeDrop }
  const states = new Map();
  // dropId -> drop (für den Claim-Button, damit der Klick den Drop findet)
  const drops = new Map();

  function stateFor(guildId) {
    let s = states.get(guildId);
    if (!s) {
      s = { activeDrop: null };
      states.set(guildId, s);
    }
    return s;
  }

  /** Persistierter Tages-Zustand (überlebt Restarts), bei Tageswechsel neu. */
  function dayState(cfg, dayKey) {
    let st = cfg.bonusState;
    if (!st || st.dayKey !== dayKey) {
      st = { dayKey, firedSlots: [] };
      cfg.bonusState = st;
      ctx.store.setGuild(cfg);
    }
    return st;
  }

  /**
   * Vom Scheduler minütlich pro Gilde aufgerufen. Findet den fälligsten,
   * noch nicht gesendeten Slot des Tages und sendet den Drop in den Haupt-Chat.
   */
  async function checkScheduled(cfg, guild, now = new Date()) {
    if (!cfg || !cfg.guildId || !cfg.mainChannelId || !cfg.leaderboardChannelId) return;
    const lang = cfg.lang || 'de';
    const dayKey = todayKey(lang);
    const daySt = dayState(cfg, dayKey);

    // Nur ein offener Drop pro Server gleichzeitig
    const state = stateFor(cfg.guildId);
    if (state.activeDrop) return;

    // Deterministischer Plan für diesen Server + Tag
    const plan = planDailyBonusSlots(cfg.guildId, dayKey, seededRngForDay(cfg.guildId, dayKey));
    const minuteOfDay = currentMinuteOfDay(lang, now);

    // Fälligster, noch nicht gesendeter Slot (innerhalb der Toleranz)
    const due = plan
      .filter((s) => !daySt.firedSlots.includes(s) && isSlotDue(s, minuteOfDay))
      .sort((a, b) => a - b)[0];
    if (due === undefined) return;

    await sendDrop(cfg, guild, daySt, due).catch((e) =>
      ctx.logger.warn('[xp-level-bot] Bonus-Drop fehlgeschlagen:', e.message)
    );
  }

  async function sendDrop(cfg, guild, daySt, slot) {
    const lang = cfg.lang || 'de';
    const channel = await ctx.client.channels.fetch(cfg.mainChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    // XP-Zahl würfeln, dann in die Nachricht schreiben
    const xp = rollBonusXp(rng);
    const dropId = randomDropId();
    const container = buildBonusDropEmbed({ lang, xp, dropId });
    const sent = await channel.send(componentsV2Payload([container])).catch(() => null);
    if (!sent) return; // ohne Nachricht keinen Slot als gesendet markieren

    const drop = {
      dropId,
      guildId: cfg.guildId,
      channelId: cfg.mainChannelId,
      messageId: sent.id,
      xp,
      lang,
      claimedBy: null,
      createdAt: Date.now(),
      message: sent,
      expiryTimer: null,
    };
    // 1 Stunde Gültigkeit – danach verfällt der Drop unwiderruflich
    drop.expiryTimer = setTimeout(() => void expireDrop(dropId).catch(() => {}), BONUS_CLAIM_MS);
    if (drop.expiryTimer.unref) drop.expiryTimer.unref();

    stateFor(cfg.guildId).activeDrop = drop;
    drops.set(dropId, drop);

    // Slot als gesendet markieren (persistiert, überlebt Neustarts)
    daySt.firedSlots.push(slot);
    cfg.bonusState = daySt;
    ctx.store.setGuild(cfg);
    void ctx.store.flush().catch(() => {});

    ctx.logger.info(`[xp-level-bot] Bonus-Drop in ${guild.name}: ${xp} XP um ${slot} Min (Tag ${daySt.dayKey})`);
  }

  /** Drop ohne Gewinner verfallen lassen: Nachricht umbauen, Button deaktivieren. */
  async function expireDrop(dropId) {
    const drop = drops.get(dropId);
    if (!drop || drop.claimedBy) return;
    drops.delete(dropId);
    const state = states.get(drop.guildId);
    if (state?.activeDrop?.dropId === dropId) state.activeDrop = null;
    try {
      const msg = drop.message || (await fetchDropMessage(drop));
      if (msg) await msg.edit(componentsV2Payload([buildBonusExpiredEmbed({ lang: drop.lang, xp: drop.xp, dropId })]));
    } catch {}
    ctx.logger.info(`[xp-level-bot] Bonus-Drop ${dropId} verfallen (1 Stunde abgelaufen)`);
  }

  async function fetchDropMessage(drop) {
    const channel = await ctx.client.channels.fetch(drop.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;
    return channel.messages.fetch(drop.messageId).catch(() => null);
  }

  function cleanupGuildSlot(drop) {
    if (drop.expiryTimer) clearTimeout(drop.expiryTimer);
    const state = states.get(drop.guildId);
    if (state?.activeDrop?.dropId === drop.dropId) state.activeDrop = null;
    drops.delete(drop.dropId);
  }

  /**
   * Button-Handler: nur der ERSTE Klick gewinnt. Danach wird die Nachricht
   * umgebaut (Button bleibt, ist aber deaktiviert; Text pingt den Gewinner).
   */
  async function handleClaim(interaction) {
    const dropId = interaction.customId.slice(BONUS_CLAIM_PREFIX.length);
    const drop = drops.get(dropId);

    // Drop unbekannt (Bot-Neustart) oder schon weg / abgelaufen
    if (!drop || drop.claimedBy) {
      const lang = ctx.store.getGuild(interaction.guildId)?.lang || 'en';
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('bonusGone', lang))], { ephemeral: true })
      );
    }

    // Atomar zuerst den Gewinner setzen (JS-Single-Thread: der erste Handler gewinnt)
    drop.claimedBy = interaction.user.id;
    cleanupGuildSlot(drop);

    const cfg = ctx.store.getGuild(drop.guildId);
    const lang = drop.lang || cfg?.lang || 'en';

    // XP gutschreiben (zählt als Aktivität gegen den Inaktivitäts-Decay:
    // der tägliche XP-Schwund des Einsammlers fällt zurück auf 10%)
    const user = ctx.store.ensureUser(drop.guildId, interaction.user.id);
    const res = applyXpGain(user, drop.xp);
    user.level = res.level;
    user.xp = res.xp;
    user.lastActivity = Date.now();
    user.inactiveDays = 0; // Decay-Satz wieder auf die Basis (10%)
    ctx.store.setUser(user);
    if (res.leveled) await ctx.store.flush().catch(() => {});

    // Nachricht umbauen: Button bleibt sichtbar, aber deaktiviert + Gewinner-Ping
    await interaction.update(
      componentsV2Payload([
        buildBonusClaimedEmbed({ lang, xp: drop.xp, claimerId: interaction.user.id, dropId }),
      ])
    );

    // Ephemere Bestätigung für den Gewinner
    await interaction.followUp(
      componentsV2Payload([smallContainer(null, t('bonusClaimedYou', lang, { xp: drop.xp }))], { ephemeral: true })
    ).catch(() => {});

    // Level-Up-Nebenwirkungen (Nickname, Rollen, Leaderboard, Ansage)
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
      } catch (e) {
        ctx.logger.warn('[xp-level-bot] Bonus Level-Up-Nachbereitung fehlgeschlagen:', e.message);
      }
    }
  }

  return { checkScheduled, handleClaim, expireDrop, states, drops };
}

module.exports = { createBonusDropper, BONUS_CLAIM_PREFIX };
