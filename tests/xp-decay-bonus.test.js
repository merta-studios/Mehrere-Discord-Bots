/**
 * Tests für den Daily-Decay (5% Basis, +3% pro weiterem inaktivem Tag)
 * und das GE-PLANTE Bonus-Belohnungssystem des XP-Bots.
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DAILY_DECAY_RATE,
  INACTIVE_DECAY_STEP,
  decayRateForInactiveDays,
  nextDecayInfo,
  wasActiveRecently,
  applyDailyDecay,
  xpNeeded,
  rollBonusXp,
  todayKey,
  tzParts,
  DAY_MS,
  BONUS_XP_MIN,
  BONUS_XP_MAX,
  BONUS_CLAIM_MS,
  BONUS_SLOT_MIN,
  BONUS_SLOT_MAX,
  BONUS_SLOT_SPACING,
  BONUS_COUNT_MIN,
  BONUS_COUNT_MAX,
  seededRngForDay,
  planDailyBonusSlots,
  isSlotDue,
} = require('../bots/xp-level-bot/src/logic');
const { createBonusDropper, BONUS_CLAIM_PREFIX, BONUS_PLAN_VERSION } = require('../bots/xp-level-bot/src/bonus');
const { createXpStore } = require('../bots/xp-level-bot/src/store');

// ---------------------------------------------------------------------------
// Decay: Basis 5 %, Inaktivitäts-Streak +3 Prozentpunkte
// ---------------------------------------------------------------------------

test('Daily-Decay-Konstanten sind 5% Basis und +3 Prozentpunkte', () => {
  assert.equal(DAILY_DECAY_RATE, 0.05);
  assert.equal(INACTIVE_DECAY_STEP, 0.03);
});

test('decayRateForInactiveDays: 0/1 Tag = 5%, dann +3% je weiterem Inaktiv-Tag', () => {
  assert.equal(decayRateForInactiveDays(0), 0.05);
  assert.equal(decayRateForInactiveDays(1), 0.05);
  assert.equal(decayRateForInactiveDays(2), 0.08);
  assert.equal(decayRateForInactiveDays(3), 0.11);
  assert.equal(decayRateForInactiveDays(4), 0.14);
});

test('decayRateForInactiveDays: ist nach oben bei 100% gedeckelt & robust gegen Mist', () => {
  assert.equal(decayRateForInactiveDays(32), 0.98);
  assert.equal(decayRateForInactiveDays(33), 1.0);
  assert.equal(decayRateForInactiveDays(99), 1.0);
  assert.equal(decayRateForInactiveDays(-5), 0.05);
  assert.equal(decayRateForInactiveDays(undefined), 0.05);
  assert.equal(decayRateForInactiveDays('3'), 0.11);
});

test('Beispiel-Woche: aktiv=5%, dann 1./2./3. inaktiver Tag = 5/8/11%, wieder aktiv = 5%', () => {
  const now = Date.now();
  const activeUser = { level: 10, xp: 50, lastXpGain: now - 3 * 3600 * 1000, lastActivity: now - 3 * 3600 * 1000, inactiveDays: 0 };
  assert.equal(nextDecayInfo(activeUser, now).percent, 5);
  assert.equal(nextDecayInfo(activeUser, now).inactiveDays, 0);
  const firstInactive = { level: 10, xp: 50, lastActivity: now - 30 * 3600 * 1000, inactiveDays: 0 };
  assert.equal(nextDecayInfo(firstInactive, now).inactiveDays, 1);
  assert.equal(nextDecayInfo(firstInactive, now).percent, 5);
  const secondInactive = { level: 10, xp: 50, lastActivity: now - 50 * 3600 * 1000, inactiveDays: 1 };
  assert.equal(nextDecayInfo(secondInactive, now).inactiveDays, 2);
  assert.equal(nextDecayInfo(secondInactive, now).percent, 8);
  assert.equal(nextDecayInfo({ level: 10, xp: 50, lastActivity: now - 70 * 3600 * 1000, inactiveDays: 2 }, now).percent, 11);
  assert.equal(nextDecayInfo({ level: 10, xp: 50, lastActivity: now - 90 * 3600 * 1000, inactiveDays: 3 }, now).percent, 14);
  const activeAgain = { level: 10, xp: 50, lastActivity: now - 2 * 3600 * 1000, inactiveDays: 4 };
  assert.equal(nextDecayInfo(activeAgain, now).percent, 5);
  assert.equal(nextDecayInfo(activeAgain, now).inactiveDays, 0);
});

test('applyDailyDecay: respektiert einen explizit übergebenen Anteil von 15%', () => {
  const user = { level: 10, xp: 100 };
  const needed = xpNeeded(10);
  const res15 = applyDailyDecay(user, 0.15);
  assert.equal(res15.decay, Math.ceil(needed * 0.15));
  assert.equal(res15.xp, 100 - Math.ceil(needed * 0.15));
});

test('nextDecayInfo: alter lastXpGain ohne lastActivity zählt rückwirkend mit', () => {
  const now = Date.now();
  const legacy = { level: 5, xp: 10, lastXpGain: now - 5 * 3600 * 1000 };
  assert.equal(wasActiveRecently(legacy, now), true);
  assert.equal(nextDecayInfo(legacy, now).percent, 5);
});

test('nextDecayInfo: wer auf Level 1 mit 0 XP steht, verliert nichts', () => {
  const info = nextDecayInfo({ level: 1, xp: 0, lastActivity: 0, inactiveDays: 5 });
  assert.equal(info.decay, 0);
});

// ---------------------------------------------------------------------------
// Bonus: XP-Höhe, geplanter Tagesplan (2–4 Slots, 1h Abstand, 06:00–23:59)
// ---------------------------------------------------------------------------

test('rollBonusXp: immer ganzzahlig zwischen 30 und 70 (inkl. Grenzen)', () => {
  assert.equal(rollBonusXp(() => 0), BONUS_XP_MIN);
  assert.equal(rollBonusXp(() => 0.9999), BONUS_XP_MAX);
  assert.equal(rollBonusXp(() => 0.5), 50);
  for (let i = 0; i < 500; i++) {
    const v = rollBonusXp();
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 30 && v <= 70, `außerhalb: ${v}`);
  }
});

test('planDailyBonusSlots: 2–4 Slots, sortiert, 1h Abstand, innerhalb 06:00–23:59', () => {
  for (let i = 0; i < 50; i++) {
    const gid = `g${i}`;
    const plan = planDailyBonusSlots(gid, '2026-08-10', seededRngForDay(gid, '2026-08-10'));
    assert.ok(plan.length >= BONUS_COUNT_MIN && plan.length <= BONUS_COUNT_MAX, `count ${plan.length}`);
    for (let j = 1; j < plan.length; j++) {
      assert.ok(plan[j] - plan[j - 1] >= BONUS_SLOT_SPACING, `Abstand ${plan[j]}-${plan[j-1]}`);
    }
    for (const s of plan) {
      assert.ok(s >= BONUS_SLOT_MIN && s <= BONUS_SLOT_MAX, `Slot ${s} außerhalb`);
    }
  }
});

test('planDailyBonusSlots: deterministisch für gleichen Server+Tag, anders zwischen Servern', () => {
  const day = todayKey('de');
  const p1a = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  const p1b = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  assert.deepEqual(p1a, p1b, 'gleicher Server+Tag ⇒ gleicher Plan (stabil)');
  const p2 = planDailyBonusSlots('g2', day, seededRngForDay('g2', day));
  assert.notDeepEqual(p1a, p2, 'verschiedene Server ⇒ unterschiedliche Termine');
});

test('seededRngForDay: gleicher Seed ⇒ gleiche Zahlenfolge', () => {
  const a = seededRngForDay('g1', '2026-08-10');
  const b = seededRngForDay('g1', '2026-08-10');
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('isSlotDue: bis 60 Minuten Toleranz, aber niemals vorgezogen/über Mitternacht', () => {
  assert.equal(isSlotDue(450, 450), true); // exakt
  assert.equal(isSlotDue(450, 453), true); // 3 min überzogen
  assert.equal(isSlotDue(450, 510), true); // genau 60 min überzogen
  assert.equal(isSlotDue(450, 449), false); // noch nicht da
  assert.equal(isSlotDue(450, 511), false); // mehr als 60 min zu spät
  assert.equal(isSlotDue(1439, 1), false); // 23:59 darf um 00:01 NICHT vorzeitig feuern
});

// ---------------------------------------------------------------------------
// Bonus-Dropper: kompletter Ablauf mit Mocks
// ---------------------------------------------------------------------------

function makeBonusHarness({ rng = () => 0.1, lang = 'de' } = {}) {
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
  const client = {
    user: { id: 'bot1' },
    guilds: { cache: new Map([['g1', guild]]) },
    channels: { fetch: async () => channel },
  };
  const ctx = { client, store, logger };
  const cfg = { guildId: 'g1', leaderboardChannelId: 'lb1', mainChannelId: 'main1', lang };

  const dropper = createBonusDropper({
    ctx,
    rng,
    onLevelChange: async () => {},
    onXpOnly: async () => {},
  });
  return { ctx, store, cfg, guild, channel, sentMessages, dropper };
}

/** Baut ein `Date` für den aktuellen Berliner Tag und die gewünschte Minute. */
function dateWithTzMinute(minute, tz = 'Europe/Berlin', dayKey = todayKey('de')) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day - 1, 0, 0, 0);
  for (let k = 0; k < 60 * 72; k++) {
    const date = new Date(base + k * 60000);
    const parts = tzParts(tz, date);
    const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    if (key === dayKey && parts.hour * 60 + parts.minute === minute) return date;
  }
  throw new Error(`Kein Date für ${dayKey}, Minute ${minute} in ${tz} gefunden`);
}

