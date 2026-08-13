/**
 * Wirklich unsichtbare Marker („Datenbank“ im Container, weiterhin ohne DB).
 *
 * Früher wurden Marker als `\u200Bwish:123:456\u200B` geschrieben – das
 * macht aber nur die Zero-Width-Spaces unsichtbar, der TEXT dazwischen
 * („wish:123:456“) war für Nutzer sichtbar. Jetzt wird der komplette
 * Marker in eine Zeichenkette aus AUSSCHLIESSLICH Zero-Width-Zeichen
 * kodiert – es bleibt also nichts Sichtbares übrig.
 *
 * Kodierung: Jedes Zeichen der Nutzlast (reine ASCII-Marker wie
 * `bday-congrats:2026-08-20:123` oder `int:<id>:<ts>`) wird als Hex
 * (0-9a-f) geschrieben; jede Hex-Ziffer wird auf eines von 16
 * unsichtbaren Unicode-Zeichen abgebildet. Vorangestellt ist eine
 * Signatur (0x11), damit der Bot eigene Blobs zuverlässig wiederfindet
 * und fremde/alte Zero-Width-Zeichen ignoriert.
 *
 * Falls Discord eines der Zeichen doch einmal entfernen sollte, dekodiert
 * der Blob einfach nicht – der Bot fällt dann auf die sichtbaren
 * Erwähnungen zurück (Liste bleibt korrekt, nur Uhrzeiten fehlen).
 */

// 16 unsichtbare Unicode-Formatzeichen (Cf), alle ohne sichtbare Breite.
// Zuerst die „robusten“ (sehr verbreitet), dann die älteren/deprecated.
const ZW_ALPHABET =
  '\u200B' + // Zero Width Space
  '\u200C' + // Zero Width Non-Joiner
  '\u200D' + // Zero Width Joiner
  '\uFEFF' + // Zero Width No-Break Space (BOM)
  '\u2060' + // Word Joiner
  '\u2061' + // Function Application
  '\u2062' + // Invisible Times
  '\u2063' + // Invisible Separator
  '\u2064' + // Invisible Plus
  '\u200E' + // Left-to-Right Mark
  '\u206A' + // Inhibit Symmetric Swapping
  '\u206B' + // Activate Symmetric Swapping
  '\u206C' + // Inhibit Arabic Form Shaping
  '\u206D' + // Activate Arabic Form Shaping
  '\u206E' + // National Digit Shapes
  '\u206F'; //  Nominal Digit Shapes

/** Regex, der einen zusammenhängenden Lauf aus unseren ZW-Zeichen findet. */
const ZW_RUN_RE = new RegExp(`[${ZW_ALPHABET}]+`, 'g');

// Signatur: Hex „11“ → zwei Zeichen aus dem Alphabet (U+200C U+200C).
// ASCII-Marker („bday…“, „wish:“, „int:“) beginnen nie mit 0x11, daher
// kollidiert die Signatur nicht mit echten Nutzlasten.
const SIGNATURE_HEX = '11';

/**
 * Kodiert eine ASCII-Nutzlast in eine Zeichenkette, die NUR aus
 * unsichtbaren Zero-Width-Zeichen besteht. Gibt '' für leere Nutzlasten
 * zurück (dann gibt es nichts zu speichern).
 */
function encodeHidden(payload) {
  if (!payload) return '';
  const hex = Buffer.from(String(payload), 'utf8').toString('hex');
  return SIGNATURE_HEX.split('')
    .concat(hex.split(''))
    .map((digit) => ZW_ALPHABET[parseInt(digit, 16)])
    .join('');
}

/**
 * Findet alle eigenen kodierten Blobs in einem Text und dekodiert sie.
 * Rückgabe: Array der Nutzlast-Strings (in der Reihenfolge des Textes).
 * Fremde/alte Zero-Width-Zeichen ohne Signatur werden ignoriert.
 */
function decodeHidden(text) {
  const out = [];
  if (!text) return out;
  const runs = String(text).match(ZW_RUN_RE) || [];
  for (const run of runs) {
    if (run.length < SIGNATURE_HEX.length + 2) continue; // zu kurz für Signatur + 1 Byte
    if (ZW_ALPHABET.indexOf(run[0]) !== parseInt(SIGNATURE_HEX[0], 16)) continue;
    if (ZW_ALPHABET.indexOf(run[1]) !== parseInt(SIGNATURE_HEX[1], 16)) continue;

    let hex = '';
    let valid = true;
    for (let i = SIGNATURE_HEX.length; i < run.length; i++) {
      const idx = ZW_ALPHABET.indexOf(run[i]);
      if (idx === -1) { valid = false; break; }
      hex += idx.toString(16);
    }
    if (!valid || hex.length % 2 !== 0) continue;
    try {
      const payload = Buffer.from(hex, 'hex').toString('utf8');
      if (payload) out.push(payload);
    } catch {
      /* ungültiger Blob → ignorieren */
    }
  }
  return out;
}

module.exports = { encodeHidden, decodeHidden, ZW_ALPHABET };
