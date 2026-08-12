/**
 * Tests für den Self-Roles-Bot – ohne Discord-Verbindung.
 *
 * Abgedeckt:
 * - Modul-Form & Slash-Command-JSON (5 Commands, 10 Sprachen)
 * - Beschreibung wird IMMER einzeilig (Zeilenumbrüche → Leerzeichen)
 * - Konfiguration überlebt den Weg „Container → Nachricht → Parser“
 *   (das ist die „Datenbank ohne Datenbank“)
 * - Layout der finalen Nachricht: „Platzhalter (Anzahl) - @Rolle“ und
 *   graue Buttons „Platzhalter (Anzahl)“
 * - Fallback-Recovery, wenn der unsichtbare Marker verloren geht
 * - Custom-ID-Bau/-Parsing, Limits (min 2 / max 20 Rollen, max 10 Nachrichten)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ButtonStyle, MessageFlags } = require('discord.js');

const logic = require('../bots/self-roles-bot/src/logic');
const { componentsV2Payload } = require('../bots/self-roles-bot/src/message-payload');
const {
  buildSelfRoleContainer,
  parseSelfRoleMessage,
  isSelfRoleMessage,
  buildCreateModal,
  buildRoleModal,
  buildEditorContainer,
  buildRemoveSelectContainer,
  buildMessagePickerContainer,
  buildAlreadyHasContainer,
} = require('../bots/self-roles-bot/src/embed-builder');
const { newSession } = require('../bots/self-roles-bot/src/editor');
const { LANGS, t } = require('../bots/self-roles-bot/src/languages');

// ---------------------------------------------------------------------------
// Modul & Commands
// ---------------------------------------------------------------------------

test('Bot-Modul hat die erwartete Form', () => {
  const bot = require('../bots/self-roles-bot/index.js');
  assert.equal(bot.id, 'self-roles-bot');
  assert.equal(bot.tokenEnv, 'SELF_ROLES_BOT_TOKEN');
  assert.equal(typeof bot.create, 'function');
  assert.ok(Array.isArray(bot.intents) && bot.intents.length >= 2);
});

test('Slash-Commands sind gültiges Discord-JSON', () => {
  const { defineCommands } = require('../bots/self-roles-bot/src/commands');
  const cmds = defineCommands().map((c) => c.toJSON());

  assert.deepEqual(
    cmds.map((c) => c.name).sort(),
    ['admin_set_bot_profile', 'adminpanel', 'create_self_role', 'edit_self_role', 'help']
  );

  const create = cmds.find((c) => c.name === 'create_self_role');
  assert.equal(create.default_member_permissions, '8', '/create_self_role ist nur für Admins');
  assert.equal(create.options.length, 1);
  assert.equal(create.options[0].name, 'channel');
  assert.ok(create.options[0].required, 'Der Channel ist Pflicht');

  const edit = cmds.find((c) => c.name === 'edit_self_role');
  assert.equal(edit.default_member_permissions, '8');

  const profile = cmds.find((c) => c.name === 'admin_set_bot_profile');
  assert.deepEqual(profile.options[0].choices.map((c) => c.value), ['standard', 'server', 'owner']);

  // Alle Beschreibungen in 10 Sprachen lokalisiert
  for (const cmd of cmds) {
    assert.equal(
      Object.keys(cmd.description_localizations || {}).length,
      Object.keys(LANGS).length,
      `/${cmd.name} ist in allen 10 Sprachen lokalisiert`
    );
  }

  // Discord-Regel: erforderliche Optionen zuerst
  for (const cmd of cmds) {
    let seenOptional = false;
    for (const opt of cmd.options || []) {
      if (opt.required) assert.equal(seenOptional, false, `/${cmd.name}: Pflichtoption nach optionaler`);
      else seenOptional = true;
    }
  }
});

test('Alle 10 Sprachen liefern echte Texte für die Kern-Keys', () => {
  const keys = ['roleGiven', 'roleAlready', 'roleRemoved', 'editorTitle', 'helpTitle', 'errBotPerms'];
  for (const lang of Object.keys(LANGS)) {
    for (const key of keys) {
      const text = t(key, lang);
      assert.ok(text && !text.startsWith('??'), `${key}/${lang} fehlt`);
    }
  }
});

// ---------------------------------------------------------------------------
// Beschreibung: immer einzeilig
// ---------------------------------------------------------------------------

test('Beschreibung wird immer einzeilig (jede neue Zeile → Leerzeichen)', () => {
  const input = 'Zeile eins\nZeile zwei\r\nZeile drei\n\n\nZeile vier';
  const out = logic.flattenDescription(input);
  assert.equal(out, 'Zeile eins Zeile zwei Zeile drei Zeile vier');
  assert.ok(!out.includes('\n'));

  // Unicode-Zeilentrenner ebenfalls
  assert.equal(logic.flattenDescription('a\u2028b\u2029c\vd'), 'a b c d');
  // Titel genauso
  assert.equal(logic.sanitizeTitle('Mein\nTitel'), 'Mein Titel');
  // Und die Beschreibung landet auch im Container ohne Umbruch
  const container = buildSelfRoleContainer({
    title: 'T',
    description: logic.flattenDescription('a\nb'),
    roles: [{ roleId: '111111111111111111', label: 'X', count: 0 }],
    lang: 'de',
  }).toJSON();
  assert.match(container.components[0].content, /a b/);
});

test('Rollennamen werden entschärft (@everyone, Umbrüche, Länge)', () => {
  assert.equal(logic.sanitizeRoleName('  Cool\nRolle '), 'Cool Rolle');
  assert.ok(!logic.sanitizeRoleName('@everyone hi').includes('@everyone'));
  assert.equal(logic.sanitizeRoleName('   '), null);
  assert.ok(logic.sanitizeRoleName('x'.repeat(200)).length <= logic.MAX_ROLE_NAME_LEN);
});

// ---------------------------------------------------------------------------
// „Datenbank ohne Datenbank“
// ---------------------------------------------------------------------------

test('Konfiguration überlebt Container → Nachricht → Parser', () => {
  const roles = [
    { roleId: '111111111111111111', label: '🎮 Zocker', count: 3 },
    { roleId: '222222222222222222', label: 'Künstler & Co', count: 17 },
  ];
  const container = buildSelfRoleContainer({
    title: 'Wähle deine Rollen 🎉',
    description: 'Alles in einer Zeile, versprochen.',
    roles,
    lang: 'de',
    mode: logic.MODE_SINGLE,
  }).toJSON();

  const message = { components: [container] };
  assert.ok(isSelfRoleMessage(message));

  const parsed = parseSelfRoleMessage(message);
  assert.equal(parsed.recovered, false);
  assert.equal(parsed.lang, 'de');
  assert.equal(parsed.mode, 'single');
  assert.equal(parsed.title, 'Wähle deine Rollen 🎉');
  assert.equal(parsed.description, 'Alles in einer Zeile, versprochen.');
  assert.deepEqual(parsed.roles, [
    { roleId: '111111111111111111', label: '🎮 Zocker' },
    { roleId: '222222222222222222', label: 'Künstler & Co' },
  ]);
});

test('Der Marker ist unsichtbar (nur Zero-Width-Zeichen)', () => {
  const container = buildSelfRoleContainer({
    title: 'T',
    description: 'D',
    roles: [{ roleId: '111111111111111111', label: 'A', count: 1 }],
    lang: 'de',
  }).toJSON();
  const header = container.components[0].content;
  const visible = header.replace(/[\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/g, '').trim();
  assert.equal(visible, '# T\nD', 'Nach Entfernen der ZW-Zeichen bleibt nur sichtbarer Text');
  // Der Marker selbst enthält keinerlei sichtbares Zeichen
  const markerLine = header.split('\n').pop();
  assert.ok(markerLine.length > 0);
  assert.equal(markerLine.replace(/[\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/g, ''), '');
});

test('Fallback-Recovery aus den Buttons, wenn der Marker verloren geht', () => {
  const container = buildSelfRoleContainer({
    title: 'T',
    description: 'D',
    roles: [
      { roleId: '111111111111111111', label: 'Foo', count: 5 },
      { roleId: '222222222222222222', label: 'Bar', count: 1234 },
    ],
    lang: 'de',
  }).toJSON();
  container.components[0].content = '# T\nD'; // Marker weg (Worst Case)

  const parsed = parseSelfRoleMessage({ components: [container] });
  assert.equal(parsed.recovered, true);
  assert.deepEqual(parsed.roles.map((r) => r.roleId), ['111111111111111111', '222222222222222222']);
  // Label wird ohne „(Anzahl)“ zurückgewonnen – auch mit Tausenderpunkt
  assert.deepEqual(parsed.roles.map((r) => r.label), ['Foo', 'Bar']);
});

// ---------------------------------------------------------------------------
// Layout der finalen Nachricht
// ---------------------------------------------------------------------------

test('Finale Nachricht: Liste „Platzhalter (Anzahl) - @Rolle“ + graue Buttons', () => {
  const roles = [
    { roleId: '111111111111111111', label: 'Gamer', count: 3 },
    { roleId: '222222222222222222', label: 'Artist', count: 0 },
  ];
  const json = buildSelfRoleContainer({ title: 'Titel', description: 'Text', roles, lang: 'en' }).toJSON();

  const listBlock = json.components.find(
    (c) => c.type === 10 && c.content.includes('<@&111111111111111111>')
  );
  assert.ok(listBlock, 'Rollenliste existiert');
  assert.equal(
    listBlock.content,
    'Gamer (3) - <@&111111111111111111>\nArtist (0) - <@&222222222222222222>'
  );

  const buttons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((b) => b.label), ['Gamer (3)', 'Artist (0)']);
  assert.deepEqual(buttons.map((b) => b.custom_id), ['srl_role_111111111111111111', 'srl_role_222222222222222222']);
  for (const b of buttons) assert.equal(b.style, ButtonStyle.Secondary, 'Alle Buttons sind grau');
});

test('20 Rollen passen in 4 Button-Reihen (5 pro Reihe)', () => {
  const roles = Array.from({ length: logic.MAX_ROLES }, (_, i) => ({
    roleId: String(100000000000000000 + i),
    label: `Rolle ${i + 1}`,
    count: i,
  }));
  const json = buildSelfRoleContainer({ title: 'T', description: 'D', roles, lang: 'de' }).toJSON();
  const rows = json.components.filter((c) => c.type === 1);
  assert.equal(rows.length, 4);
  for (const row of rows) assert.ok(row.components.length <= 5);
  assert.equal(rows.flatMap((r) => r.components).length, 20);
});

test('Button-Label bleibt unter Discords 80-Zeichen-Limit', () => {
  const long = 'M'.repeat(300);
  const label = logic.buttonLabel(long, 123456, 'de');
  assert.ok(label.length <= 80, `Label zu lang: ${label.length}`);
  assert.ok(label.endsWith('(123.456)'));
});

// ---------------------------------------------------------------------------
// Custom-IDs & Limits
// ---------------------------------------------------------------------------

test('Custom-IDs lassen sich bauen und wieder auseinandernehmen', () => {
  assert.deepEqual(logic.parseCustomId(logic.CID.role('123')), { kind: 'role', roleId: '123' });
  assert.deepEqual(logic.parseCustomId(logic.CID.drop('1', '2', '3')), {
    kind: 'drop',
    roleId: '1',
    channelId: '2',
    messageId: '3',
  });
  assert.deepEqual(logic.parseCustomId(logic.CID.editor('publish', 'abc123')), {
    kind: 'editor',
    action: 'publish',
    sessionId: 'abc123',
  });
  assert.deepEqual(logic.parseCustomId(logic.CID.removeSelect('s1')), { kind: 'removeSelect', sessionId: 's1' });
  assert.deepEqual(logic.parseCustomId(logic.CID.roleModal('s1')), { kind: 'roleModal', sessionId: 's1' });
  assert.deepEqual(logic.parseCustomId(logic.CID.textModal('s1')), { kind: 'textModal', sessionId: 's1' });
  assert.deepEqual(logic.parseCustomId(logic.CID.createModal('42')), { kind: 'createModal', channelId: '42' });
  assert.deepEqual(logic.parseCustomId(logic.CID.pickMessage), { kind: 'pickMessage' });
  assert.equal(logic.parseCustomId('bday_add'), null, 'Fremde IDs werden ignoriert');
  assert.equal(logic.parseCustomId(''), null);
});

test('Alle Custom-IDs bleiben unter Discords 100-Zeichen-Limit', () => {
  const sessionId = logic.newSessionId();
  const ids = [
    logic.CID.role('123456789012345678'),
    logic.CID.drop('123456789012345678', '123456789012345678', '123456789012345678'),
    logic.CID.editor('publish', sessionId),
    logic.CID.removeSelect(sessionId),
    logic.CID.roleModal(sessionId),
    logic.CID.textModal(sessionId),
    logic.CID.createModal('123456789012345678'),
  ];
  for (const id of ids) assert.ok(id.length <= 100, `${id} ist zu lang (${id.length})`);
});

test('Limits: min. 2, max. 20 Rollen, max. 10 Nachrichten', () => {
  assert.equal(logic.MIN_ROLES, 2);
  assert.equal(logic.MAX_ROLES, 20);
  assert.equal(logic.MAX_MESSAGES, 10);

  assert.deepEqual(logic.validateDraft({ roles: [] }), { ok: false, reason: 'min' });
  assert.deepEqual(logic.validateDraft({ roles: [{}] }), { ok: false, reason: 'min' });
  assert.deepEqual(logic.validateDraft({ roles: [{}, {}] }), { ok: true });
  assert.deepEqual(logic.validateDraft({ roles: Array(20).fill({}) }), { ok: true });
  assert.deepEqual(logic.validateDraft({ roles: Array(21).fill({}) }), { ok: false, reason: 'max' });
});

test('Auswahl-Modus wird sauber normalisiert', () => {
  assert.equal(logic.normalizeMode('single'), 'single');
  assert.equal(logic.normalizeMode('multi'), 'multi');
  assert.equal(logic.normalizeMode('quatsch'), 'multi');
  assert.equal(logic.normalizeMode(undefined), 'multi');
});

// ---------------------------------------------------------------------------
// Formulare & Editor-Oberfläche
// ---------------------------------------------------------------------------

test('/create_self_role-Formular: große Textbox + kleines Titelfeld', () => {
  const modal = buildCreateModal('de', '123456789012345678').toJSON();
  assert.equal(modal.custom_id, 'srl_createmodal_123456789012345678');
  const inputs = modal.components.flatMap((r) => r.components);
  assert.equal(inputs.length, 2);
  const desc = inputs.find((i) => i.custom_id === 'description');
  const title = inputs.find((i) => i.custom_id === 'title');
  assert.equal(desc.style, 2, 'Beschreibung ist die große Paragraph-Box');
  assert.equal(title.style, 1, 'Titel ist ein kleines Short-Feld');
  assert.ok(title.required);
  for (const i of inputs) assert.ok(i.label.length <= 45, 'Label-Limit von Discord eingehalten');
});

test('Rollen-Formular fragt Rollenname + Text-Platzhalter ab', () => {
  const modal = buildRoleModal('de', 'sess1').toJSON();
  const inputs = modal.components.flatMap((r) => r.components);
  assert.deepEqual(inputs.map((i) => i.custom_id), ['role_name', 'role_label']);
  for (const i of inputs) {
    assert.ok(i.required);
    assert.ok(i.label.length <= 45);
  }
});

test('Editor zeigt Kanal, Titel, Beschreibung, Modus und Rollenstand', () => {
  const session = newSession({
    guildId: 'g1',
    channelId: '999888777666555444',
    userId: 'u1',
    lang: 'de',
    title: 'Mein Titel',
    description: 'Meine Beschreibung',
  });

  // Ohne Rollen: Hinweis + Absenden deaktiviert
  let json = buildEditorContainer(session).toJSON();
  let text = JSON.stringify(json);
  assert.match(text, /999888777666555444/, 'Kanal wird bestätigt');
  assert.match(text, /Mein Titel/);
  assert.match(text, /Meine Beschreibung/);
  assert.match(text, /Noch keine Rollen konfiguriert/);
  let buttons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  const publish = buttons.find((b) => b.custom_id.startsWith('srl_ed_publish'));
  assert.equal(publish.disabled, true, 'Absenden bleibt gesperrt bis 2 Rollen da sind');

  // Mit 2 Rollen: freigeschaltet
  session.roles = [
    { label: 'A', name: 'Rolle A', roleId: null },
    { label: 'B', name: 'Rolle B', roleId: null },
  ];
  json = buildEditorContainer(session).toJSON();
  buttons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  assert.equal(buttons.find((b) => b.custom_id.startsWith('srl_ed_publish')).disabled, false);
  assert.ok(buttons.some((b) => b.custom_id.startsWith('srl_ed_add')));
  assert.ok(buttons.some((b) => b.custom_id.startsWith('srl_ed_remove')));
  assert.ok(buttons.some((b) => b.custom_id.startsWith('srl_ed_mode')));
  assert.ok(buttons.some((b) => b.custom_id.startsWith('srl_ed_text')));
  assert.ok(buttons.some((b) => b.custom_id.startsWith('srl_ed_cancel')));

  // Bei 20 Rollen ist „Hinzufügen“ dicht
  session.roles = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, name: `N${i}`, roleId: null }));
  json = buildEditorContainer(session).toJSON();
  buttons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  assert.equal(buttons.find((b) => b.custom_id.startsWith('srl_ed_add')).disabled, true);
});

test('Weitere Editor-Ansichten bauen gültiges JSON', () => {
  const session = newSession({ guildId: 'g', channelId: 'c', userId: 'u', lang: 'de' });
  session.roles = [{ label: 'A', name: 'Rolle A', roleId: null }];
  const remove = buildRemoveSelectContainer(session).toJSON();
  const select = remove.components.filter((c) => c.type === 1).flatMap((r) => r.components)[0];
  assert.equal(select.type, 3);
  assert.equal(select.options.length, 1);
  assert.equal(select.options[0].value, '0');

  const picker = buildMessagePickerContainer({
    lang: 'de',
    entries: [{ channelId: '1', messageId: '2', title: 'X', roleCount: 3, channelName: 'allgemein' }],
  }).toJSON();
  const pick = picker.components.filter((c) => c.type === 1).flatMap((r) => r.components)[0];
  assert.equal(pick.custom_id, 'srl_pick_message');
  assert.equal(pick.options[0].value, '1:2');

  const already = buildAlreadyHasContainer({
    lang: 'de',
    roleId: '111111111111111111',
    channelId: '2',
    messageId: '3',
  }).toJSON();
  const dropBtn = already.components.filter((c) => c.type === 1).flatMap((r) => r.components)[0];
  assert.equal(dropBtn.custom_id, 'srl_drop_111111111111111111_2_3');
  assert.equal(dropBtn.style, ButtonStyle.Danger);
});

// ---------------------------------------------------------------------------
// Discord-Limits im Extremfall
// ---------------------------------------------------------------------------

test('Maximal befüllte Nachricht sprengt kein Discord-Limit', () => {
  const roles = Array.from({ length: logic.MAX_ROLES }, (_, i) => ({
    roleId: `90000000000000${String(i).padStart(4, '0')}`,
    label: 'X'.repeat(logic.MAX_LABEL_LEN),
    count: 999999,
  }));
  const json = buildSelfRoleContainer({
    title: 'T'.repeat(logic.MAX_TITLE_LEN),
    description: 'D'.repeat(logic.MAX_DESC_LEN),
    roles,
    lang: 'de',
    mode: logic.MODE_SINGLE,
  }).toJSON();

  // Jedes TextDisplay maximal 4000 Zeichen
  for (const c of json.components) {
    if (c.type === 10) assert.ok(c.content.length <= 4000, `TextDisplay zu lang: ${c.content.length}`);
  }
  // Container: maximal 40 Komponenten, Buttons maximal 5 pro Reihe
  assert.ok(json.components.length <= 40);
  for (const row of json.components.filter((c) => c.type === 1)) {
    assert.ok(row.components.length <= 5);
    for (const b of row.components) {
      assert.ok(b.label.length <= 80);
      assert.ok(b.custom_id.length <= 100);
    }
  }

  // Und der Roundtrip funktioniert trotzdem verlustfrei
  const parsed = parseSelfRoleMessage({ components: [json] });
  assert.equal(parsed.roles.length, logic.MAX_ROLES);
  assert.equal(parsed.mode, 'single');
  assert.equal(parsed.lang, 'de');
  assert.equal(parsed.title.length, logic.MAX_TITLE_LEN);
  assert.equal(parsed.description.length, logic.MAX_DESC_LEN);
});

test('Platzhalter mit Klammern und Emojis überleben den Roundtrip', () => {
  const json = buildSelfRoleContainer({
    title: 'Titel (mit Klammer)',
    description: 'Beschreibung (auch mit Klammer) – und Gedankenstrich',
    roles: [
      { roleId: '111111111111111111', label: '🎮 Zocker (Pro)', count: 1234 },
      { roleId: '222222222222222222', label: 'A (B) (C)', count: 0 },
    ],
    lang: 'de',
  }).toJSON();

  const parsed = parseSelfRoleMessage({ components: [json] });
  assert.equal(parsed.title, 'Titel (mit Klammer)');
  assert.equal(parsed.description, 'Beschreibung (auch mit Klammer) – und Gedankenstrich');
  assert.deepEqual(parsed.roles.map((r) => r.label), ['🎮 Zocker (Pro)', 'A (B) (C)']);
});

test('Listenzeilen lassen sich einzeln bauen und parsen', () => {
  const line = logic.roleLine('🎮 Zocker', 1234, '111111111111111111', 'de');
  assert.equal(line, '🎮 Zocker (1.234) - <@&111111111111111111>');
  assert.deepEqual(logic.parseRoleLine(line), {
    label: '🎮 Zocker',
    count: 1234,
    roleId: '111111111111111111',
  });
  assert.equal(logic.parseRoleLine('irgendein Fließtext'), null);
  assert.equal(logic.parseRoleLine(''), null);
});

test('Der unsichtbare Marker bleibt winzig (nur Sprache + Modus)', () => {
  const payload = logic.encodeConfigPayload({ lang: 'de', mode: 'single' });
  assert.equal(payload, 'srl::v1::de:single');
  assert.ok(payload.length < 30, 'Marker ist kurz genug für jedes TextDisplay');
  const decoded = logic.decodeConfigPayload(payload);
  assert.equal(decoded.lang, 'de');
  assert.equal(decoded.mode, 'single');
});

test('Alte Nachrichten im ausführlichen Marker-Format werden noch verstanden', () => {
  // So sah der Marker in der ersten Version aus (Titel/Beschreibung/Rollen inline)
  const legacy = [
    `srl::v1::de:multi:${logic.encodeText('Alter Titel')}:${logic.encodeText('Alte Beschreibung')}`,
    `srl-e:111111111111111111:${logic.encodeText('Altes Label')}`,
  ].join('|');
  const decoded = logic.decodeConfigPayload(legacy);
  assert.equal(decoded.legacy, true);
  assert.equal(decoded.title, 'Alter Titel');
  assert.equal(decoded.description, 'Alte Beschreibung');
  assert.deepEqual(decoded.roles, [{ roleId: '111111111111111111', label: 'Altes Label' }]);
});

test('Doppelte Platzhalter werden über den Vergleichsschlüssel erkannt', () => {
  assert.equal(logic.labelKey('  Gamer  '), logic.labelKey('gamer'));
  assert.notEqual(logic.labelKey('Gamer'), logic.labelKey('Gamer 2'));
});

test('Ephemere Button-Antworten tragen das Ephemeral-Flag (nur für den Klicker)', () => {
  const { smallContainer } = require('../bots/self-roles-bot/src/embed-builder');
  const privateReply = componentsV2Payload([smallContainer(null, 'Zack')], { ephemeral: true });
  const publicMessage = componentsV2Payload([smallContainer(null, 'Rollen')], { ephemeral: false });

  assert.equal(
    (privateReply.flags & MessageFlags.Ephemeral) !== 0,
    true,
    'Klick-Antwort muss ephemeral sein'
  );
  assert.equal(
    (privateReply.flags & MessageFlags.IsComponentsV2) !== 0,
    true,
    'Klick-Antwort bleibt Components V2'
  );
  assert.equal(
    (publicMessage.flags & MessageFlags.Ephemeral) !== 0,
    false,
    'Die fertige Self-Roles-Nachricht selbst bleibt öffentlich'
  );
  assert.equal('ephemeral' in privateReply, false, 'Kein veraltetes ephemeral-Feld im Payload');
});
