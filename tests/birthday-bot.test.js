/**
 * Tests für die Kernlogik des Geburtstags-Bots (ohne Discord-Verbindung):
 * - Fuzzy-Monatserkennung in allen 10 Sprachen (auch mit Tippfehlern)
 * - Tages-Parsing & Datumsvalidierung
 * - 7-Tage-Regel & Monats-Reihenfolge
 * - Embed-Roundtrip: Liste bauen → wieder auslesen (das „DB-lose“ Prinzip)
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { matchMonth } = require('../bots/birthday-bot/src/languages');
const {
  monthOrder,
  isValidDate,
  parseDayInput,
  isWithinSevenDays,
  tzParts,
  daysUntilNext,
} = require('../bots/birthday-bot/src/logic');
const { buildListEmbed, parseListEmbed } = require('../bots/birthday-bot/src/embed-builder');

// ---------------------------------------------------------------------------
// Fuzzy-Monatserkennung
// ---------------------------------------------------------------------------

test('matchMonth: Zahlen in allen Formaten', () => {
  assert.equal(matchMonth('9').month, 9);
  assert.equal(matchMonth('09').month, 9);
  assert.equal(matchMonth('9.').month, 9);
  assert.equal(matchMonth(' 12 ').month, 12);
  assert.equal(matchMonth('01').month, 1);
});

test('matchMonth: Monatsnamen (exakt) in allen 10 Sprachen', () => {
  const cases = [
    ['September', 9],
    ['september', 9],
    ['Januar', 1],
    ['February', 2],
    ['février', 2],
    ['septiembre', 9],
    ['setembro', 9],
    ['сентябрь', 9],
    ['октябрь', 10],
    ['1月', 1],
    ['一月', 1],
    ['1월', 1],
    ['일월', 1],
    ['dicembre', 12],
    ['Dezember', 12],
    ['декабрь', 12],
  ];
  for (const [input, expected] of cases) {
    const res = matchMonth(input);
    assert.ok(res, `"${input}" sollte erkannt werden`);
    assert.equal(res.month, expected, `"${input}" → Monat ${expected}`);
  }
});

test('matchMonth: kurze Formen', () => {
  assert.equal(matchMonth('jan').month, 1);
  assert.equal(matchMonth('Mär').month, 3);
  assert.equal(matchMonth('dez').month, 12);
  assert.equal(matchMonth('окт').month, 10);
  assert.equal(matchMonth('sept.').month, 9);
});

test('matchMonth: Tippfehler werden zum besten Treffer aufgelöst', () => {
  assert.equal(matchMonth('Sebtemger').month, 9); // September vertippt
  assert.equal(matchMonth('Septmber').month, 9);
  assert.equal(matchMonth('Febraur').month, 2);
  assert.equal(matchMonth('setmbro').month, 9); // setembro vertippt
  assert.equal(matchMonth('sebtembre').month, 9);
  assert.equal(matchMonth('сенятбрь').month, 9); // сентябрь vertippt
  assert.equal(matchMonth('mrazo').month, 3); // marzo vertippt
});

test('matchMonth: selbst bei viel zu vielen Tippfehlern gewinnt das beste Wort', () => {
  const res = matchMonth('zzzsebtemgerzzz');
  assert.ok(res);
  assert.equal(res.month, 9);
});

test('matchMonth: leere Eingabe → null', () => {
  assert.equal(matchMonth(''), null);
  assert.equal(matchMonth('   '), null);
});

// ---------------------------------------------------------------------------
// Tag & Datum
// ---------------------------------------------------------------------------

test('parseDayInput: nur Ziffern', () => {
  assert.equal(parseDayInput('4'), 4);
  assert.equal(parseDayInput('04'), 4);
  assert.equal(parseDayInput('31'), 31);
  assert.equal(parseDayInput('4.'), 4);
  assert.equal(parseDayInput(' 7 '), 7);
  assert.equal(parseDayInput('abc'), null);
  assert.equal(parseDayInput('32'), null);
  assert.equal(parseDayInput('0'), null);
  assert.equal(parseDayInput(''), null);
});

test('isValidDate: unmögliche Daten werden abgelehnt', () => {
  assert.equal(isValidDate(31, 2), false);
  assert.equal(isValidDate(30, 2), false);
  assert.equal(isValidDate(31, 4), false);
  assert.equal(isValidDate(29, 2), true); // Schaltjahr erlaubt
  assert.equal(isValidDate(31, 1), true);
  assert.equal(isValidDate(30, 4), true);
  assert.equal(isValidDate(0, 5), false);
  assert.equal(isValidDate(15, 13), false);
});

// ---------------------------------------------------------------------------
// Monats-Reihenfolge & 7-Tage-Regel
// ---------------------------------------------------------------------------

test('monthOrder: aktueller Monat zuerst, dann Jahresrest, dann Januar bis davor', () => {
  assert.deepEqual(monthOrder(8), [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(monthOrder(1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(monthOrder(12), [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('7-Tage-Regel (relativ zu heute, Zeitzone Europe/Berlin)', () => {
  const t = tzParts('Europe/Berlin');
  const future = (days) => {
    const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
    return { day: d.getUTCDate(), month: d.getUTCMonth() + 1 };
  };

  // Heute → 0 Tage → verboten (< 7)
  assert.equal(isWithinSevenDays(t.day, t.month, 'de'), true);
  // Morgen → verboten
  const tmrw = future(1);
  assert.equal(isWithinSevenDays(tmrw.day, tmrw.month, 'de'), true);
  // +3 Tage → verboten
  const plus3 = future(3);
  assert.equal(isWithinSevenDays(plus3.day, plus3.month, 'de'), true);
  // +10 Tage → erlaubt
  const plus10 = future(10);
  assert.equal(isWithinSevenDays(plus10.day, plus10.month, 'de'), false);
  // Längst vorbei (z. B. vor einer Woche) → nächstes Vorkommen ist nächstes Jahr → erlaubt
  const past = future(-10);
  assert.equal(daysUntilNext(past.day, past.month, 'Europe/Berlin') > 7, true);
});

// ---------------------------------------------------------------------------
// Embed-Roundtrip (das „DB-lose“ Prinzip)
// ---------------------------------------------------------------------------

test('Embed-Roundtrip: gebaute Liste wird exakt wieder ausgelesen', () => {
  const birthdays = [
    { userId: '111', day: 4, month: 9 },
    { userId: '222', day: 17, month: 9 },
    { userId: '333', day: 1, month: 1 },
    { userId: '444', day: 29, month: 2 },
  ];

  for (const lang of ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it']) {
    const embedJson = buildListEmbed({ birthdays, lang }).toJSON();
    const parsed = parseListEmbed({ embeds: [embedJson] });

    assert.equal(parsed.lang, lang, `Sprache ${lang} muss aus dem Marker lesbar sein`);
    assert.equal(parsed.birthdays.length, birthdays.length, `Sprache ${lang}: alle Einträge lesbar`);
    for (const b of birthdays) {
      const found = parsed.birthdays.find((p) => p.userId === b.userId);
      assert.ok(found, `Sprache ${lang}: Nutzer ${b.userId} gefunden`);
      assert.equal(found.day, b.day, `Sprache ${lang}: Tag von ${b.userId}`);
      assert.equal(found.month, b.month, `Sprache ${lang}: Monat von ${b.userId}`);
    }
  }
});

test('Embed-Roundtrip: leere Liste → keine Einträge, Marker bleibt', () => {
  const embedJson = buildListEmbed({ birthdays: [], lang: 'fr' }).toJSON();
  const parsed = parseListEmbed({ embeds: [embedJson] });
  assert.equal(parsed.lang, 'fr');
  assert.deepEqual(parsed.birthdays, []);
});

test('Embed-Roundtrip: Feld-Reihenfolge startet mit dem aktuellen Monat', () => {
  const t = tzParts('Europe/Berlin');
  const embedJson = buildListEmbed({ birthdays: [], lang: 'de' }).toJSON();
  const order = monthOrder(t.month);
  for (let i = 0; i < 12; i++) {
    assert.equal(embedJson.fields[i].name, ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][order[i] - 1]);
  }
});

test('parseListEmbed: fremdes Embed ohne Marker → null-gefährdet, aber kein Crash', () => {
  const parsed = parseListEmbed({ embeds: [{ footer: { text: 'irgendwas' }, fields: [] }] });
  assert.ok(parsed);
  assert.equal(parsed.lang, 'en'); // Fallback
  assert.deepEqual(parsed.birthdays, []);
});