function payloadText(payload) {
  return JSON.stringify(payload, (k, v) => (typeof v === 'bigint' ? String(v) : v));
}

test('Bonus-Drop: geplanter Slot zur Fälligkeit sendet Belohnung mit XP-Zahl & Button', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  const slot = plan[0];
  const now = dateWithTzMinute(slot);

  await h.dropper.checkScheduled(h.cfg, h.guild, now);
  assert.equal(h.sentMessages.length, 1, 'genau ein Drop');
  const text = payloadText(h.sentMessages[0].components);
  assert.ok(!text.includes('xp-bonus:'), 'kein sichtbarer Speicher-Marker mehr');
  assert.ok(text.includes('**34 XP**'), 'gewürfelte XP-Zahl (rng 0.1 → 34) steht im Text');
  assert.ok(text.includes(BONUS_CLAIM_PREFIX), 'Einsammeln-Button vorhanden');
  assert.ok(text.includes('Einsammeln'), 'Button-Label sagt „Einsammeln“');
  assert.deepEqual(h.cfg.bonusState.firedSlots, [slot], 'Slot als gesendet markiert');

  // Gleicher Slot nochmal fällig → KEIN zweiter Drop (Schutz vor Doppelsendung)
  await h.dropper.checkScheduled(h.cfg, h.guild, now);
  assert.equal(h.sentMessages.length, 1, 'kein Doppel-Drop für denselben Slot');
});

