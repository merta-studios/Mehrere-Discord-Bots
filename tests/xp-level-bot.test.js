/**
 * Tests für die Kernlogik des XP Level Bots (ohne Discord-Verbindung):
 * - Nickname-Format: nur Top 3 bekommen eine Medaille, neues Format [Lvl X 🥇]
 * - stripLvlTag versteht sowohl das alte als auch das neue Format
 * - Daily Decay nutzt 5,5% und zieht bei Level-Down den echten Restbetrag ab
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
  xpNeeded,
  MEDIA_XP,
  calculateXpForMessage,
  parseLevelList,
  formatRoleName,
  roleNamePattern,
} = require('../bots/xp-level-bot/src/logic');
const { t, LANGS } = require('../bots/xp-level-bot/src/languages');
const { sendJoinNotice } = require('../bots/xp-level-bot/src/admin-panel');
const { buildModal, syncMemberLevelRoles } = require('../bots/xp-level-bot/src/level-roles');
const { buildLevelUpEmbed } = require('../bots/xp-level-bot/src/embed-builder');

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

test('applyDailyDecay: nutzt 5,5% vom aktuellen Level-Bedarf', () => {
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
