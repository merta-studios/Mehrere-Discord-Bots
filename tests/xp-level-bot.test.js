/**
 * Tests für die Kernlogik des XP Level Bots (ohne Discord-Verbindung):
 * - Nickname-Format: nur Top 3 bekommen eine Medaille, neues Format [Lvl X 🥇]
 * - stripLvlTag versteht sowohl das alte als auch das neue Format
 * - Daily Decay nutzt 5% Basis und zieht bei Level-Down den echten Restbetrag ab
 * - Leaderboard-Titel lautet „Level Leaderboard“ (nicht „XP Leaderboard“)
 * - Rank-Fortschrittszeile: Prozent passt auch bei zweistelligen Zahlen in die Zeile
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DAILY_DECAY_RATE,
  applyDailyDecay,
  formatNickname,
  stripLvlTag,
  hasLvlTag,
  xpNeeded,
  MEDIA_XP,
  calculateXpForMessage,
  parseLevelList,
  formatRoleName,
  roleNamePattern,
  currentInactiveDays,
} = require('../bots/xp-level-bot/src/logic');
const { t, LANGS } = require('../bots/xp-level-bot/src/languages');
const { sendJoinNotice } = require('../bots/xp-level-bot/src/admin-panel');
const { buildModal, syncMemberLevelRoles } = require('../bots/xp-level-bot/src/level-roles');
const { buildLevelUpEmbed } = require('../bots/xp-level-bot/src/embed-builder');
const {
  refreshRankNicknames,
  maybeRefreshRankNicknames,
  ensureNickname,
  syncAllNicknames,
  areNicknamesEnabled,
  removeNicknameTag,
  applyExpectedNickname,
} = require('../bots/xp-level-bot/src/nicknames');
const { createXpStore } = require('../bots/xp-level-bot/src/store');
const {
  isLeaderboardRefreshDue,
  isHourlyRefreshDue,
  noteLeaderboardRefresh,
  noteHourlyRefresh,
  syncMapsFromEntry,
  LEADERBOARD_MIN_REFRESH_MS,
  LEADERBOARD_HOURLY_MS,
  _lastLeaderboardRefresh,
  _lastHourlyRefresh,
} = require('../bots/xp-level-bot/src/scheduler');

// ---------------------------------------------------------------------------
// Nickname-Format
// ---------------------------------------------------------------------------

test('formatNickname: Top 3 bekommen Medaillen im Format [Lvl X 🥇]', () => {
  assert.equal(formatNickname(2, 'Claudia', 1), '[Lvl 2 🥇] Claudia');
  assert.equal(formatNickname(2, 'Claudia', 2), '[Lvl 2 🥈] Claudia');
  assert.equal(formatNickname(2, 'Claudia', 3), '[Lvl 2 🥉] Claudia');
});

test('formatNickname: Platz 4+ bekommt keine Platzangabe im Nicknamen', () => {
  assert.equal(formatNickname(2, 'Claudia', 4), '[Lvl 2] Claudia');
  assert.equal(formatNickname(2, 'Claudia', 15), '[Lvl 2] Claudia');
  assert.equal(formatNickname(2, 'Claudia'), '[Lvl 2] Claudia');
});

test('formatNickname: kürzt weiterhin auf 32 Zeichen von rechts', () => {
  const longName = 'EinSehrLangerAnzeigenameDerNichtPasst';
  const nick = formatNickname(2, longName, 1);
  assert.ok(nick.length <= 32, `Nickname ${nick.length} Zeichen > 32`);
  assert.ok(nick.startsWith('[Lvl 2 🥇] '));
});

test('stripLvlTag: entfernt neues und altes Tag-Format', () => {
  assert.equal(stripLvlTag('[Lvl 2 🥈] Claudia'), 'Claudia');
  assert.equal(stripLvlTag('[Lvl 2 | #🥈] Claudia'), 'Claudia');
  assert.equal(stripLvlTag('Claudia'), 'Claudia');
});

// ---------------------------------------------------------------------------
// Daily Decay
// ---------------------------------------------------------------------------

test('applyDailyDecay: nutzt 5% Basis vom aktuellen Level-Bedarf', () => {
  const user = { level: 10, xp: 100 };
  const needed = xpNeeded(user.level);
  const expectedDecay = Math.ceil(needed * DAILY_DECAY_RATE);
  const res = applyDailyDecay(user);
  assert.equal(res.decay, expectedDecay);
  assert.equal(res.level, 10);
  assert.equal(res.xp, 100 - expectedDecay);
  assert.equal(res.leveledDown, false);
});

test('applyDailyDecay: zieht bei Level-Down den echten Restbetrag im vorigen Level ab', () => {
  const user = { level: 2, xp: 3 };
  const needed = xpNeeded(user.level);
  const decay = Math.ceil(needed * DAILY_DECAY_RATE);
  const overflow = decay - user.xp;
  const expectedXpAfterDrop = xpNeeded(1) - overflow;
  const res = applyDailyDecay(user);
  assert.equal(res.level, 1);
  assert.equal(res.xp, expectedXpAfterDrop);
  assert.equal(res.leveledDown, true);
  assert.notEqual(res.xp, Math.floor(xpNeeded(1) * 0.93));
});

test('applyDailyDecay: fällt auf Level 1 nie unter 0 XP', () => {
  const res = applyDailyDecay({ level: 1, xp: 1 });
  assert.equal(res.level, 1);
  assert.equal(res.xp, 0);
  assert.equal(res.leveledDown, false);
});

// ---------------------------------------------------------------------------
// Join-Notice
// ---------------------------------------------------------------------------

test('sendJoinNotice: fällt bei DM-Problemen mit Components V2 auf Text zurück', async () => {
  const sendCalls = [];
  const dm = {
    async send(payload) {
      sendCalls.push(payload);
      if (sendCalls.length === 1) throw new Error('components rejected');
      return { id: 'msg-1' };
    },
  };
  const ownerUser = { createDM: async () => dm };
  const logs = [];
  const ctx = {
    ownerId: '123',
    client: {
      users: {
        cache: new Map([['123', ownerUser]]),
        fetch: async () => ownerUser,
      },
    },
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
  };
  const guild = { name: 'Test Guild', memberCount: 42, ownerId: '999' };

  await sendJoinNotice(ctx, guild);

  assert.equal(sendCalls.length, 2);
  assert.ok(sendCalls[0].components, 'erste Nachricht sollte Components V2 nutzen');
  assert.match(sendCalls[1].content, /Neuer XP-Server!/);
  assert.ok(logs.some((entry) => entry[0] === 'warn' && String(entry[1]).includes('Join-Notice nur als Text gesendet')));
});

// ---------------------------------------------------------------------------
// Leaderboard-Titel
// ---------------------------------------------------------------------------

test('lbTitle lautet "Level Leaderboard" (nicht "XP Leaderboard")', () => {
  assert.equal(t('lbTitle', 'de'), '🏆 Level Leaderboard');
  assert.equal(t('lbTitle', 'en'), '🏆 Level Leaderboard');
  assert.ok(!t('lbTitle', 'de').includes('XP'));
});

// ---------------------------------------------------------------------------
// Rank-Fortschrittszeile
// ---------------------------------------------------------------------------

test('rankBody: Fortschrittszeile passt bei ein- und zweistelligen Prozenten', () => {
  function progressLineLength(percent) {
    const BAR_SEGMENTS = 8;
    const filled = Math.round((percent / 100) * BAR_SEGMENTS);
    const bar = '⬛'.repeat(filled) + '⬜'.repeat(BAR_SEGMENTS - filled);
    const body = t('rankBody', 'de', {
      user: '<@123456789012345678>',
      rank: 1, total: 50, level: 2, xp: 45, needed: 100, nextLevel: 3,
      bar, percent, remaining: 55,
    });
    return body.split('\n').find((l) => l.includes('Fortschritt')).length;
  }
  // Vorher (10 Segmente): einstellige Prozent passten mit 33 Zeichen in die Zeile,
  // zweistellige (34) brachen um. Mit 8 Segmenten:
  // - alle real vorkommenden zweistelligen Prozent (10–99) sind ≤ 32 Zeichen
  // - selbst 100 % (nur bei Lvl-100-Cap) bleibt bei 33 = der bekannten passenden Länge
  for (let p = 0; p <= 100; p++) {
    const len = progressLineLength(p);
    const maxFit = p <= 99 ? 32 : 33;
    assert.ok(len <= maxFit, `${p}% macht die Zeile zu lang (${len})`);
  }
});

// ---------------------------------------------------------------------------
// Level-Up-Nachricht: „## “-Heading für die Level-Up-Zeile
// ---------------------------------------------------------------------------

test('buildLevelUpEmbed: Level-Up-Zeile nutzt "## "-Heading (größerer Text)', () => {
  const container = buildLevelUpEmbed({ lang: 'de', userId: '123', level: 5, xp: 10 });
  const json = container.toJSON();
  const text = JSON.stringify(json);
  assert.ok(text.includes('## 🎉 <@123> ist auf Level 5 aufgestiegen!'), `Level-Up-Text fehlt oder ohne ##: ${text}`);
});

// ---------------------------------------------------------------------------
// Medien-XP: Bilder, Videos, Sprachnachrichten & Sticker
// ---------------------------------------------------------------------------

test('calculateXpForMessage: Nur-Medien-Nachricht gibt ausgeglichene 15 XP', () => {
  const res = calculateXpForMessage('', { hasMedia: true });
  assert.equal(res.valid, 0);
  assert.equal(res.xp, MEDIA_XP);
  assert.equal(res.xp, 15);
  assert.equal(res.media, true);
});

test('calculateXpForMessage: ohne Medien gibt eine leere Nachricht 0 XP', () => {
  const res = calculateXpForMessage('', { hasMedia: false });
  assert.equal(res.xp, 0);
});

test('calculateXpForMessage: Text + Medien gibt Bonus, aber nie über 30 XP', () => {
  const textOnly = calculateXpForMessage('Hallo du da', { hasMedia: false }).xp; // 3 Wörter = 9 XP
  const withMedia = calculateXpForMessage('Hallo du da', { hasMedia: true });
  assert.ok(withMedia.xp > textOnly, `mit Medien sollte mehr XP geben (${withMedia.xp} vs ${textOnly})`);
  assert.ok(withMedia.xp <= 30, `Cap von 30 XP verletzt: ${withMedia.xp}`);
  const maxText = calculateXpForMessage('eins zwei drei vier fünf sechs sieben acht neun zehn', { hasMedia: true });
  assert.equal(maxText.xp, 30);
});

// ---------------------------------------------------------------------------
// Level-Rollen: Eingabe-Parsing (Kommas, Leerzeichen, Tippfehler)
// ---------------------------------------------------------------------------

test('parseLevelList: kommagetrennte Eingaben werden sortiert & dedupliziert', () => {
  assert.deepEqual(parseLevelList('3,6,10,20'), [3, 6, 10, 20]);
  assert.deepEqual(parseLevelList('20,3,10,6'), [3, 6, 10, 20]); // unsortiert -> sortiert
  assert.deepEqual(parseLevelList('3, 6, 10, 20'), [3, 6, 10, 20]);
  assert.deepEqual(parseLevelList('3,,6,,10'), [3, 6, 10]); // doppelte Kommas
  assert.deepEqual(parseLevelList('3,6,3,6,10'), [3, 6, 10]); // Duplikate
});

test('parseLevelList: Leerzeichen, Semikolon und Punkte als Trenner', () => {
  assert.deepEqual(parseLevelList('3 6 10 20'), [3, 6, 10, 20]);
  assert.deepEqual(parseLevelList('3;6;10'), [3, 6, 10]);
  assert.deepEqual(parseLevelList('3.6.10.20'), [3, 6, 10, 20]);
});

test('parseLevelList: korrigiert Verwechslungs-Buchstaben (1O -> 10, l3 -> 13)', () => {
  assert.deepEqual(parseLevelList('3,6,1O,2O'), [3, 6, 10, 20]);
  assert.deepEqual(parseLevelList('l3, 6'), [6, 13]); // l -> 1, also 13
  assert.deepEqual(parseLevelList('3b'), [38]); // b -> 8
});

test('parseLevelList: versteht "Level 6"/"lvl6"/"6lvl" und ignoriert Unverständliches', () => {
  assert.deepEqual(parseLevelList('Level 3, lvl6, 10'), [3, 6, 10]);
  assert.deepEqual(parseLevelList('6lvl'), [6]);
  assert.deepEqual(parseLevelList('abc, xyz, 5'), [5]); // Müll wird ignoriert
  assert.equal(parseLevelList('abc, xyz'), null);
  assert.equal(parseLevelList(''), null);
  assert.equal(parseLevelList('   , ,  '), null);
});

test('parseLevelList: begrenzt auf 1..100 (Max-Level des Bots)', () => {
  assert.deepEqual(parseLevelList('3,150,0,-5,100'), [3, 100]);
});

// ---------------------------------------------------------------------------
// Level-Rollen: Namens-Format & Erkennung alter Rollen
// ---------------------------------------------------------------------------

test('formatRoleName: ersetzt {LEVEL} (case-insensitiv) durch die Zahl', () => {
  assert.equal(formatRoleName('Level {LEVEL}', 3), 'Level 3');
  assert.equal(formatRoleName('Lvl {level}', 12), 'Lvl 12');
  assert.equal(formatRoleName('⭐ {LEVEL} ⭐', 7), '⭐ 7 ⭐');
});

test('roleNamePattern: erkennt bestehende Level-Rollen im gespeicherten Format', () => {
  const pattern = roleNamePattern('Level {LEVEL}');
  assert.ok(pattern.test('Level 3'));
  assert.ok(pattern.test('level 20'));
  assert.ok(!pattern.test('Leveler 3'));
  assert.ok(!pattern.test('Level X'));
  assert.ok(roleNamePattern('Lvl {LEVEL}').test('Lvl 10'));
});

// ---------------------------------------------------------------------------
// Level-Rollen: Formular (Modal)
// ---------------------------------------------------------------------------

test('buildModal: Standardwerte "Level {LEVEL}" und "3,6,10,20" sind vorausgefüllt', () => {
  const modal = buildModal({ lang: 'de', cfg: null });
  const fields = modal.toJSON().components.map((row) => row.components[0]);
  assert.equal(fields.length, 2);
  const formatField = fields.find((f) => f.custom_id === 'xp_lvlroles_format');
  const levelsField = fields.find((f) => f.custom_id === 'xp_lvlroles_levels');
  assert.equal(formatField.value, 'Level {LEVEL}');
  assert.equal(levelsField.value, '3,6,10,20');
  assert.equal(formatField.required, true);
  assert.equal(levelsField.required, true);
});

test('buildModal: übernimmt bestehende Konfiguration als Vorgabe', () => {
  const modal = buildModal({ lang: 'de', cfg: { levelRoleTemplate: 'Lvl {LEVEL}', levelRoleLevels: [5, 10, 25] } });
  const fields = modal.toJSON().components.map((row) => row.components[0]);
  assert.equal(fields.find((f) => f.custom_id === 'xp_lvlroles_format').value, 'Lvl {LEVEL}');
  assert.equal(fields.find((f) => f.custom_id === 'xp_lvlroles_levels').value, '5,10,25');
});

test('buildModal: Labels bleiben in allen 10 Sprachen unter 45 Zeichen (Discord-Limit)', () => {
  for (const code of Object.keys(LANGS)) {
    assert.ok(t('levelRolesFormatLabel', code).length <= 45, `levelRolesFormatLabel (${code}) zu lang: ${t('levelRolesFormatLabel', code).length}`);
    assert.ok(t('levelRolesLevelsLabel', code).length <= 45, `levelRolesLevelsLabel (${code}) zu lang: ${t('levelRolesLevelsLabel', code).length}`);
    assert.ok(t('levelRolesModalTitle', code).length <= 45, `levelRolesModalTitle (${code}) zu lang`);
  }
});

// ---------------------------------------------------------------------------
// Level-Rollen: Sync (mehrere Rollen adden, nie entfernen)
// ---------------------------------------------------------------------------

test('syncMemberLevelRoles: addet alle passenden Rollen (Level 6 -> Rollen 3 + 6)', async () => {
  const added = [];
  const member = {
    roles: {
      cache: new Map([['role-10', { id: 'role-10' }]]), // hat schon Level-10-Rolle
      add: async (ids) => { added.push(...ids); },
    },
  };
  const cfg = { levelRoleIds: { 3: 'role-3', 6: 'role-6', 10: 'role-10', 20: 'role-20' } };
  const count = await syncMemberLevelRoles({ member, level: 6, cfg });
  assert.equal(count, 2);
  assert.deepEqual(added.sort(), ['role-3', 'role-6']);
});

test('syncMemberLevelRoles: bei Level-Down wird nichts entfernt, nur ergänzt', async () => {
  const added = [];
  const member = {
    roles: {
      cache: new Map([['role-3', { id: 'role-3' }], ['role-6', { id: 'role-6' }]]),
      add: async (ids) => { added.push(...ids); },
    },
  };
  const cfg = { levelRoleIds: { 3: 'role-3', 6: 'role-6' } };
  const count = await syncMemberLevelRoles({ member, level: 4, cfg }); // von 6 auf 4 abgestiegen
  assert.equal(count, 0); // Rolle 6 bleibt (wird nie entfernt), Rolle 3 ist schon da
  assert.deepEqual(added, []);
});

test('syncMemberLevelRoles: ohne konfigurierte Rollen passiert nichts', async () => {
  let called = false;
  const member = { roles: { cache: new Map(), add: async () => { called = true; } } };
  const count = await syncMemberLevelRoles({ member, level: 5, cfg: null });
  assert.equal(count, 0);
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// Nicknames: zuverlässige Aktualisierung bei Rang-Verschiebungen
// ---------------------------------------------------------------------------

function makeNicknameHarness() {
  // Mitglieder mit Rollen für die Berechtigungsprüfung
  const members = new Map();
  function makeMember(id, displayName, nickname) {
    const m = {
      id,
      nickname,
      displayName,
      user: { username: displayName },
      roles: { highest: { position: 1 } },
      setNickname: async (nick) => { m.nickname = nick; },
    };
    members.set(id, m);
    return m;
  }
  const botMember = { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 100 } } };
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    members: {
      me: botMember,
      fetch: async (id) => members.get(id) || null,
    },
  };
  return { guild, members, makeMember };
}

test('refreshRankNicknames: Platz 2 bekommt 🥈, wenn die Rangliste sich verschoben hat', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'Alice', '[Lvl 5 🥇] Alice'); // veraltet: war Platz 1
  makeMember('b', 'Bob', '[Lvl 5 🥈] Bob'); // neuer Platz 1
  makeMember('c', 'Clara', '[Lvl 5 🥉] Clara');
  makeMember('d', 'Dan', '[Lvl 5] Dan');
  makeMember('e', 'Eva', '[Lvl 5] Eva');

  const store = {
    getLeaderboard: () => [
      { userId: 'b', level: 5, xp: 60 },
      { userId: 'a', level: 5, xp: 55 }, // Alice ist jetzt Platz 2
      { userId: 'c', level: 5, xp: 40 },
      { userId: 'd', level: 5, xp: 20 },
      { userId: 'e', level: 5, xp: 10 },
    ],
    getRank: (gid, userId) => {
      const order = { b: 1, a: 2, c: 3, d: 4, e: 5 };
      return { rank: order[userId] };
    },
    getUser: (gid, userId) => ({ userId, level: 5, xp: 0 }),
  };
  const ctx = { store, logger: { warn: () => {} } };

  await refreshRankNicknames(ctx, guild, 'b', 'de');

  assert.equal(members.get('a').nickname, '[Lvl 5 🥈] Alice', 'Platz 2 muss 🥈 im Anzeigenamen haben');
  assert.equal(members.get('b').nickname, '[Lvl 5 🥇] Bob');
  assert.equal(members.get('c').nickname, '[Lvl 5 🥉] Clara');
  assert.equal(members.get('d').nickname, '[Lvl 5] Dan', 'Platz 4 bekommt keine Medaille');
});

test('refreshRankNicknames: Nutzer, der aus den Top 3 fällt, verliert die Medaille', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'Alice', '[Lvl 5 🥉] Alice'); // fällt von Platz 3 auf Platz 20
  makeMember('b', 'Bob', '[Lvl 6] Bob'); // rückt auf Platz 1
  makeMember('c', 'Clara', '[Lvl 6] Clara');
  makeMember('d', 'Dan', '[Lvl 6] Dan');
  makeMember('e', 'Eva', '[Lvl 6] Eva');

  const store = {
    getLeaderboard: () => [
      { userId: 'b', level: 6, xp: 10 },
      { userId: 'c', level: 6, xp: 9 },
      { userId: 'd', level: 6, xp: 8 },
      { userId: 'e', level: 6, xp: 7 },
      { userId: 'a', level: 5, xp: 0 }, // Alice weit abgeschlagen
    ],
    getRank: (gid, userId) => {
      const order = { b: 1, c: 2, d: 3, e: 4, a: 20 };
      return { rank: order[userId] };
    },
    getUser: (gid, userId) => ({ userId, level: userId === 'a' ? 5 : 6, xp: 0 }),
  };
  const ctx = { store, logger: { warn: () => {} } };

  await refreshRankNicknames(ctx, guild, 'a', 'de');

  assert.equal(members.get('a').nickname, '[Lvl 5] Alice', 'Medaille muss nach dem Abstieg entfernt werden');
  assert.equal(members.get('b').nickname, '[Lvl 6 🥇] Bob');
  assert.equal(members.get('c').nickname, '[Lvl 6 🥈] Clara');
  assert.equal(members.get('d').nickname, '[Lvl 6 🥉] Dan');
});

test('refreshRankNicknames: lässt unveränderte Nicknames unangetastet (kein unnötiges API-Call)', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  let setCalls = 0;
  const a = makeMember('a', 'Alice', '[Lvl 5 🥇] Alice');
  a.setNickname = async (nick) => { setCalls++; a.nickname = nick; };
  makeMember('b', 'Bob', '[Lvl 5 🥈] Bob');
  const store = {
    getLeaderboard: () => [{ userId: 'a', level: 5, xp: 50 }, { userId: 'b', level: 5, xp: 40 }],
    getRank: (gid, userId) => ({ rank: userId === 'a' ? 1 : 2 }),
    getUser: (gid, userId) => ({ userId, level: 5, xp: 0 }),
  };
  const ctx = { store, logger: { warn: () => {} } };
  await refreshRankNicknames(ctx, guild, 'a', 'de');
  assert.equal(setCalls, 0, 'kein setNickname nötig, wenn alles aktuell ist');
});

test('maybeRefreshRankNicknames: throttelt auf 2 Minuten pro Server', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  makeMember('a', 'Alice', '[Lvl 5 🥇] Alice');
  const store = {
    getLeaderboard: () => [{ userId: 'a', level: 5, xp: 50 }],
    getRank: () => ({ rank: 1 }),
    getUser: (gid, userId) => ({ userId, level: 5, xp: 0 }),
  };
  const ctx = { store, logger: { warn: () => {} } };

  const first = await maybeRefreshRankNicknames(ctx, guild, 'a', 'de', 2 * 60 * 1000);
  assert.equal(first, true, 'erster Aufruf läuft durch');
  const second = await maybeRefreshRankNicknames(ctx, guild, 'a', 'de', 2 * 60 * 1000);
  assert.equal(second, false, 'zweiter Aufruf sofort wird gedrosselt');
});

// ---------------------------------------------------------------------------
// Leaderboard-Aktualisierung: Throttle 10 Minuten + Texte
// ---------------------------------------------------------------------------

test('isLeaderboardRefreshDue: erst nach 10 Minuten wieder fällig', () => {
  const t0 = 1_000_000;
  assert.equal(isLeaderboardRefreshDue('g1', t0), true, 'vor der ersten Aktualisierung immer fällig');
  noteLeaderboardRefresh('g1', t0);
  assert.equal(isLeaderboardRefreshDue('g1', t0 + LEADERBOARD_MIN_REFRESH_MS - 1), false, 'nach 9:59 Min noch nicht fällig');
  assert.equal(isLeaderboardRefreshDue('g1', t0 + LEADERBOARD_MIN_REFRESH_MS), true, 'nach 10 Min fällig');
  assert.equal(LEADERBOARD_MIN_REFRESH_MS, 10 * 60 * 1000);
});

test('Stunden-Timer bleibt unabhängig: ein Level-Up-Refresh verschiebt ihn NICHT', () => {
  const guildId = 'hourly-independent-guild';
  _lastLeaderboardRefresh.delete(guildId);
  _lastHourlyRefresh.delete(guildId);
  const hourlyAt = 2_000_000;
  noteHourlyRefresh(guildId, hourlyAt);

  // 54 Minuten später editiert ein Level-Up das Board.
  noteLeaderboardRefresh(guildId, hourlyAt + 54 * 60 * 1000);
  assert.equal(
    isHourlyRefreshDue(guildId, hourlyAt + LEADERBOARD_HOURLY_MS),
    true,
    'der Stunden-Refresh muss trotzdem nach 55 Minuten fällig sein'
  );
});

test('syncMapsFromEntry trennt persistierten allgemeinen und stündlichen Timestamp', () => {
  const guildId = 'persisted-hourly-independent-guild';
  _lastLeaderboardRefresh.delete(guildId);
  _lastHourlyRefresh.delete(guildId);
  syncMapsFromEntry({
    guildId,
    lastLeaderboardRefresh: 9_000_000, // z.B. gerade durch Level-Up
    lastHourlyLeaderboardRefresh: 3_000_000,
  });
  assert.equal(_lastLeaderboardRefresh.get(guildId), 9_000_000);
  assert.equal(_lastHourlyRefresh.get(guildId), 3_000_000);

  // Alte Installationen hatten nur das kontaminierte allgemeine Feld. Das darf
  // niemals mehr heimlich als echter Stunden-Zeitstempel übernommen werden.
  const legacyGuildId = 'legacy-hourly-guild';
  _lastLeaderboardRefresh.delete(legacyGuildId);
  _lastHourlyRefresh.delete(legacyGuildId);
  syncMapsFromEntry({ guildId: legacyGuildId, lastLeaderboardRefresh: 9_000_000 });
  assert.equal(_lastHourlyRefresh.has(legacyGuildId), false);
});

test('lbDecayNotice: Hinweis ist kurz & in allen 10 Sprachen vorhanden', () => {
  for (const code of Object.keys(LANGS)) {
    const text = t('lbDecayNotice', code);
    assert.ok(text && text.length > 0, `lbDecayNotice (${code}) fehlt`);
    assert.ok(text.length <= 160, `lbDecayNotice (${code}) zu lang: ${text.length} Zeichen`);
  }
  assert.ok(t('lbDecayNotice', 'de').length < 120, 'deutscher Hinweis soll kurz sein');
  assert.match(t('lbDecayNotice', 'de'), /0 Uhr/);
});

test('lbNextUpdate: erwähnt stündlich + Level-Ups', () => {
  assert.match(t('lbNextUpdate', 'de'), /stündlich/i);
  assert.match(t('lbNextUpdate', 'de'), /Level-Ups/i);
});

test('hasLvlTag: erkennt nur echte Level-Tags', () => {
  assert.equal(hasLvlTag('[Lvl 2 🥈] Claudia'), true);
  assert.equal(hasLvlTag('[Lvl 12] Bob'), true);
  assert.equal(hasLvlTag('Claudia'), false);
  assert.equal(hasLvlTag('Lvl 2 Claudia'), false);
});

test('areNicknamesEnabled: Standard ist an, nur explizites false schaltet aus', () => {
  assert.equal(areNicknamesEnabled({ getGuild: () => null }, 'g1'), true);
  assert.equal(areNicknamesEnabled({ getGuild: () => ({}) }, 'g1'), true);
  assert.equal(areNicknamesEnabled({ getGuild: () => ({ nicknamesEnabled: true }) }, 'g1'), true);
  assert.equal(areNicknamesEnabled({ getGuild: () => ({ nicknamesEnabled: false }) }, 'g1'), false);
  assert.equal(areNicknamesEnabled({}, 'g1'), true);
});

test('ensureNickname: setzt nichts, wenn Nickname-Tags ausgeschaltet sind', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'Alice', 'Alice');
  let setCalls = 0;
  a.setNickname = async (nick) => { setCalls += 1; a.nickname = nick; };
  const store = {
    getGuild: () => ({ guildId: 'g1', nicknamesEnabled: false, leaderboardChannelId: 'c' }),
    getRank: () => ({ rank: 4 }),
    getUser: () => ({ userId: 'a', level: 3, xp: 0 }),
  };
  const ok = await ensureNickname({ store }, guild, 'a', 3, 'de');
  assert.equal(ok, false);
  assert.equal(setCalls, 0);
  assert.equal(members.get('a').nickname, 'Alice');
});

test('parseNicknamesEnabled: Turso-BigInt 0 und "0" bleiben aus', () => {
  const store = createXpStore({ env: () => '' });
  assert.equal(store.parseNicknamesEnabled(0n), false);
  assert.equal(store.parseNicknamesEnabled(0), false);
  assert.equal(store.parseNicknamesEnabled('0'), false);
  assert.equal(store.parseNicknamesEnabled('false'), false);
  assert.equal(store.parseNicknamesEnabled(1n), true);
  assert.equal(store.parseNicknamesEnabled(null), true);
});

test('setGuild: Leaderboard-/Bonus-Schreib ohne Flag überschreibt toggle off nicht', () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', lang: 'de', nicknamesEnabled: false });
  store.setGuild({ guildId: 'g1', lastLeaderboardRefresh: 99 });
  assert.equal(store.getGuild('g1').nicknamesEnabled, false);
  assert.equal(store.getGuild('g1').lastLeaderboardRefresh, 99);
});

test('applyExpectedNickname: setzt keine Tags, wenn Nicknames aus sind', async () => {
  const { guild, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'Alice', 'Alice');
  let setCalls = 0;
  a.setNickname = async (nick) => { setCalls += 1; a.nickname = nick; };
  const store = {
    getGuild: () => ({ nicknamesEnabled: false }),
    getRank: () => ({ rank: 1 }),
    getUser: () => ({ userId: 'a', level: 4, xp: 0 }),
  };
  const result = await applyExpectedNickname({ store }, guild, a, 'de', { level: 4 });
  assert.equal(result, 'unchanged');
  assert.equal(setCalls, 0);
  assert.equal(a.nickname, 'Alice');
});

test('refreshRankNicknames: bleibt stumm, wenn Tags ausgeschaltet sind', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'Alice', 'Alice');
  let setCalls = 0;
  a.setNickname = async (nick) => { setCalls += 1; a.nickname = nick; };
  const store = {
    getGuild: () => ({ nicknamesEnabled: false }),
    getLeaderboard: () => [{ userId: 'a', level: 5, xp: 50 }],
    getRank: () => ({ rank: 1 }),
    getUser: () => ({ userId: 'a', level: 5, xp: 0 }),
  };
  await refreshRankNicknames({ store }, guild, 'a', 'de');
  assert.equal(setCalls, 0);
});

test('removeNicknameTag: entfernt [Lvl]-Tag und stellt den Anzeigenamen wieder her', async () => {
  const { guild, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'alice123', '[Lvl 4 🥇] CoolAlice');
  a.displayName = '[Lvl 4 🥇] CoolAlice';
  const result = await removeNicknameTag({ store: { getGuild: () => ({}) } }, guild, a, 'de');
  assert.equal(result, 'updated');
  assert.equal(a.nickname, 'CoolAlice');
});

test('removeNicknameTag: setzt Nickname auf null, wenn nur der Username übrig bleibt', async () => {
  const { guild, makeMember } = makeNicknameHarness();
  const a = makeMember('a', 'Alice', '[Lvl 1] Alice');
  const result = await removeNicknameTag({ store: { getGuild: () => ({}) } }, guild, a, 'de');
  assert.equal(result, 'updated');
  assert.equal(a.nickname, null);
});

test('syncAllNicknames: setzt fehlende Tags, wenn die Funktion an ist', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  makeMember('a', 'Alice', 'Alice');
  makeMember('b', 'Bob', '[Lvl 2] Bob');
  makeMember('botty', 'Bot', null).user.bot = true;
  guild.members.fetch = async () => members;

  const store = {
    getGuild: () => ({ nicknamesEnabled: true }),
    getRank: (gid, userId) => ({ rank: userId === 'a' ? 1 : 4 }),
    getUser: (gid, userId) => ({ userId, level: userId === 'a' ? 5 : 2, xp: 0 }),
  };
  const progress = [];
  const stats = await syncAllNicknames({ store }, guild, 'de', {
    onProgress: async (s) => { progress.push({ ...s }); },
  });

  assert.equal(stats.total, 2, 'Bots werden übersprungen');
  assert.equal(stats.updated, 1);
  assert.equal(stats.unchanged, 1);
  assert.equal(stats.failed, 0);
  assert.equal(members.get('a').nickname, '[Lvl 5 🥇] Alice');
  assert.equal(members.get('b').nickname, '[Lvl 2] Bob');
  assert.ok(progress.length >= 1, 'Lade-/Fortschritts-Callback muss feuern');
});

test('syncAllNicknames: entfernt Tags, wenn die Funktion aus ist', async () => {
  const { guild, members, makeMember } = makeNicknameHarness();
  makeMember('a', 'Alice', '[Lvl 5 🥇] Alice');
  makeMember('b', 'Bob', 'Bob');
  guild.members.fetch = async () => members;

  const store = {
    getGuild: () => ({ nicknamesEnabled: false }),
    getRank: () => ({ rank: 1 }),
    getUser: (gid, userId) => ({ userId, level: 5, xp: 0 }),
  };
  const stats = await syncAllNicknames({ store }, guild, 'de');
  assert.equal(stats.enabled, false);
  assert.equal(stats.updated, 1);
  assert.equal(stats.unchanged, 1);
  assert.equal(members.get('a').nickname, null);
  assert.equal(members.get('b').nickname, 'Bob');
});

test('Nickname-Command-Beschreibungen bleiben in allen Sprachen unter 100 Zeichen', () => {
  for (const key of ['toggleNicknamesHelp', 'toggleNicknamesEnabledDesc', 'syncNicknamesHelp']) {
    for (const code of Object.keys(LANGS)) {
      const text = t(key, code);
      assert.ok(text.length >= 1 && text.length <= 100, `${key} (${code}) ${text.length}: ${text}`);
    }
  }
});


test('currentInactiveDays: aktiver Nutzer ist 0, sonst gespeicherter Streak', () => {
  const now = Date.now();
  assert.equal(currentInactiveDays({ lastActivity: now - 1000, inactiveDays: 9 }, now), 0);
  assert.equal(currentInactiveDays({ lastActivity: now - 30 * 3600 * 1000, inactiveDays: 4 }, now), 4);
  assert.equal(currentInactiveDays(null, now), 0);
});

test('syncNicknamesProgress/Done nutzen echte Zeilenumbrüche statt \\n-Text', () => {
  const progress = t('syncNicknamesProgress', 'de', {
    bar: 'x', percent: 10, done: 1, total: 10, updated: 0, unchanged: 1, failed: 0,
  });
  const done = t('syncNicknamesDone', 'de', {
    mode: 'an', total: 1, updated: 0, unchanged: 1, failed: 0,
  });
  assert.ok(progress.includes('\n'), 'Progress braucht echte Zeilenumbrüche');
  assert.ok(done.includes('\n'), 'Done braucht echte Zeilenumbrüche');
  assert.equal(progress.includes('\\n'), false, 'kein literaler \\n-String im Progress');
  assert.equal(done.includes('\\n'), false, 'kein literaler \\n-String im Done');
});

test('set_inactive_role-Beschreibungen bleiben in allen Sprachen unter 100 Zeichen', () => {
  for (const key of ['setInactiveRoleHelp', 'setInactiveRoleModeDesc', 'setInactiveRoleDaysDesc', 'setInactiveRoleRoleDesc']) {
    for (const code of Object.keys(LANGS)) {
      const text = t(key, code);
      assert.ok(text.length >= 1 && text.length <= 100, `${key} (${code}) ${text.length}: ${text}`);
    }
  }
});