test('Bonus-Drop: ohne jeglichen Zielkanal kommt nichts', async () => {
  const h = makeBonusHarness();
  h.cfg.leaderboardChannelId = null;
  h.cfg.mainChannelId = null;
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 0);
});

test('Bonus-Drop: ohne Hauptkanal fällt auf den Leaderboard-Kanal zurück', async () => {
  const h = makeBonusHarness();
  h.cfg.mainChannelId = null;
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1, 'Fallback-Kanal muss den Drop senden');
});

test('Bonus-Drop: abgelaufener persistierter Drop blockiert neue Termine nicht', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  h.cfg.bonusState = {
    dayKey: day,
    planVersion: 2,
    firedSlots: [],
    activeDrop: {
      dropId: 'stale',
      guildId: 'g1',
      channelId: 'main1',
      messageId: 'old',
      xp: 20,
      lang: 'de',
      createdAt: Date.now() - BONUS_CLAIM_MS - 5_000,
    },
  };
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1, 'nach abgelaufenem Alt-Drop muss ein neuer gesendet werden');
});

test('Bonus-Drop: Plan-Migration nach Anzahl darf den Tag nicht leer fegen', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  h.cfg.bonusState = {
    dayKey: day,
    planVersion: 1,
    firedSlots: [1, 2, 3, 4], // alte Minuten, nicht im neuen Plan
    activeDrop: null,
  };
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1, 'neue Slots bleiben nach Versionssprung sendbar');
});

