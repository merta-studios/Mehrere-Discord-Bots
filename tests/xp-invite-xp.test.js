/**
 * Tests für Invite-XP im XP Level Bot:
 * - rollInviteXp liefert 40–80 XP (Ganzzahl)
 * - detectUsedInvite findet genau den Invite, dessen uses-Zähler gestiegen ist
 * - Rejoin-Schutz: 7-Tage-Fenster blockt XP + Nachricht, egal welcher Invite
 * - Tracker vergibt XP an den Invite-Ersteller und sendet die ##-Nachricht
 * - Store: Invite-Snapshots & Leave-Log überleben Flush + Neustart (Turso-Datei)
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  createInviteXpTracker,
  rollInviteXp,
  toInviteSnapshot,
  detectUsedInvite,
  isRejoinWithinWindow,
  REJOIN_WINDOW_MS,
  INVITE_XP_MIN,
  INVITE_XP_MAX,
} = require('../bots/xp-level-bot/src/invite-xp');
const { createXpStore } = require('../bots/xp-level-bot/src/store');
const { t, LANGS } = require('../bots/xp-level-bot/src/languages');

// ---------------------------------------------------------------------------
// Reine Funktionen
// ---------------------------------------------------------------------------

test('rollInviteXp: liefert Ganzzahlen zwischen 40 und 80', () => {
  assert.equal(INVITE_XP_MIN, 40);
  assert.equal(INVITE_XP_MAX, 80);
  assert.equal(rollInviteXp(() => 0), 40);
  assert.equal(rollInviteXp(() => 0.999999), 80);
  for (let i = 0; i < 200; i++) {
    const v = rollInviteXp();
    assert.ok(Number.isInteger(v), `keine Ganzzahl: ${v}`);
    assert.ok(v >= 40 && v <= 80, `außerhalb 40–80: ${v}`);
  }
});

test('toInviteSnapshot: baut {code: uses} aus einer Invite-Collection', () => {
  const invites = new Map([
    ['abc', { code: 'abc', uses: 3 }],
    ['def', { code: 'def', uses: 0 }],
    ['ghi', { code: 'ghi', uses: null }],
  ]);
  assert.deepEqual(toInviteSnapshot(invites), { abc: 3, def: 0, ghi: 0 });
  assert.deepEqual(toInviteSnapshot(null), {});
});

test('detectUsedInvite: findet den einzigen Invite mit gestiegenem Zähler', () => {
  const invites = new Map([
    ['abc', { code: 'abc', uses: 4, inviter: { id: '111' } }],
    ['def', { code: 'def', uses: 1, inviter: { id: '222' } }],
  ]);
  const used = detectUsedInvite({ abc: 3, def: 1 }, invites);
  assert.deepEqual(used, { code: 'abc', inviterId: '111', uses: 4, prev: 3 });
});

test('detectUsedInvite: ohne Snapshot (Neustart/erster Sync) gibt es kein Delta', () => {
  const invites = new Map([['abc', { code: 'abc', uses: 2, inviter: { id: '111' } }]]);
  assert.equal(detectUsedInvite(null, invites), null);
  assert.equal(detectUsedInvite({}, invites), null);
});

test('detectUsedInvite: mehrere erhöhte Zähler sind mehrdeutig -> null', () => {
  const invites = new Map([
    ['a', { code: 'a', uses: 2, inviter: { id: '1' } }],
    ['b', { code: 'b', uses: 2, inviter: { id: '2' } }],
  ]);
  assert.equal(detectUsedInvite({ a: 1, b: 1 }, invites), null);
});

test('detectUsedInvite: unbekannte Invites (ohne Baseline) werden ignoriert', () => {
  const invites = new Map([
    ['fresh', { code: 'fresh', uses: 1, inviter: { id: '1' } }], // Bot kannte den Invite nie
    ['known', { code: 'known', uses: 5, inviter: { id: '2' } }],
  ]);
  const used = detectUsedInvite({ known: 5 }, invites);
  assert.equal(used, null); // fresh hat keine Baseline, known unverändert
});

test('detectUsedInvite: Vanity-/Link-lose Invites haben keinen Ersteller (inviterId null)', () => {
  const invites = new Map([['vanity', { code: 'vanity', uses: 9, inviter: null }]]);
  const used = detectUsedInvite({ vanity: 8 }, invites);
  assert.equal(used.inviterId, null);
});

test('isRejoinWithinWindow: 7-Tage-Fenster grenzt korrekt ab', () => {
  const now = Date.now();
  assert.equal(isRejoinWithinWindow(now - 1000, now), true);
  assert.equal(isRejoinWithinWindow(now - 6 * 24 * 3600 * 1000, now), true);
  assert.equal(isRejoinWithinWindow(now - REJOIN_WINDOW_MS + 1000, now), true);
  assert.equal(isRejoinWithinWindow(now - REJOIN_WINDOW_MS, now), false); // exakt 7 Tage = ok
  assert.equal(isRejoinWithinWindow(now - 8 * 24 * 3600 * 1000, now), false);
  assert.equal(isRejoinWithinWindow(null, now), false);
  assert.equal(isRejoinWithinWindow(0, now), false);
});

test('inviteXp-Text existiert in allen 10 Sprachen und enthält beide Mentions + XP', () => {
  for (const code of Object.keys(LANGS)) {
    const text = t('inviteXp', code, { inviter: '<@111>', joined: '<@222>', xp: 60 });
    assert.ok(text && text.length > 0, `inviteXp (${code}) fehlt`);
    assert.ok(text.includes('<@111>'), `inviteXp (${code}) ohne Inviter-Mention`);
    assert.ok(text.includes('<@222>'), `inviteXp (${code}) ohne Joined-Mention`);
    assert.ok(text.includes('60'), `inviteXp (${code}) ohne XP-Zahl`);
    assert.equal(text.includes('{'), false, `inviteXp (${code}) mit unersetztem Platzhalter`);
  }
});

// ---------------------------------------------------------------------------
// Tracker-Harness (fakes Guild/Channels/Store, keine Discord-Verbindung)
// ---------------------------------------------------------------------------

function makeHarness({
  invites = [],
  snapshot = null,
  inviterInGuild = true,
  mainSendFails = false,
  retryDelayMs = 0,
  lang = 'de',
  setup = true,
  rng = () => 0.5, // -> 40 + floor(0.5*41) = 60 XP
} = {}) {
  const inviteMap = new Map(
    invites.map((i) => [i.code, { code: i.code, uses: i.uses, inviter: i.inviterId ? { id: i.inviterId } : null }])
  );
  const sent = [];
  const mkChannel = (id, fails = false) => ({
    id,
    isTextBased: () => true,
    send: async (payload) => {
      if (fails) throw new Error(`send ${id} rejected`);
      sent.push({ channel: id, payload });
      return { id: `msg-${id}` };
    },
  });
  const mainChannel = mkChannel('main', mainSendFails);
  const lbChannel = mkChannel('lb', false);
  const inviterMember = { id: 'inviter-1', user: { bot: false, id: 'inviter-1' } };
  const members = new Map(inviterInGuild ? [['inviter-1', inviterMember]] : []);
  const guild = {
    id: 'g1',
    name: 'Test Server',
    invites: { fetch: async () => inviteMap },
    members: {
      cache: members,
      fetch: async (id) => members.get(id) || null,
    },
    channels: {
      cache: new Map([
        ['main', mainChannel],
        ['lb', lbChannel],
      ]),
      fetch: async () => null,
    },
    systemChannel: null,
  };
  // File-Backup im Test aus, damit kein xp-data.json ins Repo geschrieben wird
  const store = createXpStore({ env: (k) => (k === 'XP_STORE_DISABLE_FILE_BACKUP' ? 'true' : '') });
  if (setup) {
    store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang });
  }
  if (snapshot) store.setInviteSnapshot('g1', snapshot);
  const logs = [];
  const logger = {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  };
  const levelChanges = [];
  const xpOnly = [];
  const tracker = createInviteXpTracker({
    ctx: { logger },
    store,
    logger,
    retryDelayMs,
    rng,
    onLevelChange: async (guild, cfg, user, res) => levelChanges.push({ guild, cfg, user, res }),
    onXpOnly: async (guild, cfg, user, userId) => xpOnly.push(userId),
  });
  return { guild, store, sent, logs, tracker, levelChanges, xpOnly, inviteMap, mainChannel, lbChannel };
}

const NEWBIE = { id: 'newbie-1', guild: null, user: { bot: false, id: 'newbie-1' } };

// ---------------------------------------------------------------------------
// Tracker: Beitritt über Invite
// ---------------------------------------------------------------------------

test('Beitritt über Invite: Ersteller bekommt 60 XP + ##-Nachricht im Haupt-Chat', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);

  assert.equal(res.awarded, true);
  assert.equal(res.inviterId, 'inviter-1');
  assert.equal(res.xp, 60);
  const user = h.store.getUser('g1', 'inviter-1');
  assert.equal(user.level, 1);
  assert.equal(user.xp, 60);
  assert.ok(user.lastActivity > 0, 'Invite-XP zählt als Aktivität');
  assert.deepEqual(h.xpOnly, ['inviter-1']);

  // Nachricht: genau EINE im Haupt-Chat, mit ##-Heading (gleiche Schriftgröße wie Level-Up)
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].channel, 'main');
  const text = JSON.stringify(h.sent[0].payload);
  assert.match(text, /## 🎉 <@inviter-1>/);
  assert.match(text, /<@newbie-1>/);
  assert.match(text, /60 XP/);

  // Snapshot wurde aktualisiert
  assert.deepEqual(h.store.getInviteSnapshot('g1').data, { abc: 2 });
});

test('Beitritt über Invite: unbekannter Invite ohne Baseline -> kein XP, keine Nachricht', async () => {
  const h = makeHarness({
    invites: [{ code: 'fresh', uses: 1, inviterId: 'inviter-1' }],
    snapshot: {},
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'no-invite-delta');
  assert.equal(h.sent.length, 0);
  assert.equal(h.store.getUser('g1', 'inviter-1'), null);
});

test('Vanity-Invite ohne Ersteller -> kein XP, keine Nachricht', async () => {
  const h = makeHarness({
    invites: [{ code: 'vanity', uses: 5, inviterId: null }],
    snapshot: { vanity: 4 },
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'no-inviter');
  assert.equal(h.sent.length, 0);
});

test('Ersteller ist nicht mehr auf dem Server -> kein XP, keine Nachricht', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
    inviterInGuild: false,
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'inviter-left');
  assert.equal(h.sent.length, 0);
});

test('Beitretender ist ein Bot -> komplett übersprungen', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
  });
  const botMember = { id: 'bot-1', guild: h.guild, user: { bot: true, id: 'bot-1' } };
  const res = await h.tracker.handleGuildMemberAdd(botMember);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'bot');
  assert.equal(h.sent.length, 0);
});

test('Ohne /setup (kein Leaderboard-Kanal) -> kein Invite-XP', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
    setup: false,
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'no-setup');
  assert.equal(h.sent.length, 0);
});

test('Self-Invite (Ersteller = Beitretender) -> kein XP', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'newbie-1' }],
    snapshot: { abc: 1 },
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'no-inviter');
  assert.equal(h.sent.length, 0);
});

test('Discord spiegelt uses erst verzögert: Retry gegen dieselbe Baseline findet das Delta', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 1, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
    retryDelayMs: 5,
  });
  // Beim zweiten Fetch ist der Zähler dann da
  let fetches = 0;
  h.guild.invites.fetch = async () => {
    fetches++;
    if (fetches === 2) h.inviteMap.get('abc').uses = 2;
    return h.inviteMap;
  };
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(fetches, 2, 'Retry-Fetch muss gelaufen sein');
  assert.equal(res.awarded, true);
  assert.equal(res.xp, 60);
  assert.equal(h.sent.length, 1);
});

test('Hauptkanal nicht erreichbar -> Fallback auf Leaderboard-Kanal', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
    mainSendFails: true,
  });
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, true);
  assert.equal(res.announced, true);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].channel, 'lb');
});

test('Level-Up durch Invite-XP löst die normale Level-Nachbereitung aus', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
  });
  // Level 1, 79/80 XP -> 60 Invite-XP = Level-Up auf Level 2
  const inviter = h.store.ensureUser('g1', 'inviter-1');
  inviter.level = 1;
  inviter.xp = 79;
  h.store.setUser(inviter);

  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, true);
  const after = h.store.getUser('g1', 'inviter-1');
  assert.equal(after.level, 2);
  assert.equal(after.xp, 0);
  assert.equal(h.levelChanges.length, 1);
  assert.equal(h.levelChanges[0].res.leveledUp, true);
  assert.equal(h.levelChanges[0].user.userId, 'inviter-1');
});

test('Invites-Fetch ohne Permission -> einmalige Warnung, kein XP, Bot läuft weiter', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
  });
  h.guild.invites.fetch = async () => { throw new Error('403 Forbidden'); };
  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'invites-unavailable');
  assert.equal(h.sent.length, 0);
  const warns = h.logs.filter((l) => l[0] === 'warn' && String(l[1]).includes('MANAGE_GUILD'));
  assert.equal(warns.length, 1, 'genau eine Warnung');
});

// ---------------------------------------------------------------------------
// Tracker: 7-Tage-Rejoin-Schutz
// ---------------------------------------------------------------------------

test('Rejoin innerhalb 7 Tagen: kein XP für den Ersteller (egal welcher Invite), keine Nachricht', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
  });
  h.store.setLeaveRecord('g1', 'newbie-1', Date.now() - 60 * 60 * 1000); // vor 1 Stunde gegangen

  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'rejoin-within-window');
  assert.equal(h.sent.length, 0);
  assert.equal(h.store.getUser('g1', 'inviter-1'), null);
  // Leave-Eintrag ist verbraucht
  assert.equal(h.store.getLeaveRecord('g1', 'newbie-1'), null);
});

test('Rejoin innerhalb 7 Tagen über ANDEREN Invite: trotzdem kein XP, keine Nachricht', async () => {
  const h = makeHarness({
    invites: [{ code: 'other', uses: 2, inviterId: 'inviter-2' }],
    snapshot: { other: 1 },
  });
  h.store.setLeaveRecord('g1', 'newbie-1', Date.now() - 2 * 24 * 3600 * 1000);
  h.store.ensureUser('g1', 'inviter-2'); // anderer Ersteller existiert schon

  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, false);
  assert.equal(res.reason, 'rejoin-within-window');
  assert.equal(h.sent.length, 0);
  assert.equal(h.store.getUser('g1', 'inviter-2').xp, 0, 'anderer Ersteller bekommt nichts');
});

test('Rejoin nach mehr als 7 Tagen: normaler Invite-XP-Ablauf', async () => {
  const h = makeHarness({
    invites: [{ code: 'abc', uses: 2, inviterId: 'inviter-1' }],
    snapshot: { abc: 1 },
  });
  h.store.setLeaveRecord('g1', 'newbie-1', Date.now() - 8 * 24 * 3600 * 1000);

  NEWBIE.guild = h.guild;
  const res = await h.tracker.handleGuildMemberAdd(NEWBIE);
  assert.equal(res.awarded, true);
  assert.equal(res.xp, 60);
  assert.equal(h.store.getUser('g1', 'inviter-1').xp, 60);
  assert.equal(h.sent.length, 1);
  assert.equal(h.store.getLeaveRecord('g1', 'newbie-1'), null);
});

test('guildMemberRemove: merkt sich den Leave-Zeitpunkt für den Rejoin-Schutz', () => {
  const h = makeHarness();
  h.tracker.handleGuildMemberRemove({ id: 'leaver-1', guild: h.guild, user: { bot: false, id: 'leaver-1' } });
  const leftAt = h.store.getLeaveRecord('g1', 'leaver-1');
  assert.ok(leftAt != null && leftAt > 0);
  assert.ok(Math.abs(Date.now() - leftAt) < 5000, 'Zeitstempel muss aktuell sein');
});

test('guildMemberRemove: Bots und nicht eingerichtete Server werden nicht geloggt', () => {
  const h = makeHarness({ setup: false });
  h.tracker.handleGuildMemberRemove({ id: 'leaver-1', guild: h.guild, user: { bot: false, id: 'leaver-1' } });
  assert.equal(h.store.getLeaveRecord('g1', 'leaver-1'), null);
  h.store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de' });
  h.tracker.handleGuildMemberRemove({ id: 'bot-1', guild: h.guild, user: { bot: true, id: 'bot-1' } });
  assert.equal(h.store.getLeaveRecord('g1', 'bot-1'), null);
});

// ---------------------------------------------------------------------------
// Store: Persistenz von Snapshots & Leave-Log (Turso-Datei)
// ---------------------------------------------------------------------------

function makeFileEnv(dbPath) {
  return (key, fallback = '') => {
    if (key === 'TURSO_DATABASE_URL') return `file:${dbPath}`;
    if (key === 'XP_STORE_DISABLE_FILE_BACKUP') return 'true';
    return fallback;
  };
}

test('Store: Invite-Snapshot & Leave-Log überleben Flush + Neustart', async () => {
  const dbPath = path.join(os.tmpdir(), `xp-invite-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const env = makeFileEnv(dbPath);
  try {
    const a = createXpStore({ env });
    await a.init();
    a.setInviteSnapshot('g1', { abc: 3, def: 1 });
    a.setLeaveRecord('g1', 'u1', 123456);
    a.setLeaveRecord('g1', 'u2', 999);
    a.deleteLeaveRecord('g1', 'u2');
    await a.flush({ force: true });

    const b = createXpStore({ env });
    await b.init();
    assert.deepEqual(b.getInviteSnapshot('g1').data, { abc: 3, def: 1 });
    assert.equal(b.getLeaveRecord('g1', 'u1'), 123456);
    assert.equal(b.getLeaveRecord('g1', 'u2'), null, 'gelöschte Leave-Records bleiben gelöscht');

    // pruneLeaveRecords räumt alte Einträge auf
    assert.equal(b.pruneLeaveRecords('g1', 200000), 1);
    assert.equal(b.getLeaveRecord('g1', 'u1'), null);
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
});

test('Store: deleteGuild räumt Invite-Snapshots & Leave-Log mit auf', async () => {
  const dbPath = path.join(os.tmpdir(), `xp-invite-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const env = makeFileEnv(dbPath);
  try {
    const a = createXpStore({ env });
    await a.init();
    a.setInviteSnapshot('g1', { abc: 1 });
    a.setLeaveRecord('g1', 'u1', 123);
    await a.flush({ force: true });

    a.deleteGuild('g1');
    await a.flush({ force: true });
    assert.equal(a.getInviteSnapshot('g1'), null);
    assert.equal(a.getLeaveRecord('g1', 'u1'), null);

    const b = createXpStore({ env });
    await b.init();
    assert.equal(b.getInviteSnapshot('g1'), null);
    assert.equal(b.getLeaveRecord('g1', 'u1'), null);
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
});

test('Store: flush({force:true}) im RAM-Modus wirft nicht und hält die Daten', async () => {
  const h = makeHarness();
  h.store.setInviteSnapshot('g1', { abc: 1 });
  h.store.setLeaveRecord('g1', 'u1', 5);
  await h.store.flush({ force: true });
  assert.deepEqual(h.store.getInviteSnapshot('g1').data, { abc: 1 });
  assert.equal(h.store.getLeaveRecord('g1', 'u1'), 5);
});
