/**
 * Tests für /give_xp (Server-Owner: XP geben/abziehen mit Level-Chat-Nachricht)
 * und die Offline-/Neustart-Sicherheit des 0-Uhr-Schwunds:
 *  - Tages-Marker wird VOR dem Decay gesetzt + persistiert (kein Doppel-Decay)
 *  - Nach Offline-Zeit werden max. 2 Nächte nachgeholt (5 % → 8 %), nie mehr
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  applyXpDelta,
  xpNeeded,
  missedDailyDecayDays,
  MAX_DECAY_CATCHUP_DAYS,
  todayKey,
} = require('../bots/xp-level-bot/src/logic');
const { handleChatInput } = require('../bots/xp-level-bot/src/commands');
const { createXpStore } = require('../bots/xp-level-bot/src/store');
const { runMaintenanceTick, applyDailyDecayForGuild } = require('../bots/xp-level-bot/src/scheduler');
const { extractAllText } = require('../bots/xp-level-bot/src/embed-builder');

function noopLogger() {
  return { info() {}, warn() {}, error() {} };
}

function textOfReply(payload) {
  return extractAllText(payload?.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || []);
}

// ---------------------------------------------------------------------------
// applyXpDelta – pure Logik
// ---------------------------------------------------------------------------

test('applyXpDelta: positive Menge wandert durch mehrere Level (kein XP-Verlust)', () => {
  const user = { level: 1, xp: 0 };
  const res = applyXpDelta(user, 500);
  assert.equal(res.leveledUp, true);
  assert.equal(res.leveled, true);
  // 500 XP ab Level 1: 80 -> L2, 94 -> L3, 108 -> L4, 122 -> L5, Rest 96
  assert.equal(res.level, 5);
  assert.equal(res.xp, 96);
  assert.equal(user.xp, 0, 'Funktion mutiert nicht selbst');
});

test('applyXpDelta: negative Menge rechnet den Restbetrag ins vorige Level', () => {
  const user = { level: 6, xp: 23 };
  const res = applyXpDelta(user, -100);
  assert.equal(res.leveledDown, true);
  // 23 XP abziehen, Rest 77 -> Level 5 mit xpNeeded(5) - 77 = 137 - 77 = 60
  assert.equal(res.level, 5);
  assert.equal(res.xp, 60);
});

test('applyXpDelta: niemals unter Level 1 / 0 XP (keine XP-Bombe)', () => {
  const res = applyXpDelta({ level: 1, xp: 5 }, -10_000);
  assert.equal(res.level, 1);
  assert.equal(res.xp, 0);
});

test('applyXpDelta: 0 ändert nichts', () => {
  const res = applyXpDelta({ level: 3, xp: 42 }, 0);
  assert.equal(res.leveled, false);
  assert.equal(res.level, 3);
  assert.equal(res.xp, 42);
});

// ---------------------------------------------------------------------------
// Nachhol-Logik nach Offline-Zeit
// ---------------------------------------------------------------------------

test('missedDailyDecayDays: 0/1/2/mehr Tage korrekt, fehlende/unbekannte Marker = 0', () => {
  assert.equal(missedDailyDecayDays('2026-08-20', '2026-08-20'), 0);
  assert.equal(missedDailyDecayDays('2026-08-20', '2026-08-21'), 1);
  assert.equal(missedDailyDecayDays('2026-08-20', '2026-08-22'), 2);
  assert.equal(missedDailyDecayDays('2026-08-01', '2026-08-22'), 21);
  assert.equal(missedDailyDecayDays(null, '2026-08-22'), 0);
  assert.equal(missedDailyDecayDays('2026-08-22', '2026-08-20'), 0, 'Zukunft zählt nicht');
  assert.equal(MAX_DECAY_CATCHUP_DAYS, 2, 'Nachhol-Cap bleibt klein');
});

function decayHarness({ lastDailyDecay = null } = {}) {
  const store = createXpStore({ env: () => '' });
  const flushes = [];
  store.flush = async () => {
    const user = store.getUser('g1', 'u1');
    flushes.push({
      marker: store.getGuild('g1')?.lastDailyDecay || null,
      level: user?.level ?? null,
      xp: user?.xp ?? null,
    });
  };

  store.setGuild({
    guildId: 'g1',
    lang: 'de',
    leaderboardChannelId: 'lb',
    mainChannelId: 'main',
  });
  const entry = store.getGuild('g1');
  entry.lastDailyDecay = lastDailyDecay;
  store.setGuild(entry);

  store.setUser({
    guildId: 'g1',
    userId: 'u1',
    level: 40,
    xp: 356,
    lastActivity: Date.now() - 3 * 24 * 3600 * 1000,
    inactiveDays: 0,
  });

  const guild = {
    id: 'g1',
    name: 'Testgilde',
    systemChannel: null,
    channels: {
      cache: new Map([['main', { id: 'main', isTextBased: () => true, send: async () => ({ id: 'x' }) }]]),
      fetch: async () => null,
    },
  };
  const ctx = {
    store,
    logger: noopLogger(),
    client: {
      user: { id: 'bot' },
      guilds: { cache: new Map([['g1', guild]]) },
      channels: { fetch: async () => null },
    },
  };
  return { store, ctx, guild, entry, flushes };
}

test('runMaintenanceTick: Marker wird VOR dem Decay gesetzt + geflusht (Fix „Level nach Offline verloren")', async () => {
  const h = decayHarness({ lastDailyDecay: '2000-01-01' });
  const now = new Date('2026-08-21T10:00:00Z'); // Berlin: 12:00 am 21.08.
  const dayKey = todayKey('de', now);

  await runMaintenanceTick(h.ctx, 1, now);

  // 1) Tag ist abgehakt – ein zweiter Tick darf NICHTS mehr ändern.
  assert.equal(h.entry.lastDailyDecay, dayKey);

  // 2) Der ERSTE Flush (Marker) lief, bevor die Nutzer angefasst wurden.
  assert.ok(h.flushes.length >= 2);
  assert.equal(h.flushes[0].marker, dayKey, 'Marker bereits beim ersten Flush aktuell');
  assert.equal(h.flushes[0].level, 40);
  assert.equal(h.flushes[0].xp, 356);

  // 3) Danach genau die 2 Nachhol-Nächte: 5 % (Tag 1) + 8 % (Tag 2),
  //    niemals die volle Level-Kaskade bei einem uralten Marker.
  const user = h.store.getUser('g1', 'u1');
  assert.equal(h.flushes[1].marker, dayKey);
  const expected = 356 - Math.ceil(xpNeeded(40) * 0.05) - Math.ceil(xpNeeded(40) * 0.08);
  assert.equal(user.level, 40);
  assert.equal(user.xp, expected);
  assert.equal(user.inactiveDays, 2);
});

test('runMaintenanceTick: zweiter Tick am selben Tag wendet keinen Decay mehr an', async () => {
  const h = decayHarness({ lastDailyDecay: '2026-08-20' });
  const now = new Date('2026-08-21T10:00:00Z');
  await runMaintenanceTick(h.ctx, 1, now);
  const afterFirst = h.store.getUser('g1', 'u1');
  const flushesAfterFirst = h.flushes.length;

  await runMaintenanceTick(h.ctx, 2, now);
  const afterSecond = h.store.getUser('g1', 'u1');
  assert.equal(afterFirst.xp, afterSecond.xp, 'kein Doppel-Decay im selben Lauf');
  assert.equal(h.flushes.length, flushesAfterFirst, 'kein weiterer Decay-Flush');
});

test('runMaintenanceTick: ohne bekannten Marker (Altbestand) nur EINE Abrechnung', async () => {
  const h = decayHarness({ lastDailyDecay: null });
  const now = new Date('2026-08-21T10:00:00Z');
  await runMaintenanceTick(h.ctx, 1, now);
  const user = h.store.getUser('g1', 'u1');
  // 5 % einmal – statt einer Kaskade bei unbekanntem Stand
  assert.equal(user.xp, 356 - Math.ceil(xpNeeded(40) * 0.05));
  assert.equal(user.inactiveDays, 1);
});

test('applyDailyDecayForGuild überspringt korrupte Level/XP-Daten ohne Kaskade', async () => {
  const store = createXpStore({ env: () => '' });
  store.flush = async () => {};
  store.setGuild({ guildId: 'g1', lang: 'de', leaderboardChannelId: 'lb', mainChannelId: 'main' });
  store.setUser({ guildId: 'g1', userId: 'kaputt', level: 'abc', xp: 10 });
  store.setUser({ guildId: 'g1', userId: 'ok', level: 5, xp: 20 });
  const guild = {
    id: 'g1',
    name: 'Test',
    channels: { cache: new Map(), fetch: async () => null },
  };
  const ctx = {
    store,
    logger: noopLogger(),
    client: { user: { id: 'bot' }, guilds: { cache: new Map([['g1', guild]]) }, channels: { fetch: async () => null } },
  };
  await applyDailyDecayForGuild(ctx, store.getGuild('g1'), guild);
  const broken = store.getUser('g1', 'kaputt');
  assert.equal(broken.level, 'abc', 'korrupte Daten bleiben unangetastet');
  assert.ok(store.getUser('g1', 'ok').xp < 20, 'gültiger Nutzer wird normal dekatziert');
});

// ---------------------------------------------------------------------------
// /give_xp – Handler
// ---------------------------------------------------------------------------

function makeGiveXpHarness() {
  const store = createXpStore({ env: () => '' });
  store.flush = async () => {};
  store.setGuild({ guildId: 'g1', lang: 'de', leaderboardChannelId: 'lb', mainChannelId: 'main' });

  const sends = [];
  const main = {
    id: 'main',
    isTextBased: () => true,
    send: async (payload) => {
      sends.push(payload);
      return { id: 'msg-1' };
    },
  };
  const guild = {
    id: 'g1',
    name: 'Testserver',
    ownerId: 'owner',
    systemChannel: null,
    channels: {
      cache: new Map([['main', main]]),
      fetch: async (id) => (id === 'main' ? main : null),
    },
    members: { fetch: async () => null },
  };
  const ctx = {
    store,
    logger: noopLogger(),
    client: {
      user: { id: 'bot' },
      guilds: { cache: new Map([['g1', guild]]) },
      channels: { fetch: async () => null },
    },
  };
  return { store, ctx, guild, sends, main };
}

function giveXpInteraction(h, { actor = 'owner', targetId = 'user1', amount }) {
  const replies = [];
  const interaction = {
    commandName: 'give_xp',
    guildId: 'g1',
    guild: h.guild,
    user: { id: actor },
    locale: 'de',
    inGuild: () => true,
    options: {
      getUser: () => ({ id: targetId }),
      getInteger: () => amount,
    },
    deferred: false,
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload) => {
      replies.push(payload);
      return payload;
    },
  };
  return { interaction, replies };
}

test('/give_xp: nur der Server-Owner darf XP vergeben', async () => {
  const h = makeGiveXpHarness();
  const { interaction, replies } = giveXpInteraction(h, { actor: 'not-owner', targetId: 'user1', amount: 50 });
  await handleChatInput(h.ctx, interaction);
  const text = textOfReply(replies[0]);
  assert.match(text, /Server-Owner/i);
  assert.equal(h.store.getUser('g1', 'user1'), null, 'kein XP ohne Owner');
  assert.equal(h.sends.length, 0, 'keine Level-Chat-Nachricht');
});

test('/give_xp: 0 XP wird abgelehnt', async () => {
  const h = makeGiveXpHarness();
  const { interaction, replies } = giveXpInteraction(h, { amount: 0 });
  await handleChatInput(h.ctx, interaction);
  assert.match(textOfReply(replies[0]), /darf nicht 0/i);
});

test('/give_xp: Owner gibt XP – Level-Up, Owner- & Nutzer-Mention im Level-Chat', async () => {
  const h = makeGiveXpHarness();
  h.store.setUser({ guildId: 'g1', userId: 'user1', level: 5, xp: 100 });
  const { interaction, replies } = giveXpInteraction(h, { amount: 60 });
  await handleChatInput(h.ctx, interaction);

  assert.equal(interaction.deferred, true, 'Bestätigung kommt als editReply (Interaktion darf nicht verfallen)');

  const user = h.store.getUser('g1', 'user1');
  assert.equal(user.level, 6, '100 + 60 >= xpNeeded(5)=137 -> Level 6');
  assert.equal(user.xp, 23);
  assert.ok(user.lastActivity > 0, 'vergebene XP zählen als Aktivität');
  assert.equal(user.inactiveDays, 0);

  assert.equal(h.sends.length, 1, 'Nachricht in den Level-Chat');
  const msg = h.sends[0].content;
  assert.ok(msg.startsWith('## '), 'gleiche ##-Optik wie andere Level-Nachrichten');
  assert.ok(msg.includes('<@owner>'), 'Owner wird erwähnt');
  assert.ok(msg.includes('<@user1>'), 'Nutzer wird erwähnt');
  assert.ok(msg.includes('**60 XP**'), 'XP-Zahl steht in der Nachricht');
  assert.ok(msg.includes('**Level 5 → 6**'), 'Level-Veränderung steht in der Nachricht');

  const done = textOfReply(replies[0]);
  assert.match(done, /Fertig!/);
  assert.match(done, /Level 6/);
});

test('/give_xp: Owner gibt XP ohne Level-Wechsel – „bleibt bei Level"', async () => {
  const h = makeGiveXpHarness();
  h.store.setUser({ guildId: 'g1', userId: 'user1', level: 5, xp: 60 });
  const { interaction } = giveXpInteraction(h, { amount: 20 });
  await handleChatInput(h.ctx, interaction);
  assert.equal(h.store.getUser('g1', 'user1').xp, 80);
  assert.match(h.sends[0].content, /bleibt bei \*\*Level 5\*\*/);
});