test('Bonus-Drop: nur ein offener Drop pro Server gleichzeitig', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1);

  // Aktiven Drop blockieren: obwohl ein anderer Slot fällig wäre, kommt nichts,
  // solange der offene Drop noch lebt.
  const state = h.dropper.states.get('g1');
  assert.ok(state.activeDrop, 'offener Drop vorhanden');
  // Slot #2 künstlich fällig machen, um das Blockieren zu prüfen.
  const slot2 = plan[1];
  const now2 = dateWithTzMinute(slot2);
  // firedSlots leerer lassen? Slot1 wurde gesendet. Wir manipulieren: neuer Tag-Fall wird woanders getestet.
  // Hier prüfen wir nur die activeDrop-Sperre:
  h.dropper.drops.get(state.activeDrop.dropId); // drop existiert
  await h.dropper.checkScheduled(h.cfg, h.guild, now2);
  assert.equal(h.sentMessages.length, 1, 'aktiver Drop blockt weiteren Drop');
});

test('Bonus-Drop: neuer Tag setzt die gesendeten Slots zurück', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1);

  // Tageswechsel simulieren: bonusState auf alten Tag setzen
  h.cfg.bonusState = { dayKey: '1999-01-01', firedSlots: [] };
  h.dropper.states.get('g1').activeDrop = null; // alter Drop weg
  h.dropper.drops.clear();

  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 2, 'neuer Tag → Budget wieder da');
  assert.equal(h.cfg.bonusState.dayKey, todayKey('de'));
});

test('Bonus-Drop: der ERSTE Klick gewinnt und setzt den Decay auf 5% (inactiveDays=0)', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  const dropMsg = h.sentMessages[0];
  const dropId = [...h.dropper.drops.keys()][0];

  // Einsammler war lange inaktiv (hoher Decay-Satz)
  const pre = h.store.ensureUser('g1', 'schnell1');
  pre.inactiveDays = 6;
  pre.lastActivity = 0;
  h.store.setUser(pre);

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

  await h.dropper.handleClaim(makeClaim('schnell1'));
  const winner = h.store.getUser('g1', 'schnell1');
  assert.equal(winner.xp, 34, 'Gewinner bekam genau die angekündigten 34 XP');
  assert.equal(winner.lastActivity > 0, true, 'zählt als Aktivität');
  assert.equal(winner.inactiveDays, 0, 'Decay fällt zurück auf 5% (inactiveDays=0)');
  assert.equal(nextDecayInfo(winner, Date.now()).percent, 5, 'nächster Decay = 5%');
  assert.equal(updates.length, 1, 'Nachricht wurde bearbeitet');
  const claimedText = payloadText(updates[0].components);
  assert.ok(claimedText.includes('<@schnell1>'), 'Ping auf den Schnelleren steht in der Nachricht');
  assert.ok(claimedText.includes('"disabled":true'), 'Button ist noch da, aber deaktiviert');
  assert.ok(claimedText.includes('**34 XP**'), 'Belohnungshöhe bleibt sichtbar');
  assert.equal(followUps.length, 1, 'Gewinner bekommt eine Bestätigung');

  // Zweiter Klick ist zu spät
  await h.dropper.handleClaim(makeClaim('langsam2'));
  assert.equal(h.store.getUser('g1', 'langsam2'), null, 'Zu-Spät-Kommer bekommt nichts');
  assert.equal(replies.length, 1, 'höfliche „zu spät“-Antwort');
});

test('Bonus-Drop: Drop verfällt nach 1 Stunde – Nachricht wird deaktiviert umgebaut', async () => {
  const h = makeBonusHarness();
  assert.equal(BONUS_CLAIM_MS, 60 * 60 * 1000, 'Gültigkeit ist genau 1 Stunde');
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
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

test('Bonus-Drop: nach Scheduler-Ausfall wird genau der jüngste verpasste Slot nachgeholt', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  const latest = plan[Math.min(1, plan.length - 1)];

  // Erster Scheduler-Lauf des Tages erst beim zweiten Termin: kein dauerhaftes
  // Verpassen, aber auch keine Flut aus mehreren alten Drops.
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(latest));
  assert.equal(h.sentMessages.length, 1);
  const expectedHandled = plan.filter((slot) => slot <= latest);
  assert.deepEqual(h.cfg.bonusState.firedSlots, expectedHandled);
});

