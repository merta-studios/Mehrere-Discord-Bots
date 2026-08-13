/**
 * Baut alle Container (Components V2), Modals und Auswahlmenüs des
 * Self-Roles-Bots – und liest die Konfiguration aus einer bestehenden
 * Nachricht wieder aus. Das ist die „Datenbank“: die komplette
 * Konfiguration steckt als unsichtbarer Zero-Width-Blob IN der Nachricht.
 *
 * Layout der finalen Nachricht:
 *
 *   # Titel
 *   Beschreibung (immer einzeilig)
 *   ───────────────────────────────
 *   Platzhalter (3) - @Rolle
 *   Platzhalter (7) - @Rolle
 *   ───────────────────────────────
 *   [ Platzhalter (3) ] [ Platzhalter (7) ]   ← alle Buttons grau
 */

const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
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
  MIN_ROLES,
  MAX_ROLES,
  MAX_TITLE_LEN,
  MAX_DESC_LEN,
  MAX_LABEL_LEN,
  MAX_ROLE_NAME_LEN,
  MODE_SINGLE,
  MODE_MULTI,
  CONFIG_MARKER,
  LOGGING_MARKER,
  CID,
  encodeConfigPayload,
  decodeConfigPayload,
  encodeLoggingPayload,
  decodeLoggingPayload,
  roleLine,
  parseRoleLine,
  buttonLabel,
  normalizeMode,
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

/** Alle Button-Custom-IDs einer Nachricht einsammeln (Fallback-Parser). */
function extractCustomIds(obj, out = [], depth = 0) {
  if (!obj || depth > 12) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) extractCustomIds(item, out, depth + 1);
    return out;
  }
  if (typeof obj === 'object') {
    const cid = obj.custom_id || obj.customId || obj.data?.custom_id || obj.data?.customId;
    if (typeof cid === 'string') out.push(cid);
    const label = obj.label ?? obj.data?.label;
    if (typeof cid === 'string' && typeof label === 'string') {
      out[out.length - 1] = cid; // Reihenfolge bleibt, Label separat via extractButtons
    }
    if (obj.components) extractCustomIds(obj.components, out, depth + 1);
    if (obj.accessory) extractCustomIds(obj.accessory, out, depth + 1);
  }
  return out;
}

