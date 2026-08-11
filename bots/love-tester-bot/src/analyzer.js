/**
 * Der „Analyse-Kern“ des Love Testers:
 *
 * 1. Chat-Scan: pro Kanal maximal 500 Nachrichten insgesamt über alle Kanäle.
 * 2. Ausschnitt-Bau („Excerpts“): 4 Nachrichten VOR dem ersten Treffer,
 *    dann der Kern (Nachrichten der beiden User, max. 3 fremde nacheinander
 *    dazwischen) und danach der Rest für den Kontext (≥ 9 Nachrichten total).
 * 3. Alles in KI-freundlichen Text verwandeln: Bilder, Videos, Antworten,
 *    Sprachnachrichten, Sticker, Server-Emojis, Erwähnungen …
 * 4. System-Prompt + User-Prompt für Groq bauen (Token-Budget beachten).
 * 5. Groq-API-Call mit Retry-/Fehlerbehandlung (Rate-Limits, 5xx, Kontext zu groß).
 *
 * Die Kernfunktionen (findCoreRuns/buildExcerpts/messageToAiText/buildPrompts/
 * extractPercent) sind bewusst ohne Discord-Objekte testbar.
 */

const { MessageFlags } = require('discord.js');
const { t, tzOf } = require('./languages');

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------
const MAX_MESSAGES_PER_SCAN = 500; // über ALLE Kanäle zusammen
const CONTEXT_BEFORE = 4; // Nachrichten vor dem ersten User-Treffer
const CONTEXT_AFTER = 4; // Nachrichten nach dem Kern („Rest danach“)
const MAX_EXCERPT_MESSAGES = 26; // Obergrenze pro Ausschnitt (Notbremse)
const MAX_EXCERPTS = 20; // Obergrenze Ausschnitte pro Analyse
const MAX_LINE_CHARS = 350; // Zeilenlänge pro Nachricht
const MAX_CONTENT_CHARS = 300; // Inhalt pro Nachricht
const PROMPT_CHAR_BUDGET = 55000; // ~13-15k Tokens – sicher unter dem Limit

const GROQ_MODEL = 'llama-3.3-70b-versatile'; // 128k Kontext, starke Qualität
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------------------------------------------------------------------------
// Kern-Erkennung: Läufe, in denen die User schreiben (max. 3 Fremde dazwischen)
// ---------------------------------------------------------------------------

/**
 * Findet „Kern-Läufe“: maximale Segmente, die mit einer User-Nachricht beginnen
 * und enden und in denen nie 4+ fremde Nachrichten hintereinander stehen.
 */
function findCoreRuns(messages, isTarget) {
  const runs = [];
  let start = -1;
  let lastUser = -1;
  let streak = 0;
  for (let i = 0; i < messages.length; i++) {
    if (isTarget(messages[i])) {
      if (start === -1) start = i;
      lastUser = i;
      streak = 0;
    } else if (start !== -1) {
      streak += 1;
      if (streak >= 4) {
        // 4+ Fremde nacheinander beenden den Kern (die Fremden gehören zum
        // „davor“ des nächsten Laufs bzw. zum Kontext)
        runs.push({ start, end: lastUser });
        start = -1;
        lastUser = -1;
        streak = 0;
      }
    }
  }
  if (start !== -1 && lastUser >= start) runs.push({ start, end: lastUser });
  return runs;
}

/**
 * Baut aus einem chronologischen Nachrichten-Array die Ausschnitte:
 *   4 davor + Kern (1..n User-Nachrichten) + 4 danach  →  mind. 9 Nachrichten.
 * Überlappende/angrenzende Ausschnitte werden zusammengeführt.
 */
