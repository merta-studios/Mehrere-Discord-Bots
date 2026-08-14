/**
 * 🔢 Counting-Spiel
 *
 * Ein Channel wird per `/set_counting_channel` zum Zähl-Channel erklärt.
 * Gemerkt wird das – wie im ganzen Bot – **ohne Datenbank**: direkt im
 * Kanal-Thema. Dort steht ein sichtbarer Hinweis („🔢 Counting-Channel |
 * Aktuelle Zahl: 42“) und direkt dahinter ein unsichtbarer Marker, den nur
 * der Bot liest.
 *
 * Regeln:
 * - Es beginnt bei 1.
 * - Niemand darf zwei Zahlen hintereinander schreiben.
 * - Richtige Zahl → ✅, falsche Zahl → ❌, Neustart bei 1 und eine neutrale
 *   Fehlermeldung (mit wechselnden Sprüchen).
 * - Bei einer falschen Zahl zeigt der Bot hin und wieder eine kurze, sichere
 *   Ausrast-Show. Die Dramaturgie steigt mit dem bisherigen Zählstand, bleibt
 *   aber auf höchstens drei Bot-Nachrichten und verwendet keine Mass-Pings.
 * - Zwei Zahlen derselben Person hintereinander → Nachricht wird nur
 *   gelöscht, der Zählstand bleibt.
 * - Text statt Zahl → Nachricht wird gelöscht, der Zählstand bleibt.
 * - Bots und Webhooks spielen nicht mit.
 */

const { PermissionFlagsBits } = require('discord.js');

const { t } = require('./languages');
const { encodeHidden, decodeHidden } = require('./zw-marker');

const COUNT_MARKER = 'mgcount::v1::';
/** Discord erlaubt 2 Topic-Änderungen pro 10 Minuten – wir bleiben darunter. */
const TOPIC_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
const TOPIC_MAX_LENGTH = 1024;
const RECOVERY_SCAN_LIMIT = 100;
/** Anzahl der Spott-Varianten in `languages.js` (countFail1 … countFailN). */
const FAIL_VARIANTS = 12;
/** Anzahl der „Durchdreh“-Bausteine in `languages.js` (countRageTitle1…/Body1…). */
const RAGE_VARIANTS = 4;
/** Legacy-Konstante; eine Fehlermeldung darf höchstens einmal erwähnen. */
const FREAKOUT_PINGS = 1;
/** Wahrscheinlichkeit, dass der Bot bei einer falschen Zahl „durchdreht“. */
const FREAKOUT_CHANCE = 0.6;
/** Kleine Pause zwischen den Nachrichten des Ausrasters (Rate-Limit-Schutz). */
const FREAKOUT_MESSAGE_DELAY_MS = 400;
/** Kein einzelner Discord-Request darf eine Sprach-Synchronisierung blockieren. */
const DISCORD_OPERATION_TIMEOUT_MS = 8_000;
/** Die Reaktion bleibt theatralisch, aber der Bot spammt niemals den Channel. */
const MAX_RAGE_MESSAGES = 3;

const OK_EMOJI = '✅';
const FAIL_EMOJI = '❌';

/* ------------------------------------------------------------------ *
 * Reine Logik (ohne Discord) – dadurch vollständig testbar
 * ------------------------------------------------------------------ */

