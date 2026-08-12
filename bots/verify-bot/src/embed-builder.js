/**
 * Baut alle Container (Components V2), Modals und Menüs des Verify-Bots –
 * und liest die Konfiguration aus einer bestehenden Nachricht wieder aus.
 * Das ist die „Datenbank“: Modus, Rollen, Log-Kanal, Prüf-Modus, Formularfelder
 * und Bild-/Banner-URL stecken als unsichtbarer Zero-Width-Blob IN der
 * Nachricht. Die Regeln selbst stehen sichtbar darin.
 *
 * Layout der finalen Nachricht (Verify-Modus):
 *
 *   [Banner – optional, MediaGallery]
 *   Regeln … (mit optionalem Bild oben rechts als Thumbnail)
 *   ───────────────────────────────
 *   [ ✅ Button-Name ]   ← grün
 *
 * Klassischer Modus: wie oben, nur ohne Button.
 */

const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const { t } = require('./languages');
const {
  MODE_VERIFY,
  MODE_CLASSIC,
  VF_SIMPLE,
  VF_FORM,
  FIELD_LONG,
  MAX_RULES_LEN,
  MAX_BUTTON_LEN,
  MAX_QUESTION_LEN,
  MAX_PLACEHOLDER_LEN,
  MAX_VALUE_LEN,
  MAX_FIELDS,
  CONFIG_MARKER,
  REQUEST_MARKER,
  CID,
  encodeConfigPayload,
  decodeConfigPayload,
  encodeRequestPayload,
  decodeRequestPayload,
  normalizeFieldStyle,
} = require('./logic');
const { encodeHidden, decodeHidden } = require('./zw-marker');

// ---------------------------------------------------------------------------
// Text-Extraktion (liest Komponenten, Embeds und Strings aus)
// ---------------------------------------------------------------------------

function extractAllText(obj, depth = 0) {
  let out = '';
  if (!obj || depth > 12) return out;
  if (typeof obj === 'string') return obj + '\n';
  if (Array.isArray(obj)) {
    for (const item of obj) out += extractAllText(item, depth + 1);
    return out;
  }
  if (typeof obj === 'object') {
    if (obj.content && typeof obj.content === 'string') out += obj.content + '\n';
    if (obj.data?.content) out += obj.data.content + '\n';
    if (obj.title && typeof obj.title === 'string') out += obj.title + '\n';
    if (obj.description && typeof obj.description === 'string') out += obj.description + '\n';
    if (obj.footer?.text) out += obj.footer.text + '\n';
    if (Array.isArray(obj.fields)) {
      for (const f of obj.fields) out += `${f.name || ''}\n${f.value || ''}\n`;
    }
    if (obj.components) out += extractAllText(obj.components, depth + 1);
    if (obj.embeds) out += extractAllText(obj.embeds, depth + 1);
  }
  return out;
}

/** Entfernt alle unsichtbaren Marker-Zeichen aus einem Text. */
function stripInvisible(text) {
  return String(text ?? '').replace(/[\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/g, '');
}

/** Sammelt die Inhalte aller TextDisplay-Komponenten in Reihenfolge. */
function collectTextBlocks(obj, out = [], depth = 0) {
  if (!obj || depth > 12) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectTextBlocks(item, out, depth + 1);
    return out;
  }
  if (typeof obj === 'object') {
    const content = obj.content ?? obj.data?.content;
    if (typeof content === 'string' && (obj.type === 10 || obj.data?.type === 10 || !obj.components)) {
      out.push(content);
    }
    if (obj.components) collectTextBlocks(obj.components, out, depth + 1);
  }
  return out;
}

