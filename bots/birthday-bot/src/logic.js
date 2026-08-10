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
function tzParts(tz, date = new Date()) {
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
  for (const p of fmt.formatToParts(date)) {
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

/** Prüft, ob ein Jahr ein Schaltjahr ist. */
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Nächstes Vorkommen des Geburtstags (dieses oder nächstes Jahr). */
function nextOccurrence(day, month, tz, now = new Date()) {
  const t = tzParts(tz, now);
  let year = t.year;
  if (month < t.month || (month === t.month && day < t.day)) year += 1;

  // Der 29. Februar existiert nur in Schaltjahren. Ohne diese Schleife würde
  // Date.UTC ein ungültiges 29.02. stillschweigend auf den 01.03. verschieben.
  while (month === 2 && day === 29 && !isLeapYear(year)) year += 1;

  return { year, month, day };
}

/** Tage bis zum nächsten Vorkommen (heute = 0). */
function daysUntilNext(day, month, tz, now = new Date()) {
  const next = nextOccurrence(day, month, tz, now);
  const t = tzParts(tz, now);
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

const HOUR_MS = 60 * 60 * 1000;

/**
 * 24-Stunden-Fenster (z. B. für das Gratulieren): true, solange die
 * Nachricht (erkennbar an ihrem Erstell-Zeitstempel) nicht älter als
 * `hours` Stunden ist. Ist der Zeitstempel unbekannt (fehlt), wird das
 * Fenster als offen gewertet, damit der Test-/Recovery-Pfad nicht unnötig
 * blockiert.
 */
function isWithinHours(createdTimestamp, hours = 24) {
  if (typeof createdTimestamp !== 'number' || !Number.isFinite(createdTimestamp)) {
    return true;
  }
  return Date.now() - createdTimestamp <= hours * HOUR_MS;
}

const EVENT_NAME_MAX = 45;

/**
 * Event-Name aufräumen: Der Name reist als `**Name**`-Zeile in der
 * Listen-Nachricht (unsere „Datenbank“) und im täglichen Event-Post mit.
 * Rausfliegen daher: Zeilenumbrüche, `*` (würde das Bold-Parsing brechen),
 * `|` (Zeilen-Trenner), unsichtbare Zeichen, `@` (keine Pings) und das alte
 * Raketen-Emoji 🚀 (früher als Marker vor Events, jetzt entfernt).
 * Rückgabe: bereinigter Name (1–45 Zeichen) oder null, wenn nichts übrig bleibt.
 */
function sanitizeEventName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/[​‌‍﻿]/g, '') // Zero-Width-Zeichen entfernen
    .replace(/[\r\n\t]+/g, ' ') // Zeilenumbrüche würden das Listen-Parsing brechen
    .replace(/[*|@`~]/g, '') // Format-/Zeilen-Brecher & Pings entfernen
    .replace(/🚀/g, '') // altes Event-Marker-Emoji entfernen
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;
  return name.length > EVENT_NAME_MAX ? name.slice(0, EVENT_NAME_MAX).trim() : name;
}

module.exports = {
  pad,
  tzParts,
  todayKey,
  monthOrder,
  daysInMonth,
  isValidDate,
  isLeapYear,
  nextOccurrence,
  daysUntilNext,
  isWithinSevenDays,
  parseDayInput,
  isWithinHours,
  sanitizeEventName,
  EVENT_NAME_MAX,
  LANGS,
};
