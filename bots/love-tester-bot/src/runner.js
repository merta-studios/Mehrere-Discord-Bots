/**
 * Der Analyse-Ablauf des Love Testers:
 *
 *  - scanBatch(): durchsucht die eingerichteten Kanäle (max. 500 Nachrichten
 *    pro Scan über alle Kanäle, bei „Weiter analysieren“ die nächsten 500).
 *  - buildAnalysis(): baut Ausschnitte, wählt sie unter dem Token-Budget aus,
 *    erstellt System- + User-Prompt.
 *  - runGroqPhase(): ruft Groq mit Retries auf (Rate-Limit, 5xx, Kontext zu
 *    groß → Budget halbieren und erneut versuchen).
 *  - updateProgress(): bearbeitet die sichtbare Nachricht laufend mit %-Stand
 *    und humorvollen Zwischenmeldungen (gedrosselt gegen Discord-Rate-Limits).
 *
 * Fehler enden NIE im Nichts: Die Nachricht wird zu einem Fehler-Container
 * mit „Erneut versuchen“, „Weiter analysieren“ und „Abbrechen“ – der
 * gescannte Fortschritt bleibt dabei erhalten.
 */

const { MessageFlags } = require('discord.js');
const { t } = require('./languages');
const { componentsV2Payload } = require('./message-payload');
const {
  MAX_MESSAGES_PER_SCAN,
  buildExcerpts,
  messageToAiText,
  buildSystemPrompt,
  buildUserPrompt,
  selectExcerpts,
  groqChat,
  extractPercent,
  sleep,
  PROMPT_CHAR_BUDGET,
} = require('./analyzer');
const {
  buildProgress,
  buildResult,
  buildError,
} = require('./embed-builder');

const PROGRESS_MIN_INTERVAL_MS = 2000; // Edit-Throttle (Discord-Rate-Limit)
const PROGRESS_PCT_STEP = 5; // nur bei ≥5 %-Punkten editieren
// Groq-Retry-Backoffs bei 429/5xx; LOVE_TEST_FAST=true macht sie minimal
// (für Tests, damit die Suite nicht Minuten braucht).
const GROQ_RETRY_DELAYS = process.env.LOVE_TEST_FAST === 'true' ? [50, 50, 50] : [4000, 9000, 15000];

// ---------------------------------------------------------------------------
// Session-Verwaltung
// ---------------------------------------------------------------------------

function createSession({ ctx, interaction, cfg, user1, user2, token }) {
  const session = {
    token,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    lang: cfg.lang || 'de',
    status: 'confirm', // confirm | running | done | error | stopped
    running: false,
    user1,
    user2,
    channels: [...(cfg.channels || [])],
    channelState: new Map(), // channelId -> { before: null | id }
    scannedTotal: 0,
    excerpts: [], // { startTs, hasBoth, messages: [{line}] }
    systemPrompt: null,
    userPrompt: null,
    canContinue: true,
    lastError: null,
    groqBudget: PROMPT_CHAR_BUDGET,
    lastEditAt: 0,
    lastPct: -1,
    phaseIdx: 0,
  };
  for (const chId of session.channels) session.channelState.set(chId, { before: null });
  return session;
}

function resolveMemberInfo(guild, userId) {
  const member = guild.members?.cache?.get(userId);
  const user = member?.user;
  return {
    id: userId,
    name: member?.displayName || user?.displayName || user?.username || userId,
    displayName: member?.displayName || user?.displayName || user?.username || userId,
    username: user?.username || userId,
    globalName: user?.globalName || user?.username || userId,
    nickname: member?.nickname || user?.username || userId,
  };
}

// ---------------------------------------------------------------------------
// Nachrichten-Resolver (Names für Mentions/Rollen/Kanäle/Antworten)
// ---------------------------------------------------------------------------