/** Alle Button-Custom-IDs einer Nachricht einsammeln. */
function extractCustomIds(obj, out = [], depth = 0) {
  if (!obj || depth > 12) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) extractCustomIds(item, out, depth + 1);
    return out;
  }
  if (typeof obj === 'object') {
    const cid = obj.custom_id || obj.customId || obj.data?.custom_id || obj.data?.customId;
    if (typeof cid === 'string') out.push(cid);
    if (obj.components) extractCustomIds(obj.components, out, depth + 1);
    if (obj.accessory) extractCustomIds(obj.accessory, out, depth + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Konfiguration aus einer Nachricht lesen
// ---------------------------------------------------------------------------

/**
 * Liest die Regeln-Konfiguration aus einer Nachricht.
 * Marker = Primärquelle, sichtbarer Text = Regeln-Text.
 */
function parseRulesMessage(message) {
  if (!message) return null;
  const text = extractAllText(message);
  const hidden = decodeHidden(text).join('|');
  const config = decodeConfigPayload(`${hidden}|${text}`);
  if (!config) return null;

  const rules = parseRulesText(message) || '';
  return { ...config, rules };
}

/** Liest den sichtbaren Regeln-Text aus dem ersten TextDisplay der Nachricht. */
function parseRulesText(message) {
  const blocks = collectTextBlocks(message);
  const content = blocks[0] || '';
  return stripInvisible(content).trim();
}

/** Trägt eine Nachricht unseren Konfig-Marker? */
function isRulesMessage(message) {
  if (!message) return false;
  const text = extractAllText(message);
  const hidden = decodeHidden(text).join('|');
  return hidden.includes(CONFIG_MARKER) || text.includes(CONFIG_MARKER);
}

/** Trägt eine Nachricht einen Anfrage-Marker? */
function parseRequestMessage(message) {
  if (!message) return null;
  const text = extractAllText(message);
  const hidden = decodeHidden(text).join('|');
  const req = decodeRequestPayload(`${hidden}|${text}`);
  if (!req) return null;
  return req;
}

// ---------------------------------------------------------------------------
// Die öffentliche Regeln-Nachricht
// ---------------------------------------------------------------------------

/**
 * Baut den Container der finalen Regeln-Nachricht.
 *
 * config: { mode, lang, rules, buttonName, bannerUrl, imageUrl }
 */
function buildRulesContainer({ config }) {
  const container = new ContainerBuilder();
  const { lang = 'en', mode = MODE_VERIFY } = config;

  // Banner (optional) – oben, über die volle Breite.
  if (config.bannerUrl) {
    try {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder({ items: [{ media: { url: config.bannerUrl } }] })
      );
    } catch {
      /* Banner weglassen, wenn die URL ungültig ist */
    }
  }

  // Regeln-Text. Mit Bild oben rechts als Thumbnail-Accessory (Section);
  // ohne Bild als einfaches TextDisplay (Section verlangt ein Accessory).
  const content = String(config.rules || '').trim() || '📜';
  if (config.imageUrl) {
    try {
      const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(config.imageUrl));
      container.addSectionComponents(section);
    } catch {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  }

  // Konfig-Blob (unsere „Datenbank“) in einem EIGENEN TextDisplay, damit lange
  // Regeln nie mit dem Marker um das 4000-Zeichen-Limit konkurrieren.
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(encodeHidden(encodeConfigPayload(config)))
  );

  // Verify-Button (nur im Verify-Modus).
  if (mode === MODE_VERIFY) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.verify)
          .setStyle(ButtonStyle.Success)
          .setLabel(String(config.buttonName || '✅ Verifizieren').slice(0, MAX_BUTTON_LEN))
      )
    );
  }

  return container;
}

// ---------------------------------------------------------------------------
// Log-Kanal: Verifizierungs-Anfrage (mit Annehmen/Ablehnen)
// ---------------------------------------------------------------------------

/**
 * Baut die Anfrage-Nachricht im Log-Kanal.
 * answers: [{ question, answer }] (optional, für Formular-Modus)
 */
function buildRequestContainer({ lang = 'en', user, answers = [], req }) {
  const container = new ContainerBuilder();
  const lines = [`# ${t('requestTitle', lang)}`, t('requestBody', lang, { user: `<@${user}>` })];
  for (const a of answers || []) {
    lines.push('', t('requestAnswerLine', lang, { question: a.question, answer: a.answer || '–' }));
  }
  lines.push(encodeHidden(encodeRequestPayload(req)));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.approve)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnApprove', lang)),
      new ButtonBuilder()
        .setCustomId(CID.reject)
        .setStyle(ButtonStyle.Danger)
        .setLabel(t('btnReject', lang))
    )
  );
  return container;
}

