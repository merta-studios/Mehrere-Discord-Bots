/**
 * Regressionstest für /admin_set_bot_profile:
 *
 * Der Bot darf sein serverseitiges Profilbild NICHT über
 * PATCH /users/@me/guilds/{guild.id}/member setzen – diese Route ist
 * OAuth2-User-Tokens vorbehalten und antwortet für Bots mit
 * "405: Method Not Allowed".
 *
 * Korrekt ist PATCH /guilds/{guild.id}/members/@me
 * (Routes.guildMember(guildId, '@me')) – Guild-Member-Avatare sind für
 * Bots dort seit dem API-Changelog vom 27.09.2022 erlaubt.
 *
 * Getestet wird mit gemockten Objekten, ohne echte Discord-Verbindung:
 * - "standard" setzt den Guild-Avatar auf der @me-Member-Route zurück
 * - "server" sendet den Avatar als Data-URI an dieselbe Route
 * - "owner" nimmt den Avatar des Server-Owners (gleiche Route)
 * - 50013 Missing Permissions wird als verständlicher Hinweis angezeigt
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Routes } = require('discord.js');

const { handleChatInput } = require('../bots/birthday-bot/src/commands');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeCtx({ patchImpl } = {}) {
  const restCalls = [];
  return {
    ctx: {
      store: { get: () => undefined },
      rest: {
        patch: async (route, options) => {
          restCalls.push({ route, options });
          if (patchImpl) return patchImpl(route, options);
          return {};
        },
      },
    },
    restCalls,
  };
}

function makeInteraction({ choice = 'standard', iconURL = null, ownerAvatarURL = null } = {}) {
  const replies = { edits: [] };
  const interaction = {
    commandName: 'admin_set_bot_profile',
    locale: 'de',
    guildId: 'guild1',
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: { getString: (name) => (name === 'image' ? choice : null) },
    deferReply: async () => {},
    editReply: async (payload) => {
      replies.edits.push(payload);
      return payload;
    },
    guild: {
      id: 'guild1',
      iconURL: () => iconURL,
      fetchOwner: async () => ({
        user: { displayAvatarURL: () => ownerAvatarURL },
      }),
    },
  };
  return { interaction, replies };
}

function payloadText(payload) {
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Profilbild "standard": Guild-Avatar wird auf /guilds/{id}/members/@me zurückgesetzt (kein 405)', async () => {
  const { ctx, restCalls } = makeCtx();
  const { interaction, replies } = makeInteraction({ choice: 'standard' });

  await handleChatInput(ctx, interaction);

  assert.equal(restCalls.length, 1);
  const { route, options } = restCalls[0];
  assert.equal(route, Routes.guildMember('guild1', '@me'));
  // discord.js URL-enkodiert "@me" → "%40me"; beide Formen sind dieselbe API-Route:
  assert.match(route.replace('%40me', '@me'), /^\/guilds\/guild1\/members\/@me$/);
  // Explizit gegen die alte, kaputte Route absichern:
  assert.ok(!route.startsWith('/users/@me'), `Falsche Route (OAuth2-only → 405): ${route}`);
  assert.deepEqual(options.body, { avatar: null });

  // Erfolgsmeldung wurde gezeigt
  assert.match(payloadText(replies.edits.at(-1)), /Profilbild geändert/);
});

test('Profilbild "server": Data-URI geht an /guilds/{id}/members/@me', async () => {
  const { ctx, restCalls } = makeCtx();
  const { interaction } = makeInteraction({
    choice: 'server',
    iconURL: 'https://cdn.discordapp.com/icons/guild1/abc.png',
  });

  // CDN-Fetch mocken: 1×1 Pixel PNG
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://cdn.discordapp.com/icons/guild1/abc.png');
    return {
      ok: true,
      headers: { get: (k) => (k === 'content-type' ? 'image/png' : null) },
      arrayBuffer: async () =>
        pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength),
    };
  };
  try {
    await handleChatInput(ctx, interaction);
  } finally {
    globalThis.fetch = origFetch;
  }

  assert.equal(restCalls.length, 1);
  const { route, options } = restCalls[0];
  assert.equal(route, Routes.guildMember('guild1', '@me'));
  assert.ok(
    options.body.avatar.startsWith(`data:image/png;base64,${pngBytes.toString('base64')}`),
    `Data-URI erwartet, erhalten: ${options.body.avatar.slice(0, 40)}`
  );
});

test('Profilbild "owner": Avatar des Owners geht an /guilds/{id}/members/@me', async () => {
  const { ctx, restCalls } = makeCtx();
  const { interaction } = makeInteraction({
    choice: 'owner',
    ownerAvatarURL: 'https://cdn.discordapp.com/avatars/owner/xyz.png',
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  try {
    await handleChatInput(ctx, interaction);
  } finally {
    globalThis.fetch = origFetch;
  }

  assert.equal(restCalls.length, 1);
  assert.equal(restCalls[0].route, Routes.guildMember('guild1', '@me'));
  assert.ok(restCalls[0].options.body.avatar.startsWith('data:image/png;base64,'));
});

test('50013 Missing Permissions wird als verständlicher Hinweis angezeigt', async () => {
  const permErr = new Error('Missing Permissions');
  permErr.code = 50013;
  permErr.status = 403;
  const { ctx } = makeCtx({
    patchImpl: () => {
      throw permErr;
    },
  });
  const { interaction, replies } = makeInteraction({ choice: 'standard' });

  await handleChatInput(ctx, interaction);

  const text = payloadText(replies.edits.at(-1));
  assert.match(text, /Nickname ändern/);
});

test('Anderweitige API-Fehler (z. B. alter 405) werden weiterhin als Fehlertext gezeigt', async () => {
  const err405 = new Error('405: Method Not Allowed');
  err405.status = 405;
  const { ctx } = makeCtx({
    patchImpl: () => {
      throw err405;
    },
  });
  const { interaction, replies } = makeInteraction({ choice: 'standard' });

  await handleChatInput(ctx, interaction);

  const text = payloadText(replies.edits.at(-1));
  assert.match(text, /konnte nicht geändert werden/);
  assert.match(text, /405/);
});
