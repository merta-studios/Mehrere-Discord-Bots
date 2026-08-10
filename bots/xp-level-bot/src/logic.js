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

function todayKey(lang) {
  const t = tzParts(tzOf(lang));
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
// - Basis: 10% des Level-Bedarfs, wenn man in den letzten 24h aktiv war (XP verdient hat)
// - Jeder weitere Tag ohne verdiente XP: +5 Prozentpunkte (1. inaktiver Tag = 10%, dann 15%, 20%, 25%, …)
const DAILY_DECAY_RATE = 0.10;
const INACTIVE_DECAY_STEP = 0.05;

/**
 * Decay-Anteil für die nächste 0-Uhr-Abrechnung.
 * inactiveDays = wie viele Tage in Folge der Nutzer (ab heute/dieser Abrechnung)
 * inaktiv ist. 0 (aktiv) und 1 (erster inaktiver Tag) -> 10%, danach +5% pro Tag.
 */
function decayRateForInactiveDays(inactiveDays) {
  const days = Math.max(0, Math.floor(Number(inactiveDays) || 0));
  if (days <= 1) return DAILY_DECAY_RATE;
  // Ganzzahl-Prozentrechnung, damit 10 % + 5 % exakt 0.15 ergibt (kein Float-Fehler)
  const percent = Math.min(100, 10 + (days - 1) * Math.round(INACTIVE_DECAY_STEP * 100));
  return percent / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** War der Nutzer in den letzten 24h aktiv (irgendwelche XP verdient)? */
function wasActiveRecently(user, now = Date.now()) {
  const last = user?.lastActivity || user?.lastXpGain || 0;
  return last > 0 && (now - last) < DAY_MS;
}

/**
 * Wie viele XP verliert der Nutzer bei der nächsten 0-Uhr-Abrechnung?
 * Aktiv in den letzten 24h -> 10%. Sonst steigt der Inaktivitäts-Streak an.
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
  // täglich `rate` (Standard: 10%) von den für das nächste Level nötigen XP abziehen
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
// ---------------------------------------------------------------------------

function shouldGrantVoiceXp({ secondsSpoken, totalSeconds, hadPause, eligible }) {
  if (!eligible) return false;
  if (secondsSpoken < 5) return false; // mindestens 5 sec gesprochen
  if (secondsSpoken >= totalSeconds) return false; // durchgehend ohne Pause
  if (!hadPause) return false;
  return true;
}

function isVoiceEligible(memberVoiceState, channelMemberCount) {
  // memberVoiceState muss Objekt mit mute/deaf flags haben
  if (!memberVoiceState) return false;
  const { selfMute, selfDeaf, serverMute, serverDeaf, suppress } = memberVoiceState;
  if (selfMute || selfDeaf || serverMute || serverDeaf || suppress) return false;
  // braucht mindestens eine weitere eligible Person im selben Channel
  if (channelMemberCount < 2) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Bonus-Belohnungen (zufällige XP-Geschenke im Haupt-Chat) – reine Logik
// ---------------------------------------------------------------------------

const BONUS_XP_MIN = 20;
const BONUS_XP_MAX = 40;
const BONUS_MAX_PER_DAY = 4;
const BONUS_MIN_SPACING_MS = 90 * 60 * 1000; // mind. 1h 30min zwischen zwei Drops
const BONUS_WINDOW_MS = 75_000; // Aktivitäts-Fenster: 75 Sekunden
const BONUS_MIN_MESSAGES = 8; // mind. so viele Nachrichten im Fenster
const BONUS_MIN_USERS = 2; // von mind. so vielen verschiedenen Personen
const BONUS_DROP_CHANCE = 0.25; // nicht bei jedem Gespräch: 25% Chance pro Burst
const BONUS_ROLL_COOLDOWN_MS = 10 * 60 * 1000; // nach einer Wertung 10min Ruhe
const BONUS_CLAIM_MS = 10 * 60 * 1000; // Drops verfallen nach 10 Minuten

/** Zufällige Bonus-Höhe (20–40 XP, Ganzzahl). rng injizierbar für Tests. */
function rollBonusXp(rng = Math.random) {
  return BONUS_XP_MIN + Math.floor(rng() * (BONUS_XP_MAX - BONUS_XP_MIN + 1));
}

/**
 * Erkennt einen Aktivitäts-Burst: mindestens `minMessages` Nachrichten von
 * mindestens `minUsers` verschiedenen Personen im Zeitfenster.
 * `entries`: [{uid, ts}] – veraltete Einträge werden intern ignoriert.
 */
function detectBurst(entries, now = Date.now(), { windowMs = BONUS_WINDOW_MS, minMessages = BONUS_MIN_MESSAGES, minUsers = BONUS_MIN_USERS } = {}) {
  const fresh = entries.filter((e) => e && typeof e.ts === 'number' && now - e.ts <= windowMs);
  const users = new Set(fresh.map((e) => e.uid));
  return fresh.length >= minMessages && users.size >= minUsers;
}

/**
 * Darf aktuell ein neuer Bonus-Drop kommen? (Tageslimit + Mindestabstand)
 * state: { dayKey, count, lastDropAt } (für den heutigen Tag)
 */
function canDropBonus(state, now = Date.now()) {
  if (!state) return true;
  if ((state.count || 0) >= BONUS_MAX_PER_DAY) return false;
  if (state.lastDropAt && now - state.lastDropAt < BONUS_MIN_SPACING_MS) return false;
  return true;
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
  DAY_MS,
  rollBonusXp,
  detectBurst,
  canDropBonus,
  BONUS_XP_MIN,
  BONUS_XP_MAX,
  BONUS_MAX_PER_DAY,
  BONUS_MIN_SPACING_MS,
  BONUS_WINDOW_MS,
  BONUS_MIN_MESSAGES,
  BONUS_MIN_USERS,
  BONUS_DROP_CHANCE,
  BONUS_ROLL_COOLDOWN_MS,
  BONUS_CLAIM_MS,
  countValidWords,
  xpForWords,
  calculateXpForMessage,
  isValidWordToken,
  isSpamMessage,
  isOnCooldown,
  applyXpGain,
  applyDailyDecay,
  formatNickname,
  stripLvlTag,
  getMedal,
  shouldGrantVoiceXp,
  isVoiceEligible,
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
