/**
 * Bonus-Belohnungen – zufällige XP-Geschenke im Haupt-Chat.
 *
 * Auslösung (alles muss passen):
 * - Aktivitäts-Burst im Haupt-Chat: >=8 Nachrichten von >=2 Personen in 75s
 * - Würfel: nur mit 25% Chance pro Burst (nicht bei jedem Gespräch!)
 * - Maximal 4 Drops pro Tag (Kalendertag in der Sprach-Zeitzone, persistiert)
 * - Mindestabstand zwischen zwei Drops: 1 Stunde 30 Minuten
 * - Es ist immer nur ein Drop pro Server gleichzeitig offen
 *
 * Der Drop ist ein Container mit „Einsammeln“-Button: Der ERSTE Klick gewinnt
 * die (vorher ausgewürfelte) XP-Zahl. Danach bleibt der Button an der
 * Nachricht, wird aber deaktiviert, und im Text steht mit Ping, wer schneller
 * war. Ungenutzte Drops verfallen nach 10 Minuten.
 */

const {
  rollBonusXp,
  detectBurst,
  canDropBonus,
  applyXpGain,
  todayKey,
  BONUS_DROP_CHANCE,
  BONUS_ROLL_COOLDOWN_MS,
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
const EVALUATE_MIN_MS = 3_000; // Burst-Auswertung frühestens alle 3s pro Gilde

function randomDropId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * @param {object} opts.ctx Bot-Kontext (client, store, logger, …)
 * @param {Function} opts.onLevelChange Callback (guild, cfg, user, res, sourceMsg)
 *        für Level-Up/Down-Nebenwirkungen (Nickname, Rollen, Leaderboard, Ansage)
 * @param {Function} opts.onXpOnly optionaler Callback für XP-Gewinn ohne Level-Change
 */
function createBonusDropper({ ctx, onLevelChange, onXpOnly, rng = Math.random, evaluateMinMs = EVALUATE_MIN_MS }) {
  // guildId -> { window: [{uid, ts}], lastEvaluateAt, lastRollAt, activeDrop }
  const states = new Map();
  // dropId -> drop (für den Claim-Button, damit der Klick den Drop findet)
  const drops = new Map();

  function stateFor(guildId) {
    let s = states.get(guildId);
    if (!s) {
      s = { window: [], lastEvaluateAt: 0, lastRollAt: 0, activeDrop: null };
      states.set(guildId, s);
    }
    return s;
  }

  /** Persistierter Tages-Zähler (überlebt Restarts), zurückgesetzt bei Tageswechsel. */
  function dayState(cfg) {
    const dayKey = todayKey(cfg.lang || 'de');
    let st = cfg.bonusState;
    if (!st || st.dayKey !== dayKey) {
      st = { dayKey, count: 0, lastDropAt: st?.lastDropAt || 0 };
      cfg.bonusState = st;
      ctx.store.setGuild(cfg);
    }
    return st;
  }

  /**
   * Wird bei jeder Nachricht im Haupt-Chat aufgerufen (Bots/Webhooks filtert
   * der Aufrufer schon raus). Zählt Fenster, erkennt Bursts, würfelt.
   */
  async function onMessage(msg, cfg) {
    if (!cfg || !cfg.mainChannelId || msg.channel.id !== cfg.mainChannelId) return;
    // Ohne aktives XP-System (kein Leaderboard = pausiert) gibt es keine Boni
    if (!cfg.leaderboardChannelId) return;

    const now = Date.now();
    const state = stateFor(msg.guild.id);
    state.window.push({ uid: msg.author.id, ts: now });

    // Auswertung drosseln (sonst rechnen wir bei jedem Burst je Nachricht)
    if (now - state.lastEvaluateAt < evaluateMinMs) return;
    state.lastEvaluateAt = now;

    if (!detectBurst(state.window, now)) return;

    // Nach einer Burst-Wertung (egal ob Treffer oder nicht) 10 min Ruhe –
    // sonst würde ein langes Gespräch Dutzende Würfe hintereinander auslösen
    if (now - state.lastRollAt < BONUS_ROLL_COOLDOWN_MS) return;
    state.lastRollAt = now;
    state.window = []; // Fenster zurücksetzen: nächster Burst muss sich neu aufbauen

    // Nur ein offener Drop pro Server gleichzeitig
    if (state.activeDrop) return;

    // Tageslimit (4) + Mindestabstand (1h30) – persistiert im Guild-Config
    const daySt = dayState(cfg);
    if (!canDropBonus(daySt, now)) return;

    // Nicht bei jedem Gespräch: 25% Chance
    if (rng() >= BONUS_DROP_CHANCE) return;

    await sendDrop(msg, cfg, state, daySt).catch((e) =>
      ctx.logger.warn('[xp-level-bot] Bonus-Drop fehlgeschlagen:', e.message)
    );
  }

  async function sendDrop(msg, cfg, state, daySt) {
    const lang = cfg.lang || 'de';
    // XP-Zahl ZUERST würfeln, dann in die Nachricht schreiben
    const xp = rollBonusXp(rng);
    const dropId = randomDropId();
    const container = buildBonusDropEmbed({ lang, xp, dropId });
    const sent = await msg.channel.send(componentsV2Payload([container])).catch(() => null);
    if (!sent) return; // ohne Nachricht keinen Zähler erhöhen

    const drop = {
      dropId,
      guildId: msg.guild.id,
      channelId: msg.channel.id,
      messageId: sent.id,
      xp,
      lang,
      claimedBy: null,
      createdAt: Date.now(),
      message: sent,
      expiryTimer: null,
    };
    drop.expiryTimer = setTimeout(() => void expireDrop(dropId).catch(() => {}), BONUS_CLAIM_MS);
    if (drop.expiryTimer.unref) drop.expiryTimer.unref();

    state.activeDrop = drop;
    drops.set(dropId, drop);

    // Tageszähler + Abstand persistieren (überlebt Restarts)
    daySt.count = (daySt.count || 0) + 1;
    daySt.lastDropAt = Date.now();
    cfg.bonusState = daySt;
    ctx.store.setGuild(cfg);
    void ctx.store.flush().catch(() => {});

    ctx.logger.info(`[xp-level-bot] Bonus-Drop in ${msg.guild.name}: ${xp} XP (Tag ${daySt.count}/4)`);
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
    ctx.logger.info(`[xp-level-bot] Bonus-Drop ${dropId} verfallen (niemand war schnell genug)`);
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

    // Drop unbekannt (Bot-Neustart) oder schon weg → der Dropslot & die
    // Nachricht passen nicht mehr zusammen → ehrlich antworten.
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

    // XP gutschreiben (zählt als Aktivität gegen den Inaktivitäts-Streak)
    const user = ctx.store.ensureUser(drop.guildId, interaction.user.id);
    const res = applyXpGain(user, drop.xp);
    user.level = res.level;
    user.xp = res.xp;
    user.lastActivity = Date.now();
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

  return { onMessage, handleClaim, expireDrop, states, drops };
}

module.exports = { createBonusDropper, BONUS_CLAIM_PREFIX };