function buildExcerpts(messages, user1Id, user2Id) {
  const isTarget = (m) => {
    const id = m.author?.id ?? m.authorId;
    return id === user1Id || id === user2Id;
  };
  const runs = findCoreRuns(messages, isTarget);
  const excerpts = [];
  for (const run of runs) {
    const s = Math.max(0, run.start - CONTEXT_BEFORE);
    const e = Math.min(messages.length - 1, run.end + CONTEXT_AFTER);
    const slice = messages.slice(s, e + 1);
    excerpts.push({
      start: s,
      end: e,
      messages: capExcerpt(slice, run, s),
      hasBoth: slice.some((m) => (m.author?.id ?? m.authorId) === user1Id) &&
        slice.some((m) => (m.author?.id ?? m.authorId) === user2Id),
    });
  }
  // Überlappende/angrenzende Ausschnitte verschmelzen
  const merged = [];
  for (const ex of excerpts) {
    const last = merged[merged.length - 1];
    if (last && ex.start <= last.end + 1) {
      last.end = Math.max(last.end, ex.end);
      last.messages = messages.slice(last.start, last.end + 1);
      last.hasBoth = last.hasBoth || ex.hasBoth;
    } else {
      merged.push({ ...ex });
    }
  }
  return merged;
}

/** Notbremse: Ausschnitt auf MAX_EXCERPT_MESSAGES begrenzen (Kern bleibt erhalten). */
function capExcerpt(slice, run, offset) {
  if (slice.length <= MAX_EXCERPT_MESSAGES) return slice;
  const coreStart = run.start - offset;
  const coreEnd = run.end - offset;
  const core = slice.slice(coreStart, coreEnd + 1);
  const before = slice.slice(0, coreStart).slice(-CONTEXT_BEFORE);
  const after = slice.slice(coreEnd + 1).slice(0, CONTEXT_AFTER);
  // Kern ggf. stutzen (erste Hälfte + letzte Hälfte), damit die Notbremse greift
  let coreCapped = core;
  const maxCore = MAX_EXCERPT_MESSAGES - before.length - after.length;
  if (coreCapped.length > maxCore) {
    const half = Math.floor(maxCore / 2);
    coreCapped = [...coreCapped.slice(0, half), ...coreCapped.slice(coreCapped.length - (maxCore - half))];
  }
  return [...before, ...coreCapped, ...after];
}

// ---------------------------------------------------------------------------
// Nachricht → KI-Text (Bilder, Antworten, Sticker, Emojis, Erwähnungen …)
// ---------------------------------------------------------------------------

/** Bereinigt Rohtext: Mentions → @Name, Rollen → @Rolle, Kanäle → #Kanal, Emojis → :name:, Timestamps → Datum. */
function cleanContent(content, { displayName = () => null, roleName = () => null, channelName = () => null, lang = 'de' } = {}) {
  if (!content) return '';
  let out = String(content);
  // Server-Emojis (auch animiert): <:name:id> / <a:name:id> → :name:
  out = out.replace(/<a?:([A-Za-z0-9_]+):\d+>/g, (m, name) => `:${name}:`);
  // User-Mentions → @Name
  out = out.replace(/<@!?(\d+)>/g, (m, id) => {
    const name = displayName(id);
    return name ? `@${name}` : `@${t('genericUser', lang)}`;
  });
  // Rollen-Mentions → @Rolle
  out = out.replace(/<@&(\d+)>/g, (m, id) => {
    const name = roleName(id);
    return name ? `@${name}` : `@${t('genericRole', lang)}`;
  });
  // Kanal-Mentions → #Kanal
  out = out.replace(/<#(\d+)>/g, (m, id) => {
    const name = channelName(id);
    return name ? `#${name}` : `#${t('genericChannel', lang)}`;
  });
  // Discord-Timestamps → lesbares Datum
  out = out.replace(/<t:(\d+)(?::[tTdDRFf])?>/g, (m, ts) => {
    try {
      return new Date(Number(ts) * 1000).toISOString().replace('T', ' ').slice(0, 16);
    } catch {
      return m;
    }
  });
  // Codeblöcke glätten (Zeilenumbrüche in ```-Blöcken würden das Format brechen)
  out = out.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (m, code) => `[code] ${code.replace(/\s+/g, ' ').slice(0, 200)} [/code]`);
  // Zeilenumbrüche zu „ ⏎ “ (eine Zeile pro Nachricht!)
  out = out.replace(/\s*\n+\s*/g, ' ⏎ ');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > MAX_CONTENT_CHARS) out = `${out.slice(0, MAX_CONTENT_CHARS)}…`;
  return out;
}

/**
 * Wandelt eine Discord-Nachricht in eine KI-freundliche Zeile um.
 *
 * @param {object} msg  Discord-Message (oder Test-Mock mit author, content, attachments, …)
 * @param {object} ctx  { user1Id, user2Id, lang, displayName(id), roleName(id), channelName(id), resolveReply(msg) -> {user, content}|null }
 */
