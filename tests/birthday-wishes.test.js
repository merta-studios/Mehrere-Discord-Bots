/**
 * Tests für die Geburtstags-Glückwunsch-/Event-Interessenten-Funktionen:
 * - Mentions UNTEREINANDER (eine Person pro Zeile, nicht mehr nebeneinander)
 * - Uhrzeit des Gratulierens/Interesse-Meldens wird angezeigt
 * - Marker sind WIRKLICH unsichtbar: als Zero-Width-Blobs kodiert
 *   (kein sichtbares „wish:/int:“ im Text) → Roundtrip
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
  decodeHidden,
} = require('../bots/birthday-bot/src/embed-builder');

function containerText(container) {
  return extractAllText(container.toJSON());
}

test('Glückwünsche: Mentions untereinander (eine Zeile pro Person) mit Uhrzeit', () => {
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

  // UNTEREINANDER: 5 Einträge = 5 Zeilen (vorher: nebeneinander, max. 2 Zeilen)
  const section = text.split('Glückwünsche (5)')[1];
  const lines = section.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 5, `erwartet 5 Zeilen, bekam ${lines.length}: ${JSON.stringify(lines)}`);
  // Jede Zeile enthält genau eine Erwähnung
  for (const line of lines) {
    const mentions = line.match(/<@!?([^>]+)>/g) || [];
    assert.equal(mentions.length, 1, `Zeile enthält nicht genau eine Erwähnung: ${line}`);
  }

  // Uhrzeiten sichtbar (nur Format prüfen)
  const time1 = formatWishTime(1700000000000, 'de');
  assert.match(time1, /^\d{1,2}:\d{2}$/, `Uhrzeit-Format falsch: ${time1}`);
  assert.ok(text.includes(time1), `Uhrzeit ${time1} fehlt im Text`);
});

test('Glückwünsche: im sichtbaren Text steht KEIN „wish:“/„int:“/„bday-…“-Klartext mehr', () => {
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

  // Genau die Beschwerde aus dem Feld: kein sichtbares „int:“ / „wish:“ + Zahlen
  assert.ok(!text.includes('wish:'), `sichtbarer wish:-Marker: ${text}`);
  assert.ok(!text.includes('int:'), `sichtbarer int:-Marker: ${text}`);
  assert.ok(!text.includes('bday-congrats:'), `sichtbarer bday-congrats:-Marker: ${text}`);
  assert.ok(!text.includes('bday-event:'), `sichtbarer bday-event:-Marker: ${text}`);
  assert.ok(!text.includes('bday::v1::'), `sichtbarer Listen-Marker: ${text}`);

  // Aber der Bot kann die Daten aus den unsichtbaren Blobs lesen
  const decoded = decodeHidden(text).join('\n');
  assert.ok(decoded.includes('bday-congrats:2026-12-31:333333333333333333'), 'Gruß-Marker fehlt');
  assert.ok(decoded.includes('wish:111111111111111111:1700000000000'), 'Marker u1 fehlt');
  assert.ok(decoded.includes('wish:222222222222222222:1700003600000'), 'Marker u2 fehlt');
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

  // Roundtrip: Marker aus den unsichtbaren Blobs wieder auslesen
  const decoded = decodeHidden(text).join('\n');
  const re = /wish:(\d+):(\d+)/g;
  const parsed = [];
  let m;
  while ((m = re.exec(decoded))) parsed.push({ id: m[1], ts: Number(m[2]) });
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
  // Und auch kein sichtbares Marker-Format
  assert.ok(!text.includes('wish:'), 'kein sichtbarer wish:-Text');
});

test('Event-Interessenten: untereinander + Uhrzeit + unsichtbare int-Marker', () => {
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
  assert.ok(text.includes('<@u1>') && text.includes('<@u2>') && text.includes('<@u3>'));

  // Im sichtbaren Text steht kein „int:“-Klartext mehr (Nutzer-Beschwerde)
  assert.ok(!text.includes('int:'), `sichtbarer int:-Marker: ${text}`);
  assert.ok(!text.includes('bday-event:'), `sichtbarer bday-event:-Marker: ${text}`);

  // Der Bot liest sie aus den unsichtbaren Blobs
  const decoded = decodeHidden(text).join('\n');
  assert.ok(decoded.includes('int:u1:1700000000000'), 'int-Marker u1 fehlt');
  assert.ok(decoded.includes('int:u2:1700003600000'), 'int-Marker u2 fehlt');
  assert.ok(!decoded.includes('int:u3:'), 'ohne Zeit kein Marker');
  assert.ok(decoded.includes(`bday-event:2026-08-20:${'536f6d6d657266657374'}`), 'Event-Marker fehlt');

  // UNTEREINANDER: 3 Einträge = 3 Zeilen
  const section = text.split('Interessenten (3)')[1];
  const lines = section.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 3, `erwartet 3 Zeilen, bekam ${lines.length}`);
});

test('wishListText: jede Person auf einer eigenen Zeile', () => {
  const entries = normalizeWishEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `u${n}`, ts: 1700000000000 })));
  const text = wishListText(entries, 'de');
  const lines = text.split('\n');
  assert.equal(lines.length, 9, '9 Einträge = 9 Zeilen');
  assert.ok(lines[0].includes('<@u1>'), 'Zeile 1 enthält u1');
  assert.ok(!lines[0].includes('<@u2>'), 'Zeile 1 enthält nicht u2');
  assert.ok(lines[8].includes('<@u9>'), 'Zeile 9 enthält u9');
});

test('normalizeWishEntries: dedupliziert nach ID (kein Doppel-Eintrag möglich)', () => {
  const entries = normalizeWishEntries([
    { id: 'u1', ts: 1700000000000 },
    { id: 'u1', ts: 1700003600000 }, // Doppel-Eintrag (z. B. fehlerhafte Quelle)
    'u1', // und nochmal als alter String-Stil
    { id: 'u2', ts: null },
    'u2',
  ]);
  assert.deepEqual(entries, [
    { id: 'u1', ts: 1700000000000 },
    { id: 'u2', ts: null },
  ]);
});

test('formatWishTime: nutzt die Zeitzone der Sprache', () => {
  // 1700000000000 = 2023-11-14T22:13:20Z → Berlin = 23:13, New York = 17:13
  assert.equal(formatWishTime(1700000000000, 'de'), '23:13');
  assert.equal(formatWishTime(1700000000000, 'en'), '17:13');
  assert.equal(formatWishTime(null, 'de'), '');
});
