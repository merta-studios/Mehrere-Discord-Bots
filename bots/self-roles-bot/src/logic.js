/**
 * Reine Logik-Helfer des Self-Roles-Bots – komplett ohne Discord-Objekte,
 * damit alles einzeln testbar bleibt.
 *
 * Hier wohnen:
 * - Konstanten (min./max. Rollen, max. Nachrichten)
 * - Text-Säuberung (Beschreibung IMMER einzeilig!)
 * - Kodierung/Dekodierung der Konfiguration für den unsichtbaren
 *   Zero-Width-Marker (das ist unsere „Datenbank“ – siehe zw-marker.js)
 * - Custom-ID-Bau & -Parsing für alle Buttons
 */

const MIN_ROLES = 2;
const MAX_ROLES = 20;
const MAX_MESSAGES = 10;

/** Discord-Limits (mit etwas Sicherheitsabstand). */
const MAX_TITLE_LEN = 100;
const MAX_DESC_LEN = 900;
const MAX_LABEL_LEN = 60; // Platzhaltertext (Button-Label = Label + " (123)")
const MAX_ROLE_NAME_LEN = 90; // Discord erlaubt 100

/** Marker-Präfixe (reines ASCII – siehe zw-marker.js). */
const CONFIG_MARKER = 'srl::v1::';
const ROLE_MARKER = 'srl-e:';
const LOGGING_MARKER = 'srllog::v1::';

/** Auswahl-Modi. */
const MODE_SINGLE = 'single';
const MODE_MULTI = 'multi';

/**
 * Macht aus beliebigem Nutzertext eine EINZEILIGE Beschreibung:
 * Zeilenumbrüche (auch \r\n, Unicode-Zeilentrenner) werden zu Leerzeichen,
 * Mehrfach-Leerzeichen zusammengefasst, Rand getrimmt.
 */