/** Erledigte Anfrage: Buttons weg, Statuszeile dazu, Marker bleibt erhalten. */
function buildResolvedRequestContainer({ original, statusText }) {
  const container = new ContainerBuilder();
  const text = stripInvisible(extractAllText(original)).trim();
  const hidden = (decodeHidden(extractAllText(original)) || []).find((p) => p.startsWith(REQUEST_MARKER));
  const marker = hidden ? encodeHidden(hidden) : '';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${text}\n\n${statusText}${marker ? '\n' + marker : ''}`)
  );
  return container;
}

// ---------------------------------------------------------------------------
// Formulare (Modals)
// ---------------------------------------------------------------------------

/**
 * Formular für /create_verify_rules & /create_classic_rules:
 * große Textbox (Regeln) + (nur Verify) kleines Feld (Button-Name).
 * Falls schon Regeln existieren, wird der Inhalt vorbefüllt.
 */
function buildCreateModal(lang, kind, channelId, prefill = {}) {
  const rulesInput = new TextInputBuilder()
    .setCustomId('rules')
    .setLabel(fit(t('createRulesLabel', lang)))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_RULES_LEN)
    .setPlaceholder(fit(t('createRulesPlaceholder', lang), 100));
  if (prefill.rules) rulesInput.setValue(String(prefill.rules).slice(0, MAX_RULES_LEN));

  const modal = new ModalBuilder()
    .setCustomId(prefill.sessionId ? CID.textModal(prefill.sessionId) : CID.createModal(kind, channelId))
    .setTitle(fit(t('createModalTitle', lang)))
    .addComponents(new ActionRowBuilder().addComponents(rulesInput));

  if (kind === 'verify') {
    const buttonInput = new TextInputBuilder()
      .setCustomId('button_name')
      .setLabel(fit(t('createButtonLabel', lang)))
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(MAX_BUTTON_LEN)
      .setPlaceholder(fit(t('createButtonPlaceholder', lang), 100));
    if (prefill.buttonName) buttonInput.setValue(String(prefill.buttonName).slice(0, MAX_BUTTON_LEN));
    modal.addComponents(new ActionRowBuilder().addComponents(buttonInput));
  }

  return modal;
}

/** Formular „Regeln bearbeiten“ (aus dem Editor). */
function buildRulesModal(lang, sessionId, prefill = {}) {
  const rulesInput = new TextInputBuilder()
    .setCustomId('rules')
    .setLabel(fit(t('createRulesLabel', lang)))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_RULES_LEN)
    .setPlaceholder(fit(t('createRulesPlaceholder', lang), 100));
  if (prefill.rules) rulesInput.setValue(String(prefill.rules).slice(0, MAX_RULES_LEN));
  return new ModalBuilder()
    .setCustomId(CID.textModal(sessionId))
    .setTitle(fit(t('createModalTitle', lang)))
    .addComponents(new ActionRowBuilder().addComponents(rulesInput));
}

/** Formular „Button-Name bearbeiten“ (nur Verify). */
function buildButtonModal(lang, sessionId, prefill = {}) {
  const input = new TextInputBuilder()
    .setCustomId('button_name')
    .setLabel(fit(t('createButtonLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(MAX_BUTTON_LEN)
    .setPlaceholder(fit(t('createButtonPlaceholder', lang), 100));
  if (prefill.buttonName) input.setValue(String(prefill.buttonName).slice(0, MAX_BUTTON_LEN));
  return new ModalBuilder()
    .setCustomId(CID.buttonModal(sessionId))
    .setTitle(fit(t('createButtonLabel', lang)))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Formular „Ablehnungsgrund“ (Admins). */
function buildRejectModal(lang, channelId, messageId) {
  const input = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel(fit(t('rejectReasonLabel', lang)))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(900)
    .setPlaceholder(fit(t('rejectReasonPlaceholder', lang), 100));
  return new ModalBuilder()
    .setCustomId(CID.rejectModal(channelId, messageId))
    .setTitle(fit(t('rejectModalTitle', lang)))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Verifizierungs-Formular (aus den konfigurierten Feldern). */
function buildVerifyFormModal(lang, channelId, messageId, fields = []) {
  const modal = new ModalBuilder()
    .setCustomId(CID.verifyFormModal(channelId, messageId))
    .setTitle(fit(t('formModalTitle', lang)));
  for (const f of fields.slice(0, MAX_FIELDS)) {
    const input = new TextInputBuilder()
      .setCustomId(`vf_${f.id}`)
      .setLabel(fit(f.question || t('feFieldShort', lang), 45) || '?')
      .setStyle(normalizeFieldStyle(f.style) === FIELD_LONG ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(Boolean(f.required))
      .setMaxLength(900);
    if (f.placeholder) input.setPlaceholder(fit(f.placeholder, 100));
    if (f.value) input.setValue(String(f.value).slice(0, 900));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  if (!fields.length) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('vf_confirm')
          .setLabel(fit(t('btnApprove', lang)))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(fit(t('rejectReasonPlaceholder', lang), 100))
      )
    );
  }
  return modal;
}

/** Formular-Feld bearbeiten/hinzufügen. */
function buildFieldModal(lang, sessionId, prefill = {}) {
  const q = new TextInputBuilder()
    .setCustomId('question')
    .setLabel(fit(t('fieldQuestionLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(MAX_QUESTION_LEN)
    .setPlaceholder(fit(t('fieldQuestionPlaceholder', lang), 100));
  if (prefill.question) q.setValue(String(prefill.question).slice(0, MAX_QUESTION_LEN));

  const p = new TextInputBuilder()
    .setCustomId('placeholder')
    .setLabel(fit(t('fieldPlaceholderLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(MAX_PLACEHOLDER_LEN);
  if (prefill.placeholder) p.setValue(String(prefill.placeholder).slice(0, MAX_PLACEHOLDER_LEN));

  const v = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(fit(t('fieldValueLabel', lang)))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_VALUE_LEN);
  if (prefill.value) v.setValue(String(prefill.value).slice(0, MAX_VALUE_LEN));

  const s = new TextInputBuilder()
    .setCustomId('style')
    .setLabel(fit(t('fieldStyleLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(20)
    .setPlaceholder(fit(t('fieldStylePlaceholder', lang), 100));
  if (prefill.style) s.setValue(prefill.style === FIELD_LONG ? 'long' : 'short');

  const r = new TextInputBuilder()
    .setCustomId('required')
    .setLabel(fit(t('fieldRequiredLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10)
    .setPlaceholder('yes/no');
  if (prefill.required !== undefined) r.setValue(prefill.required ? 'yes' : 'no');

  return new ModalBuilder()
    .setCustomId(CID.fieldModal(sessionId))
    .setTitle(fit(t('fieldModalTitle', lang)))
    .addComponents(
      new ActionRowBuilder().addComponents(q),
      new ActionRowBuilder().addComponents(p),
      new ActionRowBuilder().addComponents(v),
      new ActionRowBuilder().addComponents(s),
      new ActionRowBuilder().addComponents(r)
    );
}

// ---------------------------------------------------------------------------
// Editor (Bestätigungs-/Bearbeitungs-Nachricht)
// ---------------------------------------------------------------------------

function buildEditorContainer(session) {
  const lang = session.lang || 'en';
  const container = new ContainerBuilder();

  const head = [`# ${t('editorTitle', lang)}`, t('editorIntroNew', lang)];
  if (session.notice) head.push('', session.notice);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const info = [
    t('editorChannel', lang, { channel: `<#${session.channelId}>` }),
    t('editorMode', lang, { mode: session.mode === MODE_CLASSIC ? t('modeClassic', lang) : t('modeVerify', lang) }),
    t('editorRules', lang, { rules: session.rules || t('editorNoRules', lang) }),
  ];
  if (session.mode === MODE_VERIFY) {
    info.push(t('editorButtonName', lang, { name: session.buttonName || '✅ Verifizieren' }));
    info.push(t('editorRoles', lang, { unverified: `<@&${session.unverifiedRoleId}>`, verified: `<@&${session.verifiedRoleId}>` }));
    info.push(t('editorLogging', lang, { channel: `<#${session.loggingChannelId}>` }));
  }
  info.push(
    t('editorImage', lang, { status: session.imageUrl ? t('statusSet', lang) : t('statusEmpty', lang) }),
    t('editorBanner', lang, { status: session.bannerUrl ? t('statusSet', lang) : t('statusEmpty', lang) })
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(info.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.editor('rules', session.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('btnEditRules', lang)),
    new ButtonBuilder()
      .setCustomId(CID.editor('upload_image', session.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('btnUploadImage', lang)),
    new ButtonBuilder()
      .setCustomId(CID.editor('upload_banner', session.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('btnUploadBanner', lang))
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.editor('remove_image', session.id))
      .setStyle(ButtonStyle.Danger)
      .setLabel(t('btnRemoveImage', lang))
      .setDisabled(!session.imageUrl),
    new ButtonBuilder()
      .setCustomId(CID.editor('remove_banner', session.id))
      .setStyle(ButtonStyle.Danger)
      .setLabel(t('btnRemoveBanner', lang))
      .setDisabled(!session.bannerUrl)
  );
  if (session.mode === MODE_VERIFY) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(CID.editor('button', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnEditButton', lang))
    );
  }
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.editor('publish', session.id))
      .setStyle(ButtonStyle.Primary)
      .setLabel(t('btnPublish', lang)),
    new ButtonBuilder()
      .setCustomId(CID.editor('cancel', session.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('btnCancel', lang))
  );

  container.addActionRowComponents(row1, row2, row3);
  return container;
}

// ---------------------------------------------------------------------------
// Formular-Editor (Überprüfung mit Formular)
// ---------------------------------------------------------------------------

function buildFieldEditorContainer(session) {
  const lang = session.lang || 'en';
  const fields = session.fields || [];
  const container = new ContainerBuilder();

  const head = [`# ${t('feTitle', lang)}`, t('feIntro', lang)];
  if (session.notice) head.push('', session.notice);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const lines = [];
  if (!fields.length) {
    lines.push(t('feEmpty', lang));
  } else {
    fields.forEach((f, i) => {
      lines.push(
        t('feFieldLine', lang, {
          index: i + 1,
          question: f.question || '?',
          style: normalizeFieldStyle(f.style) === FIELD_LONG ? t('feFieldLong', lang) : t('feFieldShort', lang),
          required: f.required ? t('feFieldRequired', lang) : t('feFieldOptional', lang),
        })
      );
    });
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.fieldEditor('add', session.id))
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnAddField', lang))
        .setDisabled(fields.length >= MAX_FIELDS),
      new ButtonBuilder()
        .setCustomId(CID.fieldEditor('remove', session.id))
        .setStyle(ButtonStyle.Danger)
        .setLabel(t('btnRemoveField', lang))
        .setDisabled(fields.length === 0),
      new ButtonBuilder()
        .setCustomId(CID.fieldEditor('save', session.id))
        .setStyle(ButtonStyle.Primary)
        .setLabel(t('btnSaveFields', lang)),
      new ButtonBuilder()
        .setCustomId(CID.fieldEditor('cancel', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnCancel', lang))
    )
  );
  return container;
}

/** Auswahlmenü „Welches Feld fliegt raus?“ */
function buildFieldRemoveSelectContainer(session) {
  const lang = session.lang || 'en';
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('feRemoveTitle', lang)}`)
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(CID.fieldRemoveSelect(session.id))
    .setPlaceholder(fit(t('feRemoveTitle', lang), 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      (session.fields || []).slice(0, 25).map((f, i) => ({
        label: String(f.question || `#${i + 1}`).slice(0, 100) || `#${i + 1}`,
        value: String(i),
      }))
    );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.fieldEditor('back', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnBack', lang))
    )
  );
  return container;
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function smallContainer(title, desc) {
  const container = new ContainerBuilder();
  let text = '';
  if (title) text += `# ${title}\n\n`;
  if (desc) text += desc;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trim() || '…'));
  return container;
}

function fit(str, max = 45) {
  return String(str ?? '').slice(0, max);
}

module.exports = {
  extractAllText,
  extractCustomIds,
  stripInvisible,
  parseRulesMessage,
  parseRulesText,
  isRulesMessage,
  parseRequestMessage,
  buildRulesContainer,
  buildRequestContainer,
  buildResolvedRequestContainer,
  buildCreateModal,
  buildRulesModal,
  buildButtonModal,
  buildRejectModal,
  buildVerifyFormModal,
  buildFieldModal,
  buildEditorContainer,
  buildFieldEditorContainer,
  buildFieldRemoveSelectContainer,
  smallContainer,
  encodeHidden,
  decodeHidden,
  fit,
};
