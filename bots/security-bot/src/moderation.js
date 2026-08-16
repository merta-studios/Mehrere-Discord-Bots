/**
 * Mistral Moderations-API Anbindung & Verstoß-Auswertung.
 */

const { PermissionFlagsBits } = require('discord.js');
const {
  CATEGORIES,
  PRESET_THRESHOLDS,
  getActionForWarningCount,
  getActionSeconds,
} = require('./rules');
const { buildViolationAlertContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');

const MISTRAL_MODERATION_URL = 'https://api.mistral.ai/v1/moderations';
const MISTRAL_MODERATION_MODEL = 'mistral-moderation-latest';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter != null && retryAfter !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 2000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 2000);
  }
  return Math.min(250 * (2 ** attempt), 2000);
}

/**
 * Ruft die textbasierte Mistral Moderation API auf.
 * Bei kurzen Rate-Limits und vorübergehenden Serverfehlern wird begrenzt erneut
 * versucht. Dadurch blockiert eine Discord-Nachricht nie länger als nötig.
 */
async function callMistralModeration({
  apiKey,
  text,
  fetchFn = globalThis.fetch,
  sleepFn = delay,
  maxRetries = 2,
} = {}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return { ok: false, error: 'missing_api_key' };
  }

  const input = String(text || '').trim();
  if (!input) return { ok: false, error: 'empty_input' };
  if (typeof fetchFn !== 'function') return { ok: false, error: 'fetch_unavailable' };

  const attempts = Math.max(1, Number(maxRetries) + 1);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let res;
      try {
        res = await fetchFn(MISTRAL_MODERATION_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MISTRAL_MODERATION_MODEL,
            input,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (res.ok) {
        const data = await res.json();
        return { ok: true, data };
      }

      const errText = await res.text().catch(() => '');
      if (attempt + 1 < attempts && RETRYABLE_STATUS.has(res.status)) {
        await sleepFn(retryDelayMs(res, attempt));
        continue;
      }
      return {
        ok: false,
        status: res.status,
        error: `api_error_${res.status}`,
        detail: errText,
      };
    } catch (err) {
      const error = err?.name === 'AbortError' ? 'timeout' : 'network_error';
      if (attempt + 1 < attempts && error === 'network_error') {
        await sleepFn(Math.min(250 * (2 ** attempt), 2000));
        continue;
      }
      return { ok: false, error, message: err?.message };
    }
  }

  return { ok: false, error: 'retry_exhausted' };
}

/** Wertet ein Mistral-Moderationsergebnis gegen die Serverkonfiguration aus. */
function evaluateModerationResult({ data, guildConfig = {} } = {}) {
  const result = data?.results?.[0];
  if (!result) {
    return {
      violated: false,
      highestCategory: null,
      highestScore: 0,
      shouldAutoDelete: false,
      violatedCategories: [],
      categoryScores: {},
      details: [],
    };
  }

  const sensitivity = guildConfig.sensitivity || 'balanced';
  const defaultThreshold = PRESET_THRESHOLDS[sensitivity] ?? 0.50;
  const thresholds = guildConfig.categoryThresholds || {};
  const enabledMap = guildConfig.categoryEnabled || {};
  const autoDeleteMap = guildConfig.categoryAutoDelete || {};
  const defaultAutoDelete = guildConfig.defaultAutoDelete !== false;
  const categories = result.categories || {};
  const scores = result.category_scores || {};
  const violatedList = [];
  const details = [];

  for (const cat of CATEGORIES) {
    const isEnabled = enabledMap[cat] !== false;
    const score = Number(scores[cat]) || 0;
    const configuredThreshold = Number(thresholds[cat]);
    const threshold = Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? configuredThreshold
      : defaultThreshold;
    const isFlaggedByApi = categories[cat] === true;
    const hasNumericScore = scores[cat] !== undefined && Number.isFinite(Number(scores[cat]));
    // Eigene Discord-Schwellenwerte haben Vorrang vor Mistrals booleschem
    // Standard-Flag. Nur bei einer Response ohne Score dient das Flag als Fallback.
    const isViolation = isEnabled && (hasNumericScore ? score >= threshold : isFlaggedByApi);
    const catAutoDelete = autoDeleteMap[cat] != null ? autoDeleteMap[cat] : defaultAutoDelete;

    details.push({
      category: cat,
      score,
      threshold,
      enabled: isEnabled,
      flagged: isFlaggedByApi,
      violation: isViolation,
      autoDelete: catAutoDelete,
    });

    if (isViolation) violatedList.push({ category: cat, score, autoDelete: catAutoDelete });
  }

  if (violatedList.length === 0) {
    return {
      violated: false,
      highestCategory: null,
      highestScore: 0,
      shouldAutoDelete: false,
      violatedCategories: [],
      categoryScores: scores,
      details,
    };
  }

  violatedList.sort((a, b) => b.score - a.score);
  const highest = violatedList[0];
  return {
    violated: true,
    highestCategory: highest.category,
    highestScore: highest.score,
    shouldAutoDelete: violatedList.some((v) => v.autoDelete),
    violatedCategories: violatedList.map((v) => v.category),
    categoryScores: scores,
    details,
  };
}