/** Buttons als {customId, label} einsammeln – für Label-Recovery. */
function extractButtons(obj, out = [], depth = 0) {
  if (!obj || depth > 12) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) extractButtons(item, out, depth + 1);
    return out;
  }
  if (typeof obj === 'object') {
    const cid = obj.custom_id || obj.customId || obj.data?.custom_id || obj.data?.customId;
    const label = obj.label ?? obj.data?.label;
    if (typeof cid === 'string') out.push({ customId: cid, label: typeof label === 'string' ? label : '' });
    if (obj.components) extractButtons(obj.components, out, depth + 1);
    if (obj.accessory) extractButtons(obj.accessory, out, depth + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Konfiguration aus einer Nachricht lesen
// ---------------------------------------------------------------------------

/**
 * Liest die Self-Roles-Konfiguration aus einer Nachricht.
 *
 * Primärquelle: der unsichtbare Zero-Width-Blob (vollständig, inkl. Titel,
 * Beschreibung, Modus, Sprache und Reihenfolge der Rollen).
 * Fallback (falls Discord den Blob je verschluckt): die Buttons selbst –
 * Rollen-IDs stecken in den Custom-IDs, Labels in den Button-Beschriftungen.
 * So bleibt die Nachricht auch im Worst Case bedienbar.
 */
function parseSelfRoleMessage(message) {
  if (!message) return null;
  const text = extractAllText(message);
  const hidden = decodeHidden(text).join('|');

  // Sprache & Auswahl-Modus stecken im (winzigen) unsichtbaren Marker.
  const marker = decodeConfigPayload(`${hidden}|${text}`);
  const loggingConfig = decodeLoggingPayload(`${hidden}|${text}`);

  // Titel & Beschreibung aus dem sichtbaren Header lesen.
  const { title, description } = parseHeader(message);

  // Rollen aus den sichtbaren Listenzeilen lesen …
  const roles = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const parsedLine = parseRoleLine(line);
    if (!parsedLine || seen.has(parsedLine.roleId)) continue;
    seen.add(parsedLine.roleId);
    roles.push({ roleId: parsedLine.roleId, label: parsedLine.label });
  }

  // … und – falls die Liste fehlt/beschädigt ist – aus den Buttons.
  let recovered = false;
  if (!roles.length) {
    const buttons = extractButtons(message).filter((b) => /^srl_role_[A-Za-z0-9]+$/.test(b.customId));
    for (const b of buttons) {
      const roleId = b.customId.replace('srl_role_', '');
      if (seen.has(roleId)) continue;
      seen.add(roleId);
      roles.push({
        roleId,
        label: String(b.label || '')
          .replace(/\s*\(\s*[\d.,\s\u00A0\u202F']+\s*\)\s*$/, '')
          .trim(),
      });
      recovered = true;
    }
  }

  // Altes Marker-Format brachte alles mit – als Fallback nutzen.
  if (marker?.legacy) {
    return {
      lang: marker.lang,
      mode: marker.mode,
      title: title || marker.title || '',
      description: description || marker.description || '',
      roles: roles.length ? roles : marker.roles,
      logging: loggingConfig ? loggingConfig.enabled : null,
      loggingLang: loggingConfig ? loggingConfig.lang : null,
      recovered,
    };
  }

  if (!marker && !roles.length) return null;

  return {
    lang: marker?.lang || 'en',
    mode: marker?.mode || MODE_MULTI,
    title: title || '',
    description: description || '',
    roles,
    logging: loggingConfig ? loggingConfig.enabled : null,
    loggingLang: loggingConfig ? loggingConfig.lang : null,
    recovered: recovered || !marker,
  };
}

/**
 * Liest Titel („# …“) und Beschreibung (die Zeilen danach) aus dem ersten
 * TextDisplay der Nachricht – unsichtbare Marker-Zeichen werden entfernt.
 */
function parseHeader(message) {
  const blocks = collectTextBlocks(message);
  const header = blocks[0] || '';
  const lines = stripInvisible(header)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length);

  let title = '';
  const descParts = [];
  for (const line of lines) {
    if (!title && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('#')) continue;
    descParts.push(line);
  }
  return { title, description: descParts.join(' ').trim() };
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

/** Entfernt alle unsichtbaren Marker-Zeichen aus einem Text. */
function stripInvisible(text) {
  return String(text ?? '').replace(/[\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/g, '');
}

/** Trägt eine Nachricht unseren Konfig-Marker (oder wenigstens Rollen-Buttons)? */
function isSelfRoleMessage(message) {
  if (!message) return false;
  const text = extractAllText(message);
  const hidden = decodeHidden(text).join('|');
  if (hidden.includes(CONFIG_MARKER) || text.includes(CONFIG_MARKER)) return true;
  return extractCustomIds(message).some((cid) => /^srl_role_[A-Za-z0-9]+$/.test(cid));
}

// ---------------------------------------------------------------------------
// Die öffentliche Self-Roles-Nachricht
// ---------------------------------------------------------------------------

/**
 * Baut den Container der finalen Nachricht.
 *
 * roles: [{ roleId, label, count }]
 * Zeilenformat: „Platzhalter (Anzahl) - <@&Rolle>“
 * Buttons: alle grau (Secondary), Label „Platzhalter (Anzahl)“.
 */
function buildSelfRoleContainer({
  title,
  description,
  roles = [],
  lang = 'en',
  mode = MODE_MULTI,
  logging = true,
  loggingLang = null,
}) {
  const container = new ContainerBuilder();

  const cleanTitle = String(title || '').trim();
  const cleanDesc = String(description || '').trim();

  const headerLines = [];
  if (cleanTitle) headerLines.push(`# ${cleanTitle}`);
  if (cleanDesc) headerLines.push(cleanDesc);
  if (!headerLines.length) headerLines.push('# 🎭');

  // Unsichtbarer Konfig-Blob (unsere „Datenbank“) – hängt am Header.
  headerLines.push(
    encodeHidden(
      encodeConfigPayload({
        lang,
        mode: normalizeMode(mode),
        title: cleanTitle,
        description: cleanDesc,
        roles: roles.map((r) => ({ roleId: r.roleId, label: r.label })),
      })
    )
  );

  // Unsichtbarer Logging-Blob (Server-Einstellung auf Discord versteckt persistiert)
  if (logging != null) {
    headerLines.push(
      encodeHidden(
        encodeLoggingPayload({
          enabled: logging !== false,
          lang: loggingLang || lang || 'de',
        })
      )
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  // Genau dasselbe Format, das parseRoleLine() wieder einliest.
  const listText = roles.map((r) => roleLine(r.label, r.count ?? 0, r.roleId, lang)).join('\n');
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(listText || t('editorNoRoles', lang, { min: MIN_ROLES, max: MAX_ROLES }))
  );

  if (roles.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    for (const row of chunk(roles, 5)) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          ...row.map((r) =>
            new ButtonBuilder()
              .setCustomId(CID.role(r.roleId))
              .setStyle(ButtonStyle.Secondary) // ALLE Buttons grau
              .setLabel(buttonLabel(r.label, r.count ?? 0, lang))
          )
        )
      );
    }
  }

  return container;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// /create_self_role – Formular (großer Text + kleiner Titel)
// ---------------------------------------------------------------------------

function buildCreateModal(lang, channelId, prefill = {}) {
  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel(fit(t('createTitleLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(MAX_TITLE_LEN)
    .setPlaceholder(fit(t('createTitlePlaceholder', lang), 100));
  if (prefill.title) titleInput.setValue(String(prefill.title).slice(0, MAX_TITLE_LEN));

  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel(fit(t('createDescLabel', lang)))
    .setStyle(TextInputStyle.Paragraph) // die große Textbox
    .setRequired(false)
    .setMaxLength(MAX_DESC_LEN)
    .setPlaceholder(fit(t('createDescPlaceholder', lang), 100));
  if (prefill.description) descInput.setValue(String(prefill.description).slice(0, MAX_DESC_LEN));

  return new ModalBuilder()
    .setCustomId(prefill.sessionId ? CID.textModal(prefill.sessionId) : CID.createModal(channelId))
    .setTitle(fit(t('createModalTitle', lang)))
    .addComponents(
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(titleInput)
    );
}

/** Formular „Rolle hinzufügen“: Rollenname + Text-Platzhalter. */
function buildRoleModal(lang, sessionId) {
  const nameInput = new TextInputBuilder()
    .setCustomId('role_name')
    .setLabel(fit(t('roleNameLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(MAX_ROLE_NAME_LEN)
    .setPlaceholder(fit(t('roleNamePlaceholder', lang), 100));

  const labelInput = new TextInputBuilder()
    .setCustomId('role_label')
    .setLabel(fit(t('roleLabelLabel', lang)))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(MAX_LABEL_LEN)
    .setPlaceholder(fit(t('roleLabelPlaceholder', lang), 100));

  return new ModalBuilder()
    .setCustomId(CID.roleModal(sessionId))
    .setTitle(fit(t('roleModalTitle', lang)))
    .addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(labelInput)
    );
}

function fit(str, max = 45) {
  return String(str ?? '').slice(0, max);
}

// ---------------------------------------------------------------------------
// Editor-Container (Bestätigung + Bearbeitung)
// ---------------------------------------------------------------------------

/**
 * Der Editor: zeigt Kanal, Titel, Beschreibung, Modus und die Rollenliste,
 * dazu alle Bearbeitungs-Buttons.
 *
 * session: { id, channelId, title, description, mode, lang, roles, notice, editing }
 */
function buildEditorContainer(session) {
  const lang = session.lang || 'en';
  const roles = session.roles || [];
  const container = new ContainerBuilder();

  const head = [
    `# ${t('editorTitle', lang)}`,
    session.editing ? t('editorIntroEdit', lang) : t('editorIntroNew', lang),
  ];
  if (session.notice) head.push('', session.notice);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const info = [
    t('editorChannel', lang, { channel: `<#${session.channelId}>` }),
    t('editorMsgTitle', lang, { title: session.title || '—' }),
    t('editorDesc', lang, { desc: session.description || t('editorDescEmpty', lang) }),
    t('editorMode', lang, {
      mode: session.mode === MODE_SINGLE ? t('modeSingle', lang) : t('modeMulti', lang),
    }),
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(info.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const roleLines = [t('editorRolesTitle', lang, { count: roles.length, max: MAX_ROLES })];
  if (!roles.length) {
    roleLines.push(t('editorNoRoles', lang, { min: MIN_ROLES, max: MAX_ROLES }));
  } else {
    roles.forEach((r, i) => {
      roleLines.push(
        r.roleId
          ? t('editorRoleLineExisting', lang, { index: i + 1, label: r.label, mention: `<@&${r.roleId}>` })
          : t('editorRoleLineNew', lang, { index: i + 1, label: r.label, name: r.name })
      );
    });
  }
  roleLines.push('');
  if (roles.length < MIN_ROLES) {
    roleLines.push(t('editorNeedMore', lang, { missing: MIN_ROLES - roles.length, min: MIN_ROLES }));
  } else {
    roleLines.push(t('editorReady', lang));
  }
  if (session.editing) roleLines.push(t('editorRemoveHint', lang));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(roleLines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const canPublish = roles.length >= MIN_ROLES && roles.length <= MAX_ROLES;

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.editor('add', session.id))
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnAddRole', lang))
        .setDisabled(roles.length >= MAX_ROLES),
      new ButtonBuilder()
        .setCustomId(CID.editor('remove', session.id))
        .setStyle(ButtonStyle.Danger)
        .setLabel(t('btnRemoveRole', lang))
        .setDisabled(roles.length === 0),
      new ButtonBuilder()
        .setCustomId(CID.editor('text', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnEditText', lang)),
      new ButtonBuilder()
        .setCustomId(CID.editor('mode', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnToggleMode', lang))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.editor('publish', session.id))
        .setStyle(ButtonStyle.Primary)
        .setLabel(session.editing ? t('btnSave', lang) : t('btnPublish', lang))
        .setDisabled(!canPublish),
      new ButtonBuilder()
        .setCustomId(CID.editor('cancel', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnCancel', lang))
    )
  );

  return container;
}

/** Auswahlmenü „Welche Rolle fliegt raus?“ */
function buildRemoveSelectContainer(session) {
  const lang = session.lang || 'en';
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('btnRemoveRole', lang)}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(CID.removeSelect(session.id))
    .setPlaceholder(fit(t('removeSelectPlaceholder', lang), 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      (session.roles || []).slice(0, 25).map((r, i) => ({
        label: String(r.label || r.name || `#${i + 1}`).slice(0, 100),
        value: String(i),
        description: (r.roleId ? `@${r.name || r.label}` : r.name || '').slice(0, 100) || undefined,
      }))
    );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.editor('back', session.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t('btnBack', lang))
    )
  );
  return container;
}

/** Auswahlmenü für /edit_self_role. */
function buildMessagePickerContainer({ lang, entries }) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${t('editPickTitle', lang)}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(CID.pickMessage)
    .setPlaceholder(fit(t('editPickPlaceholder', lang), 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      entries.slice(0, 25).map((e) => ({
        label: String(e.title || '🎭').slice(0, 100) || '🎭',
        value: `${e.channelId}:${e.messageId}`.slice(0, 100),
        description: t('editEntryDesc', lang, { count: e.roleCount, channel: e.channelName }).slice(0, 100),
      }))
    );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  return container;
}

/** Ephemere Antwort „Du hast die Rolle schon – abgeben?“ */
function buildAlreadyHasContainer({ lang, roleId, channelId, messageId }) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t('roleAlready', lang, { role: `<@&${roleId}>` }))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.drop(roleId, channelId, messageId))
          .setStyle(ButtonStyle.Danger)
          .setLabel(t('btnRemoveMyRole', lang))
      )
    );
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

module.exports = {
  extractAllText,
  extractCustomIds,
  extractButtons,
  parseSelfRoleMessage,
  isSelfRoleMessage,
  buildSelfRoleContainer,
  buildCreateModal,
  buildRoleModal,
  buildEditorContainer,
  buildRemoveSelectContainer,
  buildMessagePickerContainer,
  buildAlreadyHasContainer,
  smallContainer,
  encodeHidden,
  decodeHidden,
  chunk,
  fit,
};
