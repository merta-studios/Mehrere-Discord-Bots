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
} = require('../bots/xp-level-bot/src/logic');
const { t } = require('../bots/xp-level-bot/src/languages');
const { sendJoinNotice } = require('../bots/xp-level-bot/src/admin-panel');

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
