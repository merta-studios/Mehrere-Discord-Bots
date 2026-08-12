/**
 * Tests für den Verify-Bot – komplett ohne Discord-Verbindung.
 *
 * Geprüft werden:
 * - Konfig-Marker Roundtrip (die „Datenbank“ in der Nachricht)
 * - Regeln-Container bauen & wieder auslesen (Self-Healing)
 * - Anfrage-Marker Roundtrip (Log-Kanal)
 * - Custom-ID-Parsing für Buttons/Modals
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MODE_VERIFY,
  MODE_CLASSIC,
  VF_NONE,
  VF_SIMPLE,
  VF_FORM,
  CID,
  parseCustomId,
  encodeConfigPayload,
  decodeConfigPayload,
  encodeRequestPayload,
  decodeRequestPayload,
  sanitizeRules,
  sanitizeButtonName,
} = require('../bots/verify-bot/src/logic');
const {
  buildRulesContainer,
  parseRulesMessage,
  isRulesMessage,
  buildRequestContainer,
  parseRequestMessage,
  extractAllText,
} = require('../bots/verify-bot/src/embed-builder');
const { defineCommands } = require('../bots/verify-bot/src/commands');

function containerToMessage(container) {
  const json = container.toJSON();
  return {
    content: '',
    components: [json],
    embeds: [],
    author: { id: 'bot1' },
  };
}

test('Konfig-Marker Roundtrip (Verify-Modus, vollständig)', () => {
  const config = {
    mode: MODE_VERIFY,
    lang: 'de',
    buttonName: '✅ Verifizieren',
    loggingChannelId: '123456',
    unverifiedRoleId: '111',
    verifiedRoleId: '222',
    verifyForm: VF_FORM,
    formFields: [
      { id: 'abc', question: 'Wie alt bist du?', placeholder: '18', value: '', style: 'short', required: true },
      { id: 'def', question: 'Warum hier?', placeholder: '', value: 'weil cool', style: 'long', required: false },
    ],
    bannerUrl: 'https://example.com/banner.png',
    imageUrl: 'https://example.com/img.png',
  };
  const payload = encodeConfigPayload(config);
  assert.ok(payload.startsWith('vrf::v1::'), 'Marker-Präfix vorhanden');
  const decoded = decodeConfigPayload(payload);
  assert.deepEqual(decoded, config);
});

test('Konfig-Marker: ungültige Sprache & Modus werden normalisiert', () => {
  const decoded = decodeConfigPayload(encodeConfigPayload({ mode: 'foo', lang: 'XX' }));
  assert.equal(decoded.mode, MODE_VERIFY);
  assert.equal(decoded.lang, 'en');
});

test('Regeln-Container: bauen → senden → wieder auslesen (Self-Healing)', () => {
  const config = {
    mode: MODE_VERIFY,
    lang: 'de',
    rules: '# Regeln\n\n1. Sei nett\n2. Kein Spam',
    buttonName: '✅ Verifizieren',
    loggingChannelId: '123456',
    unverifiedRoleId: '111',
    verifiedRoleId: '222',
    verifyForm: VF_NONE,
    formFields: [],
    bannerUrl: '',
    imageUrl: '',
  };
  const container = buildRulesContainer({ config });
  const message = containerToMessage(container);

  const parsed = parseRulesMessage(message);
  assert.ok(parsed, 'Konfiguration wurde gelesen');
  assert.equal(parsed.mode, MODE_VERIFY);
  assert.equal(parsed.lang, 'de');
  assert.equal(parsed.buttonName, '✅ Verifizieren');
  assert.equal(parsed.loggingChannelId, '123456');
  assert.equal(parsed.unverifiedRoleId, '111');
  assert.equal(parsed.verifiedRoleId, '222');
  assert.equal(parsed.rules, '# Regeln\n\n1. Sei nett\n2. Kein Spam');

  assert.equal(isRulesMessage(message), true, 'Nachricht wird als Regeln-Nachricht erkannt');
});

test('Klassische Regeln haben keinen Verify-Button', () => {
  const container = buildRulesContainer({
    config: {
      mode: MODE_CLASSIC,
      lang: 'en',
      rules: 'Only rules.',
      buttonName: '',
      loggingChannelId: '',
      unverifiedRoleId: '',
      verifiedRoleId: '',
      verifyForm: VF_NONE,
      formFields: [],
      bannerUrl: '',
      imageUrl: '',
    },
  });
  const text = extractAllText(container.toJSON());
  const json = JSON.stringify(container.toJSON());
  assert.ok(!json.includes('"custom_id":"vrf_verify"'), 'kein Verify-Button im klassischen Modus');
  assert.ok(text.includes('Only rules.'), 'Regeln sichtbar');
});

test('Anfrage-Marker Roundtrip', () => {
  const req = {
    userId: 'user1',
    guildId: 'g1',
    rulesMessageId: 'm1',
    rulesChannelId: 'c1',
    loggingChannelId: 'log1',
    verifiedRoleId: '222',
    unverifiedRoleId: '111',
    lang: 'de',
    requestedAt: 1700000000000,
    status: 'open',
  };
  const payload = encodeRequestPayload(req);
  const decoded = decodeRequestPayload(payload);
  assert.deepEqual(decoded, req);
});

test('Anfrage-Container: bauen → auslesen', () => {
  const req = {
    userId: 'user1',
    guildId: 'g1',
    rulesMessageId: 'm1',
    rulesChannelId: 'c1',
    loggingChannelId: 'log1',
    verifiedRoleId: '222',
    unverifiedRoleId: '111',
    lang: 'de',
    requestedAt: Date.now(),
    status: 'open',
  };
  const container = buildRequestContainer({
    lang: 'de',
    user: 'user1',
    answers: [{ question: 'Wie alt?', answer: '20' }],
    req,
  });
  const message = containerToMessage(container);
  const parsed = parseRequestMessage(message);
  assert.ok(parsed, 'Anfrage wurde gelesen');
  assert.equal(parsed.userId, 'user1');
  assert.equal(parsed.status, 'open');
  assert.equal(parsed.verifiedRoleId, '222');
});

test('Custom-IDs: alle Button-/Modal-Kinds werden korrekt geparst', () => {
  assert.deepEqual(parseCustomId(CID.verify), { kind: 'verify' });
  assert.deepEqual(parseCustomId(CID.approve), { kind: 'approve' });
  assert.deepEqual(parseCustomId(CID.reject), { kind: 'reject' });
  assert.deepEqual(parseCustomId(CID.editor('publish', 'sid123')), { kind: 'editor', action: 'publish', sessionId: 'sid123' });
  assert.deepEqual(parseCustomId(CID.fieldEditor('add', 'sid123')), { kind: 'fieldEditor', action: 'add', sessionId: 'sid123' });
  assert.deepEqual(parseCustomId(CID.createModal('verify', 'chan1')), { kind: 'createModal', modalKind: 'verify', channelId: 'chan1' });
  assert.deepEqual(parseCustomId(CID.rejectModal('c1', 'm1')), { kind: 'rejectModal', channelId: 'c1', messageId: 'm1' });
  assert.deepEqual(parseCustomId(CID.verifyFormModal('c1', 'm1')), { kind: 'verifyFormModal', channelId: 'c1', messageId: 'm1' });
  assert.equal(parseCustomId('irgendwas_fremdes'), null);
});

test('Text-Säuberung: Regeln behalten Markdown, Button-Name wird einzeilig', () => {
  const rules = sanitizeRules('  Zeile 1\n\nZeile 2  ');
  assert.equal(rules, 'Zeile 1\n\nZeile 2');
  assert.equal(sanitizeButtonName('  ✅\nVerifizieren  '), '✅ Verifizieren');
});

// ---------------------------------------------------------------------------
// Slash-Command-Definitionen: alle Commands müssen baubar & Discord-API-valide
// sein. Regression: languageChoices nutzte rohe Sprachcodes (de, en, es, pt, zh)
// statt Discord-Locale-Codes (de, en-US, es-ES, pt-BR, zh-CN) als
// name_localizations-Keys. @discordjs/builders warf dadurch schon beim Bauen –
// defineCommands() scheiterte, registerCommands() fing den Fehler still ab und
// KEIN Command des Verify-Bots wurde registriert.
// ---------------------------------------------------------------------------

const VALID_LOCALES = new Set([
  'id', 'da', 'de', 'en-GB', 'en-US', 'es-ES', 'es-419', 'fr', 'hr', 'it', 'lt',
  'hu', 'nl', 'no', 'pl', 'pt-BR', 'ro', 'fi', 'sv-SE', 'vi', 'tr', 'cs', 'el',
  'bg', 'ru', 'uk', 'hi', 'th', 'zh-CN', 'ja', 'zh-TW', 'ko',
]);

function assertValidLocales(map, path) {
  for (const [locale] of Object.entries(map || {})) {
    assert.ok(VALID_LOCALES.has(locale), `${path}: ungültige Discord-Locale "${locale}"`);
  }
}

test('alle 7 Slash-Commands des Verify-Bots sind baubar und Discord-API-valide', () => {
  const cmds = defineCommands().map((c) => c.toJSON());
  assert.equal(cmds.length, 7);
  assert.deepEqual(
    cmds.map((c) => c.name),
    ['create_verify_rules', 'create_classic_rules', 'set_verify_form', 'set_language', 'admin_set_bot_profile', 'help', 'adminpanel']
  );

  for (const cmd of cmds) {
    assertValidLocales(cmd.name_localizations, `${cmd.name}.name`);
    assertValidLocales(cmd.description_localizations, `${cmd.name}.description`);
    for (const [locale, value] of Object.entries(cmd.description_localizations || {})) {
      assert.ok(value.length >= 1 && value.length <= 100, `${cmd.name}: lokalisierte Beschreibung "${locale}" muss 1-100 Zeichen haben (${value.length})`);
    }
    for (const opt of cmd.options || []) {
      assertValidLocales(opt.name_localizations, `${cmd.name}.${opt.name}.name`);
      assertValidLocales(opt.description_localizations, `${cmd.name}.${opt.name}.description`);
      for (const choice of opt.choices || []) {
        assertValidLocales(choice.name_localizations, `${cmd.name}.${opt.name}.choice[${choice.value}].name`);
      }
    }
  }
});
