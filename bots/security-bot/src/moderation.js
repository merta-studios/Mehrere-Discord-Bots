/**
 * OpenAI Moderations-API Anbindung & Verstoß-Auswertung.
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

const OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';

/**
 * Ruft die OpenAI Moderation API auf (unterstützt omni-moderation-latest mit Text & Bildern).
 */
async function callOpenAIModeration({ apiKey, text, imageUrls = [], fetchFn = globalThis.fetch } = {}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return { ok: false, error: 'missing_api_key' };
  }

  const hasText = Boolean(text && String(text).trim());
  const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0;

  if (!hasText && !hasImages) {
    return { ok: false, error: 'empty_input' };
  }

  let inputPayload;
  if (!hasImages) {
    inputPayload = String(text).trim();
  } else {
    inputPayload = [];
    if (hasText) {
      inputPayload.push({ type: 'text', text: String(text).trim() });
    }
    for (const url of imageUrls) {
      if (url && typeof url === 'string') {
        inputPayload.push({ type: 'image_url', image_url: { url } });
      }
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetchFn(OPENAI_MODERATION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: inputPayload,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `api_error_${res.status}`, detail: errText };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : 'network_error', message: err.message };
  }
}

/**
 * Wertet ein OpenAI Moderation Ergebnis gegen die Serverkonfiguration aus.
 */
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
    const threshold = Number(thresholds[cat]) || defaultThreshold;
    const isFlaggedByApi = categories[cat] === true;
    const exceedsThreshold = score >= threshold;
    const isViolation = isEnabled && (isFlaggedByApi || exceedsThreshold);
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

    if (isViolation) {
      violatedList.push({
        category: cat,
        score,
        autoDelete: catAutoDelete,
      });
    }
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

/**
 * Haupt-Listener für eingehende Nachrichten: prüft Nicht-Admins und reagiert auf Verstöße.
 */
async function handleMessageModeration({ ctx, msg }) {
  try {
    if (msg.author?.bot) return;
    if (msg.webhookId) return;
    if (!msg.guild) return;
    if (msg.system) return;

    // Administrator-Bypass: alle Nutzer mit Administrator-Rechten ignorieren
    let member = msg.member;
    if (!member && msg.guild) {
      member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
    }
    if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return;
    }

    const cfg = ctx.store.getGuild(msg.guild.id);
    if (!cfg || !cfg.openaiApiKey) {
      // Kein API-Key konfiguriert -> still ignorieren
      return;
    }

    const text = msg.content || '';
    const imageUrls = [];

    if (msg.attachments && msg.attachments.size > 0) {
      for (const att of msg.attachments.values()) {
        const ct = (att.contentType || att.content_type || '').toLowerCase();
        const url = att.url || att.proxyURL;
        if (
          url &&
          (ct.startsWith('image/') ||
            /\.(png|jpe?g|webp|gif)$/i.test(url.split('?')[0] || ''))
        ) {
          imageUrls.push(url);
        }
      }
    }

    if (!text.trim() && imageUrls.length === 0) {
      return;
    }

    // OpenAI Moderation aufrufen
    const modRes = await callOpenAIModeration({
      apiKey: cfg.openaiApiKey,
      text: text.trim() || undefined,
      imageUrls,
    });

    if (!modRes.ok) {
      // Bei Fehlern / Rate Limits / ungültigen Keys still bleiben
      ctx.logger?.warn?.(`[security-bot] Moderation API Fehler für Gilde ${msg.guild.id}: ${modRes.error} (${modRes.status || ''})`);
      return;
    }

    const evalRes = evaluateModerationResult({ data: modRes.data, guildConfig: cfg });
    if (!evalRes.violated) {
      return;
    }

    // Verstoß festgestellt -> Verwarnungszähler berechnen
    const activeViolations = ctx.store.getViolations(msg.guild.id, msg.author.id, { activeOnly: true });
    const warningCount = activeViolations.length + 1;
    const maxWarnings = cfg.maxWarnings || 3;
    const lang = cfg.lang || 'de';

    const tier = getActionForWarningCount(warningCount, cfg.warningActions);
    const actionKey = tier.action || 'warn';
    const timeoutSeconds = tier.timeoutSeconds || getActionSeconds(actionKey);

    // Timeout via Discord verhängen, falls definiert
    let timeoutApplied = false;
    if (timeoutSeconds > 0 && member) {
      try {
        if (member.moderatable) {
          await member.timeout(
            timeoutSeconds * 1000,
            `Automatischer Sicherheits-Timeout: ${evalRes.highestCategory} (Verwarnung ${warningCount}/${maxWarnings})`
          );
          timeoutApplied = true;
        }
      } catch (err) {
        ctx.logger?.warn?.(`[security-bot] Timeout für ${msg.author.id} fehlgeschlagen:`, err.message);
      }
    }

    // Verstoß in DB persistieren
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
      hasImage: imageUrls.length > 0,
      actionTaken: actionKey,
      timeoutSeconds,
      warningNumber: warningCount,
      createdAt: now,
      expiresAt,
    });
    void ctx.store.flush();

    // Nachricht löschen, wenn Auto-Delete aktiv ist
    let messageDeleted = false;
    if (evalRes.shouldAutoDelete) {
      try {
        await msg.delete();
        messageDeleted = true;
      } catch (err) {
        ctx.logger?.warn?.(`[security-bot] Nachrichtenlöschung fehlgeschlagen:`, err.message);
      }
    }

    // Verwarnung im Kanal posten
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
      if (messageDeleted) {
        await msg.channel.send(componentsV2Payload([alertContainer]));
      } else {
        await msg.reply(componentsV2Payload([alertContainer])).catch(() => {
          return msg.channel.send(componentsV2Payload([alertContainer]));
        });
      }
    } catch (err) {
      ctx.logger?.warn?.('[security-bot] Senden der Verwarnung fehlgeschlagen:', err.message);
    }
  } catch (err) {
    ctx.logger?.error?.('[security-bot] Fehler in handleMessageModeration:', err);
  }
}

module.exports = {
  callOpenAIModeration,
  evaluateModerationResult,
  handleMessageModeration,
};