function messageToAiText(msg, ctx) {
  const lang = ctx.lang || 'de';
  const authorId = msg.author?.id ?? msg.authorId ?? '?';
  let name = ctx.displayName ? ctx.displayName(authorId) : null;
  name = name || msg.author?.displayName || msg.author?.username || authorId;

  const isU1 = authorId === ctx.user1Id;
  const isU2 = authorId === ctx.user2Id;
  // Beide User besonders hervorheben, damit die KI sie eindeutig erkennt
  let authorLabel = name;
  if (isU1) authorLabel = `**${name}** [USER1]`;
  else if (isU2) authorLabel = `**${name}** [USER2]`;

  const parts = [];

  // Antworten (Replies)
  const reply = ctx.resolveReply ? ctx.resolveReply(msg) : null;
  if (reply) {
    const refContent = cleanContent(reply.content || '', ctx);
    if (reply.user) {
      parts.push(t('msgRepliedTo', lang, { user: `**${reply.user}**`, content: refContent || '…' }));
    } else {
      parts.push(t('msgRepliedGeneric', lang));
    }
  }

  // Sticker
  if (msg.stickers && msg.stickers.size) {
    for (const st of msg.stickers.values()) {
      parts.push(t('msgSticker', lang, { name: st.name || '?' }));
    }
  }

  // Attachments (Bilder, Videos, Sprachnachrichten, Dateien)
  if (msg.attachments && msg.attachments.size) {
    for (const a of msg.attachments.values()) {
      const ct = a.contentType || a.content_type || '';
      if (/^image\//i.test(ct)) parts.push(t('msgImage', lang));
      else if (/^video\//i.test(ct)) parts.push(t('msgVideo', lang));
      else if (/^audio\//i.test(ct)) parts.push(t('msgVoice', lang));
      else parts.push(t('msgFile', lang, { name: (a.name || '?').slice(0, 80) }));
    }
  } else if (msg.flags && typeof msg.flags.has === 'function' && msg.flags.has(MessageFlags.IsVoiceMessage)) {
    parts.push(t('msgVoice', lang));
  }

  // Embeds
  if (msg.embeds && msg.embeds.length) {
    parts.push(t('msgEmbed', lang));
  }

  // Text-Inhalt
  const content = cleanContent(msg.content || '', ctx);
  if (content) parts.push(content);

  const line = `${authorLabel}: ${parts.join(' ')}`.trim();
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * System-Prompt: humorvoll, fordert 3–5 Sätze (mit 2 Leerzeilen getrennt)
 * und die „### XX %“-Zeile ganz unten.
 */
function buildSystemPrompt(lang, user1, user2) {
  const u1 = user1.name;
  const u2 = user2.name;
  return [
    `Du bist der "Love Tester", ein humorvoller, charmant-sarkastischer KI-Liebesanalyst auf einem Discord-Server.`,
    ``,
    `Deine Aufgabe: Schätze die Liebe zwischen ${u1} [USER1] und ${u2} [USER2] anhand der mitgelieferten Chat-Ausschnitte in PROZENT.`,
    ``,
    `Regeln für deine Antwort:`,
    `1. Sei humorvoll und unterhaltsam, aber auch ehrlich – wenn die Chemie fehlt, sag es witzig, aber deutlich.`,
    `2. Schreibe 3 bis 5 Sätze. Jeder Satz ist ein Schritt deiner Schlussfolgerung mit Begründung (z. B. Hinweise im Chat, wer mehr schreibt, wer antwortet, wer Emojis/Reaktionen nutzt, wer ignoriert wird, Flirt-Signale, Insider, Streit).`,
    `3. Trenne die Sätze IMMER mit zwei Leerzeilen voneinander (Absatz pro Schlussfolgerung).`,
    `4. Ganz unten kommt eine EINZELNE Zeile, die mit "### " beginnt und nur den Prozentwert enthält, z. B.:`,
    `### 73%`,
    ``,
    `Wichtig:`,
    `- [USER1] = ${u1}, [USER2] = ${u2}. Zeilen mit diesen Markierungen gehören zu den beiden.`,
    `- Erwähne konkrete Beispiele aus den Ausschnitten, um deine Einschätzung glaubwürdig zu machen.`,
    `- Antworte in der Sprache der Ausschnitte und Anweisungen.`,
    `- Übertreibe nicht: 100 % nur bei einem Heiratsantrag im Chat, 0 % nur bei komplettem Desinteresse.`,
  ].join('\n');
}

/**
 * Baut den User-Prompt: Info über beide User (Username, Nickname, Server-Nick,
 * ID) + alle Ausschnitte als formatierte Blöcke.
 */
function buildUserPrompt({ lang, user1, user2, excerpts }) {
  const lines = [];
  lines.push(`=== INFORMATIONEN ÜBER DIE PERSONEN ===`);
  lines.push(userInfoBlock(user1, 1));
  lines.push(userInfoBlock(user2, 2));
  lines.push('');
  lines.push(`=== CHAT-AUSSCHNITTE (chronologisch, neueste zuletzt) ===`);
  if (!excerpts.length) {
    lines.push('(keine Ausschnitte vorhanden)');
  } else {
    excerpts.forEach((ex, i) => {
      lines.push('');
      lines.push(t('excerptHeader', lang, { n: i + 1 }));
      for (const msg of ex.messages) {
        lines.push(msg.line);
      }
    });
  }
  return lines.join('\n');
}

function userInfoBlock(user, n) {
  return [
    `USER ${n} (${user.name}):`,
    `- Username: ${user.username || '?'}`,
    `- Anzeigename (Discord): ${user.globalName || user.username || '?'}`,
    `- Server-Nickname: ${user.nickname || user.name || '?'}`,
    `- Benutzer-ID: ${user.id}`,
  ].join('\n');
}

/**
 * Wählt Ausschnitte unter dem Token-Budget aus:
 * zuerst Ausschnitte mit BEIDEN Usern (neueste zuerst), dann die übrigen.
 * Ausgabe chronologisch sortiert.
 */
function selectExcerpts(excerpts, budgetChars = PROMPT_CHAR_BUDGET) {
  const withBoth = excerpts.filter((e) => e.hasBoth).sort((a, b) => b.start - a.start);
  const rest = excerpts.filter((e) => !e.hasBoth).sort((a, b) => b.start - a.start);
  const ordered = [...withBoth, ...rest].slice(0, MAX_EXCERPTS);
  const chosen = [];
  let total = 0;
  for (const ex of ordered) {
    const cost = ex.messages.reduce((sum, m) => sum + (m.line ? m.line.length : 0), 0) + 30;
    if (chosen.length && total + cost > budgetChars) continue;
    chosen.push(ex);
    total += cost;
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Groq-API
// ---------------------------------------------------------------------------

function groqError(status) {
  const err = new Error(`Groq-API-Fehler (HTTP ${status})`);
  err.status = status;
  return err;
}

/**
 * Ruft Groq auf. Wirft bei Fehlern mit `.status`:
 *  429 = Rate-Limit, 401/403 = Auth, 400 = Kontext zu groß, 5xx = Serverfehler.
 */
async function groqChat({ apiKey, systemPrompt, userPrompt, model = GROQ_MODEL, maxTokens = 1500, temperature = 0.9, signal } = {}) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const err = groqError(res.status);
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {}
    err.detail = detail;
    throw err;
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const err = new Error('Groq hat eine leere Antwort geliefert.');
    err.status = 0;
    throw err;
  }
  return { content: content.trim() };
}

/** Extrahiert den Prozentwert aus „### XX %“. */
function extractPercent(text) {
  const m = String(text || '').match(/###\s*(\d{1,3})\s*%/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
}

/** Wartet mit Rate-Limit-Respekt (retryAfter aus Discord-429). */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  MAX_MESSAGES_PER_SCAN,
  CONTEXT_BEFORE,
  CONTEXT_AFTER,
  MAX_EXCERPT_MESSAGES,
  MAX_EXCERPTS,
  PROMPT_CHAR_BUDGET,
  GROQ_MODEL,
  GROQ_URL,
  findCoreRuns,
  buildExcerpts,
  capExcerpt,
  cleanContent,
  messageToAiText,
  buildSystemPrompt,
  buildUserPrompt,
  userInfoBlock,
  selectExcerpts,
  groqChat,
  extractPercent,
  sleep,
  tzOf,
};