test('/give_xp: negative Menge zieht XP ab – Level-Down wird angekündigt', async () => {
  const h = makeGiveXpHarness();
  h.store.setUser({
    guildId: 'g1', userId: 'user1', level: 6, xp: 23,
    lastActivity: 0, inactiveDays: 7,
  });
  const { interaction } = giveXpInteraction(h, { amount: -100 });
  await handleChatInput(h.ctx, interaction);

  const user = h.store.getUser('g1', 'user1');
  assert.equal(user.level, 5);
  assert.equal(user.xp, 60);
  assert.equal(user.lastActivity, 0, 'Abzug zählt nicht als Aktivität');
  assert.equal(user.inactiveDays, 7, 'Abzug setzt den Inaktiv-Streak nicht zurück');

  const msg = h.sends[0].content;
  assert.ok(msg.includes('<@owner>'));
  assert.ok(msg.includes('<@user1>'));
  assert.ok(msg.includes('**100 XP**'));
  assert.ok(msg.includes('abgezogen'));
  assert.ok(msg.includes('**Level 6 → 5**'));
});

test('/give_xp: Works auch für den Owner selbst', async () => {
  const h = makeGiveXpHarness();
  h.store.setUser({ guildId: 'g1', userId: 'owner', level: 3, xp: 10 });
  const { interaction } = giveXpInteraction(h, { actor: 'owner', targetId: 'owner', amount: 30 });
  await handleChatInput(h.ctx, interaction);
  const user = h.store.getUser('g1', 'owner');
  assert.equal(user.xp, 40);
  assert.ok(h.sends[0].content.includes('<@owner>'), 'Owner-Mention auch bei Selbst-Verbuchen');
});