function flattenDescription(raw, maxLen = MAX_DESC_LEN) {
  const text = String(raw ?? '')
    .replace(/[\r\n\u2028\u2029\v\f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLen);
}

/** Titel säubern: ebenfalls einzeilig, gekürzt. */
function sanitizeTitle(raw, maxLen = MAX_TITLE_LEN) {
  return flattenDescription(raw, maxLen);
}

/** Platzhaltertext (Button-Beschriftung) säubern. */
function sanitizeLabel(raw, maxLen = MAX_LABEL_LEN) {
  return flattenDescription(raw, maxLen);
}

/**
 * Rollennamen säubern: Discord verbietet @everyone/@here-Tricks und mag
 * keine Zeilenumbrüche. Leerer Name → null (Aufrufer meldet den Fehler).
 */
function sanitizeRoleName(raw, maxLen = MAX_ROLE_NAME_LEN) {
  const name = flattenDescription(raw, maxLen).replace(/@(everyone|here)/gi, '$1');
  return name || null;
}

/** Normalisiert einen Modus-String auf 'single' | 'multi'. */
function normalizeMode(mode) {
  return mode === MODE_SINGLE ? MODE_SINGLE : MODE_MULTI;
}

/** Vergleichsschlüssel für Platzhalter-Duplikate (case-insensitive). */
function labelKey(label) {
  return String(label ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Hex-Kodierung (separator-sicher, nur [0-9a-f])
// ---------------------------------------------------------------------------

function encodeText(text) {
  return Buffer.from(String(text ?? ''), 'utf8').toString('hex');
}

function decodeText(hex) {
  try {
    if (!/^[0-9a-f]*$/i.test(String(hex))) return null;
    const s = Buffer.from(String(hex), 'hex').toString('utf8');
    return s || '';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Konfiguration ⇄ Marker-Nutzlast
// ---------------------------------------------------------------------------

/**
 * Baut die Marker-Nutzlast (reines ASCII) für eine Self-Roles-Nachricht.
 *
 * Bewusst WINZIG: `srl::v1::<lang>:<mode>` – mehr braucht es nicht!
 * Titel, Beschreibung, Rollen-IDs und Platzhalter stehen ohnehin sichtbar
 * in der Nachricht (Header + Liste + Buttons) und werden von dort gelesen.
 * Nur Sprache und Auswahl-Modus wären sonst nicht rekonstruierbar.
 *
 * Warum das wichtig ist: Ein TextDisplay darf max. 4000 Zeichen haben. Ein
 * Marker, der Titel + Beschreibung + 20 Rollen doppelt (hex-kodiert, 2
 * unsichtbare Zeichen pro Byte), würde dieses Limit sprengen.
 */
function encodeConfigPayload({ lang = 'en', mode = MODE_MULTI } = {}) {
  const safeLang = /^[a-z]{2,5}$/i.test(String(lang)) ? String(lang).toLowerCase() : 'en';
  return `${CONFIG_MARKER}${safeLang}:${normalizeMode(mode)}`;
}

/**
 * Liest Sprache & Modus aus einer (evtl. zerstückelten) Marker-Nutzlast.
 * Gibt null zurück, wenn kein gültiger Marker gefunden wurde.
 *
 * Versteht zusätzlich das alte, ausführliche Format
 * (`srl::v1::<lang>:<mode>:<titleHex>:<descHex>` + `srl-e:`-Einträge),
 * damit ältere Nachrichten weiter funktionieren.
 */
function decodeConfigPayload(payload) {
  const text = String(payload ?? '');

  // Altes Format zuerst versuchen (bringt Titel/Beschreibung/Rollen mit).
  const legacy = text.match(
    new RegExp(`${CONFIG_MARKER}([a-z]{2,5}):(single|multi):([0-9a-f]*):([0-9a-f]*)`, 'i')
  );
  if (legacy) {
    const roles = [];
    const seen = new Set();
    const re = new RegExp(`${ROLE_MARKER}([A-Za-z0-9]{1,32}):([0-9a-f]*)`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      roles.push({ roleId: m[1], label: decodeText(m[2]) ?? '' });
    }
    return {
      lang: legacy[1].toLowerCase(),
      mode: normalizeMode(legacy[2].toLowerCase()),
      title: decodeText(legacy[3]) ?? '',
      description: decodeText(legacy[4]) ?? '',
      roles,
      legacy: true,
    };
  }

  const head = text.match(new RegExp(`${CONFIG_MARKER}([a-z]{2,5}):(single|multi)`, 'i'));
  if (!head) return null;

  return {
    lang: head[1].toLowerCase(),
    mode: normalizeMode(head[2].toLowerCase()),
    title: null, // kommt aus dem sichtbaren Header
    description: null,
    roles: [], // kommen aus der sichtbaren Liste / den Buttons
    legacy: false,
  };
}

/**
 * Baut eine Listenzeile der finalen Nachricht:
 *   „Platzhalter (Anzahl) - <@&Rollen-ID>“
 */
function roleLine(label, count, roleId, lang = 'en') {
  return `${label} (${formatCount(count, lang)}) - <@&${roleId}>`;
}

/**
 * Liest eine Listenzeile wieder aus. Der Platzhalter darf selbst Klammern
 * enthalten – deshalb wird von HINTEN geparst (gieriges `.*`).
 * Rückgabe: { label, count, roleId } oder null.
 */
function parseRoleLine(line) {
  const m = String(line ?? '').match(/^(.*)\s\(([\d.,\s\u00A0\u202F']+)\)\s-\s<@&([A-Za-z0-9]+)>\s*$/);
  if (!m) return null;
  const label = m[1].trim();
  const count = Number(String(m[2]).replace(/[^\d]/g, '')) || 0;
  if (!label) return null;
  return { label, count, roleId: m[3] };
}

// ---------------------------------------------------------------------------
// Custom-IDs
// ---------------------------------------------------------------------------

const CID = {
  /** Rollen-Button unter der öffentlichen Nachricht. */
  role: (roleId) => `srl_role_${roleId}`,
  /** „Rolle wieder abgeben“ in der ephemeren Antwort. */
  drop: (roleId, channelId, messageId) => `srl_drop_${roleId}_${channelId}_${messageId}`,
  /** Editor-Buttons (sessionId hält alte Editoren erkennbar). */
  editor: (action, sessionId) => `srl_ed_${action}_${sessionId}`,
  /** Auswahlmenüs. */
  removeSelect: (sessionId) => `srl_rm_${sessionId}`,
  pickMessage: 'srl_pick_message',
  /** Modals. */
  textModal: (sessionId) => `srl_textmodal_${sessionId}`,
  roleModal: (sessionId) => `srl_rolemodal_${sessionId}`,
  createModal: (channelId) => `srl_createmodal_${channelId}`,
};

function parseCustomId(customId) {
  const id = String(customId ?? '');

  let m = id.match(/^srl_role_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'role', roleId: m[1] };

  m = id.match(/^srl_drop_([A-Za-z0-9]+)_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'drop', roleId: m[1], channelId: m[2], messageId: m[3] };

  m = id.match(/^srl_ed_([a-z_]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'editor', action: m[1], sessionId: m[2] };

  m = id.match(/^srl_rm_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'removeSelect', sessionId: m[1] };

  m = id.match(/^srl_textmodal_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'textModal', sessionId: m[1] };

  m = id.match(/^srl_rolemodal_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'roleModal', sessionId: m[1] };

  m = id.match(/^srl_createmodal_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'createModal', channelId: m[1] };

  if (id === CID.pickMessage) return { kind: 'pickMessage' };

  return null;
}

/** Kurze, kollisionsarme Session-ID (nur [A-Za-z0-9]). */
function newSessionId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rand}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
}

/** Zahl hübsch formatieren (1234 → 1.234 je nach Sprache). */
function formatCount(count, lang = 'en') {
  const locale = { de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', it: 'it-IT' }[lang] || 'en-US';
  const n = Number.isFinite(Number(count)) ? Number(count) : 0;
  try {
    return n.toLocaleString(locale);
  } catch {
    return String(n);
  }
}

/** Button-Label: „Platzhalter (12)“ – hart auf 80 Zeichen begrenzt. */
function buttonLabel(label, count, lang = 'en') {
  const suffix = ` (${formatCount(count, lang)})`;
  const room = Math.max(1, 80 - suffix.length);
  const base = String(label ?? '').slice(0, room);
  return `${base}${suffix}`;
}

/**
 * Baut die Marker-Nutzlast für die Rollen-Logging-Einstellung.
 * Format: srllog::v1::<enabled>:<lang>
 * enabled: 1 (true) oder 0 (false)
 */
function encodeLoggingPayload({ enabled = true, lang = 'de' } = {}) {
  const isEnabled = enabled !== false && enabled !== 'false' && enabled !== 0 && enabled !== '0';
  const safeLang = /^[a-z]{2,5}$/i.test(String(lang)) ? String(lang).toLowerCase() : 'de';
  return `${LOGGING_MARKER}${isEnabled ? '1' : '0'}:${safeLang}`;
}

/**
 * Liest die Rollen-Logging-Einstellung aus einer Marker-Nutzlast.
 * Gibt { enabled: boolean, lang: string } oder null zurück.
 */
function decodeLoggingPayload(payload) {
  const text = String(payload ?? '');
  const m = text.match(new RegExp(`${LOGGING_MARKER}(1|0|true|false):([a-z]{2,5})`, 'i'));
  if (!m) return null;
  const enabled = m[1] === '1' || m[1].toLowerCase() === 'true';
  const lang = m[2].toLowerCase();
  return { enabled, lang };
}

/** Prüft, ob eine Draft-Konfiguration veröffentlicht werden darf. */
function validateDraft(draft) {
  const roles = Array.isArray(draft?.roles) ? draft.roles : [];
  if (roles.length < MIN_ROLES) return { ok: false, reason: 'min' };
  if (roles.length > MAX_ROLES) return { ok: false, reason: 'max' };
  return { ok: true };
}

module.exports = {
  MIN_ROLES,
  MAX_ROLES,
  MAX_MESSAGES,
  MAX_TITLE_LEN,
  MAX_DESC_LEN,
  MAX_LABEL_LEN,
  MAX_ROLE_NAME_LEN,
  CONFIG_MARKER,
  ROLE_MARKER,
  LOGGING_MARKER,
  MODE_SINGLE,
  MODE_MULTI,
  flattenDescription,
  sanitizeTitle,
  sanitizeLabel,
  sanitizeRoleName,
  normalizeMode,
  labelKey,
  encodeText,
  decodeText,
  encodeConfigPayload,
  decodeConfigPayload,
  encodeLoggingPayload,
  decodeLoggingPayload,
  roleLine,
  parseRoleLine,
  CID,
  parseCustomId,
  newSessionId,
  formatCount,
  buttonLabel,
  validateDraft,
};
