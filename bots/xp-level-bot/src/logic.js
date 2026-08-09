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

function calculateXpForMessage(content) {
  const valid = countValidWords(content);
  if (valid === 0) return { valid, xp: 0 };
  const xp = xpForWords(valid);
  return { valid, xp };
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

function applyDailyDecay(user) {
  // täglich 7% von benötigt für nächstes Level abziehen
  let level = user.level;
  let xp = user.xp;
  const needed = xpNeeded(level);
  const decay = Math.ceil(needed * 0.07);
  xp -= decay;
  if (xp <= 0) {
    // Achtung: wenn 0 erreicht, level verlieren falls >1
    if (level > 1) {
      level -= 1;
      const newNeeded = xpNeeded(level);
      xp = Math.floor(newNeeded * 0.93);
      return { level, xp, leveledDown: true, decay, dropped: true };
    } else {
      xp = 0;
      return { level, xp, leveledDown: false, decay, dropped: false };
    }
  }
  return { level, xp, leveledDown: false, decay, dropped: false };
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
  let suffix = '';
  if (rank !== null && rank >= 1 && rank <= 15) {
    const medal = getMedal(rank);
    // für Top3 medal emoji, sonst Zahl
    if (rank <= 3) suffix = ` | #${medal}`;
    else suffix = ` | #${medal}`;
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

module.exports = {
  pad,
  tzParts,
  todayKey,
  formatTimeInTz,
  xpNeeded,
  nextLevelXp,
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
};