test('Bonus-Drop: alte firedSlots ohne lastSentAt werden nicht mehr als „schon gesendet“ geglaubt', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  h.cfg.bonusState = {
    dayKey: day,
    planVersion: 2, // der Stand nach dem letzten „Fix“, der nie sichtbar gesendet hat
    firedSlots: [...plan],
    activeDrop: null,
  };
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1, 'Lügen-Slots dürfen den Tag nicht leer fegen');
  assert.equal(h.cfg.bonusState.planVersion, BONUS_PLAN_VERSION);
  assert.ok(h.cfg.bonusState.lastSentAt > 0, 'erfolgreicher Send setzt lastSentAt');
});

test('Bonus-Drop: echte Sends (lastSentAt) werden nicht nochmal nachgeholt', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  h.cfg.bonusState = {
    dayKey: day,
    planVersion: BONUS_PLAN_VERSION,
    firedSlots: [...plan],
    activeDrop: null,
    lastSentAt: Date.now() - 60_000,
  };
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[plan.length - 1]));
  assert.equal(h.sentMessages.length, 0, 'bereits wirklich gesendete Slots bleiben abgeschlossen');
});

test('Bonus-Drop: wenn Components V2 scheitert, kommt klassisches Embed + Button', async () => {
  const h = makeBonusHarness();
  const originalSend = h.channel.send;
  h.channel.send = async (payload) => {
    if (payload && payload.flags && !payload.embeds) {
      throw new Error('Invalid Form Body: components v2 rejected');
    }
    return originalSend(payload);
  };
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  assert.equal(h.sentMessages.length, 1, 'Fallback muss senden');
  const text = payloadText(h.sentMessages[0]);
  assert.ok(text.includes(BONUS_CLAIM_PREFIX) || text.includes('embeds') || text.includes('Einsammeln'), 'Button bleibt erhalten');
});

test('Bonus-Drop: Chat-Kick holt einen überfälligen Slot nach und drosselt Folge-Kicks', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  const now = dateWithTzMinute(plan[0]);
  const first = await h.dropper.kickFromActivity(h.cfg, h.guild, now);
  assert.equal(first, true);
  assert.equal(h.sentMessages.length, 1);
  // Zweiter Kick innerhalb der Drossel: kein zweiter Discord-Send-Versuch
  const second = await h.dropper.kickFromActivity(h.cfg, h.guild, now);
  assert.equal(second, false);
  assert.equal(h.sentMessages.length, 1);
});

test('Bonus-Drop: offener Einsammeln-Button funktioniert nach Bot-Neustart weiter', async () => {
  const h = makeBonusHarness();
  const day = todayKey('de');
  const plan = planDailyBonusSlots('g1', day, seededRngForDay('g1', day));
  await h.dropper.checkScheduled(h.cfg, h.guild, dateWithTzMinute(plan[0]));
  const dropMsg = h.sentMessages[0];
  const dropId = h.cfg.bonusState.activeDrop.dropId;

  // Neue Dropper-Instanz = leerer RAM wie nach Render-Restart. Nur Store und
  // Discord-Nachricht bleiben erhalten.
  const restarted = createBonusDropper({
    ctx: h.ctx,
    rng: () => 0.1,
    onLevelChange: async () => {},
    onXpOnly: async () => {},
  });
  assert.equal(restarted.drops.size, 0);

  const updates = [];
  await restarted.handleClaim({
    customId: `${BONUS_CLAIM_PREFIX}${dropId}`,
    user: { id: 'after-restart' },
    guildId: 'g1',
    guild: h.guild,
    message: dropMsg,
    update: async (payload) => updates.push(payload),
    followUp: async () => {},
    reply: async () => assert.fail('gültiger Drop darf nicht als verschwunden gelten'),
  });

  assert.equal(h.store.getUser('g1', 'after-restart').xp, 34);
  assert.equal(updates.length, 1);
  assert.equal(h.cfg.bonusState.activeDrop, null, 'persistierter offene Drop wurde abgeschlossen');
});