/** Erkennt eine reine Zahl. Alles andere (auch „5!“ oder „5 nice“) ist Text. */
function parseCountingNumber(content) {
  const text = String(content ?? '').trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function createCountingState(count = 0, lastUserId = '') {
  return { count: Math.max(0, Number(count) || 0), lastUserId: String(lastUserId || '') };
}

/**
 * Entscheidet, was mit einer Nachricht passiert.
 * → { action: 'accept' | 'delete' | 'reset', reason, state, expected, got }
 */
function evaluateCount(state, { userId, content }) {
  const current = createCountingState(state?.count, state?.lastUserId);
  const id = String(userId);
  const value = parseCountingNumber(content);

  // Kein reiner Zahlenwert → still und leise entfernen.
  if (value === null) {
    return { action: 'delete', reason: 'text', state: current };
  }
  // Zweimal dieselbe Person → nur löschen, kein Neustart.
  if (current.lastUserId && current.lastUserId === id) {
    return { action: 'delete', reason: 'double', state: current };
  }

  const expected = current.count + 1;
  if (value !== expected) {
    return {
      action: 'reset',
      reason: 'wrong',
      expected,
      got: value,
      state: createCountingState(0, ''),
    };
  }
  return { action: 'accept', state: createCountingState(expected, id), expected };
}

/** Wählt einen der abwechslungsreichen Spott-Texte aus. */
function failureText(lang, vars, index = Math.floor(Math.random() * FAIL_VARIANTS)) {
  const variant = ((Number(index) % FAIL_VARIANTS) + FAIL_VARIANTS) % FAIL_VARIANTS;
  return t(`countFail${variant + 1}`, lang, vars);
}

/** Neutrale Fehlermeldung für die aktive Counting-Engine. */
function safeFailureText(lang, vars, index = Math.floor(Math.random() * FAIL_VARIANTS)) {
  const variant = ((Number(index) % FAIL_VARIANTS) + FAIL_VARIANTS) % FAIL_VARIANTS;
  return t('countFailureSafe', lang, { ...vars, variant: variant + 1 });
}

/** Entscheidet zufällig, ob der Bot bei einer falschen Zahl „durchdreht“. */
function shouldFreakout(random = Math.random, chance = FREAKOUT_CHANCE) {
  return Number(random()) < Math.max(0, Math.min(1, Number(chance) || 0));
}

/**
 * Kompatibilitätshelfer für ältere Integrationen. Die Counting-Engine ruft
 * ihn bewusst nicht mehr auf, damit ein Fehler niemals eine Ping-Salve auslöst.
 */
function pingBomb(vars) {
  const mention = String(vars?.user || '').trim();
  return mention ? mention : '';
}

/**
 * Kompatibilitätsalias für ältere Integrationen. Die frühere Ping-Salve wurde
 * absichtlich durch die sichere, begrenzte Show ersetzt.
 */
function buildFreakoutLines(lang, vars) {
  return buildEscalationLines(lang, vars);
}

/**
 * Gibt die sichere Intensitätsstufe anhand des bisherigen Zählstands zurück.
 * Die Stufen machen die Show dramatischer, ändern aber keine Rollen, löschen
 * keine fremden Nachrichten und pingen niemals den ganzen Server.
 */
function rageTierForCount(count) {
  const value = Math.max(0, Number(count) || 0);
  if (value >= 100) return 3;
  if (value >= 50) return 2;
  if (value >= 10) return 1;
  return 0;
}

function rageBar(tier) {
  return ['⚡', '🔥', '🚨', '🌋'][Math.max(0, Math.min(3, Number(tier) || 0))].repeat(
    Math.max(1, Math.min(4, Number(tier) + 1))
  );
}

/**
 * Öffentliche, aber harmlose Ausrast-Show. Es gibt höchstens drei kurze
 * Bot-Nachrichten, eine einzige gezielte Erwähnung und keine Ping-Salve.
 * Der bisherige Stand beeinflusst sichtbar die Stufe und den Umfang der
 * Dramaturgie.
 */
function buildEscalationLines(lang, vars = {}) {
  const streak = Math.max(0, Number(vars.streak ?? vars.expected - 1) || 0);
  const tier = rageTierForCount(streak);
  const values = {
    ...vars,
    streak,
    level: ['I', 'II', 'III', 'IV'][tier],
    bar: rageBar(tier),
  };
  return [
    t('countRageSafeTitle', lang, values),
    t('countRageSafePulse', lang, values),
    t('countRageSafeBody', lang, values),
  ].slice(0, MAX_RAGE_MESSAGES);
}

/* ------------------------------------------------------------------ *
 * Kanal-Thema als Speicher
 * ------------------------------------------------------------------ */

function encodeCountingMarker(count, lang = '', languageChangedAt = 0) {
  const data = { n: Math.max(0, Number(count) || 0) };
  // Die Sprache steckt zusätzlich im dauerhaft sichtbaren Kanal-Thema. Anders
  // als die /set_language-Bestätigung fällt dieser Marker nie aus dem
  // Nachrichten-Scan, wenn im Channel viel geschrieben wurde.
  if (lang) data.l = String(lang);
  if (Number(languageChangedAt) > 0) data.t = Number(languageChangedAt);
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  return encodeHidden(`${COUNT_MARKER}${payload}`);
}

function decodeCountingMarker(text) {
  for (const payload of decodeHidden(text)) {
    if (!payload.startsWith(COUNT_MARKER)) continue;
    try {
      const data = JSON.parse(Buffer.from(payload.slice(COUNT_MARKER.length), 'base64url').toString('utf8'));
      const result = { count: Math.max(0, Number(data?.n) || 0) };
      if (data?.l) result.lang = String(data.l);
      if (Number(data?.t) > 0) result.languageChangedAt = Number(data.t);
      return result;
    } catch {
      return { count: 0 };
    }
  }
  return null;
}

/** Liest den Zählstand aus einem Kanal-Thema (oder null, wenn kein Zähl-Channel). */
function parseCountingTopic(topic) {
  return decodeCountingMarker(String(topic || ''));
}

/** Entfernt die Counting-Zeile aus einem Thema und lässt den Rest unberührt. */
function stripCountingTopic(topic) {
  return String(topic || '')
    .split('\n')
    .filter((line) => !decodeCountingMarker(line))
    .join('\n')
    .trim();
}

/** Baut das neue Thema: sichtbarer Hinweis + unsichtbarer Marker + Rest. */
function buildCountingTopic(topic, count, lang = 'en', languageChangedAt = 0) {
  const rest = stripCountingTopic(topic);
  const label = t('countingTopicLabel', lang, { count: Math.max(0, Number(count) || 0) });
  const head = `${label}${encodeCountingMarker(count, lang, languageChangedAt)}`;
  const full = rest ? `${head}\n${rest}` : head;
  return full.length <= TOPIC_MAX_LENGTH ? full : head;
}

/* ------------------------------------------------------------------ *
 * Discord-Anbindung
 * ------------------------------------------------------------------ */

function createCountingManager(
  ctx,
  {
    random = Math.random,
    freakoutChance = FREAKOUT_CHANCE,
    messageDelayMs = FREAKOUT_MESSAGE_DELAY_MS,
  } = {}
) {
  /** channelId -> { guildId, count, lastUserId, recovered, topicWrittenAt, timer, pending } */
  const channels = new Map();

  function entryFor(channelId) {
    return channels.get(channelId) || null;
  }

  function forget(channelId) {
    const entry = channels.get(channelId);
    if (entry?.timer) clearTimeout(entry.timer);
    channels.delete(channelId);
  }

  function forgetGuild(guildId) {
    for (const [channelId, entry] of channels.entries()) {
      if (entry.guildId === guildId) forget(channelId);
    }
  }

  function canManage(channel) {
    const me = channel.guild?.members?.me;
    if (!me || !channel.permissionsFor) return true;
    return Boolean(channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages));
  }

  /**
   * Discord.js-Requests können bei Netzwerkproblemen oder einem hängenden
   * Mock/Adapter offen bleiben. Für Counting ist das nicht kritisch genug,
   * um eine Interaction oder den gesamten Sprachabgleich festzuhalten.
   */
  function withTimeout(task, timeoutMs = DISCORD_OPERATION_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(`Discord-Request Timeout nach ${timeoutMs} ms`);
        error.code = 'DISCORD_REQUEST_TIMEOUT';
        reject(error);
      }, timeoutMs);
      timer.unref?.();

      Promise.resolve()
        .then(task)
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async function writeTopic(channel, count, lang, languageChangedAt = 0) {
    const topic = buildCountingTopic(channel.topic, count, lang, languageChangedAt);
    try {
      await withTimeout(() => channel.setTopic(topic));
      return true;
    } catch (err) {
      ctx.logger.warn(`[minigames-bot] Kanal-Thema konnte nicht gesetzt werden: ${err.message}`);
      return false;
    }
  }

  /**
   * Das Thema darf nicht bei jeder Zahl neu geschrieben werden (Rate-Limit).
   * Deshalb wird der aktuelle Stand gesammelt und höchstens alle zehn Minuten
   * nachgezogen. Der exakte Stand steckt ohnehin in den Nachrichten selbst.
   */
  function scheduleTopicUpdate(channel, entry, lang, immediate = false, languageChangedAt = 0) {
    entry.lang = lang || entry.lang || 'en';
    entry.languageChangedAt = Math.max(
      Number(entry.languageChangedAt) || 0,
      Number(languageChangedAt) || 0
    );
    entry.pending = {
      count: entry.count,
      lang: entry.lang,
      languageChangedAt: entry.languageChangedAt,
    };
    if (entry.timer) return;

    const since = Date.now() - (entry.topicWrittenAt || 0);
    const delay = immediate ? 0 : Math.max(0, TOPIC_UPDATE_INTERVAL_MS - since);
    const run = async () => {
      entry.timer = null;
      const pending = entry.pending;
      entry.pending = null;
      if (!pending) return;
      entry.topicWrittenAt = Date.now();
      await writeTopic(
        channel,
        pending.count,
        pending.lang,
        pending.languageChangedAt
      );
    };

    if (delay === 0) {
      void run();
      return;
    }
    entry.timer = setTimeout(() => void run(), delay);
    entry.timer.unref?.();
  }

  /**
   * Nach einem Neustart ist der Stand im Thema evtl. veraltet. Der exakte
   * Stand wird aus den letzten Nachrichten rekonstruiert: die jüngste reine
   * Zahl, die der Bot mit ✅ bestätigt hat, ist der aktuelle Zählstand.
   */
  async function recover(channel, fallbackCount) {
    const messages = await channel.messages?.fetch?.({ limit: RECOVERY_SCAN_LIMIT }).catch(() => null);
    if (!messages) return createCountingState(fallbackCount, '');

    const sorted = [...messages.values()].sort(
      (a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0)
    );
    for (const message of sorted) {
      if (message.author?.bot || message.webhookId) continue;
      const value = parseCountingNumber(message.content);
      if (value === null) continue;
      const reaction = message.reactions?.cache?.get?.(OK_EMOJI);
      if (!reaction?.me) continue;
      return createCountingState(value, message.author?.id || '');
    }
    return createCountingState(fallbackCount, '');
  }

  async function ensureEntry(channel) {
    const known = channels.get(channel.id);
    if (known?.recovered) return known;

    const topicState = parseCountingTopic(channel.topic);
    if (!topicState) {
      if (known) forget(channel.id);
      return null;
    }

    const recovered = await recover(channel, topicState.count);
    const entry = known || { guildId: channel.guildId, topicWrittenAt: Date.now(), timer: null, pending: null };
    entry.guildId = channel.guildId;
    entry.count = recovered.count;
    entry.lastUserId = recovered.lastUserId;
    entry.lang = topicState.lang || ctx.store.getServerLang?.(channel.guildId) || 'en';
    entry.languageChangedAt = Number(topicState.languageChangedAt) || 0;
    entry.recovered = true;
    channels.set(channel.id, entry);

    // Nach einem Neustart stellt das Kanal-Thema die Server-Sprache wieder her,
    // selbst wenn die alte Bestätigungsnachricht längst aus den letzten 50
    // Nachrichten verschwunden ist.
    if (topicState.lang) {
      ctx.store.setServerLang?.(
        channel.guildId,
        topicState.lang,
        topicState.languageChangedAt || Date.now()
      );
    }
    return entry;
  }

  /** Aktiviert (oder deaktiviert) einen Zähl-Channel. */
  async function setCountingChannel(channel, lang, enable) {
    if (!enable) {
      forget(channel.id);
      const rest = stripCountingTopic(channel.topic);
      try {
        await withTimeout(() => channel.setTopic(rest || null));
      } catch (err) {
        ctx.logger.warn(`[minigames-bot] Kanal-Thema konnte nicht bereinigt werden: ${err.message}`);
        return { ok: false, error: 'topic' };
      }
      return { ok: true, enabled: false };
    }

    const languageConfig = ctx.store.getServerLanguageConfig?.(channel.guildId);
    const languageChangedAt = Number(languageConfig?.changedAt) || Date.now();
    const ok = await writeTopic(channel, 0, lang, languageChangedAt);
    if (!ok) return { ok: false, error: 'topic' };
    forget(channel.id);
    channels.set(channel.id, {
      guildId: channel.guildId,
      count: 0,
      lastUserId: '',
      lang,
      languageChangedAt,
      recovered: true,
      topicWrittenAt: Date.now(),
      timer: null,
      pending: null,
    });
    return { ok: true, enabled: true, manageMessages: canManage(channel) };
  }

  function isCountingChannel(channel) {
    return Boolean(channel && parseCountingTopic(channel.topic));
  }

  /**
   * Schreibt eine neu gewählte Server-Sprache auch in alle Counting-Themen.
   * Damit ist `/set_language` nicht nur im RAM bzw. in einer alten Nachricht
   * gespeichert, sondern wird nach jedem Prozess-Neustart sicher gefunden.
   */
  async function setGuildLanguage(guild, lang, changedAt = Date.now()) {
    let guildChannels;
    try {
      const fetched = await withTimeout(() => guild.channels.fetch());
      guildChannels = [...(fetched?.values?.() || [])].filter(Boolean);
    } catch (err) {
      ctx.logger.warn(`[minigames-bot] Counting-Kanäle konnten nicht geladen werden: ${err.message}`);
      guildChannels = [...(guild.channels?.cache?.values?.() || [])];
    }

    let updated = 0;
    for (const channel of guildChannels) {
      const topicState = parseCountingTopic(channel?.topic);
      if (!topicState || typeof channel.setTopic !== 'function') continue;

      const entry = channels.get(channel.id) || {
        guildId: guild.id,
        count: topicState.count,
        lastUserId: '',
        recovered: false,
        topicWrittenAt: 0,
        timer: null,
        pending: null,
      };
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.lang = lang;
      entry.languageChangedAt = Number(changedAt) || Date.now();
      entry.pending = null;
      channels.set(channel.id, entry);

      if (await writeTopic(channel, entry.count, lang, entry.languageChangedAt)) {
        entry.topicWrittenAt = Date.now();
        updated += 1;
      } else {
        // Bei einem Discord-Topic-Rate-Limit später automatisch nachziehen.
        scheduleTopicUpdate(channel, entry, lang, false, entry.languageChangedAt);
      }
    }
    return updated;
  }

  /**
   * In einem Counting-Channel gehören alle Reaktionen ausschließlich dem Bot.
   * Das gilt auch dann, wenn jemand exakt dasselbe Emoji (✅/❌) wie der Bot
   * hinzufügt. `reaction.users.remove(id)` entfernt nur die Reaktion dieser
   * Person und lässt die Bot-Reaktion bestehen.
   */
  async function handleReactionAdd(reaction, user) {
    if (!user?.id || user.id === ctx.client.user?.id) return false;

    // Mit Partials funktioniert die Regel auch für Nachrichten, die vor einem
    // Bot-Neustart geschrieben wurden und deshalb nicht mehr im Cache liegen.
    if (reaction?.partial) {
      reaction = await reaction.fetch().catch(() => null);
    }
    if (!reaction) return false;

    let message = reaction.message;
    if (message?.partial) {
      message = await message.fetch().catch(() => null);
    }
    const channel = message?.channel;
    if (!message?.guildId || !channel || !parseCountingTopic(channel.topic)) return false;

    try {
      await reaction.users.remove(user.id);
      return true;
    } catch (err) {
      ctx.logger.warn(
        `[minigames-bot] Fremde Counting-Reaktion von ${user.id} konnte nicht entfernt werden: ${err.message}`
      );
      return false;
    }
  }

  /**
   * Reagiert auf eine falsche Zahl. Kleine Fehler bekommen einen kurzen
   * Spruch. Bei langen Streaks oder einem zufälligen Ausraster zeigt der Bot
   * eine begrenzte, skalierende Showeinlage – ohne Mass-Pings, Rollenaktionen,
   * DMs oder fremde Nachrichten anzufassen.
   */
  async function sendFailureReaction(channel, userId, lang, vars) {
    const mentionOptions = { users: [userId], parse: [] };
    const streak = Math.max(0, Number(vars.streak ?? vars.expected - 1) || 0);
    const forceEscalation = streak >= 10;

    if (!forceEscalation && !shouldFreakout(random, freakoutChance)) {
      const text = safeFailureText(lang, vars, Math.floor(Number(random()) * FAIL_VARIANTS));
      await channel.send({ content: text, allowedMentions: mentionOptions }).catch(() => {});
      return;
    }

    const lines = buildEscalationLines(lang, { ...vars, streak });
    for (const content of lines) {
      await channel.send({ content, allowedMentions: mentionOptions }).catch(() => {});
      if (content !== lines[lines.length - 1]) {
        await new Promise((resolve) => {
          setTimeout(resolve, Math.max(0, Number(messageDelayMs) || 0));
        });
      }
    }
  }

  async function handleMessage(message) {
    // Bots und Webhooks spielen nicht mit.
    if (!message.guildId || message.author?.bot || message.webhookId || message.system) return null;
    const channel = message.channel;
    if (!channel || !parseCountingTopic(channel.topic)) return null;

    return ctx.store.withLock(`count:${channel.id}`, async () => {
      const entry = await ensureEntry(channel);
      if (!entry) return null;

      const languageConfig = ctx.store.getServerLanguageConfig?.(message.guildId);
      const lang = languageConfig?.lang || entry.lang || 'en';
      const languageChangedAt = Number(languageConfig?.changedAt) || entry.languageChangedAt || 0;
      const result = evaluateCount(entry, { userId: message.author.id, content: message.content });

      if (result.action === 'delete') {
        await message.delete().catch(() => {});
        return result;
      }

      if (result.action === 'accept') {
        entry.count = result.state.count;
        entry.lastUserId = result.state.lastUserId;
        await message.react(OK_EMOJI).catch(() => {});
        scheduleTopicUpdate(channel, entry, lang, false, languageChangedAt);
        return result;
      }

      // Falsche Zahl → ❌, Neustart bei 1 und öffentliches Outing.
      entry.count = 0;
      entry.lastUserId = '';
      await message.react(FAIL_EMOJI).catch(() => {});
      const vars = {
        user: `<@${message.author.id}>`,
        expected: result.expected,
        got: result.got,
        // Vor dem Reset ist `expected - 1` der erreichte Stand. Dieser Wert
        // steuert die Intensitätsstufe der sicheren Ausrast-Show.
        streak: Math.max(0, Number(result.expected) - 1),
      };
      await sendFailureReaction(channel, message.author.id, lang, vars);
      scheduleTopicUpdate(channel, entry, lang, true, languageChangedAt);
      return result;
    });
  }

  function shutdown() {
    for (const channelId of [...channels.keys()]) forget(channelId);
  }

  return {
    handleMessage,
    handleReactionAdd,
    setCountingChannel,
    setGuildLanguage,
    isCountingChannel,
    entryFor,
    forget,
    forgetGuild,
    shutdown,
  };
}

module.exports = {
  COUNT_MARKER,
  TOPIC_UPDATE_INTERVAL_MS,
  TOPIC_MAX_LENGTH,
  FAIL_VARIANTS,
  RAGE_VARIANTS,
  FREAKOUT_PINGS,
  FREAKOUT_CHANCE,
  FREAKOUT_MESSAGE_DELAY_MS,
  DISCORD_OPERATION_TIMEOUT_MS,
  MAX_RAGE_MESSAGES,
  OK_EMOJI,
  FAIL_EMOJI,
  parseCountingNumber,
  createCountingState,
  evaluateCount,
  failureText,
  safeFailureText,
  shouldFreakout,
  pingBomb,
  buildFreakoutLines,
  rageTierForCount,
  rageBar,
  buildEscalationLines,
  parseCountingTopic,
  stripCountingTopic,
  buildCountingTopic,
  encodeCountingMarker,
  decodeCountingMarker,
  createCountingManager,
};
