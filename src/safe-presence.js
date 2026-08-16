/**
 * ============================================================================
 *  Sichere Presence-Aktualisierung für alle Bots
 *
 *  Hintergrund (Produktionsfehler):
 *    ClientUser#setPresence() liefert in discord.js v14 SYNCHRON ein
 *    ClientPresence-Objekt zurück – kein Promise. Der Aufruf
 *      client.user.setPresence({...}).catch(() => {})
 *    wirft deshalb sofort:
 *      TypeError: client.user?.setPresence(...).catch is not a function
 *    Passiert das im ClientReady-Handler, bricht der komplette Ready-Ablauf ab,
 *    bevor die Slash-Commands registriert werden.
 *
 *  Diese Hilfsfunktion:
 *    - unterstützt synchrone Rückgabewerte ohne .catch(),
 *    - isoliert synchron geworfene Fehler und loggt sie sicher,
 *    - behandelt optional Promise-Rückgabewerte bzw. Rejections,
 *    - loggt niemals Tokens oder andere Secrets.
 * ============================================================================
 */

// Discord-Bot-Tokens und typische Secret-Formate werden vor dem Logging
// unkenntlich gemacht – ein Presence-Fehler darf nie ein Secret ausgeben.
const SECRET_PATTERNS = [
  /\b(?:mfa\.[\w-]{20,})/gi, // MFA-Tokens
  /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g, // Bot-Token
  /\bBot\s+[A-Za-z0-9_.-]{20,}/gi, // Authorization-Header
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-Keys
];

function redactSecrets(text) {
  let out = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

function describeError(err) {
  if (err instanceof Error) return redactSecrets(err.message || err.name || 'Unbekannter Fehler');
  if (err && typeof err === 'object') {
    const message = err.message || err.code || err.status;
    if (message !== undefined) return redactSecrets(message);
    try {
      return redactSecrets(JSON.stringify(err));
    } catch {
      return 'Unbekannter Fehler';
    }
  }
  return redactSecrets(err === undefined ? 'Unbekannter Fehler' : err);
}

function reportPresenceFailure(logger, label, err) {
  const line = `[${label}] Presence-Update fehlgeschlagen (ignoriert): ${describeError(err)}`;
  try {
    if (logger && typeof logger.warn === 'function') logger.warn(line);
    else if (logger && typeof logger.error === 'function') logger.error(line);
  } catch {
    // Auch ein kaputter Logger darf den Ready-Ablauf nicht abbrechen.
  }
}

/**
 * Setzt die Presence, ohne dass ein Fehler den Aufrufer stoppen kann.
 *
 * @param {object} client        discord.js Client (oder kompatibles Objekt)
 * @param {object} presence      PresenceData für setPresence()
 * @param {object} [options]
 * @param {object} [options.logger] Logger mit warn()/error()
 * @param {string} [options.label]  Log-Präfix, z. B. 'security-bot'
 * @returns {boolean} true, wenn setPresence() synchron ohne Fehler durchlief
 */
function safeSetPresence(client, presence, { logger, label = 'bot' } = {}) {
  const user = client && client.user;
  if (!user || typeof user.setPresence !== 'function') return false;

  let result;
  try {
    result = user.setPresence(presence);
  } catch (err) {
    reportPresenceFailure(logger, label, err);
    return false;
  }

  // discord.js v14 gibt ein ClientPresence-Objekt zurück (kein Promise).
  // Ältere/andere Implementierungen liefern ein Promise – beides ist ok.
  if (result && typeof result.then === 'function') {
    try {
      const handled = result.then(undefined, (err) => reportPresenceFailure(logger, label, err));
      if (handled && typeof handled.catch === 'function') handled.catch(() => {});
    } catch (err) {
      reportPresenceFailure(logger, label, err);
    }
  }

  return true;
}

/**
 * Erzeugt eine gebundene updatePresence-Funktion, die niemals wirft.
 *
 * @param {object} params
 * @param {object} params.client
 * @param {object} [params.logger]
 * @param {string} [params.label]
 * @param {Function} params.build  Liefert die PresenceData (darf werfen)
 * @returns {() => boolean}
 */
function createPresenceUpdater({ client, logger, label = 'bot', build }) {
  return () => {
    let presence;
    try {
      presence = typeof build === 'function' ? build() : build;
    } catch (err) {
      reportPresenceFailure(logger, label, err);
      return false;
    }
    return safeSetPresence(client, presence, { logger, label });
  };
}

module.exports = { safeSetPresence, createPresenceUpdater, redactSecrets };