function makeResolver(guild, client) {
  const replyCache = new Map(); // messageId -> {user, content}
  const resolveReplyAsync = async (msg) => {
    const refId = msg.reference?.messageId;
    if (!refId || !msg.channel) return null;
    if (replyCache.has(refId)) return replyCache.get(refId);
    let val = { user: null, content: '' };
    try {
      const ref = await msg.channel.messages.fetch(refId);
      val = {
        user: ref.author?.displayName || ref.author?.username || null,
        content: ref.content || '',
      };
    } catch {
      val = { user: null, content: '' };
    }
    replyCache.set(refId, val);
    return val;
  };
  return {
    displayName: (id) => {
      const m = guild.members?.cache?.get(id);
      if (m) return m.displayName || m.user?.username || null;
      const u = client.users?.cache?.get(id);
      return u ? u.displayName || u.username || null : null;
    },
    roleName: (id) => guild.roles?.cache?.get(id)?.name || null,
    channelName: (id) => guild.channels?.cache?.get(id)?.name || null,
    // Synchroner Zugriff: wird erst nach resolveReplyAsync-Warmup genutzt
    resolveReply: (msg) => {
      const refId = msg.reference?.messageId;
      if (!refId) return null;
      return replyCache.get(refId) || null;
    },
    resolveReplyAsync,
  };
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/**
 * Scannt so lange, bis `budget` neue Nachrichten über alle Kanäle gesammelt
 * sind (oder nichts mehr da ist). Liefert die neuen Nachrichten pro Kanal
 * zurück. Aktualisiert session.scannedTotal (gesamt) und die Cursor.
 * `budget` ist der Kontingent für DIESEN Aufruf – so kann „Weiter
 * analysieren“ auch nach bereits 500 gescannten Nachrichten weitermachen.
 */
async function scanChannels(ctx, session, budget = MAX_MESSAGES_PER_SCAN) {
  const guild = ctx.client.guilds.cache.get(session.guildId);
  if (!guild) throw Object.assign(new Error('Gilde nicht gefunden'), { loveKind: 'generic' });

  const resolver = makeResolver(guild, ctx.client);
  const collected = new Map(); // channelId -> [messages] (chronologisch)
  let fetchedThisCall = 0;

  for (const chId of session.channels) {
    if (fetchedThisCall >= budget) break;
    const state = session.channelState.get(chId);
    if (!state) continue;
    if (state.before === 'done') continue;

    let channel;
    try {
      channel = await ctx.client.channels.fetch(chId);
    } catch {
      continue; // Kanal nicht mehr erreichbar → überspringen
    }
    if (!channel || !channel.isTextBased?.()) {
      state.before = 'done';
      continue;
    }

    let before = state.before || undefined;
    let rateLimitHits = 0;
    // eslint-disable-next-line no-constant-condition
    while (fetchedThisCall < budget) {
      let batch;
      try {
        batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      } catch (err) {
        if (err?.status === 429) {
          rateLimitHits += 1;
          if (rateLimitHits > 5) {
            // Dauert-Rate-Limit: nicht endlos hängen bleiben, sondern Fehler
            // mit klarer Meldung („Weiter analysieren“ rettet den Fortschritt)
            const e = new Error('Discord-Rate-Limit beim Scannen');
            e.loveKind = 'discord429';
            throw e;
          }
          const wait = ((err.retryAfter ?? err.rateLimit?.retryAfter ?? 2) * 1000) + 500;
          await sleep(Math.min(wait, 15000));
          continue; // gleiche Stelle erneut
        }
        if (err?.status === 403) { state.before = 'done'; break; }
        throw err;
      }
      if (!batch.size) { state.before = 'done'; break; }

      const arr = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      if (!collected.has(chId)) collected.set(chId, []);
      collected.get(chId).push(...arr);
      session.scannedTotal += arr.length;
      fetchedThisCall += arr.length;
      // Älteste der Batch = nächster Cursor (lokal UND im State, damit auch
      // spätere „Weiter analysieren“-Läufe an der richtigen Stelle weitermachen)
      before = arr[0].id;
      state.before = before;

      // Antworten vorab auflösen (Warmup), damit die Umwandlung synchron läuft
      await Promise.allSettled(arr.map((m) => resolver.resolveReplyAsync(m)));

      // Fortschritt live melden (gedrosselt)
      const pct = Math.min(90, Math.floor((session.scannedTotal / MAX_MESSAGES_PER_SCAN) * 90));
      await updateProgress(ctx, session, pct);

      if (arr.length < 100) { state.before = 'done'; break; }
      await sleep(250); // höflich zur API
    }
  }

  // Ausschnitte aus den neuen Nachrichten bauen und mit alten mergen
  const newExcerpts = [];
  for (const [chId, messages] of collected.entries()) {
    const exs = buildExcerpts(messages, session.user1.id, session.user2.id);
    for (const ex of exs) {
      const lines = ex.messages.map((m) =>
        messageToAiText(m, {
          lang: session.lang,
          user1Id: session.user1.id,
          user2Id: session.user2.id,
          displayName: resolver.displayName,
          roleName: resolver.roleName,
          channelName: resolver.channelName,
          resolveReply: resolver.resolveReply,
        })
      );
      newExcerpts.push({
        startTs: ex.messages[0]?.createdTimestamp || 0,
        hasBoth: ex.hasBoth,
        messages: lines.map((line) => ({ line })),
      });
    }
  }
  session.excerpts = mergeExcerpts([...session.excerpts, ...newExcerpts]);

  // Kann weitergescannt werden? Nur wenn in irgendeinem Kanal noch ältere
  // Nachrichten liegen (Cursor offen). Das Gesamtlimit gilt pro Scan-Aufruf.
  session.canContinue = [...session.channelState.values()].some((s) => s.before !== 'done');
  return { newCount: fetchedThisCall };
}

/** Führt Ausschnitte zusammen und sortiert chronologisch. */
function mergeExcerpts(excerpts) {
  const byKey = new Map();
  for (const ex of excerpts) {
    const key = ex.startTs;
    const existing = byKey.get(key);
    if (existing) {
      // Duplikate (gleicher Start) – längeren behalten
      if (ex.messages.length > existing.messages.length) byKey.set(key, ex);
    } else {
      byKey.set(key, ex);
    }
  }
  return [...byKey.values()].sort((a, b) => a.startTs - b.startTs);
}

// ---------------------------------------------------------------------------
// Prompt + Groq
// ---------------------------------------------------------------------------

async function buildAnalysis(ctx, session) {
  if (!session.excerpts.length) {
    throw Object.assign(new Error('NO_MESSAGES'), { loveKind: 'noMessages' });
  }
  session.systemPrompt = buildSystemPrompt(session.lang, session.user1, session.user2);
  const chosen = selectExcerpts(session.excerpts, session.groqBudget);
  session.userPrompt = buildUserPrompt({
    lang: session.lang,
    user1: session.user1,
    user2: session.user2,
    excerpts: chosen,
  });
  return chosen.length > 0;
}

/**
 * Groq-Call mit Retries. Wirft am Ende den letzten Fehler mit .status.
 * Bei HTTP 400 (Kontext zu groß) wird das Budget halbiert, neu ausgewählt
 * und einmal erneut versucht.
 */
async function runGroqPhase(ctx, session) {
  const cfg = ctx.store.getGuild(session.guildId);
  const apiKey = cfg?.groqApiKey;
  if (!apiKey) {
    throw Object.assign(new Error('NO_KEY'), { loveKind: 'auth' });
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await updateProgress(ctx, session, 92, 'final');
      const result = await groqChat({
        apiKey,
        systemPrompt: session.systemPrompt,
        userPrompt: session.userPrompt,
      });
      await updateProgress(ctx, session, 98, 'final');
      return result;
    } catch (err) {
      lastErr = err;
      if (err.status === 429) {
        // Groq-Nutzungslimit: warten und erneut versuchen
        await sleep(GROQ_RETRY_DELAYS[attempt] ?? 5000);
        continue;
      }
      if (err.status >= 500) {
        await sleep(Math.min(GROQ_RETRY_DELAYS[attempt] ?? 2500, 10000) / 2);
        continue;
      }
      if (err.status === 400 && session.groqBudget > 10000) {
        // Kontext zu groß → Budget halbieren und mit wichtigeren Ausschnitten neu bauen
        session.groqBudget = Math.floor(session.groqBudget / 2);
        session.excerpts = selectExcerpts(session.excerpts, session.groqBudget);
        session.userPrompt = buildUserPrompt({
          lang: session.lang,
          user1: session.user1,
          user2: session.user2,
          excerpts: session.excerpts,
        });
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Fortschritt
// ---------------------------------------------------------------------------

function phaseText(ctx, session, phase) {
  const phases = t('analysingPhases', session.lang);
  const list = Array.isArray(phases) ? phases : [];
  if (phase === 'final') return t('analysingFinal', session.lang);
  return list[session.phaseIdx % Math.max(1, list.length)];
}

async function updateProgress(ctx, session, pct, phase = 'scan') {
  const now = Date.now();
  const bigEnough = pct - session.lastPct >= PROGRESS_PCT_STEP || pct === 100 || pct >= 90;
  const longEnough = now - session.lastEditAt >= PROGRESS_MIN_INTERVAL_MS;
  const isFinal = phase === 'final' || pct === 100;
  if (!isFinal && (!bigEnough || !longEnough)) return;

  session.lastPct = Math.max(session.lastPct, pct);
  session.lastEditAt = now;
  session.phaseIdx += 1;

  const payload = componentsV2Payload([
    buildProgress({ lang: session.lang, token: session.token, pct, phase: phaseText(ctx, session, phase) }),
  ]);
  await editSessionMessage(ctx, session, payload);
}

async function editSessionMessage(ctx, session, payload) {
  const guild = ctx.client.guilds.cache.get(session.guildId);
  if (!guild) return;
  let channel;
  try {
    channel = await ctx.client.channels.fetch(session.channelId);
  } catch {
    return;
  }
  if (!channel?.isTextBased?.()) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await channel.messages.fetch(session.messageId);
      await msg.edit(payload);
      return;
    } catch (err) {
      if (err?.status === 429) {
        await sleep(((err.retryAfter ?? err.rateLimit?.retryAfter ?? 2) * 1000) + 500);
        continue;
      }
      if (err?.status === 403 || err?.code === 10008) return;
      await sleep(500 * (attempt + 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------------

/** Vollständiger Lauf: Scan → Analyse → Groq → Ergebnis (oder Fehler). */
async function runAnalysis(ctx, session) {
  if (session.running) return;
  session.running = true;
  session.status = 'running';
  session.lastError = null;

  // Erste sichtbare Reaktion: humorvolle „Analysiere…“-Nachricht
  const firstPayload = componentsV2Payload([
    buildProgress({ lang: session.lang, token: session.token, pct: 0, phase: phaseText(ctx, session, 'scan') }),
  ]);
  await editSessionMessage(ctx, session, firstPayload);

  try {
    // 1) Chat scanen (max. 500 Nachrichten über alle Kanäle)
    await scanChannels(ctx, session, MAX_MESSAGES_PER_SCAN);

    // 2) Ausschnitte + Prompts bauen
    await updateProgress(ctx, session, 90, 'final');
    await buildAnalysis(ctx, session);

    // 3) Groq befragen
    const result = await runGroqPhase(ctx, session);

    // 4) Ergebnis anzeigen (mit „### XX %“-Zeile)
    session.status = 'done';
    const percent = extractPercent(result.content);
    let finalText = result.content;
    if (percent !== null) {
      // Sicherstellen, dass die Prozentzeile ganz unten steht (Discord-Format)
      finalText = `${result.content.replace(/###\s*\d{1,3}\s*%.*$/i, '').trim()}\n### ${percent}%`;
    }
    const payload = componentsV2Payload([
      buildResult({ lang: session.lang, token: session.token, aiText: finalText }),
    ]);
    await editSessionMessage(ctx, session, payload);
  } catch (err) {
    session.status = 'error';
    session.lastError = err;
    const payload = componentsV2Payload([
      buildError({
        lang: session.lang,
        token: session.token,
        message: errorText(ctx, session, err),
        canContinue: session.canContinue && session.status !== 'stopped',
      }),
    ]);
    await editSessionMessage(ctx, session, payload);
  } finally {
    session.running = false;
  }
}

/** „Weiter analysieren“: noch einmal bis zu 500 ältere Nachrichten scannen. */
async function continueAnalysis(ctx, session) {
  if (session.running) {
    return { busy: true };
  }
  session.running = true;
  session.status = 'running';
  session.lastError = null;
  try {
    await updateProgress(ctx, session, Math.min(90, Math.floor((session.scannedTotal / (MAX_MESSAGES_PER_SCAN * 2)) * 90)), 'scan');
    await scanChannels(ctx, session, MAX_MESSAGES_PER_SCAN);
    await buildAnalysis(ctx, session);
    const result = await runGroqPhase(ctx, session);
    session.status = 'done';
    const percent = extractPercent(result.content);
    let finalText = result.content;
    if (percent !== null) {
      finalText = `${result.content.replace(/###\s*\d{1,3}\s*%.*$/i, '').trim()}\n### ${percent}%`;
    }
    const payload = componentsV2Payload([
      buildResult({ lang: session.lang, token: session.token, aiText: finalText }),
    ]);
    await editSessionMessage(ctx, session, payload);
    return { busy: false };
  } catch (err) {
    session.status = 'error';
    session.lastError = err;
    const payload = componentsV2Payload([
      buildError({
        lang: session.lang,
        token: session.token,
        message: errorText(ctx, session, err),
        canContinue: session.canContinue,
      }),
    ]);
    await editSessionMessage(ctx, session, payload);
    return { busy: false };
  } finally {
    session.running = false;
  }
}

/** Übersetzt Fehler in humorvolle, verständliche Meldungen. */
function errorText(ctx, session, err) {
  const lang = session.lang;
  const status = err?.status;
  if (err?.loveKind === 'noMessages' || err?.message === 'NO_MESSAGES') return t('errNoMessages', lang);
  if (err?.loveKind === 'auth' || err?.message === 'NO_KEY') return t('errGroqAuth', lang);
  if (err?.loveKind === 'discord429') return t('errDiscordRateLimit', lang);
  if (status === 429) return t('errGroqRateLimit', lang);
  if (status === 401 || status === 403) return t('errGroqAuth', lang);
  if (status >= 500) return t('errGroqServer', lang, { status });
  if (status === 0 && /fetch|network|ECONN|ENOTFOUND|abort/i.test(String(err?.message || ''))) {
    return t('errGroqNetwork', lang);
  }
  if (/rate.?limit|429/i.test(String(err?.message || ''))) return t('errDiscordRateLimit', lang);
  return t('errGeneric', lang, { error: (err?.message || String(err)).slice(0, 300) });
}

module.exports = {
  createSession,
  resolveMemberInfo,
  runAnalysis,
  continueAnalysis,
  updateProgress,
  editSessionMessage,
  scanChannels,
  buildAnalysis,
  runGroqPhase,
  mergeExcerpts,
  errorText,
};
