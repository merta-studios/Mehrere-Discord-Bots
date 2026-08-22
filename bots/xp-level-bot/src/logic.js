/**
 * XP-Logik – reine Funktionen, gut testbar, keine Discord-Abhängigkeiten.
 */

const { LANGS, tzOf } = require('./languages');

function pad(n) { return String(n).padStart(2,'0'); }

function tzParts(tz, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') parts[p.type]=p.value;
  return { year:Number(parts.year), month:Number(parts.month), day:Number(parts.day), hour:Number(parts.hour), minute:Number(parts.minute) };
}

function todayKey(lang, date = new Date()) {
  const t = tzParts(tzOf(lang), date);
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

function formatTimeInTz(lang, date = new Date()) {
  const tz = tzOf(lang);
  return new Intl.DateTimeFormat(LANGS[lang]?.locale || 'de-DE', { timeZone: tz, hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(date) + ` (${tz})`;
}

/**
 * XP-Kurve:
 * Level 1 -> 2 braucht 80 XP
 * Level 99 ->100 braucht ~2000 XP
 * Sanfte, kaum merkbare Steigerung, fast linear mit kleiner quadratischer Komponente
 * Formel: xp = 80 + 14*(lvl-1) + 0.058 * (lvl-1)^2  => lvl99 ~ 2000
 * Wir runden auf ganze Zahlen.
 */
function xpNeeded(level) {
  if (level < 1) level = 1;
  if (level >= 100) return 2200; // über 100 capped
  if (level === 1) return 80;
  const n = level - 1;
  // quadratisch + linear gemischt für schöne Kurve
  const val = 80 + 13.9 * n + 0.058 * n * n;
  return Math.round(val);
}

// Alternative wenn man exakt 2000 bei 99 will: fine tune
// Test: lvl1 80, lvl2 94, lvl10 211, lvl50 916, lvl80 1491, lvl99 2016 -> passt

function nextLevelXp(level) { return xpNeeded(level); }

// Täglicher XP-Verlust um 0 Uhr:
// - Basis: 5% des Level-Bedarfs, wenn man in den letzten 24h aktiv war (XP verdient hat)
// - Jeder weitere Tag ohne verdiente XP: +3 Prozentpunkte (1. inaktiver Tag = 5%, dann 8%, 11%, 14%, …)
const DAILY_DECAY_RATE = 0.05;
const INACTIVE_DECAY_STEP = 0.03;

/**
 * Decay-Anteil für die nächste 0-Uhr-Abrechnung.
 * inactiveDays = wie viele Tage in Folge der Nutzer (ab heute/dieser Abrechnung)
 * inaktiv ist. 0 (aktiv) und 1 (erster inaktiver Tag) -> 5%, danach +3% pro Tag.
 */
function decayRateForInactiveDays(inactiveDays) {
  const days = Math.max(0, Math.floor(Number(inactiveDays) || 0));
  if (days <= 1) return DAILY_DECAY_RATE;
  // Ganzzahl-Prozentrechnung, damit 5 % + 3 % exakt 0.08 ergibt (kein Float-Fehler)
  const basePercent = Math.round(DAILY_DECAY_RATE * 100);
  const stepPercent = Math.round(INACTIVE_DECAY_STEP * 100);
  const percent = Math.min(100, basePercent + (days - 1) * stepPercent);
  return percent / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Maximal so viele Tages-Abrechnungen werden NACHGEHOLT, wenn der Bot über
 * Mitternacht offline war. Mehr wäre nicht fair (der Bot war weg, die Nutzer
 * konnten nichts dagegen tun) und hätte bei langen Ausfällen den Effekt, dass
 * Level kaskadieren und Nutzer in Sekunden mehrere Level verlieren.
 * Die ersten beiden Tage entsprechen der Erwartung „Tag 1 = 5 %, Tag 2 = 8 %“.
 */
const MAX_DECAY_CATCHUP_DAYS = 2;

/**
 * Wie viele 0-Uhr-Abrechnungen zwischen dem gespeicherten letzten Decay-Tag
 * (YYYY-MM-DD) und dem heutigen Tag liegen. 0 = keine (frisch bzw. unbekannt).
 * Bei unbekanntem/fehlendem Marker wird 0 geliefert – der Aufrufer entscheidet,
 * ob er trotzdem genau EINE Abrechnung anwendet (Altbestand).
 */
function missedDailyDecayDays(lastDecayKey, dayKey) {
  if (!lastDecayKey || !dayKey) return 0;
  const from = Date.parse(`${String(lastDecayKey).slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${String(dayKey).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  const diff = Math.floor((to - from) / DAY_MS);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

/** War der Nutzer in den letzten 24h aktiv (irgendwelche XP verdient)? */
function wasActiveRecently(user, now = Date.now()) {
  const last = user?.lastActivity || user?.lastXpGain || 0;
  return last > 0 && (now - last) < DAY_MS;
}

/**
 * Wie viele XP verliert der Nutzer bei der nächsten 0-Uhr-Abrechnung?
 * Aktiv in den letzten 24h -> 5%. Sonst steigt der Inaktivitäts-Streak an.
 */
function nextDecayInfo(user, now = Date.now()) {
  const inactiveDays = wasActiveRecently(user, now) ? 0 : (user?.inactiveDays || 0) + 1;
  const rate = decayRateForInactiveDays(inactiveDays);
  const level = Math.max(1, user?.level || 1);
  const raw = Math.ceil(xpNeeded(level) * rate);
  // Wer auf Level 1 mit 0 XP steht, kann faktisch nichts verlieren
  const decay = level === 1 && (user?.xp || 0) <= 0 ? 0 : raw;
  return { inactiveDays, rate, percent: Math.round(rate * 100), decay };
}

/**
 * Aktueller Inaktivitäts-Streak OHNE Mitternachts-Inkrement.
 * Nach der 0-Uhr-Abrechnung steht user.inactiveDays bereits auf dem neuen Wert.
 * Wer in den letzten 24h XP verdient hat, gilt als 0.
 */
function currentInactiveDays(user, now = Date.now()) {
  if (!user) return 0;
  if (wasActiveRecently(user, now)) return 0;
  return Math.max(0, Math.floor(Number(user.inactiveDays) || 0));
}

// ---------------------------------------------------------------------------
// Wortzählung & Spam-Erkennung – KRASS robust
// ---------------------------------------------------------------------------

/**
 * Prüft ein einzelnes Token nach Spam-Kriterien.
 * Gibt true zurück wenn das Token als echtes Wort zählt.
 */
function isValidWordToken(raw) {
  if (!raw) return false;
  let token = String(raw).trim();
  if (!token) return false;

  // Discord Artefakte ignorieren
  if (/^<a?:\w+:\d+>$/.test(token)) return false; // custom emoji
  if (/^<@!?\d+>$/.test(token)) return false; // user mention
  if (/^<@&\d+>$/.test(token)) return false; // role mention
  if (/^<#\d+>$/.test(token)) return false; // channel mention
  if (/^https?:\/\/\S+/i.test(token)) return false; // URL
  if (/^discord\.gg\/\S+/i.test(token)) return false;
  if (/^www\.\S+/i.test(token)) return false;

  // Trim punctuation am Rand (Unicode aware)
  // Entferne führende/abschließende Zeichen die keine Buchstaben/Zahlen sind
  token = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!token) return false;
  if (token.length < 1) return false;
  if (token.length > 30) return false; // zu lang = spam

  // Muss mindestens einen Buchstaben enthalten
  if (!/\p{L}/u.test(token)) return false;

  // Nur ein Zeichen wiederholt: aaaa, !!!!, eeeee, 111 -> spam
  if (/^(.)\1+$/u.test(token)) return false;
  // Minimal 2 Zeichen, aber alles gleich

  // Wiederholtes Substring-Muster: lololol, hahaha, abcabcabc, testtesttest
  if (token.length >= 6) {
    // prüfe ob Token komplett aus Wiederholung eines 2-4 Zeichen Substrings besteht
    for (let subLen = 2; subLen <= 4; subLen++) {
      if (token.length % subLen !== 0) continue;
      const sub = token.slice(0, subLen).toLowerCase();
      let repeated = true;
      for (let i = subLen; i < token.length; i += subLen) {
        if (token.slice(i, i + subLen).toLowerCase() !== sub) { repeated = false; break; }
      }
      if (repeated) return false;
    }
    // auch hahaha -> "ha" *3 etc.
    if (/^(..+)\1{2,}$/u.test(token.toLowerCase())) return false;
  }

  // Zu wenig unterschiedliche Zeichen: z.B. "ababa", "abcabc" – Entropie niedrig
  const lower = token.toLowerCase();
  const distinct = new Set([...lower]).size;
  if (distinct === 1) return false;
  if (token.length >= 5 && distinct / token.length < 0.35) return false; // 35% Schwelle – fängt lololol, abcabc etc.
  // Zusätzlich: Wiederholtes Teilwort das den Token exakt abdeckt (z.B. lololol -> lo* )
  if (token.length >= 6) {
    for (let len = 2; len <= 4; len++) {
      const sub = lower.slice(0, len);
      if (new Set([...sub]).size === 1) continue; // "aa" etc. schon oben behandelt
      let built = sub.repeat(Math.ceil(lower.length / sub.length)).slice(0, lower.length);
      if (lower === built) return false;
    }
  }

  // Enthält nur Buchstaben/Zahlen/Apostroph/Bindestrich nach innen? Erlaube auch Umlaute
  // Wenn Token viele Sonderzeichen innen hat (z.B. "h@e!!l#l$o") als spam werten
  // Wir zählen Anteil Buchstaben: muss >=60% sein
  const letters = (token.match(/\p{L}/gu) || []).length;
  if (letters / token.length < 0.6) return false;

  // Zahlen-lastig? Wenn mehr Zahlen als Buchstaben -> spam
  const numbers = (token.match(/\p{N}/gu) || []).length;
  if (numbers > letters) return false;

  // Einzelbuchstaben wie "a", "I" sind okay, aber "x" als einziges Wort mit Spam-Kontext?
  // Erlauben 1-Buchstabe Wörter nur wenn sie echte Wörter sind: a, i, o etc kurz, aber wir lassen durch

  return true;
}

/**
 * Zählt valide Worte in einem Text (Leerzeichen + neue Zeilen), robust gegen Spam.
 * Doppel-Leerzeichen erzeugen keine extra Worte (split /\s+/).
 */
function countValidWords(text) {
  if (!text || typeof text !== 'string') return 0;
  // Ersetze Code-Blöcke? Code-Blöcke könnten spam sein, aber wir behandeln einfach als Text
  // Entferne Custom Emoji Syntax nicht als Wort
  const rawTokens = text.split(/\s+/).filter(Boolean);
  let count = 0;
  for (const t of rawTokens) {
    if (isValidWordToken(t)) count++;
  }
  return count;
}

function xpForWords(validWordCount) {
  const capped = Math.min(Math.max(validWordCount, 0), 10);
  return capped * 3;
}

// ---------------------------------------------------------------------------
// Medien-XP: Bilder, Videos, Sprachnachrichten & Sticker geben ausgeglichen XP
// ---------------------------------------------------------------------------

const MEDIA_XP = 15; // entspricht einem 5-Wörter-Text (Mitte der Range 3–30)
const MAX_MESSAGE_XP = 30;

function isMediaContentType(contentType) {
  return typeof contentType === 'string' && /^(image|video|audio)\//i.test(contentType.trim());
}

function calculateXpForMessage(content, opts = {}) {
  const hasMedia = Boolean(opts && opts.hasMedia);
  const valid = countValidWords(content);
  let xp = xpForWords(valid);
  if (hasMedia) {
    if (valid === 0) {
      // Nur-Medien-Nachricht (Bild/Video/Sprachnachricht/Sticker): ausgeglichene 15 XP
      xp = MEDIA_XP;
    } else {
      // Text + Medien: Bonus, aber nie über das normale Maximum hinaus
      xp = Math.min(MAX_MESSAGE_XP, xp + MEDIA_XP);
    }
  }
  return { valid, xp, media: hasMedia };
}

// Spam-Erkennung für Gesamt-Nachricht: Wenn Verhältnis valider Worte zu Roh-Tokens zu niedrig ist
function isSpamMessage(content) {
  if (!content) return true;
  const raw = content.split(/\s+/).filter(Boolean);
  if (raw.length === 0) return true;
  const valid = countValidWords(content);
  if (valid === 0) return true;
  // Wenn weniger als 40% der Tokens valide Worte sind, gilt Nachricht als spam-artig
  if (valid / raw.length < 0.4 && raw.length >= 3) return true;
  // Wenn Nachricht nur aus gleichen Zeichen besteht
  const collapsed = content.replace(/\s+/g, '');
  if (collapsed.length >= 4 && /^(.)\1+$/u.test(collapsed)) return true;
  return false;
}

function isOnCooldown(lastGain, now = Date.now()) {
  if (!lastGain) return false;
  return (now - lastGain) < 30_000;
}

// ---------------------------------------------------------------------------
// Level Up/Down Handling
// ---------------------------------------------------------------------------

function applyXpGain(user, amount) {
  // user: { level, xp }
  let level = user.level;
  let xp = user.xp;
  xp += amount;
  const needed = xpNeeded(level);
  if (xp >= needed) {
    // Level Up, reset to 0 (überschuss verfällt laut Spec 0-reset)
    // Max Level 100 cap
    if (level >= 100) {
      xp = Math.min(xp, needed); // bleib bei max
      return { level, xp, leveledUp: false, leveledDown: false, leveled: false };
    }
    level += 1;
    xp = 0;
    return { level, xp, leveledUp: true, leveledDown: false, leveled: true, amount };
  }
  return { level, xp, leveledUp: false, leveledDown: false, leveled: false };
}

function applyDailyDecay(user, rate = DAILY_DECAY_RATE) {
  // täglich `rate` (Standard: 5%) von den für das nächste Level nötigen XP abziehen
  // Falls das nicht mehr in die aktuellen XP passt, wird der echte Restbetrag
  // ins vorige Level mitgenommen statt pauschal auf einen Fixwert zu setzen.
  const startLevel = user.level;
  let level = user.level;
  let xp = user.xp;
  const needed = xpNeeded(level);
  const decay = Math.ceil(needed * Math.min(1, Math.max(0, rate)));
  let remainingDecay = decay;

  while (remainingDecay > 0) {
    if (xp >= remainingDecay) {
      xp -= remainingDecay;
      remainingDecay = 0;
      break;
    }

    remainingDecay -= xp;
    if (level <= 1) {
      xp = 0;
      remainingDecay = 0;
      break;
    }

    level -= 1;
    xp = xpNeeded(level);
  }

  const leveledDown = level < startLevel;
  return { level, xp, leveledDown, decay, dropped: leveledDown };
}

/**
 * Wendet eine beliebige XP-Änderung an (auch negativ) – für den
 * /give_xp-Befehl des Server-Owners.
 *
 * - Positiv: XP dazu; überschüssige XP wandern durch mehrere Level (kein
 *   Verlust wie beim 30-XP-Chat-Reset). Maximal Level 100 mit XP-Cap.
 * - Negativ: XP abziehen; der Restbetrag wird wie beim Tages-Schwund korrekt
 *   ins vorige Level übernommen. Es geht NIE unter Level 1 mit 0 XP –
 *   ein negativer XP-Stand („XP-Bombe“) ist damit ausgeschlossen.
 */
function applyXpDelta(user, amount) {
  const startLevel = Math.max(1, Math.floor(Number(user?.level) || 1));
  let level = startLevel;
  let xp = Math.max(0, Math.floor(Number(user?.xp) || 0));
  const delta = Math.trunc(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) {
    return { level, xp, leveledUp: false, leveledDown: false, leveled: false, delta: 0 };
  }

  if (delta > 0) {
    xp += delta;
    while (level < MAX_LEVEL && xp >= xpNeeded(level)) {
      xp -= xpNeeded(level);
      level += 1;
    }
    if (level >= MAX_LEVEL && xp > xpNeeded(MAX_LEVEL)) xp = xpNeeded(MAX_LEVEL);
  } else {
    let remaining = -delta;
    while (remaining > 0) {
      if (xp >= remaining) {
        xp -= remaining;
        remaining = 0;
        break;
      }
      remaining -= xp;
      if (level <= 1) {
        xp = 0;
        remaining = 0;
        break;
      }
      level -= 1;
      xp = xpNeeded(level);
    }
  }

  const leveledUp = level > startLevel;
  const leveledDown = level < startLevel;
  return { level, xp, leveledUp, leveledDown, leveled: leveledUp || leveledDown, delta };
}

// ---------------------------------------------------------------------------
// Nickname Format
// ---------------------------------------------------------------------------

function getMedal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function formatNickname(level, displayName, rank = null) {
  // Nur die Top 3 bekommen eine Medaille in den Nicknamen: [Lvl 2 🥈]
  let suffix = '';
  if (rank !== null && rank >= 1 && rank <= 3) {
    suffix = ` ${getMedal(rank)}`;
  }
  const tag = `[Lvl ${level}${suffix}]`;
  let nick = `${tag} ${displayName}`;
  // Discord Limit 32 Zeichen – kürzen von rechts
  if (nick.length > 32) {
    const allowedDisplay = 32 - (tag.length + 1);
    const trimmed = displayName.slice(0, Math.max(0, allowedDisplay));
    nick = `${tag} ${trimmed}`;
    // falls immer noch zu lang (tag selbst zu lang) kürzen tag? unwahrscheinlich
    if (nick.length > 32) nick = nick.slice(0, 32);
  }
  return nick;
}

function stripLvlTag(name) {
  // Entfernt führendes [Lvl X ...] Tag falls vorhanden, um echten Anzeigenamen zu holen
  return String(name).replace(/^\[Lvl\s*\d+[^\]]*\]\s*/u, '').trim();
}

function hasLvlTag(name) {
  return /^\[Lvl\s*\d+[^\]]*\]/u.test(String(name || ''));
}

// ---------------------------------------------------------------------------
// Level-Belohnungsrollen – Eingabe-Parsing & Namens-Format (testbar, pur)
// ---------------------------------------------------------------------------

const DEFAULT_ROLE_TEMPLATE = 'Level {LEVEL}';
const MAX_LEVEL = 100;

// Buchstaben, die beim Tippen gerne mit Ziffern verwechselt werden: "1O" -> 10
const CONFUSION_CHARS = { O:'0', o:'0', I:'1', l:'1', Z:'2', z:'2', S:'5', s:'5', B:'8', b:'8', G:'6', g:'6' };
const LEVEL_MARKER_RE = /(?:lvl|level|lv|niv(?:eau)?|stufe|rank|rang)\s*[.:\-]?\s*(\d+)/i;
const LEVEL_MARKER_SUFFIX_RE = /^(\d+)\s*(?:lvl|level|lv|niv(?:eau)?|stufe|rank|rang)\b/i;

/**
 * Interpretiert ein einzelnes Token der Level-Eingabe:
 * - "6" / "(6)" / "6." -> 6
 * - "1O" / "l3" / "3b" -> 10 / 13 / 38 (Verwechslungs-Buchstaben werden korrigiert)
 * - "Level 6" / "lvl6" / "6lvl" -> 6
 * - Unverständliches (z.B. "abc") -> null (wird intelligent ignoriert)
 */
function normalizeLevelToken(raw) {
  const s = String(raw).trim();
  if (!s) return null;

  // Reine Zahl
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  // Level-Marker: "Level 6", "lvl6", "niveau 10", "6lvl"
  let m = s.match(LEVEL_MARKER_RE);
  if (m) return parseInt(m[1], 10);
  m = s.match(LEVEL_MARKER_SUFFIX_RE);
  if (m) return parseInt(m[1], 10);

  // Nur Ziffern + Verwechslungs-Buchstaben -> korrigieren
  if (/^[\dOoIlZzSsBbGg]+$/.test(s)) {
    const fixed = s.split('').map((c) => CONFUSION_CHARS[c] || c).join('');
    if (/^\d+$/.test(fixed)) return parseInt(fixed, 10);
    return null;
  }

  // Zahl mit Störzeichen am Rand: "(6)", "6.", "6??"
  // Negative Zahlen ("-5", "−3") sind keine Level und werden ignoriert
  m = s.match(/^(\D*)(\d+)(\D*)$/);
  if (m) {
    if (/[-−+]/.test(m[1])) return null;
    return parseInt(m[2], 10);
  }

  return null;
}

/**
 * Parst die kommagetrennte Level-Liste des Admins, sehr tolerant:
 * - "3,6,10,20", "3, 6, 10, 20", "3,,6,,10", "3 6 10 20", "3;6;10", "3.6.10.20"
 * - Tippfehler werden intelligent korrigiert ("1O" -> 10), Unverständliches ignoriert
 * - Rückgabe: aufsteigend sortierte, eindeutige Zahlen (1..100) oder null
 */
function parseLevelList(input) {
  if (input == null) return null;
  const tokens = String(input).split(/[\s,.;:]+/).filter(Boolean);
  const levels = new Set();
  for (const raw of tokens) {
    const n = normalizeLevelToken(raw);
    if (n !== null && n >= 1 && n <= MAX_LEVEL) levels.add(n);
  }
  const arr = [...levels].sort((a, b) => a - b);
  return arr.length ? arr : null;
}

/**
 * Ersetzt den {LEVEL}-Platzhalter durch die konkrete Zahl.
 * "Level {LEVEL}" + 3 -> "Level 3"
 */
function formatRoleName(template, level) {
  return String(template || DEFAULT_ROLE_TEMPLATE).replace(/\{LEVEL\}/gi, String(level));
}

/**
 * Baut aus dem Format-Template ein Regex, das bestehende Level-Rollen erkennt.
 * "Level {LEVEL}" -> /^Level (\d+)$/i
 */
function roleNamePattern(template) {
  const parts = String(template || DEFAULT_ROLE_TEMPLATE).split(/\{LEVEL\}/i);
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)');
  try {
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return null;
  }
}

function hasLevelPlaceholder(template) {
  return /\{LEVEL\}/i.test(String(template || ''));
}

// ---------------------------------------------------------------------------
// Voice XP Logik (testbar)
//
// Seit v2: Voice-XP gibt es einfach dafür, dass man im Voice-Channel ist –
// egal ob stumm/taub (self/server mute/deaf, suppress), egal ob allein oder
// mit anderen. „Anwesend = XP“. Keine Speaking-/Pausen-Heuristik mehr, die
// realen Voicestates ohnehin nicht zuverlässig beobachtet (Discord liefert
// ohne Receiver keine Speaking-Events).
// ---------------------------------------------------------------------------

function shouldGrantVoiceXp({ present }) {
  return Boolean(present);
}

// ---------------------------------------------------------------------------
// Bonus-Belohnungen – geplante, zeitgesteuerte XP-Geschenke im Haupt-Chat
// ---------------------------------------------------------------------------
//
// Statt Aktivitäts-Bursts mit 35% Zufallsschwelle gibt es jetzt für jeden
// Server 2–4 FEST GEPLANTE Drops pro Tag (Kalendertag in der Sprach-TZ):
//  - Anzahl und Uhrzeiten werden deterministisch aus (Guild-ID + Tag) abgeleitet
//    → stabil über Neustarts hinweg und für jeden Server anders
//  - alle Termine liegen mindestens 1 Stunde auseinander
//  - nur zwischen 06:00 und 23:59 Uhr Ortszeit (eindeutig derselbe Kalendertag)
//  - ein Drop ist 1 Stunde lang einsammelbar (BONUS_CLAIM_MS) und verfällt dann

const BONUS_XP_MIN = 30;
const BONUS_XP_MAX = 70;
const BONUS_CLAIM_MS = 60 * 60 * 1000; // Belohnung ist 1 Stunde gültig
// Geplante Termine (Minuten ab 0:00 Uhr Ortszeit): 06:00 bis 23:59.
// Das alte Maximum 00:30 (= Minute 1470) gehörte bereits zum Folgetag, während
// der persistierte Tageszustand um 00:00 wechselte. Dadurch konnten diese Slots
// dem falschen Datum zugeordnet werden. Ein Kalendertag endet nun eindeutig 23:59.
const BONUS_SLOT_MIN = 6 * 60; // 06:00
const BONUS_SLOT_MAX = 23 * 60 + 59; // 23:59
const BONUS_SLOT_SPACING = 60; // mind. 1 Stunde Abstand
const BONUS_COUNT_MIN = 2; // 2 bis 4 Drops pro Tag
const BONUS_COUNT_MAX = 4;
// Der isolierte Scheduler prüft minütlich. Eine Stunde Toleranz schützt zusätzlich
// vor Render-Schlaf, Deployments und vorübergehenden Discord-Ausfällen.
const BONUS_SLOT_GRACE_MIN = 60;

/** Zufällige Bonus-Höhe (30–70 XP, Ganzzahl). rng injizierbar für Tests. */
function rollBonusXp(rng = Math.random) {
  return BONUS_XP_MIN + Math.floor(rng() * (BONUS_XP_MAX - BONUS_XP_MIN + 1));
}

/** FNV-1a Hash – für deterministische Seeds aus Guild-ID + Tag. */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministischer PRNG (mulberry32) – gleicher Seed ⇒ gleiche Zahlenfolge. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministischer Zufallsgenerator für einen Server + Kalendertag.
 * Damit haben alle Server an einem Tag unterschiedliche, aber stabile Termine.
 */
function seededRngForDay(guildId, dayKey) {
  return mulberry32(hashString(`${String(guildId)}:${dayKey}`));
}

/**
 * Plant die Bonus-Termine eines Servers für einen Tag.
 * Gibt ein aufsteigend sortiertes Array von "Minuten ab 0 Uhr Ortszeit" zurück
 * (z. B. 450 = 07:30, 1439 = 23:59). Alle Termine liegen mindestens
 * BONUS_SLOT_SPACING Minuten auseinander und innerhalb desselben Kalendertags
 * im Tagesfenster [BONUS_SLOT_MIN, BONUS_SLOT_MAX].
 * `rng` injizierbar für Tests (Standard: Math.random).
 */
function planDailyBonusSlots(guildId, dayKey, rng = Math.random) {
  const count = BONUS_COUNT_MIN + Math.floor(rng() * (BONUS_COUNT_MAX - BONUS_COUNT_MIN + 1));
  const L = BONUS_SLOT_MIN;
  const R = BONUS_SLOT_MAX;
  const d = BONUS_SLOT_SPACING;
  const effR = R - (count - 1) * d;
  const pts = [];
  for (let i = 0; i < count; i++) pts.push(L + rng() * (effR - L));
  pts.sort((a, b) => a - b);
  return pts.map((p, i) => Math.round(p + i * d));
}

/** Aktuelle Uhrzeit als "Minuten ab 0 Uhr" in der Zeitzone der Sprache. */
function currentMinuteOfDay(lang, now = new Date()) {
  const t = tzParts(tzOf(lang), now);
  return t.hour * 60 + t.minute;
}

/** Prüft, ob ein geplanter Slot gerade (oder in der Toleranz) fällig ist. */
function isSlotDue(slot, minuteOfDay, graceMin = BONUS_SLOT_GRACE_MIN) {
  const diff = minuteOfDay - slot;
  // Kein Modulo über Mitternacht: Slot und minuteOfDay gehören immer zum
  // gleichen lokalen Kalendertag. So kann 23:59 nicht um 00:01 vorzeitig feuern.
  return diff >= 0 && diff <= graceMin;
}

module.exports = {
  pad,
  tzParts,
  todayKey,
  formatTimeInTz,
  xpNeeded,
  nextLevelXp,
  DAILY_DECAY_RATE,
  INACTIVE_DECAY_STEP,
  decayRateForInactiveDays,
  wasActiveRecently,
  nextDecayInfo,
  currentInactiveDays,
  DAY_MS,
  rollBonusXp,
  BONUS_XP_MIN,
  BONUS_XP_MAX,
  BONUS_CLAIM_MS,
  BONUS_SLOT_MIN,
  BONUS_SLOT_MAX,
  BONUS_SLOT_SPACING,
  BONUS_COUNT_MIN,
  BONUS_COUNT_MAX,
  BONUS_SLOT_GRACE_MIN,
  hashString,
  mulberry32,
  seededRngForDay,
  planDailyBonusSlots,
  currentMinuteOfDay,
  isSlotDue,
  countValidWords,
  xpForWords,
  calculateXpForMessage,
  isValidWordToken,
  isSpamMessage,
  isOnCooldown,
  applyXpGain,
  applyDailyDecay,
  applyXpDelta,
  MAX_DECAY_CATCHUP_DAYS,
  missedDailyDecayDays,
  formatNickname,
  stripLvlTag,
  hasLvlTag,
  getMedal,
  shouldGrantVoiceXp,
  MEDIA_XP,
  MAX_MESSAGE_XP,
  isMediaContentType,
  normalizeLevelToken,
  parseLevelList,
  formatRoleName,
  roleNamePattern,
  hasLevelPlaceholder,
  DEFAULT_ROLE_TEMPLATE,
  MAX_LEVEL,
};