/** Haupt-Listener für eingehende Textnachrichten von Nicht-Admins. */
async function handleMessageModeration({ ctx, msg }) {
  try {
    if (msg.author?.bot || msg.webhookId || !msg.guild || msg.system) return;

    let member = msg.member;
    if (!member && msg.guild) member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
    if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return;

    const cfg = ctx.store.getGuild(msg.guild.id);
    if (!cfg?.mistralApiKey) return;

    // Mistral Moderation ist textbasiert. Bildanhänge werden nicht an einen
    // unpassenden generativen Vision-Endpunkt weitergeleitet.
    const text = String(msg.content || '').trim();
    if (!text) return;

    const hasImage = Boolean(msg.attachments && [...msg.attachments.values()].some((att) => {
      const ct = (att.contentType || att.content_type || '').toLowerCase();
      const url = att.url || att.proxyURL || '';
      return ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(url.split('?')[0] || '');
    }));

    const modRes = await callMistralModeration({ apiKey: cfg.mistralApiKey, text });
    if (!modRes.ok) {
      ctx.logger?.warn?.(
        `[security-bot] Mistral Moderation API Fehler für Gilde ${msg.guild.id}: ${modRes.error} (${modRes.status || ''})`
      );
      return;
    }

    const evalRes = evaluateModerationResult({ data: modRes.data, guildConfig: cfg });
    if (!evalRes.violated) return;

    const activeViolations = ctx.store.getViolations(msg.guild.id, msg.author.id, { activeOnly: true });
    const warningCount = activeViolations.length + 1;
    const maxWarnings = cfg.maxWarnings || 3;
    const lang = cfg.lang || 'de';
    const tier = getActionForWarningCount(warningCount, cfg.warningActions);
    const actionKey = tier.action || 'warn';
    const timeoutSeconds = tier.timeoutSeconds || getActionSeconds(actionKey);

    if (timeoutSeconds > 0 && member) {
      try {
        if (member.moderatable) {
          await member.timeout(
            timeoutSeconds * 1000,
            `Automatischer Sicherheits-Timeout: ${evalRes.highestCategory} (Verwarnung ${warningCount}/${maxWarnings})`
          );
        }
      } catch (err) {
        ctx.logger?.warn?.(`[security-bot] Timeout für ${msg.author.id} fehlgeschlagen:`, err.message);
      }
    }

    const expiryMs = (cfg.violationExpiryDays || 14) * 86400 * 1000;
    const now = Date.now();
    const expiresAt = now + expiryMs;
    const violationId = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    ctx.store.addViolation({
      id: violationId,
      guildId: msg.guild.id,
      userId: msg.author.id,
      categories: evalRes.violatedCategories,
      highestCategory: evalRes.highestCategory,
      highestScore: evalRes.highestScore,
      contentSnippet: text.slice(0, 250),
      hasImage,
      actionTaken: actionKey,
      timeoutSeconds,
      warningNumber: warningCount,
      createdAt: now,
      expiresAt,
    });
    void ctx.store.flush();

    let messageDeleted = false;
    if (evalRes.shouldAutoDelete) {
      try {
        await msg.delete();
        messageDeleted = true;
      } catch (err) {
        ctx.logger?.warn?.(`[security-bot] Nachrichtenlöschung fehlgeschlagen:`, err.message);
      }
    }

    const alertContainer = buildViolationAlertContainer({
      lang,
      userId: msg.author.id,
      category: evalRes.highestCategory,
      warningNumber: warningCount,
      maxWarnings,
      action: actionKey,
      expiresAt,
      messageDeleted,
    });

    try {
      if (messageDeleted) await msg.channel.send(componentsV2Payload([alertContainer]));
      else {
        await msg.reply(componentsV2Payload([alertContainer])).catch(() =>
          msg.channel.send(componentsV2Payload([alertContainer]))
        );
      }
    } catch (err) {
      ctx.logger?.warn?.('[security-bot] Senden der Verwarnung fehlgeschlagen:', err.message);
    }
  } catch (err) {
    ctx.logger?.error?.('[security-bot] Fehler in handleMessageModeration:', err);
  }
}

module.exports = {
  MISTRAL_MODERATION_URL,
  MISTRAL_MODERATION_MODEL,
  callMistralModeration,
  evaluateModerationResult,
  handleMessageModeration,
};
