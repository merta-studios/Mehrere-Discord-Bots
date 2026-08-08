/**
 * Reine Datums-/Logik-Funktionen ohne Discord-Abhängigkeiten
 * (gut testbar). Alle Zeiten laufen über die Zeitzone der
 * jeweiligen Sprache (Intl/ICU).
 */

const { LANGS, tzOf } = require('./languages');

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Aktuelle Zeit (Jahr/Monat/Tag/Stunde/Minute) in einer Zeitzone. */
function tzParts(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Heutiger Datumsschlüssel „YYYY-MM-DD“ in der Zeitzone der Sprache. */
function todayKey(lang) {
  const t = tzParts(tzOf(lang));
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

/**
 * Reihenfolge der Monate für die Liste:
 * erst der aktuelle Monat, dann bis Jahresende, dann Januar bis
 * vor den aktuellen Monat. Beispiel (August): [8,9,10,11,12,1,…,7]
 */
function monthOrder(currentMonth) {
  return Array.from({ length: 12 }, (_, i) => ((currentMonth - 1 + i) % 12) + 1);
}

function daysInMonth(month, year) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Prüft, ob Tag/Monat ein reales Datum ist (Feb 29 ist erlaubt). */
function isValidDate(day, month) {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(month, 2024); // 2024 = Schaltjahr → erlaubt 29.02.
}

/** Nächstes Vorkommen des Geburtstags (dieses oder nächstes Jahr). */
function nextOccurrence(day, month, tz) {
  const t = tzParts(tz);
  let year = t.year;
  if (month < t.month || (month === t.month && day < t.day)) year += 1;
  return { year, month, day };
}

/** Tage bis zum nächsten Vorkommen (heute = 0). */
function daysUntilNext(day, month, tz) {
  const next = nextOccurrence(day, month, tz);
  const t = tzParts(tz);
  const a = Date.UTC(next.year, next.month - 1, next.day);
  const b = Date.UTC(t.year, t.month - 1, t.day);
  return Math.round((a - b) / 86400000);
}

/**
 * 7-Tage-Regel: true, wenn das nächste Vorkommen in weniger als
 * 7 Tagen liegt (dann darf man nicht eintragen – Spam-Schutz).
 */
function isWithinSevenDays(day, month, lang) {
  return daysUntilNext(day, month, tzOf(lang)) < 7;
}

/** Tag aus Nutzereingabe: nur Ziffern, 1–31. */
function parseDayInput(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const day = parseInt(cleaned, 10);
  return day >= 1 && day <= 31 ? day : null;
}

module.exports = {
  pad,
  tzParts,
  todayKey,
  monthOrder,
  daysInMonth,
  isValidDate,
  nextOccurrence,
  daysUntilNext,
  isWithinSevenDays,
  parseDayInput,
  LANGS,
};
