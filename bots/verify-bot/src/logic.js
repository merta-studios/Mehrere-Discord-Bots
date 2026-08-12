/**
 * Reine Logik-Helfer des Verify-Bots – komplett ohne Discord-Objekte,
 * damit alles einzeln testbar bleibt.
 *
 * Hier wohnen:
 * - Konstanten (Limits, Modi)
 * - Kodierung/Dekodierung der Konfiguration für den unsichtbaren
 *   Zero-Width-Marker (das ist unsere „Datenbank“ – siehe zw-marker.js)
 * - Custom-ID-Bau & -Parsing für alle Buttons/Modals/Menüs
 */

// ---------------------------------------------------------------------------
// Modi
// ---------------------------------------------------------------------------
const MODE_VERIFY = 'verify';
const MODE_CLASSIC = 'classic';

/** Gültige Sprachcodes (identisch zu den anderen Bots). */
const VALID_LANGS = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];

function normalizeLangCode(code) {
  return VALID_LANGS.includes(String(code).toLowerCase()) ? String(code).toLowerCase() : 'en';
}

// Überprüfungs-Modi (wie /set_verify_form sie kennt)
const VF_NONE = 'none';
const VF_SIMPLE = 'simple';
const VF_FORM = 'form';

// Formular-Feld-Typen (Discord-Text-Input-Styles)
const FIELD_SHORT = 'short';
const FIELD_LONG = 'long';

// ---------------------------------------------------------------------------
// Limits (mit Discord-Sicherheitsabstand)
// ---------------------------------------------------------------------------
const MAX_RULES_LEN = 3500; // Regeln dürfen groß sein, bleiben aber unter 4000
const MAX_BUTTON_LEN = 80; // Discord-Button-Label
const MAX_QUESTION_LEN = 45; // TextInput-Label-Limit
const MAX_PLACEHOLDER_LEN = 100;
const MAX_VALUE_LEN = 900; // TextInput-Wert-Limit (Paragraph) – etwas Puffer
const MAX_FIELDS = 5; // Discord-Modal erlaubt max. 5 ActionRows
const MAX_RULES_MESSAGES = 10; // Registrierungs-Limit pro Server (Defensive)

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------
const CONFIG_MARKER = 'vrf::v1::';
const REQUEST_MARKER = 'vreq::v1::';

// ---------------------------------------------------------------------------
// Hex-Kodierung (separator-sicher, nur [0-9a-f])
// ---------------------------------------------------------------------------
function encodeText(text) {
  return Buffer.from(String(text ?? ''), 'utf8').toString('hex');
}

