/**
 * Tests für die neuen Geburtstags-Glückwunsch-/Event-Interessenten-Funktionen:
 * - Mentions NEBENEINANDER statt untereinander (Platzsparer)
 * - Uhrzeit des Gratulierens/Interesse-Meldens wird angezeigt
 * - Unsichtbare Marker (wish:/int:) für die komplette Liste → Roundtrip
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCongratsEmbed,
  buildEventCongratsEmbed,
  extractAllText,
  normalizeWishEntries,
  wishListText,
  formatWishTime,
} = require('../bots/birthday-bot/src/embed-builder');

function containerText(container) {
  return extractAllText(container.toJSON());
}

test('Glückwünsche: Mentions nebeneinander (nicht untereinander) mit Uhrzeit', () => {
  const { container } = buildCongratsEmbed({
    member: { id: 'bday1' },
    lang: 'de',
    dateKey: '2026-12-31',
    wishes: [
      { id: 'u1', ts: 1700000000000 },
      { id: 'u2', ts: 1700003600000 },
      { id: 'u3', ts: 1700007200000 },
      { id: 'u4', ts: 1700010800000 },
      { id: 'u5', ts: 1700014400000 },
    ],
  });
  const text = containerText(container);

  // Alle 5 Mentions sind da
  for (const uid of ['u1', 'u2', 'u3', 'u4', 'u5']) {
    assert.ok(text.includes(`<@${uid}>`), `Mention ${uid} fehlt`);
  }
  // Zähler stimmt
  assert.ok(text.includes('Glückwünsche (5)'), text);

  // Zeilenumbruch-Sparer: 5 Einträge müssen auf ≤ 2 Zeilen passen (vorher: 5 Zeilen)
  const section = text.split('Glückwünsche (5)')[1].split('\u200B')[0];
  const lines = section.split('\n').filter((l) => l.trim());
  assert.ok(lines.length <= 2, `erwartet max. 2 Zeilen, bekam ${lines.length}: ${JSON.stringify(lines)}`);

  // Uhrzeiten sichtbar (z. B. 10:13 für 1700000000000 in Europe/Berlin = 11:13? – egal, nur Format prüfen)
  const time1 = formatWishTime(1700000000000, 'de');
  assert.match(time1, /^\d{1,2}:\d{2}$/, `Uhrzeit-Format falsch: ${time1}`);
  assert.ok(text.includes(time1), `Uhrzeit ${time1} fehlt im Text`);
});

test('Glückwünsche: Marker enthalten komplette Liste inkl. Uhrzeit (Roundtrip)', () => {
  const wishes = [
    { id: '111111111111111111', ts: 1700000000000 },
    { id: '222222222222222222', ts: 1700003600000 },
  ];
  const { container } = buildCongratsEmbed({
    member: { id: '333333333333333333' },
    lang: 'de',
    dateKey: '2026-12-31',
    wishes,
  });
  const text = containerText(container);
  // Marker für beide Einträge
  assert.ok(text.includes('wish:111111111111111111:1700000000000'), 'Marker u1 fehlt');
  assert.ok(text.includes('wish:222222222222222222:1700003600000'), 'Marker u2 fehlt');

  // Roundtrip: Marker wieder auslesen (Discord-Snowflakes sind numerisch)
  const re = /wish:(\d+):(\d+)/g;
  const parsed = [];
  let m;
  while ((m = re.exec(text))) parsed.push({ id: m[1], ts: Number(m[2]) });
  assert.deepEqual(parsed, wishes);
});

test('Glückwünsche: alte Listen ohne Marker (nur Mentions) bleiben kompatibel', () => {
  const { container } = buildCongratsEmbed({
    member: { id: 'bday1' },
    lang: 'de',
    dateKey: '2026-12-31',
    wishes: ['u1', 'u2'], // alter String-Stil
  });
  const text = containerText(container);
  assert.ok(text.includes('<@u1>'));
  assert.ok(text.includes('<@u2>'));
  assert.ok(text.includes('Glückwünsche (2)'));
  // Keine Marker, da keine Zeitstempel vorhanden
  assert.ok(!text.includes('wish:u1:'), 'ohne Zeitstempel kein Marker');
});

test('Event-Interessenten: nebeneinander + Uhrzeit + int-Marker', () => {
  const { container } = buildEventCongratsEmbed({
    name: 'Sommerfest',
    lang: 'de',
    dateKey: '2026-08-20',
    interested: [
      { id: 'u1', ts: 1700000000000 },
      { id: 'u2', ts: 1700003600000 },
      { id: 'u3', ts: null }, // alt: keine Zeit
    ],
  });
  const text = containerText(container);
  assert.ok(text.includes('Interessenten (3)'), text);
  assert.ok(text.includes('int:u1:1700000000000'), 'int-Marker u1 fehlt');
  assert.ok(text.includes('int:u2:1700003600000'), 'int-Marker u2 fehlt');
  assert.ok(!text.includes('int:u3:'), 'ohne Zeit kein Marker');

  // Nebeneinander: max. 2 Zeilen für 3 Einträge
  const section = text.split('Interessenten (3)')[1].split('\u200B')[0];
  const lines = section.split('\n').filter((l) => l.trim());
  assert.ok(lines.length <= 2, `erwartet max. 2 Zeilen, bekam ${lines.length}`);
});

test('wishListText: chunkt in Zeilen zu je 4 Einträgen', () => {
  const entries = normalizeWishEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `u${n}`, ts: 1700000000000 })));
  const text = wishListText(entries, 'de');
  const lines = text.split('\n');
  assert.equal(lines.length, 3); // 4 + 4 + 1
  assert.ok(lines[0].includes('<@u1>') && lines[0].includes('<@u4>'), 'Zeile 1 enthält u1..u4');
  assert.ok(!lines[0].includes('<@u5>'), 'Zeile 1 endet bei u4');
  assert.ok(lines[2].includes('<@u9>'), 'Zeile 3 enthält u9');
});

test('formatWishTime: nutzt die Zeitzone der Sprache', () => {
  // 1700000000000 = 2023-11-14T22:13:20Z → Berlin = 23:13, New York = 17:13
  assert.equal(formatWishTime(1700000000000, 'de'), '23:13');
  assert.equal(formatWishTime(1700000000000, 'en'), '17:13');
  assert.equal(formatWishTime(null, 'de'), '');
});
