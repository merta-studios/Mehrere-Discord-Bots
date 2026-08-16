/**
 * Regelwerk, Schwellenwerte & Eskalationsstufen für den Sicherheitsbot.
 */

const CATEGORIES = [
  'hate',
  'hate/threatening',
  'harassment',
  'harassment/threatening',
  'self-harm',
  'self-harm/intent',
  'self-harm/instructions',
  'sexual',
  'sexual/minors',
  'violence',
  'violence/graphic',
  'illicit',
  'illicit/violent',
];

const CATEGORY_ICONS = {
  hate: '🤬',
  'hate/threatening': '🛑',
  harassment: '🥊',
  'harassment/threatening': '🔪',
  'self-harm': '🩹',
  'self-harm/intent': '⚠️',
  'self-harm/instructions': '🚫',
  sexual: '🔞',
  'sexual/minors': '🚨',
  violence: '⚔️',
  'violence/graphic': '🩸',
  illicit: '💊',
  'illicit/violent': '💣',
};

const PRESET_THRESHOLDS = {
  strict: 0.30,
  balanced: 0.50,
  relaxed: 0.75,
};

const DEFAULT_WARNING_ESCALATION = [
  { warning: 1, action: 'warn', timeoutSeconds: 0 },
  { warning: 2, action: 'timeout_600s', timeoutSeconds: 600 },
  { warning: 3, action: 'timeout_86400s', timeoutSeconds: 86400 },
  { warning: 4, action: 'timeout_604800s', timeoutSeconds: 604800 },
];

const TIMEOUT_ACTION_SECONDS = {
  warn: 0,
  timeout_60s: 60,
  timeout_300s: 300,
  timeout_600s: 600,
  timeout_3600s: 3600,
  timeout_86400s: 86400,
  timeout_604800s: 604800,
};

function getCategoryTranslationKey(cat) {
  return `cat_${cat.replace(/[\/-]/g, '_')}`;
}

function getActionTranslationKey(action) {
  if (action?.startsWith('action_')) return action;
  return `action_${action}`;
}

function getActionSeconds(action) {
  if (!action) return 0;
  const key = action.replace(/^action_/, '');
  return TIMEOUT_ACTION_SECONDS[key] || 0;
}

function getActionForWarningCount(count, escalation = DEFAULT_WARNING_ESCALATION) {
  const list = Array.isArray(escalation) && escalation.length > 0 ? escalation : DEFAULT_WARNING_ESCALATION;
  const sorted = [...list].sort((a, b) => a.warning - b.warning);
  // Finde exakte Stufe oder höchste definierte Stufe
  const match = sorted.find((e) => e.warning === count);
  if (match) return match;
  // Falls Zähler größer als alle Einträge ist, nimm den schärfsten letzten Eintrag
  const last = sorted[sorted.length - 1];
  if (count >= last.warning) return last;
  return sorted[0] || { warning: 1, action: 'warn', timeoutSeconds: 0 };
}

function getDefaultCategoryMap(defaultValue = true) {
  const map = {};
  for (const cat of CATEGORIES) {
    map[cat] = defaultValue;
  }
  return map;
}

function getDefaultThresholdMap(preset = 'balanced') {
  const val = PRESET_THRESHOLDS[preset] ?? 0.50;
  const map = {};
  for (const cat of CATEGORIES) {
    map[cat] = val;
  }
  return map;
}

function getDefaultGuildConfig(guildId) {
  return {
    guildId: String(guildId),
    openaiApiKey: null,
    lang: 'de',
    sensitivity: 'balanced',
    categoryThresholds: getDefaultThresholdMap('balanced'),
    categoryEnabled: getDefaultCategoryMap(true),
    categoryAutoDelete: getDefaultCategoryMap(true),
    warningActions: [...DEFAULT_WARNING_ESCALATION],
    maxWarnings: 3,
    violationExpiryDays: 14,
    defaultAutoDelete: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function normalizeGuildConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = { ...raw };
  cfg.guildId = String(cfg.guildId);
  cfg.lang = cfg.lang || 'de';
  cfg.sensitivity = cfg.sensitivity || 'balanced';
  cfg.categoryThresholds = cfg.categoryThresholds && typeof cfg.categoryThresholds === 'object'
    ? { ...getDefaultThresholdMap(cfg.sensitivity), ...cfg.categoryThresholds }
    : getDefaultThresholdMap(cfg.sensitivity);
  cfg.categoryEnabled = cfg.categoryEnabled && typeof cfg.categoryEnabled === 'object'
    ? { ...getDefaultCategoryMap(true), ...cfg.categoryEnabled }
    : getDefaultCategoryMap(true);
  cfg.categoryAutoDelete = cfg.categoryAutoDelete && typeof cfg.categoryAutoDelete === 'object'
    ? { ...getDefaultCategoryMap(true), ...cfg.categoryAutoDelete }
    : getDefaultCategoryMap(true);
  cfg.warningActions = Array.isArray(cfg.warningActions) && cfg.warningActions.length > 0
    ? cfg.warningActions
    : [...DEFAULT_WARNING_ESCALATION];
  cfg.maxWarnings = Number.isInteger(Number(cfg.maxWarnings)) && Number(cfg.maxWarnings) > 0 ? Number(cfg.maxWarnings) : 3;
  cfg.violationExpiryDays = Number.isInteger(Number(cfg.violationExpiryDays)) && Number(cfg.violationExpiryDays) > 0
    ? Number(cfg.violationExpiryDays)
    : 14;
  cfg.defaultAutoDelete = cfg.defaultAutoDelete !== false;
  return cfg;
}

function progressBar(ratio, size = 10) {
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const filled = Math.round(clamped * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '—';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

module.exports = {
  CATEGORIES,
  CATEGORY_ICONS,
  PRESET_THRESHOLDS,
  DEFAULT_WARNING_ESCALATION,
  TIMEOUT_ACTION_SECONDS,
  getCategoryTranslationKey,
  getActionTranslationKey,
  getActionSeconds,
  getActionForWarningCount,
  getDefaultCategoryMap,
  getDefaultThresholdMap,
  getDefaultGuildConfig,
  normalizeGuildConfig,
  progressBar,
  maskApiKey,
};
