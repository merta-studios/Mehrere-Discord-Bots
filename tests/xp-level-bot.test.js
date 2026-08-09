/**
 * Tests für die Kernlogik des XP Level Bots (ohne Discord-Verbindung):
 * - Nickname-Format: nur Top 3 bekommen eine Medaille, neues Format [Lvl X 🥇]
 * - stripLvlTag versteht sowohl das alte als auch das neue Format
 * - Leaderboard-Titel lautet „Level Leaderboard“ (nicht „XP Leaderboard“)
 * - Rank-Fortschrittszeile: Prozent passt auch bei zweistelligen Zahlen in die Zeile
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatNickname,
  stripLvlTag,
} = require('../bots/xp-level-bot/src/logic');
const { t } = require('../bots/xp-level-bot/src/languages');

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
