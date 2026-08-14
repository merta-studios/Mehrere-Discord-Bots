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
 * - Richtige Zahl → ✅, falsche Zahl → ❌, Neustart bei 1 und die Person
 *   wird (mit wechselnden Sprüchen) geoutet.
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
const FAIL_VARIANTS = 6;

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

/* ------------------------------------------------------------------ *
 * Kanal-Thema als Speicher
 * ------------------------------------------------------------------ */

function encodeCountingMarker(count) {
  const payload = Buffer.from(JSON.stringify({ n: Math.max(0, Number(count) || 0) }), 'utf8').toString(
    'base64url'
  );
  return encodeHidden(`${COUNT_MARKER}${payload}`);
}

function decodeCountingMarker(text) {
  for (const payload of decodeHidden(text)) {
    if (!payload.startsWith(COUNT_MARKER)) continue;
    try {
      const data = JSON.parse(Buffer.from(payload.slice(COUNT_MARKER.length), 'base64url').toString('utf8'));
      return { count: Math.max(0, Number(data?.n) || 0) };
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
function buildCountingTopic(topic, count, lang = 'en') {
  const rest = stripCountingTopic(topic);
  const label = t('countingTopicLabel', lang, { count: Math.max(0, Number(count) || 0) });
  const head = `${label}${encodeCountingMarker(count)}`;
  const full = rest ? `${head}\n${rest}` : head;
  return full.length <= TOPIC_MAX_LENGTH ? full : head;
}

/* ------------------------------------------------------------------ *
 * Discord-Anbindung
 * ------------------------------------------------------------------ */

function createCountingManager(ctx) {
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

  async function writeTopic(channel, count, lang) {
    const topic = buildCountingTopic(channel.topic, count, lang);
    try {
      await channel.setTopic(topic);
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
  function scheduleTopicUpdate(channel, entry, lang, immediate = false) {
    entry.pending = { count: entry.count, lang };
    if (entry.timer) return;

    const since = Date.now() - (entry.topicWrittenAt || 0);
    const delay = immediate ? 0 : Math.max(0, TOPIC_UPDATE_INTERVAL_MS - since);
    const run = async () => {
      entry.timer = null;
      const pending = entry.pending;
      entry.pending = null;
      if (!pending) return;
      entry.topicWrittenAt = Date.now();
      await writeTopic(channel, pending.count, pending.lang);
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
    entry.recovered = true;
    channels.set(channel.id, entry);
    return entry;
  }

  /** Aktiviert (oder deaktiviert) einen Zähl-Channel. */
  async function setCountingChannel(channel, lang, enable) {
    if (!enable) {
      forget(channel.id);
      const rest = stripCountingTopic(channel.topic);
      try {
        await channel.setTopic(rest || null);
      } catch (err) {
        ctx.logger.warn(`[minigames-bot] Kanal-Thema konnte nicht bereinigt werden: ${err.message}`);
        return { ok: false, error: 'topic' };
      }
      return { ok: true, enabled: false };
    }

    const ok = await writeTopic(channel, 0, lang);
    if (!ok) return { ok: false, error: 'topic' };
    forget(channel.id);
    channels.set(channel.id, {
      guildId: channel.guildId,
      count: 0,
      lastUserId: '',
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

  async function handleMessage(message) {
    // Bots und Webhooks spielen nicht mit.
    if (!message.guildId || message.author?.bot || message.webhookId || message.system) return null;
    const channel = message.channel;
    if (!channel || !parseCountingTopic(channel.topic)) return null;

    return ctx.store.withLock(`count:${channel.id}`, async () => {
      const entry = await ensureEntry(channel);
      if (!entry) return null;

      const lang = ctx.store.getServerLang(message.guildId) || 'en';
      const result = evaluateCount(entry, { userId: message.author.id, content: message.content });

      if (result.action === 'delete') {
        await message.delete().catch(() => {});
        return result;
      }

      if (result.action === 'accept') {
        entry.count = result.state.count;
        entry.lastUserId = result.state.lastUserId;
        await message.react(OK_EMOJI).catch(() => {});
        scheduleTopicUpdate(channel, entry, lang);
        return result;
      }

      // Falsche Zahl → ❌, Neustart bei 1 und öffentliches Outing.
      entry.count = 0;
      entry.lastUserId = '';
      await message.react(FAIL_EMOJI).catch(() => {});
      const text = failureText(lang, {
        user: `<@${message.author.id}>`,
        expected: result.expected,
        got: result.got,
      });
      await channel
        .send({ content: text, allowedMentions: { users: [message.author.id], parse: [] } })
        .catch(() => {});
      scheduleTopicUpdate(channel, entry, lang, true);
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
  OK_EMOJI,
  FAIL_EMOJI,
  parseCountingNumber,
  createCountingState,
  evaluateCount,
  failureText,
  parseCountingTopic,
  stripCountingTopic,
  buildCountingTopic,
  encodeCountingMarker,
  decodeCountingMarker,
  createCountingManager,
};