function decodeText(hex) {
  try {
    if (!/^[0-9a-f]*$/i.test(String(hex))) return null;
    return Buffer.from(String(hex), 'hex').toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Konfiguration ⇄ Marker-Nutzlast
// ---------------------------------------------------------------------------

/**
 * Baut die Marker-Nutzlast (reines ASCII) für eine Regeln-Nachricht.
 *
 * Die Regeln selbst stehen SICHTBAR in der Nachricht und werden von dort
 * gelesen. Nur das, was sonst nicht rekonstruierbar wäre, landet im Marker:
 * Modus, Sprache, Button-Name, Log-Kanal, Rollen, Prüf-Modus, Formularfelder
 * sowie Banner-/Bild-URL.
 */
function encodeConfigPayload(config = {}) {
  const json = JSON.stringify({
    v: 1,
    mode: config.mode === MODE_CLASSIC ? MODE_CLASSIC : MODE_VERIFY,
    lang: normalizeLangCode(config.lang),
    buttonName: String(config.buttonName ?? '').slice(0, MAX_BUTTON_LEN),
    loggingChannelId: String(config.loggingChannelId ?? ''),
    unverifiedRoleId: String(config.unverifiedRoleId ?? ''),
    verifiedRoleId: String(config.verifiedRoleId ?? ''),
    verifyForm: [VF_NONE, VF_SIMPLE, VF_FORM].includes(config.verifyForm) ? config.verifyForm : VF_NONE,
    formFields: Array.isArray(config.formFields)
      ? config.formFields
          .slice(0, MAX_FIELDS)
          .map((f) => ({
            id: String(f.id ?? '').slice(0, 32) || randId(),
            question: String(f.question ?? '').slice(0, MAX_QUESTION_LEN),
            placeholder: String(f.placeholder ?? '').slice(0, MAX_PLACEHOLDER_LEN),
            value: String(f.value ?? '').slice(0, MAX_VALUE_LEN),
            style: f.style === FIELD_LONG ? FIELD_LONG : FIELD_SHORT,
            required: Boolean(f.required),
          }))
      : [],
    bannerUrl: String(config.bannerUrl ?? '').slice(0, 500),
    imageUrl: String(config.imageUrl ?? '').slice(0, 500),
  });
  return `${CONFIG_MARKER}${encodeText(json)}`;
}

/** Liest die Konfiguration aus einer (evtl. zerstückelten) Marker-Nutzlast. */
function decodeConfigPayload(payload) {
  const text = String(payload ?? '');
  const idx = text.indexOf(CONFIG_MARKER);
  if (idx === -1) return null;
  const hex = text.slice(idx + CONFIG_MARKER.length);
  const m = hex.match(/^[0-9a-f]+/i);
  if (!m) return null;
  const json = decodeText(m[0]);
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    return {
      mode: data.mode === MODE_CLASSIC ? MODE_CLASSIC : MODE_VERIFY,
      lang: normalizeLangCode(data.lang),
      buttonName: String(data.buttonName ?? ''),
      loggingChannelId: String(data.loggingChannelId ?? ''),
      unverifiedRoleId: String(data.unverifiedRoleId ?? ''),
      verifiedRoleId: String(data.verifiedRoleId ?? ''),
      verifyForm: [VF_NONE, VF_SIMPLE, VF_FORM].includes(data.verifyForm) ? data.verifyForm : VF_NONE,
      formFields: (Array.isArray(data.formFields) ? data.formFields : []).slice(0, MAX_FIELDS).map((f) => ({
        id: String(f.id ?? randId()),
        question: String(f.question ?? ''),
        placeholder: String(f.placeholder ?? ''),
        value: String(f.value ?? ''),
        style: f.style === FIELD_LONG ? FIELD_LONG : FIELD_SHORT,
        required: Boolean(f.required),
      })),
      bannerUrl: String(data.bannerUrl ?? ''),
      imageUrl: String(data.imageUrl ?? ''),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verifizierungs-Anfrage ⇄ Marker-Nutzlast (in der Log-Kanal-Nachricht)
// ---------------------------------------------------------------------------
function encodeRequestPayload(req = {}) {
  const json = JSON.stringify({
    v: 1,
    userId: String(req.userId ?? ''),
    guildId: String(req.guildId ?? ''),
    rulesMessageId: String(req.rulesMessageId ?? ''),
    rulesChannelId: String(req.rulesChannelId ?? ''),
    loggingChannelId: String(req.loggingChannelId ?? ''),
    verifiedRoleId: String(req.verifiedRoleId ?? ''),
    unverifiedRoleId: String(req.unverifiedRoleId ?? ''),
    lang: String(req.lang ?? 'en'),
    requestedAt: Number(req.requestedAt) || Date.now(),
    status: 'open',
  });
  return `${REQUEST_MARKER}${encodeText(json)}`;
}

function decodeRequestPayload(payload) {
  const text = String(payload ?? '');
  const idx = text.indexOf(REQUEST_MARKER);
  if (idx === -1) return null;
  const hex = text.slice(idx + REQUEST_MARKER.length);
  const m = hex.match(/^[0-9a-f]+/i);
  if (!m) return null;
  const json = decodeText(m[0]);
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    if (!data.userId) return null;
    return {
      userId: String(data.userId),
      guildId: String(data.guildId ?? ''),
      rulesMessageId: String(data.rulesMessageId ?? ''),
      rulesChannelId: String(data.rulesChannelId ?? ''),
      loggingChannelId: String(data.loggingChannelId ?? ''),
      verifiedRoleId: String(data.verifiedRoleId ?? ''),
      unverifiedRoleId: String(data.unverifiedRoleId ?? ''),
      lang: String(data.lang ?? 'en'),
      requestedAt: Number(data.requestedAt) || Date.now(),
      status: String(data.status ?? 'open'),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Custom-IDs
// ---------------------------------------------------------------------------
const CID = {
  // Öffentlicher Verifizier-Button. Der Bot liest die Konfiguration direkt
  // aus interaction.message – deshalb reicht eine konstante ID.
  verify: 'vrf_verify',
  // Log-Kanal: Annehmen / Ablehnen (Kontext kommt aus interaction.message).
  approve: 'vrf_approve',
  reject: 'vrf_reject',
  // Editor
  editor: (action, sessionId) => `vrf_ed_${action}_${sessionId}`,
  // Formular-Editor
  fieldEditor: (action, sessionId) => `vrf_fe_${action}_${sessionId}`,
  fieldRemoveSelect: (sessionId) => `vrf_ferm_${sessionId}`,
  // Modals
  createModal: (kind, channelId) => `vrf_createmodal_${kind}_${channelId}`,
  textModal: (sessionId) => `vrf_textmodal_${sessionId}`,
  buttonModal: (sessionId) => `vrf_buttonmodal_${sessionId}`,
  rejectModal: (channelId, messageId) => `vrf_rejectmodal_${channelId}_${messageId}`,
  verifyFormModal: (channelId, messageId) => `vrf_formmodal_${channelId}_${messageId}`,
  fieldModal: (sessionId) => `vrf_fieldmodal_${sessionId}`,
};

function parseCustomId(customId) {
  const id = String(customId ?? '');

  if (id === CID.verify) return { kind: 'verify' };
  if (id === CID.approve) return { kind: 'approve' };
  if (id === CID.reject) return { kind: 'reject' };

  let m = id.match(/^vrf_ed_([a-z_]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'editor', action: m[1], sessionId: m[2] };

  m = id.match(/^vrf_fe_([a-z_]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'fieldEditor', action: m[1], sessionId: m[2] };

  m = id.match(/^vrf_ferm_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'fieldRemoveSelect', sessionId: m[1] };

  m = id.match(/^vrf_createmodal_([a-z]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'createModal', modalKind: m[1], channelId: m[2] };

  m = id.match(/^vrf_textmodal_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'textModal', sessionId: m[1] };

  m = id.match(/^vrf_buttonmodal_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'buttonModal', sessionId: m[1] };

  m = id.match(/^vrf_rejectmodal_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'rejectModal', channelId: m[1], messageId: m[2] };

  m = id.match(/^vrf_formmodal_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'verifyFormModal', channelId: m[1], messageId: m[2] };

  m = id.match(/^vrf_fieldmodal_([A-Za-z0-9]+)$/);
  if (m) return { kind: 'fieldModal', sessionId: m[1] };

  return null;
}

/** Kurze, kollisionsarme ID (nur [A-Za-z0-9]). */
function randId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rand}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
}

function newSessionId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rand}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
}

/** Regeln säubern: Rand trimmen, Länge begrenzen (Markdown/Umbrüche bleiben). */
function sanitizeRules(raw, maxLen = MAX_RULES_LEN) {
  return String(raw ?? '').replace(/\r\n/g, '\n').trim().slice(0, maxLen);
}

/** Button-Name säubern: einzeilig, gekürzt. */
function sanitizeButtonName(raw, maxLen = MAX_BUTTON_LEN) {
  return String(raw ?? '')
    .replace(/[\r\n\u2028\u2029\v\f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Normalisiert einen Feld-Stil. */
function normalizeFieldStyle(style) {
  return style === FIELD_LONG ? FIELD_LONG : FIELD_SHORT;
}

module.exports = {
  MODE_VERIFY,
  MODE_CLASSIC,
  VF_NONE,
  VF_SIMPLE,
  VF_FORM,
  FIELD_SHORT,
  FIELD_LONG,
  MAX_RULES_LEN,
  MAX_BUTTON_LEN,
  MAX_QUESTION_LEN,
  MAX_PLACEHOLDER_LEN,
  MAX_VALUE_LEN,
  MAX_FIELDS,
  MAX_RULES_MESSAGES,
  CONFIG_MARKER,
  REQUEST_MARKER,
  encodeText,
  decodeText,
  encodeConfigPayload,
  decodeConfigPayload,
  encodeRequestPayload,
  decodeRequestPayload,
  CID,
  parseCustomId,
  randId,
  newSessionId,
  sanitizeRules,
  sanitizeButtonName,
  normalizeFieldStyle,
};
