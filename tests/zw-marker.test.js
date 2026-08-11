/**
 * Tests für die wirklich unsichtbaren Zero-Width-Marker (zw-marker.js):
 * - Roundtrip: encodeHidden → decodeHidden
 * - Keine falsch-positiven Treffer bei fremden/alten Zero-Width-Zeichen
 * - Mehrere Blobs in einem Text werden in Reihenfolge gefunden
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { encodeHidden, decodeHidden, ZW_ALPHABET } = require('../bots/birthday-bot/src/zw-marker');

test('Roundtrip: einfache ASCII-Marker', () => {
  for (const payload of [
    'bday::v1::de',
    'bday::v1::en:9876543210',
    'bday-congrats:2026-08-11:123456789012345678',
    'int:111111111111111111:1700000000000int:222222222222222222:1700003600000',
    'wish:123:1700000000000',
  ]) {
    const blob = encodeHidden(payload);
    assert.notEqual(blob, payload, 'Blob darf den Klartext nicht enthalten');
    assert.deepEqual(decodeHidden(blob), [payload]);
  }
});

test('Roundtrip: auch mit Umlauten/UTF-8 (z. B. Event-Name-Hex)', () => {
  const payload = 'bday-event:2026-08-20:4dc3bc6c6c657220262053c3b86e6e65'; // „Müller & Söhne“
  const blob = encodeHidden(payload);
  assert.deepEqual(decodeHidden(blob), [payload]);
});

test('Der Blob besteht NUR aus Zero-Width-Zeichen (kein sichtbarer Text)', () => {
  const blob = encodeHidden('int:111111111111111111:1700000000000');
  for (const ch of blob) {
    assert.ok(ZW_ALPHABET.includes(ch), `Zeichen ${ch.charCodeAt(0)} ist nicht aus dem Alphabet`);
  }
});

test('Leere Nutzlast → kein Blob; leerer Text → keine Treffer', () => {
  assert.equal(encodeHidden(''), '');
  assert.equal(encodeHidden(null), '');
  assert.deepEqual(decodeHidden(''), []);
  assert.deepEqual(decodeHidden('nur sichtbarer Text'), []);
});

test('Alte Klartext-Marker (mit einzelnen \\u200B drumherum) werden NICHT als Blob fehlgedeutet', () => {
  const old = '\u200Bint:123:456\u200B';
  assert.deepEqual(decodeHidden(old), []);
  // Auch mehrere alte Marker nebeneinander ergeben keinen falschen Blob
  assert.deepEqual(decodeHidden('\u200Bwish:1:2\u200B\u200Bwish:3:4\u200B'), []);
});

test('Fremde Zero-Width-Läufe ohne Signatur werden ignoriert', () => {
  // Ein Lauf aus „nur \u200B“ (wie er durch alte Marker/Formatierung entsteht)
  assert.deepEqual(decodeHidden('\u200B\u200B\u200B'), []);
  // Ein zufälliger Lauf aus unseren Alphabet-Zeichen ohne Signatur
  const noSignature = ZW_ALPHABET[5] + ZW_ALPHABET[9] + ZW_ALPHABET[2];
  assert.deepEqual(decodeHidden(noSignature), []);
});

test('Mehrere Blobs in einem Text werden in der Reihenfolge des Textes dekodiert', () => {
  const a = encodeHidden('bday-congrats:2026-08-11:111');
  const b = encodeHidden('int:222:1700000000000');
  const text = `Überschrift\n${a}\nText dazwischen\n${b}`;
  assert.deepEqual(decodeHidden(text), [
    'bday-congrats:2026-08-11:111',
    'int:222:1700000000000',
  ]);
});

test('Blob direkt neben Klartext-Ziffern bleibt eindeutig dekodierbar', () => {
  const blob = encodeHidden('wish:123:456');
  const text = `Liste\n<@123> · 14:32${blob}`;
  assert.deepEqual(decodeHidden(text), ['wish:123:456']);
});

test('Lange Listen: Roundtrip intakt, Chunking hält jedes TextDisplay unter 4000 Zeichen', () => {
  const { wishMarkerText } = require('../bots/birthday-bot/src/embed-builder');
  const entries = Array.from({ length: 120 }, (_, i) => ({
    id: String(100000000000000000 + i),
    ts: 1700000000000 + i,
  }));

  // encode/decode: ein großer Blob übersteht den Roundtrip
  const payload = entries.map((e) => `int:${e.id}:${e.ts}`).join('');
  assert.deepEqual(decodeHidden(encodeHidden(payload)), [payload]);

  // wishMarkerText chunkt an Eintrags-Grenzen, jeder Chunk < 4000 (TextDisplay-Limit)
  const chunks = wishMarkerText(entries, 'int');
  assert.ok(chunks.length > 1, 'lange Liste wird in mehrere Chunks aufgeteilt');
  for (const chunk of chunks) {
    assert.ok(chunk.length < 4000, `Chunk ${chunk.length} Zeichen > TextDisplay-Limit`);
    assert.ok(chunk.length > 0);
  }
  // Jeder Chunk dekodiert eigenständig; zusammen ergeben sie alle Einträge
  const decoded = chunks.flatMap((c) => decodeHidden(c)).join('');
  const re = /int:(\d+):(\d+)/g;
  const parsed = [];
  let m;
  while ((m = re.exec(decoded))) parsed.push({ id: m[1], ts: Number(m[2]) });
  assert.deepEqual(parsed, entries);
});
