/**
 * Tests für den Security-Bot (OpenAI Moderation, Regeln, Persistenz, Commands & UI).
 * Läuft komplett ohne externe Discord- oder OpenAI-Verbindung.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

const { defineCommands, ALL_COMMAND_NAMES, GUILD_COMMAND_NAMES, GLOBAL_COMMAND_NAMES } = require('../bots/security-bot/src/commands');
const { LANGS, t, langFromDiscord, DISCORD_LOCALE } = require('../bots/security-bot/src/languages');
const {
  CATEGORIES,
  PRESET_THRESHOLDS,
  DEFAULT_WARNING_ESCALATION,
  getActionForWarningCount,
  getActionSeconds,
  getDefaultGuildConfig,
  normalizeGuildConfig,
  maskApiKey,
  progressBar,
} = require('../bots/security-bot/src/rules');
const { createSecurityStore } = require('../bots/security-bot/src/store');
const { evaluateModerationResult, callOpenAIModeration, handleMessageModeration } = require('../bots/security-bot/src/moderation');
const {
  smallContainer,
  buildStatusContainer,
  buildManageUserContainer,
  buildTestReportContainer,
  buildWarningsConfigContainer,
  buildRulesConfigContainer,
  buildSensitivityContainer,
  buildViolationAlertContainer,
} = require('../bots/security-bot/src/embed-builder');

test('Security Bot: Modul-Export & Intents', () => {
  const bot = require('../bots/security-bot/index.js');
  assert.equal(bot.id, 'security-bot');
  assert.equal(bot.name, 'Security Bot');
  assert.equal(bot.tokenEnv, 'SECURITY_BOT_TOKEN');
  assert.equal(typeof bot.create, 'function');
  assert.ok(Array.isArray(bot.intents));
});

test('Security Bot: Slash-Commands Definition & Permissions', () => {
  const cmds = defineCommands().map((c) => c.toJSON());
  assert.equal(cmds.length, 11);

  const names = cmds.map((c) => c.name).sort();
  assert.deepEqual(names, [
    'admin_set_bot_profile',
    'adminpanel',
    'configure_rules',
    'help',
    'manage_user',
    'set_api_key',
    'set_language',
    'set_sensitivity',
    'set_warnings',
    'status',
    'test_text',
  ].sort());

  // Admin-Rechte prüfen (Bit 8 = Administrator)
  const adminCmds = [
    'set_api_key',
    'set_language',
    'set_sensitivity',
    'configure_rules',
    'set_warnings',
    'manage_user',
    'test_text',
    'admin_set_bot_profile',
  ];

  for (const name of adminCmds) {
    const cmd = cmds.find((c) => c.name === name);
    assert.ok(cmd, `Command /${name} existiert`);
    assert.equal(cmd.default_member_permissions, '8', `/${name} erfordert Admin-Rechte (Bit 8)`);
  }

  // /status und /help sind für alle verfügbar
  const statusCmd = cmds.find((c) => c.name === 'status');
  assert.equal(statusCmd.default_member_permissions, undefined, '/status ist für alle verfügbar');
  const helpCmd = cmds.find((c) => c.name === 'help');
  assert.equal(helpCmd.default_member_permissions, undefined, '/help ist für alle verfügbar');

  // /set_language hat 10 Sprach-Auswahlen
  const langCmd = cmds.find((c) => c.name === 'set_language');
  assert.equal(langCmd.options[0].choices.length, 10, '10 Sprachen stehen zur Auswahl');

  // /admin_set_bot_profile hat 3 Bild-Auswahlen
  const profCmd = cmds.find((c) => c.name === 'admin_set_bot_profile');
  assert.deepEqual(
    profCmd.options[0].choices.map((c) => c.value),
    ['standard', 'server', 'owner']
  );

  // Erforderliche Optionen dürfen nicht nach optionalen Optionen stehen
  for (const cmd of cmds) {
    if (!cmd.options) continue;
    let seenOptional = false;
    for (const opt of cmd.options) {
      if (opt.required) {
        assert.equal(
          seenOptional,
          false,
          `In /${cmd.name}: erforderliche Option "${opt.name}" steht hinter optionaler Option`
        );
      } else {
        seenOptional = true;
      }
    }
  }
});

test('Security Bot: 10 Sprachen & Übersetzungstexte', () => {
  const expectedLangs = ['de', 'en', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh', 'it'];
  assert.deepEqual(Object.keys(LANGS), expectedLangs);

  for (const lang of expectedLangs) {
    assert.ok(LANGS[lang].name, `Sprachname für ${lang} vorhanden`);
    assert.ok(LANGS[lang].tz, `Zeitzone für ${lang} vorhanden`);
    assert.ok(t('helpTitle', lang).length > 0, `helpTitle für ${lang}`);
    assert.ok(t('warnTitle', lang).length > 0, `warnTitle für ${lang}`);
    assert.ok(t('statusTitle', lang, { user: 'Test' }).includes('Test'), `statusTitle für ${lang}`);
  }

  assert.equal(langFromDiscord('de'), 'de');
  assert.equal(langFromDiscord('en-US'), 'en');
  assert.equal(langFromDiscord('fr'), 'fr');
  assert.equal(langFromDiscord('ja'), 'ja');
});

test('Security Bot: Regeln, Schwellenwerte & Eskalationsstufen', () => {
  assert.equal(CATEGORIES.length, 13);
  assert.equal(PRESET_THRESHOLDS.strict, 0.30);
  assert.equal(PRESET_THRESHOLDS.balanced, 0.50);
  assert.equal(PRESET_THRESHOLDS.relaxed, 0.75);

  // Eskalation prüfen
  const a1 = getActionForWarningCount(1);
  assert.equal(a1.action, 'warn');
  assert.equal(a1.timeoutSeconds, 0);

  const a2 = getActionForWarningCount(2);
  assert.equal(a2.action, 'timeout_600s');
  assert.equal(a2.timeoutSeconds, 600);

  const a3 = getActionForWarningCount(3);
  assert.equal(a3.action, 'timeout_86400s');
  assert.equal(a3.timeoutSeconds, 86400);

  const a4 = getActionForWarningCount(4);
  assert.equal(a4.action, 'timeout_604800s');
  assert.equal(a4.timeoutSeconds, 604800);

  // Höhere Warnungen greifen auf die schärfste Stufe zurück
  const a10 = getActionForWarningCount(10);
  assert.equal(a10.action, 'timeout_604800s');

  assert.equal(getActionSeconds('warn'), 0);
  assert.equal(getActionSeconds('timeout_600s'), 600);
  assert.equal(getActionSeconds('timeout_86400s'), 86400);

  assert.equal(maskApiKey('sk-proj-1234567890abcdef'), 'sk-proj...cdef');
  assert.equal(maskApiKey(''), '—');
});

test('Security Bot: Store CRUD & RAM-first Verhaltensweisen', async () => {
  const store = createSecurityStore({
    env: (k) => (k === 'SECURITY_STORE_DISABLE_FILE_BACKUP' ? 'true' : ''),
  });
  await store.init();

  // Guild config
  const g1 = store.ensureGuild('guild_123');
  assert.equal(g1.guildId, 'guild_123');
  assert.equal(g1.lang, 'de');
  assert.equal(g1.sensitivity, 'balanced');

  store.setApiKey('guild_123', 'sk-test-key-123');
  assert.equal(store.getApiKey('guild_123'), 'sk-test-key-123');

  store.setLanguage('guild_123', 'en');
  assert.equal(store.getLanguage('guild_123'), 'en');

  // Violations
  const v1 = store.addViolation({
    id: 'v_test_1',
    guildId: 'guild_123',
    userId: 'user_456',
    highestCategory: 'hate',
    highestScore: 0.95,
    contentSnippet: 'Offensive message',
    actionTaken: 'warn',
    timeoutSeconds: 0,
    warningNumber: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 14 * 86400 * 1000,
  });
  assert.ok(v1);
  assert.equal(v1.id, 'v_test_1');

  const active = store.getViolations('guild_123', 'user_456', { activeOnly: true });
  assert.equal(active.length, 1);
  assert.equal(active[0].highestCategory, 'hate');

  // Einzelnen Verstoß löschen (Fehlalarm)
  const delOk = store.deleteViolation('v_test_1', { deletedBy: 'admin_999' });
  assert.equal(delOk, true);

  const activeAfterDel = store.getViolations('guild_123', 'user_456', { activeOnly: true });
  assert.equal(activeAfterDel.length, 0);

  const allAfterDel = store.getViolations('guild_123', 'user_456', { activeOnly: false });
  assert.equal(allAfterDel.length, 1);
  assert.equal(allAfterDel[0].deleted, true);

  // Zweiter Verstoß und Clear All
  store.addViolation({
    id: 'v_test_2',
    guildId: 'guild_123',
    userId: 'user_456',
    highestCategory: 'harassment',
    highestScore: 0.85,
    actionTaken: 'timeout_600s',
    timeoutSeconds: 600,
    warningNumber: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 14 * 86400 * 1000,
  });

  assert.equal(store.getViolations('guild_123', 'user_456', { activeOnly: true }).length, 1);
  const cleared = store.clearUserViolations('guild_123', 'user_456', { deletedBy: 'admin_999' });
  assert.equal(cleared, 1);
  assert.equal(store.getViolations('guild_123', 'user_456', { activeOnly: true }).length, 0);

  // Command IDs API
  store.setCommandIds({ help: '111', status: '222' });
  assert.equal(store.getCommandId('help'), '111');
  assert.equal(store.getCommandId('status'), '222');

  store.setGuildCommandIds('guild_123', { set_api_key: '333' });
  assert.deepEqual(store.getGuildCommandIds('guild_123'), { set_api_key: '333' });
});

test('Security Bot: Moderations-Auswertung (OpenAI Response -> Regelwerk)', () => {
  const mockCleanResponse = {
    results: [
      {
        flagged: false,
        categories: {
          hate: false,
          harassment: false,
          violence: false,
          sexual: false,
          'self-harm': false,
        },
        category_scores: {
          hate: 0.001,
          harassment: 0.02,
          violence: 0.005,
          sexual: 0.0001,
          'self-harm': 0.00001,
        },
      },
    ],
  };

  const cleanEval = evaluateModerationResult({
    data: mockCleanResponse,
    guildConfig: getDefaultGuildConfig('g1'),
  });
  assert.equal(cleanEval.violated, false);
  assert.equal(cleanEval.highestCategory, null);
  assert.equal(cleanEval.shouldAutoDelete, false);

  const mockViolationResponse = {
    results: [
      {
        flagged: true,
        categories: {
          hate: true,
          harassment: true,
          violence: false,
          sexual: false,
          'self-harm': false,
        },
        category_scores: {
          hate: 0.88,
          harassment: 0.72,
          violence: 0.05,
          sexual: 0.001,
          'self-harm': 0.0001,
        },
      },
    ],
  };

  const violEval = evaluateModerationResult({
    data: mockViolationResponse,
    guildConfig: getDefaultGuildConfig('g1'),
  });
  assert.equal(violEval.violated, true);
  assert.equal(violEval.highestCategory, 'hate');
  assert.equal(violEval.highestScore, 0.88);
  assert.equal(violEval.shouldAutoDelete, true);
  assert.deepEqual(violEval.violatedCategories, ['hate', 'harassment']);

  // Schutzlevel Strikt schlägt auch bei Score 0.35 an
  const mockSubtleHate = {
    results: [
      {
        flagged: false,
        categories: { hate: false },
        category_scores: { hate: 0.35 },
      },
    ],
  };

  const balancedEval = evaluateModerationResult({
    data: mockSubtleHate,
    guildConfig: { ...getDefaultGuildConfig('g1'), sensitivity: 'balanced' },
  });
  assert.equal(balancedEval.violated, false, 'Bei Balanced (50%) kein Verstoß bei 35%');

  const strictConfig = {
    ...getDefaultGuildConfig('g1'),
    sensitivity: 'strict',
    categoryThresholds: { hate: 0.30 },
  };
  const strictEval = evaluateModerationResult({
    data: mockSubtleHate,
    guildConfig: strictConfig,
  });
  assert.equal(strictEval.violated, true, 'Bei Strict (30%) Verstoß bei 35%');
});

test('Security Bot: Nachrichten-Moderation (Admin-Bypass, Silent Failure & Aktion)', async () => {
  const store = createSecurityStore({
    env: (k) => (k === 'SECURITY_STORE_DISABLE_FILE_BACKUP' ? 'true' : ''),
  });
  await store.init();

  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const ctx = { store, logger };

  // 1. Bot-Nachricht -> ignoriert
  let botMsg = { author: { bot: true }, guild: { id: 'g1' }, content: 'bad' };
  await handleMessageModeration({ ctx, msg: botMsg });
  assert.equal(store.getAllViolationsForGuild('g1').length, 0);

  // 2. Admin-Nachricht -> ignoriert (Admin-Bypass)
  let adminMsg = {
    author: { id: 'admin1', bot: false },
    guild: { id: 'g1' },
    member: {
      permissions: {
        has: (p) => p === PermissionFlagsBits.Administrator,
      },
    },
    content: 'bad content from admin',
  };
  await handleMessageModeration({ ctx, msg: adminMsg });
  assert.equal(store.getAllViolationsForGuild('g1').length, 0);

  // 3. Kein API-Key hinterlegt -> still ignoriert
  let userMsgNoKey = {
    author: { id: 'user1', bot: false },
    guild: { id: 'g1' },
    member: {
      permissions: {
        has: () => false,
      },
    },
    content: 'some text',
  };
  await handleMessageModeration({ ctx, msg: userMsgNoKey });
  assert.equal(store.getAllViolationsForGuild('g1').length, 0);

  // 4. Mit API-Key & Mock-Call
  store.setApiKey('g1', 'sk-valid-key');
  let deletedCalled = false;
  let sentPayload = null;
  let timeoutCalled = false;

  let memberObj = {
    id: 'user1',
    moderatable: true,
    permissions: { has: () => false },
    timeout: async (ms, reason) => {
      timeoutCalled = true;
    },
  };

  let channelObj = {
    send: async (p) => {
      sentPayload = p;
      return { id: 'm_alert' };
    },
  };

  let violMsg = {
    id: 'm100',
    author: { id: 'user1', bot: false },
    guild: {
      id: 'g1',
      members: { fetch: async () => memberObj },
    },
    member: memberObj,
    channel: channelObj,
    content: 'toxic insult text',
    attachments: new Map(),
    delete: async () => {
      deletedCalled = true;
    },
    reply: async (p) => {
      sentPayload = p;
    },
  };

  // Mock globalThis.fetch für OpenAI
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            flagged: true,
            categories: { harassment: true },
            category_scores: { harassment: 0.92 },
          },
        ],
      }),
    };
  };

  try {
    await handleMessageModeration({ ctx, msg: violMsg });
    assert.equal(deletedCalled, true, 'Nachricht wurde automatisch gelöscht');
    assert.ok(sentPayload, 'Verwarnung wurde gesendet');
    assert.equal(sentPayload.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);

    const recorded = store.getViolations('g1', 'user1', { activeOnly: true });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].highestCategory, 'harassment');
    assert.equal(recorded[0].warningNumber, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Security Bot: UI-Container Builder & Components V2', () => {
  const statusContainer = buildStatusContainer({
    lang: 'de',
    userId: '123456',
    activeViolations: [],
    maxWarnings: 3,
  });
  assert.ok(statusContainer);

  const manageContainer = buildManageUserContainer({
    lang: 'de',
    targetUser: { id: '123456', tag: 'User#0001' },
    activeViolations: [
      {
        id: 'v_1',
        highestCategory: 'hate',
        actionTaken: 'warn',
        expiresAt: Date.now() + 100000,
      },
    ],
    allViolations: [],
    maxWarnings: 3,
  });
  assert.ok(manageContainer);

  const testContainer = buildTestReportContainer({
    lang: 'de',
    text: 'Test message',
    evalRes: {
      violated: true,
      highestCategory: 'violence',
      highestScore: 0.85,
      shouldAutoDelete: true,
      details: [
        { category: 'violence', score: 0.85, threshold: 0.50, enabled: true, violation: true },
        { category: 'hate', score: 0.05, threshold: 0.50, enabled: true, violation: false },
      ],
    },
    guildConfig: getDefaultGuildConfig('g1'),
  });
  assert.ok(testContainer);

  const warningsContainer = buildWarningsConfigContainer({
    lang: 'de',
    guildConfig: getDefaultGuildConfig('g1'),
  });
  assert.ok(warningsContainer);

  const alertContainer = buildViolationAlertContainer({
    lang: 'de',
    userId: '123456',
    category: 'hate',
    warningNumber: 2,
    maxWarnings: 3,
    action: 'timeout_600s',
    expiresAt: Date.now() + 86400000,
    messageDeleted: true,
  });
  assert.ok(alertContainer);
});

test('Security Bot: Interaktions- & Modal-Handling', async () => {
  const { handleInteraction } = require('../bots/security-bot/src/interactions');
  const store = createSecurityStore({
    env: (k) => (k === 'SECURITY_STORE_DISABLE_FILE_BACKUP' ? 'true' : ''),
  });
  await store.init();
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const ctx = { store, logger, ownerId: 'owner_1' };

  // 1. Modal: sec_modal_api_key mit Key
  let repliedPayload = null;
  const mockModalApiKey = {
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    guildId: 'g1',
    customId: 'sec_modal_api_key',
    user: { id: 'admin1' },
    memberPermissions: { has: (p) => p === PermissionFlagsBits.Administrator },
    fields: {
      getTextInputValue: (id) => (id === 'sec_input_api_key' ? 'sk-new-test-key' : ''),
    },
    deferReply: async () => {},
    editReply: async (p) => { repliedPayload = p; },
    reply: async (p) => { repliedPayload = p; },
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  try {
    await handleInteraction(ctx, mockModalApiKey);
    assert.equal(store.getApiKey('g1'), 'sk-new-test-key');
    assert.ok(repliedPayload);
  } finally {
    globalThis.fetch = origFetch;
  }

  // 2. Modal: sec_modal_api_key mit 'remove'
  const mockModalRemoveKey = {
    ...mockModalApiKey,
    fields: {
      getTextInputValue: () => 'remove',
    },
  };
  await handleInteraction(ctx, mockModalRemoveKey);
  assert.equal(store.getApiKey('g1'), null);

  // 3. Modal: sec_modal_warnings
  const mockModalWarnings = {
    ...mockModalApiKey,
    customId: 'sec_modal_warnings',
    fields: {
      getTextInputValue: (id) => (id === 'sec_input_max_warn' ? '5' : '30'),
    },
    reply: async (p) => { repliedPayload = p; },
  };
  await handleInteraction(ctx, mockModalWarnings);
  const updatedCfg = store.getGuild('g1');
  assert.equal(updatedCfg.maxWarnings, 5);
  assert.equal(updatedCfg.violationExpiryDays, 30);

  // 4. Button: sec_btn_toggle_autodelete
  let updatedPayload = null;
  const mockBtnAutoDel = {
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    guildId: 'g1',
    customId: 'sec_btn_toggle_autodelete',
    user: { id: 'admin1' },
    memberPermissions: { has: () => true },
    update: async (p) => { updatedPayload = p; },
  };
  await handleInteraction(ctx, mockBtnAutoDel);
  assert.equal(store.getGuild('g1').defaultAutoDelete, false);

  // 5. Button: sec_sens_btn_strict
  const mockBtnStrict = {
    ...mockBtnAutoDel,
    customId: 'sec_sens_btn_strict',
  };
  await handleInteraction(ctx, mockBtnStrict);
  assert.equal(store.getGuild('g1').sensitivity, 'strict');
  assert.equal(store.getGuild('g1').categoryThresholds.hate, 0.30);

  // 6. SelectMenu: sec_del_viol_<userId>
  store.addViolation({
    id: 'v_to_delete',
    guildId: 'g1',
    userId: 'u_target',
    highestCategory: 'violence',
    highestScore: 0.9,
    actionTaken: 'warn',
    createdAt: Date.now(),
    expiresAt: Date.now() + 100000,
  });

  const mockSelectDelViol = {
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    guildId: 'g1',
    customId: 'sec_del_viol_u_target',
    values: ['v_to_delete'],
    user: { id: 'admin1' },
    memberPermissions: { has: () => true },
    guild: {
      members: {
        fetch: async () => ({ user: { id: 'u_target', tag: 'TargetUser' } }),
      },
    },
    update: async (p) => { updatedPayload = p; },
  };

  await handleInteraction(ctx, mockSelectDelViol);
  assert.equal(store.getViolation('v_to_delete').deleted, true);
  assert.equal(store.getViolations('g1', 'u_target', { activeOnly: true }).length, 0);
});

test('Security Bot: Chat-Input Commands & Admin Panel', async () => {
  const { handleChatInput } = require('../bots/security-bot/src/commands');
  const { openPanel, sendJoinNotice } = require('../bots/security-bot/src/admin-panel');
  const { startScheduler } = require('../bots/security-bot/src/scheduler');

  const store = createSecurityStore({
    env: (k) => (k === 'SECURITY_STORE_DISABLE_FILE_BACKUP' ? 'true' : ''),
  });
  await store.init();
  const logger = { info: () => {}, warn: () => {}, error: () => {} };

  let dmMessages = [];
  const mockClient = {
    guilds: {
      cache: new Map([
        [
          'g1',
          {
            id: 'g1',
            name: 'Test Server',
            memberCount: 42,
            ownerId: 'owner_1',
            members: {
              cache: new Map(),
              fetch: async () => ({ id: 'owner_1' }),
            },
          },
        ],
      ]),
    },
    users: {
      cache: new Map(),
      fetch: async (id) => ({
        id,
        createDM: async () => ({
          send: async (p) => {
            dmMessages.push(p);
          },
        }),
      }),
    },
  };

  const ctx = {
    client: mockClient,
    store,
    logger,
    ownerId: 'owner_1',
    commandIds: { set_api_key: '999', help: '888' },
    panelSessions: new Map(),
  };

  // 1. /help
  let replyPayload = null;
  const mockHelpInteraction = {
    commandName: 'help',
    inGuild: () => true,
    guildId: 'g1',
    user: { id: 'u1' },
    locale: 'de',
    reply: async (p) => { replyPayload = p; },
  };
  await handleChatInput(ctx, mockHelpInteraction);
  assert.ok(replyPayload);

  // 2. /status
  const mockStatusInteraction = {
    commandName: 'status',
    inGuild: () => true,
    guildId: 'g1',
    user: { id: 'u1' },
    member: { communicationDisabledUntil: null },
    locale: 'de',
    reply: async (p) => { replyPayload = p; },
  };
  await handleChatInput(ctx, mockStatusInteraction);
  assert.ok(replyPayload);

  // 3. /set_language
  const mockSetLangInteraction = {
    commandName: 'set_language',
    inGuild: () => true,
    guildId: 'g1',
    user: { id: 'admin1' },
    memberPermissions: { has: () => true },
    options: { getString: () => 'en' },
    locale: 'en',
    reply: async (p) => { replyPayload = p; },
  };
  await handleChatInput(ctx, mockSetLangInteraction);
  assert.equal(store.getLanguage('g1'), 'en');

  // 4. /adminpanel in DM durch Owner
  const mockPanelInteraction = {
    commandName: 'adminpanel',
    channel: { type: ChannelType.DM },
    user: { id: 'owner_1' },
    reply: async (p) => { replyPayload = p; },
  };
  await handleChatInput(ctx, mockPanelInteraction);
  assert.ok(replyPayload);

  // 5. sendJoinNotice
  await sendJoinNotice(ctx, { id: 'g_new', name: 'Brand New Server', memberCount: 15, ownerId: 'guild_owner' });
  assert.ok(dmMessages.length > 0);

  // 6. Scheduler Start & Stop
  const stopScheduler = startScheduler({ ctx });
  assert.equal(typeof stopScheduler, 'function');
  stopScheduler();
});
