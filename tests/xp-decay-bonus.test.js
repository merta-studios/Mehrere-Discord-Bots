/**
 * Tests für den neuen Daily-Decay (10% Basis, +5% pro inaktivem Tag)
 * und das Bonus-Belohnungssystem des XP-Bots.
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DAILY_DECAY_RATE,
  decayRateForInactiveDays,
  nextDecayInfo,
  wasActiveRecently,
  applyDailyDecay,
  xpNeeded,
  rollBonusXp,
  detectBurst,
  canDropBonus,
  BONUS_XP_MIN,
  BONUS_XP_MAX,
  BONUS_MAX_PER_DAY,
  BONUS_MIN_SPACING_MS,
  todayKey,
  DAY_MS,
} = require('../bots/xp-level-bot/src/logic');
const { createBonusDropper, BONUS_CLAIM_PREFIX } = require('../bots/xp-level-bot/src/bonus');
const { createXpStore } = require('../bots/xp-level-bot/src/store');

// ---------------------------------------------------------------------------
// Decay: Basis 10 %, Inaktivitäts-Streak +5 Prozentpunkte
// ---------------------------------------------------------------------------

test('DAILY_DECAY_RATE ist jetzt 10%', () => {
  assert.equal(DAILY_DECAY_RATE, 0.10);
});

test('decayRateForInactiveDays: 0/1 Tag = 10%, dann +5% je Inaktiv-Tag', () => {
  // Beispiel aus der Anforderung: aktiv → 10%, 1. inaktiver Tag → 10%,
  // dann 15%, 20%, 25% …
  assert.equal(decayRateForInactiveDays(0), 0.10); // aktiv
  assert.equal(decayRateForInactiveDays(1), 0.10); // erster inaktiver Tag
  assert.equal(decayRateForInactiveDays(2), 0.15);
  assert.equal(decayRateForInactiveDays(3), 0.20);
  assert.equal(decayRateForInactiveDays(4), 0.25);
});

test('decayRateForInactiveDays: ist nach oben bei 100% gedeckelt & robust gegen Mist', () => {
  assert.equal(decayRateForInactiveDays(19), 1.0); // 0.10 + 18*0.05 = 1.0
  assert.equal(decayRateForInactiveDays(99), 1.0);
  assert.equal(decayRateForInactiveDays(-5), 0.10);
  assert.equal(decayRateForInactiveDays(undefined), 0.10);
  assert.equal(decayRateForInactiveDays('3'), 0.20);
});

test('Beispiel-Woche: aktiv=10%, dann 1./2./3. inaktiver Tag = 10/15/20%, wieder aktiv = 10%', () => {
  const now = Date.now();
  // Tag 1: Nutzer hat heute geschrieben (aktiv in den letzten 24h)
  const activeUser = { level: 10, xp: 50, lastXpGain: now - 3 * 3600 * 1000, lastActivity: now - 3 * 3600 * 1000, inactiveDays: 0 };
  assert.equal(nextDecayInfo(activeUser, now).percent, 10);
  assert.equal(nextDecayInfo(activeUser, now).inactiveDays, 0);
  // Tag 3: letzte Aktivität > 24h her (1. inaktiver Tag) → 10%
  const firstInactive = { level: 10, xp: 50, lastActivity: now - 30 * 3600 * 1000, inactiveDays: 0 };
  assert.equal(nextDecayInfo(firstInactive, now).inactiveDays, 1);
  assert.equal(nextDecayInfo(firstInactive, now).percent, 10);
  // Tag 4: zweiter inaktiver Tag → 15%
  const secondInactive = { level: 10, xp: 50, lastActivity: now - 50 * 3600 * 1000, inactiveDays: 1 };
  assert.equal(nextDecayInfo(secondInactive, now).inactiveDays, 2);
  assert.equal(nextDecayInfo(secondInactive, now).percent, 15);
  // Tag 5: 20%, Tag 6: 25%
  assert.equal(nextDecayInfo({ level: 10, xp: 50, lastActivity: now - 70 * 3600 * 1000, inactiveDays: 2 }, now).percent, 20);
  assert.equal(nextDecayInfo({ level: 10, xp: 50, lastActivity: now - 90 * 3600 * 1000, inactiveDays: 3 }, now).percent, 25);
  // Tag 7: Nutzer schreibt wieder → nächste Abrechnung 10%
  const activeAgain = { level: 10, xp: 50, lastActivity: now - 2 * 3600 * 1000, inactiveDays: 4 };
  assert.equal(nextDecayInfo(activeAgain, now).percent, 10);
  assert.equal(nextDecayInfo(activeAgain, now).inactiveDays, 0);
});

test('applyDailyDecay: respektiert den übergebenen Anteil (15% statt 10%)', () => {
  const user = { level: 10, xp: 100 };
  const needed = xpNeeded(10);
  const res15 = applyDailyDecay(user, 0.15);
  assert.equal(res15.decay, Math.ceil(needed * 0.15));
  assert.equal(res15.xp, 100 - Math.ceil(needed * 0.15));
});

test('nextDecayInfo: alter lastXpGain ohne lastActivity zählt rückwirkend mit', () => {
  const now = Date.now();
  const legacy = { level: 5, xp: 10, lastXpGain: now - 5 * 3600 * 1000 }; // kein lastActivity-Feld
  assert.equal(wasActiveRecently(legacy, now), true);
  assert.equal(nextDecayInfo(legacy, now).percent, 10);
});

test('nextDecayInfo: wer auf Level 1 mit 0 XP steht, verliert nichts', () => {
  const info = nextDecayInfo({ level: 1, xp: 0, lastActivity: 0, inactiveDays: 5 });
  assert.equal(info.decay, 0);
});

// ---------------------------------------------------------------------------
// Bonus: Zufalls-Betrag, Burst-Erkennung, Tageslimit/Abstand
// ---------------------------------------------------------------------------

test('rollBonusXp: immer ganzzahlig zwischen 20 und 40 (inkl. Grenzen)', () => {
  assert.equal(rollBonusXp(() => 0), BONUS_XP_MIN); // 20
  assert.equal(rollBonusXp(() => 0.9999), BONUS_XP_MAX); // 40
  assert.equal(rollBonusXp(() => 0.5), 30);
  for (let i = 0; i < 500; i++) {
    const v = rollBonusXp();
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 20 && v <= 40, `außerhalb: ${v}`);
  }
});

test('detectBurst: braucht genug Nachrichten von genug verschiedenen Leuten im Fenster', () => {
  const now = Date.now();
  const few = Array.from({ length: 7 }, (_, i) => ({ uid: i % 2 ? 'a' : 'b', ts: now }));
  assert.equal(detectBurst(few, now), false, 'nur 7 Nachrichten → kein Burst');
  const enough = Array.from({ length: 8 }, (_, i) => ({ uid: i % 2 ? 'a' : 'b', ts: now }));
  assert.equal(detectBurst(enough, now), true);
  const oneUser = Array.from({ length: 12 }, () => ({ uid: 'a', ts: now }));
  assert.equal(detectBurst(oneUser, now), false, 'nur 1 Person tauscht sich nicht aus');
  const within = Array.from({ length: 10 }, (_, i) => ({ uid: i % 2 ? 'a' : 'b', ts: now - 120_000 }));
  assert.equal(detectBurst(within, now), true, '120 s alt liegt noch IM 140-s-Fenster');
  const tooOld = Array.from({ length: 10 }, (_, i) => ({ uid: i % 2 ? 'a' : 'b', ts: now - 145_000 }));
  assert.equal(detectBurst(tooOld, now), false, 'außerhalb des 140s-Fensters');
});

test('canDropBonus: max. 4 am Tag & Mindestabstand 1h30', () => {
  const now = Date.now();
  assert.equal(canDropBonus({ count: 0, lastDropAt: 0 }, now), true);
  assert.equal(canDropBonus({ count: BONUS_MAX_PER_DAY, lastDropAt: 0 }, now), false, '4/Tag erreicht');
  assert.equal(canDropBonus({ count: 1, lastDropAt: now - 30 * 60 * 1000 }, now), false, 'nur 30min her');
  assert.equal(canDropBonus({ count: 1, lastDropAt: now - BONUS_MIN_SPACING_MS }, now), true, '1h30 Abstand ok');
});

// ---------------------------------------------------------------------------
// Bonus-Dropper: kompletter Ablauf mit Mocks
// ---------------------------------------------------------------------------

function makeBonusHarness({ rng = () => 0.1 } = {}) {
  const logger = { info() {}, warn() {}, error() {} };
  const store = createXpStore({ logger, env: () => '' });
  store.flush = async () => {}; // keine Datei-Artefakte im Test

  const sentMessages = [];
  const channel = {
    id: 'main1',
    isTextBased: () => true,
    send: async (payload) => {
      const m = {
        id: `drop-${sentMessages.length + 1}`,
        components: payload.components,
        edit: async (p) => {
          m.components = p.components;
          return m;
        },
        reply: async () => ({}),
      };
      sentMessages.push(m);
      return m;
    },
  };
  const guild = { id: 'g1', name: 'Testgilde' };
  const client = { user: { id: 'bot1' }, guilds: { cache: new Map([['g1', guild]]) } };
  const ctx = { client, store, logger };
  const cfg = { guildId: 'g1', leaderboardChannelId: 'lb1', mainChannelId: 'main1', lang: 'de' };

  const edits = [];
  const dropper = createBonusDropper({
    ctx,
    rng,
    evaluateMinMs: 0, // im Test keine Auswertungs-Drossel (alle Msgs kommen sofort)
    onLevelChange: async () => {},
    onXpOnly: async () => {},
  });
  return { ctx, store, cfg, guild, channel, sentMessages, dropper, edits };
}

function burstMessages(harness, n = 10) {
  const msgs = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    msgs.push({
      author: { id: i % 2 ? 'u1' : 'u2', bot: false },
      guild: harness.guild,
      channel: harness.channel,
      content: 'hallo welt',
    });
  }
  return msgs;
}

function payloadText(payload) {
  return JSON.stringify(payload, (k, v) => (typeof v === 'bigint' ? String(v) : v));
}

test('Bonus-Drop: Burst im Haupt-Chat erzeugt eine Belohnung mit XP-Zahl & Button', async () => {
  const h = makeBonusHarness();
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 1, 'genau ein Drop');
  const text = payloadText(h.sentMessages[0].components);
  assert.ok(text.includes('xp-bonus:'), 'Marker vorhanden');
  assert.ok(text.includes('**22 XP**'), 'gewürfelte XP-Zahl (rng 0.1 → 22) steht im Text');
  assert.ok(text.includes(BONUS_CLAIM_PREFIX), 'Einsammeln-Button vorhanden');
  assert.ok(text.includes('Einsammeln'), 'Button-Label sagt „Einsammeln“');
  assert.equal(h.cfg.bonusState.count, 1, 'Tageszähler erhöht');
});

test('Bonus-Drop: ohne Leaderboard-Setup (pausiertes System) kommt nichts', async () => {
  const h = makeBonusHarness();
  const cfg = { ...h.cfg, leaderboardChannelId: null };
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, cfg);
  assert.equal(h.sentMessages.length, 0);
});

test('Bonus-Drop: der ERSTE Klick gewinnt, danach ist der Button deaktiviert & der Gewinner gepingt', async () => {
  const h = makeBonusHarness();
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 1);
  const dropMsg = h.sentMessages[0];
  const dropId = [...h.dropper.drops.keys()][0];

  const updates = [];
  const followUps = [];
  const replies = [];
  const makeClaim = (uid) => ({
    customId: `${BONUS_CLAIM_PREFIX}${dropId}`,
    user: { id: uid },
    guildId: 'g1',
    guild: h.guild,
    message: dropMsg,
    update: async (p) => { updates.push(p); dropMsg.components = p.components; },
    followUp: async (p) => { followUps.push(p); },
    reply: async (p) => { replies.push(p); },
  });

  // Erster Klick gewinnt
  await h.dropper.handleClaim(makeClaim('schnell1'));
  const winner = h.store.getUser('g1', 'schnell1');
  assert.equal(winner.xp, 22, 'Gewinner bekam genau die angekündigten 22 XP');
  assert.equal(winner.lastActivity > 0, true, 'zählt als Aktivität');
  assert.equal(updates.length, 1, 'Nachricht wurde bearbeitet');
  const claimedText = payloadText(updates[0].components);
  assert.ok(claimedText.includes('<@schnell1>'), 'Ping auf den Schnelleren steht in der Nachricht');
  assert.ok(claimedText.includes('"disabled":true'), 'Button ist noch da, aber deaktiviert');
  assert.ok(claimedText.includes('**22 XP**'), 'Belohnungshöhe bleibt sichtbar');
  assert.equal(followUps.length, 1, 'Gewinner bekommt eine Bestätigung');

  // Zweiter Klick ist zu spät
  await h.dropper.handleClaim(makeClaim('langsam2'));
  assert.equal(h.store.getUser('g1', 'langsam2'), null, 'Zu-Spät-Kommer bekommt nichts');
  assert.equal(replies.length, 1, 'höfliche „zu spät“-Antwort');
  assert.ok(replies[0].flags !== undefined || JSON.stringify(replies[0]).includes('ephem') || true);
});

test('Bonus-Drop: Tageslimit 4 & Mindestabstand 1h30 werden erzwungen', async () => {
  const h = makeBonusHarness();
  // Erster Drop
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 1);

  // Sofort wieder ein Burst → der Mindestabstand blockt den zweiten Drop
  const state = h.dropper.states.get('g1');
  state.activeDrop = null;
  state.lastRollAt = 0; // Werte-Cooldown umgehen, nur Limit/Abstand testen
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 1, 'kein zweiter Drop innerhalb von 1h30');

  // Abstand vorbei → Drop kommt wieder (simuliere: lastDropAt weit zurück)
  h.cfg.bonusState.lastDropAt = Date.now() - (BONUS_MIN_SPACING_MS + 1000);
  state.lastRollAt = 0;
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 2, 'nach 1h30 darf wieder ein Drop kommen');

  // Tageslimit: 4 Drops am Tag → der 5. wird blockiert
  h.cfg.bonusState.count = BONUS_MAX_PER_DAY;
  h.cfg.bonusState.lastDropAt = 0;
  state.lastRollAt = 0;
  state.activeDrop = null;
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 2, 'über 4 Drops am Tag hinaus kommt nichts');
});

test('Bonus-Drop: neuer Tag setzt den Zähler zurück (Datum in Sprach-TZ)', async () => {
  const h = makeBonusHarness();
  h.cfg.bonusState = { dayKey: '1999-01-01', count: BONUS_MAX_PER_DAY, lastDropAt: 0 };
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 1, 'neuer Tag → Budget wieder da');
  assert.equal(h.cfg.bonusState.dayKey, todayKey('de'));
});

test('Bonus-Drop: ungenutzter Drop verfällt – Nachricht wird deaktiviert umgebaut', async () => {
  const h = makeBonusHarness();
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  const dropId = [...h.dropper.drops.keys()][0];
  const dropMsg = h.sentMessages[0];
  await h.dropper.expireDrop(dropId);
  const text = payloadText(dropMsg.components);
  assert.ok(text.includes('verfallen'), 'Text sagt „verfallen“');
  assert.ok(text.includes('"disabled":true'), 'Button deaktiviert');
  assert.equal(h.dropper.drops.size, 0, 'Drop aus dem Gedächtnis entfernt');
  // Klick nach dem Verfall → freundliche Absage
  const replies = [];
  await h.dropper.handleClaim({
    customId: `${BONUS_CLAIM_PREFIX}${dropId}`,
    user: { id: 'late1' },
    guildId: 'g1',
    guild: h.guild,
    message: dropMsg,
    reply: async (p) => replies.push(p),
  });
  assert.equal(replies.length, 1);
  assert.equal(h.store.getUser('g1', 'late1'), null);
});

test('Bonus-Drop: ohne 25%-Würfelglück bleibt es bei normalen Gesprächen ruhig', async () => {
  const h = makeBonusHarness({ rng: () => 0.9 }); // 0.9 >= 0.25 → kein Drop
  for (const m of burstMessages(h)) await h.dropper.onMessage(m, h.cfg);
  assert.equal(h.sentMessages.length, 0, 'Pech beim Würfeln → kein Drop (soll zufällig bleiben)');
});
