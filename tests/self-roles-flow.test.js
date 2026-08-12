/**
 * Flow-Tests des Self-Roles-Bots mit gemockten Discord-Objekten.
 *
 * Getestet wird der komplette Lebenszyklus ohne echte Discord-Verbindung:
 *  - /create_self_role → Formular → Editor → Rollen hinzufügen → Absenden
 *  - Rollen werden ERST beim Absenden erstellt (und ganz unten einsortiert)
 *  - Klick auf einen Button: Rolle geben / „hast du schon“ → Abgeben
 *  - Einzel-Modus tauscht die Rolle
 *  - Zähler aktualisieren sich (auch bei manueller Rollenvergabe)
 *  - Robustheit: kaputte Nachricht, gelöschte Rolle, abgelaufene Session,
 *    fehlende Bot-Rechte, Rollback bei fehlgeschlagenem Absenden
 *  - Maximal 10 Nachrichten pro Server
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const { handleInteraction } = require('../bots/self-roles-bot/src/interactions');
const { createStore } = require('../bots/self-roles-bot/src/store');
const { createSessionStore } = require('../bots/self-roles-bot/src/editor');
const {
  parseSelfRoleMessage,
  buildSelfRoleContainer,
} = require('../bots/self-roles-bot/src/embed-builder');
const { componentsV2Payload } = require('../bots/self-roles-bot/src/message-payload');
const logic = require('../bots/self-roles-bot/src/logic');

const logger = { info: () => {}, warn: () => {}, error: () => {} };

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeHarness({ botCanManageRoles = true, roleCreateFails = false, sendFails = false } = {}) {
  const roles = new Map(); // roleId -> role
  const members = new Map(); // userId -> member
  let roleSeq = 1000;
  const created = [];
  const deletedRoles = [];
  const positionCalls = [];

  const guildId = 'guild1';

  function makeRole({ id, name, position = 1, mentionable = true }) {
    const role = {
      id,
      name,
      position,
      mentionable,
      managed: false,
      members: new Map(),
      delete: async () => {
        deletedRoles.push(id);
        roles.delete(id);
      },
      setPosition: async (pos) => {
        positionCalls.push({ id, pos });
        role.position = pos;
      },
    };
    return role;
  }

  // Bot-Rolle steht hoch oben
  const botRole = makeRole({ id: 'botrole', name: 'Bot', position: 100 });
  roles.set(botRole.id, botRole);

  function makeMember(userId) {
    const owned = new Set();
    const member = {
      id: userId,
      user: { id: userId, bot: false },
      roles: {
        cache: {
          has: (id) => owned.has(id),
          keys: () => owned.keys(),
          get highest() {
            return botRole;
          },
        },
        add: async (ids) => {
          for (const id of [].concat(ids)) {
            if (!roles.has(id)) throw Object.assign(new Error('Unknown Role'), { code: 10011 });
            owned.add(id);
            roles.get(id).members.set(userId, member);
          }
        },
        remove: async (ids) => {
          for (const id of [].concat(ids)) {
            owned.delete(id);
            roles.get(id)?.members?.delete(userId);
          }
        },
      },
      _owned: owned,
    };
    members.set(userId, member);
    return member;
  }

  const botMember = {
    id: 'bot1',
    permissions: {
      has: (perm) => (perm === PermissionFlagsBits.ManageRoles ? botCanManageRoles : true),
    },
    roles: { highest: botRole },
  };

  const sentMessages = [];

  const channel = {
    id: 'chan1',
    name: 'rollen',
    type: 0,
    viewable: true,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'object') return new Map(sentMessages.map((m) => [m.id, m]));
        return sentMessages.find((m) => m.id === arg) || null;
      },
    },
    send: async (payload) => {
      if (sendFails) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      const msg = makeMessage(payload);
      sentMessages.push(msg);
      return msg;
    },
  };

  function makeMessage(payload) {
    const id = `msg${sentMessages.length + 1}`;
    const msg = {
      id,
      channelId: channel.id,
      guildId,
      author: { id: 'bot1' },
      createdTimestamp: Date.now(),
      components: (payload.components || []).map((c) => (c.toJSON ? c.toJSON() : c)),
      embeds: [],
      flags: payload.flags,
      url: `https://discord.com/channels/${guildId}/${channel.id}/${id}`,
      edit: async (p) => {
        msg.components = (p.components || []).map((c) => (c.toJSON ? c.toJSON() : c));
        return msg;
      },
    };
    return msg;
  }

  const guild = {
    id: guildId,
    name: 'Testserver',
    ownerId: 'owner1',
    memberCount: 42,
    members: {
      me: botMember,
      cache: members,
      fetch: async (id) => {
        if (id === undefined) return members;
        return members.get(id) || null;
      },
    },
    roles: {
      cache: roles,
      fetch: async (id) => (id === undefined ? roles : roles.get(id) || null),
      create: async ({ name, mentionable }) => {
        if (roleCreateFails) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
        const id = `role${roleSeq++}`;
        const role = makeRole({ id, name, position: 1, mentionable });
        roles.set(id, role);
        created.push({ id, name, mentionable });
        return role;
      },
      setPositions: async (payload) => {
        for (const p of payload) positionCalls.push({ id: p.role, pos: p.position });
      },
    },
    channels: {
      cache: new Map([[channel.id, channel]]),
      fetch: async () => new Map([[channel.id, channel]]),
    },
  };

  const client = {
    user: { id: 'bot1' },
    guilds: { cache: new Map([[guildId, guild]]) },
    channels: { fetch: async (id) => (id === channel.id ? channel : null), cache: new Map([[channel.id, channel]]) },
  };

  const ctx = {
    client,
    logger,
    store: createStore({ client, logger }),
    sessions: createSessionStore(),
    panelSessions: new Map(),
    ownerId: 'owner1',
    commandIds: {},
  };

  return { ctx, guild, channel, roles, members, makeMember, sentMessages, created, deletedRoles, positionCalls, botMember };
}

/** Interaktions-Mocks – sammeln alle Antworten für die Assertions. */
function makeInteraction(overrides = {}) {
  const out = {
    replies: [],
    updates: [],
    modals: [],
    editReplies: [],
    followUps: [],
    deferred: false,
    replied: false,
    deferOptions: null,
  };
  const base = {
    deferred: false,
    replied: false,
    user: { id: 'admin1' },
    locale: 'de',
    guildId: 'guild1',
    channelId: 'chan1',
    memberPermissions: { has: () => true },
    inGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isFromMessage: () => true,
    reply: async (p) => {
      out.replies.push(p);
      out.replied = true;
      return p;
    },
    update: async (p) => {
      out.updates.push(p);
      out.replied = true;
      return p;
    },
    editReply: async (p) => {
      out.editReplies.push(p);
      return p;
    },
    followUp: async (p) => {
      out.followUps.push(p);
      return p;
    },
    deferReply: async (opts = {}) => {
      out.deferred = true;
      out.deferOptions = opts;
      base.deferred = true;
    },
    deferUpdate: async () => {
      out.deferred = true;
      out.deferUpdate = true;
      base.deferred = true;
    },
    showModal: async (m) => {
      out.modals.push(m.toJSON ? m.toJSON() : m);
    },
  };
  return { interaction: Object.assign(base, overrides), out };
}

function isEphemeralPayload(payload) {
  return Boolean(payload?.flags & MessageFlags.Ephemeral);
}

/** Defer oder direkte Antwort muss das Ephemeral-Flag tragen. */
function assertPrivateToClicker(out, label = 'Antwort') {
  const deferredEphemeral =
    out.deferOptions &&
    ((typeof out.deferOptions.flags === 'number' && (out.deferOptions.flags & MessageFlags.Ephemeral) !== 0) ||
      out.deferOptions.ephemeral === true);
  const reply = out.replies.at(-1) || out.followUps.at(-1) || out.editReplies.at(-1);
  assert.ok(
    deferredEphemeral || isEphemeralPayload(reply),
    `${label} muss nur für den Klicker sichtbar sein (ephemeral)`
  );
}

function textOf(payload) {
  return JSON.stringify(payload?.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || payload);
}

// ---------------------------------------------------------------------------
// Kompletter Erstell-Flow
// ---------------------------------------------------------------------------

test('Kompletter Flow: Command → Formular → Editor → Rollen → Absenden', async () => {
  const h = makeHarness();
  const { ctx, guild, channel } = h;

  // 1) /create_self_role öffnet das Formular
  const cmd = makeInteraction({
    isChatInputCommand: () => true,
    commandName: 'create_self_role',
    guild,
    options: { getChannel: () => channel },
  });
  await handleInteraction(ctx, cmd.interaction);
  assert.equal(cmd.out.modals.length, 1);
  assert.equal(cmd.out.modals[0].custom_id, 'srl_createmodal_chan1');

  // 2) Formular abschicken (Beschreibung mehrzeilig → wird geglättet)
  const create = makeInteraction({
    isModalSubmit: () => true,
    customId: 'srl_createmodal_chan1',
    guild,
    fields: {
      getTextInputValue: (id) =>
        id === 'title' ? 'Wähle deine Rollen 🎉' : 'Erste Zeile\nZweite Zeile\n\nDritte',
    },
  });
  await handleInteraction(ctx, create.interaction);

  const editorPayload = create.out.replies[0] || create.out.updates[0];
  assert.ok(editorPayload, 'Editor wurde angezeigt');
  const editorText = textOf(editorPayload);
  assert.match(editorText, /chan1/, 'Kanal wird bestätigt');
  assert.match(editorText, /Wähle deine Rollen/, 'Titel wird bestätigt');
  assert.match(editorText, /Erste Zeile Zweite Zeile Dritte/, 'Beschreibung ist einzeilig');
  assert.match(editorText, /Noch keine Rollen konfiguriert/);
  // Nach Transparenz-Update ist der Editor public (alle Admins sehen was konfiguriert wird)
  // – ephemer ist optional, Hauptsache Container Flag vorhanden
  assert.ok(
    (editorPayload.flags & MessageFlags.IsComponentsV2) !== 0,
    'Editor trägt ComponentsV2 Flag (public für Transparenz)'
  );

  const sessionId = [...ctx.sessions._map.keys()][0];
  assert.ok(sessionId);

  // 3) Zwei Rollen hinzufügen
  for (const [name, label] of [
    ['Gamer', '🎮 Zocker'],
    ['Artist', '🎨 Künstler'],
  ]) {
    const add = makeInteraction({
      isModalSubmit: () => true,
      customId: `srl_rolemodal_${sessionId}`,
      guild,
      fields: { getTextInputValue: (id) => (id === 'role_name' ? name : label) },
    });
    await handleInteraction(ctx, add.interaction);
  }
  const session = ctx.sessions.get(sessionId);
  assert.equal(session.roles.length, 2);
  assert.equal(h.created.length, 0, 'Rollen werden NOCH NICHT erstellt');

  // 4) Absenden
  const publish = makeInteraction({
    isButton: () => true,
    customId: `srl_ed_publish_${sessionId}`,
    guild,
  });
  await handleInteraction(ctx, publish.interaction);

  // Rollen wurden jetzt erstellt – erwähnbar und ganz unten einsortiert
  assert.equal(h.created.length, 2, 'Beide Rollen wurden beim Absenden erstellt');
  assert.deepEqual(h.created.map((r) => r.name), ['Gamer', 'Artist']);
  assert.ok(h.created.every((r) => r.mentionable === true), 'Rollen sind erwähnbar');
  assert.ok(h.positionCalls.length >= 2, 'Rollen wurden positioniert');
  assert.ok(h.positionCalls.every((p) => p.pos >= 1 && p.pos <= 2), 'Positionen ganz unten (über @everyone)');

  // Nachricht wurde gesendet und trägt das erwartete Layout
  assert.equal(h.sentMessages.length, 1);
  const parsed = parseSelfRoleMessage(h.sentMessages[0]);
  assert.equal(parsed.title, 'Wähle deine Rollen 🎉');
  assert.equal(parsed.description, 'Erste Zeile Zweite Zeile Dritte');
  assert.equal(parsed.roles.length, 2);
  assert.deepEqual(parsed.roles.map((r) => r.label), ['🎮 Zocker', '🎨 Künstler']);

  const list = h.sentMessages[0].components[0].components.find(
    (c) => c.type === 10 && c.content.includes('<@&')
  );
  assert.match(list.content, /🎮 Zocker \(0\) - <@&role1000>/);
  assert.match(list.content, /🎨 Künstler \(0\) - <@&role1001>/);

  // Registry kennt die Nachricht, Session ist aufgeräumt
  assert.equal(ctx.store.countMessages('guild1'), 1);
  assert.equal(ctx.sessions.get(sessionId), null);

  // Erfolgsmeldung mit Link
  const done = textOf(publish.out.editReplies.at(-1));
  assert.match(done, /discord\.com\/channels/);
});

// ---------------------------------------------------------------------------
// Buttons: Rolle geben / schon vorhanden / abgeben
// ---------------------------------------------------------------------------

async function publishFixture({ mode = 'multi', ...opts } = {}) {
  const h = makeHarness(opts);
  const { ctx, guild, channel } = h;

  const roleA = await guild.roles.create({ name: 'Gamer', mentionable: true });
  const roleB = await guild.roles.create({ name: 'Artist', mentionable: true });

  const container = buildSelfRoleContainer({
    title: 'Titel',
    description: 'Text',
    roles: [
      { roleId: roleA.id, label: 'Zocker', count: 0 },
      { roleId: roleB.id, label: 'Künstler', count: 0 },
    ],
    lang: 'de',
    mode,
  });
  const message = await channel.send(componentsV2Payload([container]));
  ctx.store.set({
    guildId: guild.id,
    channelId: channel.id,
    messageId: message.id,
    lang: 'de',
    mode,
    title: 'Titel',
    description: 'Text',
    roles: [
      { roleId: roleA.id, label: 'Zocker' },
      { roleId: roleB.id, label: 'Künstler' },
    ],
  });

  return { ...h, roleA, roleB, message };
}

test('Button-Klick gibt die Rolle und aktualisiert den Zähler', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');

  const click = makeInteraction({
    isButton: () => true,
    customId: `srl_role_${h.roleA.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
    memberPermissions: { has: () => false }, // normaler Nutzer darf klicken
  });
  await handleInteraction(h.ctx, click.interaction);

  assert.ok(member._owned.has(h.roleA.id), 'Nutzer hat die Rolle bekommen');
  assertPrivateToClicker(click.out, 'Rollen-Vergabe');
  const answer = textOf(click.out.editReplies.at(-1));
  assert.match(answer, new RegExp(`<@&${h.roleA.id}>`));
  assert.match(answer, /gehört jetzt dir|Zack/);

  // Zähler in der Nachricht steht jetzt auf 1
  const list = h.message.components[0].components.find((c) => c.type === 10 && c.content.includes('<@&'));
  assert.match(list.content, new RegExp(`Zocker \\(1\\) - <@&${h.roleA.id}>`));
  const buttons = h.message.components[0].components.filter((c) => c.type === 1).flatMap((r) => r.components);
  assert.equal(buttons.find((b) => b.custom_id === `srl_role_${h.roleA.id}`).label, 'Zocker (1)');
});

test('Zweiter Klick fragt nach und der Abgeben-Button entfernt die Rolle', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');
  await member.roles.add(h.roleA.id);

  // Klick, obwohl die Rolle schon da ist
  const again = makeInteraction({
    isButton: () => true,
    customId: `srl_role_${h.roleA.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, again.interaction);

  assertPrivateToClicker(again.out, 'Schon-drin-Nachfrage');
  const ask = again.out.editReplies.at(-1);
  const askText = textOf(ask);
  assert.match(askText, /hast .*längst|schon/i);
  const dropButton = ask.components[0]
    .toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components)[0];
  assert.equal(dropButton.custom_id, `srl_drop_${h.roleA.id}_chan1_${h.message.id}`);

  // Abgeben
  const drop = makeInteraction({
    isButton: () => true,
    customId: dropButton.custom_id,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, drop.interaction);

  assert.equal(member._owned.has(h.roleA.id), false, 'Rolle wurde entfernt');
  assertPrivateToClicker(drop.out, 'Rolle abgeben');
  assert.match(textOf(drop.out.editReplies.at(-1)), /ist weg|entfernt/i);
});

test('Abgeben ohne Rolle meldet freundlich „nichts zu tun“', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');

  const drop = makeInteraction({
    isButton: () => true,
    customId: `srl_drop_${h.roleA.id}_chan1_${h.message.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, drop.interaction);
  assert.match(textOf(drop.out.editReplies.at(-1)), /gar nicht|Nichts zu tun/i);
});

test('Einzel-Modus tauscht die alte Rolle gegen die neue', async () => {
  const h = await publishFixture({ mode: 'single' });
  const member = h.makeMember('user1');
  await member.roles.add(h.roleA.id);

  const click = makeInteraction({
    isButton: () => true,
    customId: `srl_role_${h.roleB.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, click.interaction);

  assert.equal(member._owned.has(h.roleA.id), false, 'Alte Rolle ist weg');
  assert.ok(member._owned.has(h.roleB.id), 'Neue Rolle ist da');
  assertPrivateToClicker(click.out, 'Rollentausch');
  assert.match(textOf(click.out.editReplies.at(-1)), /Rollentausch|Swap/i);
});

test('Abgeben auf der ephemeren Nachfrage ersetzt sie in-place (bleibt privat)', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');
  await member.roles.add(h.roleA.id);

  const ephemeralAsk = {
    id: 'ask1',
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [],
  };
  const drop = makeInteraction({
    isButton: () => true,
    customId: `srl_drop_${h.roleA.id}_chan1_${h.message.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: ephemeralAsk,
  });
  await handleInteraction(h.ctx, drop.interaction);

  assert.equal(drop.out.deferUpdate, true, 'Ephemere Nachfrage wird in-place aktualisiert');
  assert.equal(member._owned.has(h.roleA.id), false);
  assertPrivateToClicker(drop.out, 'In-place Abgeben');
});

test('Abgeben auf einer öffentlichen Alt-Antwort öffnet eine neue ephemere Antwort', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');
  await member.roles.add(h.roleA.id);

  const publicLeftover = {
    id: 'old-public',
    flags: MessageFlags.IsComponentsV2, // kein Ephemeral – Altlast
    components: [],
    delete: async () => {
      publicLeftover.deleted = true;
    },
  };
  const drop = makeInteraction({
    isButton: () => true,
    customId: `srl_drop_${h.roleA.id}_chan1_${h.message.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: publicLeftover,
  });
  await handleInteraction(h.ctx, drop.interaction);

  assert.ok(drop.out.deferOptions, 'Neue ephemere Antwort statt Update der öffentlichen Nachricht');
  assert.equal(drop.out.deferUpdate, undefined, 'Öffentliche Alt-Antwort wird nicht in-place überschrieben');
  assert.equal(h.message.id, 'msg1', 'Die fertige Self-Roles-Nachricht bleibt stehen');
  assertPrivateToClicker(drop.out, 'Alt-Antwort Abgeben');
});

test('Mehrfach-Modus lässt beide Rollen zu', async () => {
  const h = await publishFixture({ mode: 'multi' });
  const member = h.makeMember('user1');

  for (const roleId of [h.roleA.id, h.roleB.id]) {
    const click = makeInteraction({
      isButton: () => true,
      customId: `srl_role_${roleId}`,
      guild: h.guild,
      member,
      user: { id: 'user1' },
      message: h.message,
    });
    await handleInteraction(h.ctx, click.interaction);
  }
  assert.ok(member._owned.has(h.roleA.id) && member._owned.has(h.roleB.id));
});

// ---------------------------------------------------------------------------
// Zähler-Aktualisierung
// ---------------------------------------------------------------------------

test('Manuell vergebene Rollen werden beim Refresh nachgezogen', async () => {
  const h = await publishFixture();
  // „Admin“ vergibt die Rolle von Hand (ohne Button)
  const m1 = h.makeMember('user1');
  const m2 = h.makeMember('user2');
  await m1.roles.add(h.roleA.id);
  await m2.roles.add(h.roleA.id);

  const affected = await h.ctx.store.refreshForRole('guild1', h.roleA.id, { force: true });
  assert.equal(affected, 1, 'Eine Nachricht war betroffen');

  const list = h.message.components[0].components.find((c) => c.type === 10 && c.content.includes('<@&'));
  assert.match(list.content, /Zocker \(2\)/);
  const buttons = h.message.components[0].components.filter((c) => c.type === 1).flatMap((r) => r.components);
  assert.equal(buttons.find((b) => b.custom_id === `srl_role_${h.roleA.id}`).label, 'Zocker (2)');
});

test('Gelöschte Rollen verschwinden aus der Nachricht', async () => {
  const h = await publishFixture();
  await h.roles.get(h.roleB.id).delete();

  const entry = h.ctx.store.get('guild1', 'chan1', h.message.id);
  await h.ctx.store.refreshEntry(entry, { force: true });

  const parsed = parseSelfRoleMessage(h.message);
  assert.equal(parsed.roles.length, 1);
  assert.equal(parsed.roles[0].roleId, h.roleA.id);
});

test('Sind alle Rollen gelöscht, fliegt der Eintrag aus der Registry', async () => {
  const h = await publishFixture();
  await h.roles.get(h.roleA.id).delete();
  await h.roles.get(h.roleB.id).delete();

  const entry = h.ctx.store.get('guild1', 'chan1', h.message.id);
  await h.ctx.store.refreshEntry(entry, { force: true });
  assert.equal(h.ctx.store.countMessages('guild1'), 0);
});

test('Refresh ohne Änderung schreibt die Nachricht nicht neu (Signatur-Check)', async () => {
  const h = await publishFixture();
  const entry = h.ctx.store.get('guild1', 'chan1', h.message.id);

  let edits = 0;
  const originalEdit = h.message.edit;
  h.message.edit = async (p) => {
    edits += 1;
    return originalEdit(p);
  };

  await h.ctx.store.refreshEntry(entry, { force: false }); // erste Signatur setzen
  const afterFirst = edits;
  await h.ctx.store.refreshEntry(entry, { force: false }); // nichts geändert
  assert.equal(edits, afterFirst, 'Zweiter Refresh schreibt nichts');

  await h.ctx.store.refreshEntry(entry, { force: true });
  assert.equal(edits, afterFirst + 1, 'force schreibt trotzdem');
});

// ---------------------------------------------------------------------------
// Robustheit
// ---------------------------------------------------------------------------

test('Klick auf eine gelöschte Rolle antwortet freundlich statt zu crashen', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');
  await h.roles.get(h.roleA.id).delete();

  const click = makeInteraction({
    isButton: () => true,
    customId: `srl_role_${h.roleA.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, click.interaction);
  assertPrivateToClicker(click.out, 'Gelöschte Rolle');
  assert.match(textOf(click.out.editReplies.at(-1)), /gelöscht|🪦/);
});

test('Fehlende Bot-Rechte werden klar gemeldet (kein stiller Fehler)', async () => {
  const h = await publishFixture({ botCanManageRoles: false });
  const member = h.makeMember('user1');

  const click = makeInteraction({
    isButton: () => true,
    customId: `srl_role_${h.roleA.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, click.interaction);
  assertPrivateToClicker(click.out, 'Fehlende Rechte');
  assert.match(textOf(click.out.editReplies.at(-1)), /Rollen verwalten|Manage Roles/i);
  assert.equal(member._owned.has(h.roleA.id), false);
});

test('Klick auf eine kaputte Nachricht ohne Konfiguration bleibt höflich', async () => {
  const h = makeHarness();
  const member = h.makeMember('user1');
  const click = makeInteraction({
    isButton: () => true,
    customId: 'srl_role_999999999999999999',
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: { id: 'x', components: [], embeds: [] },
  });
  await handleInteraction(h.ctx, click.interaction);
  const answer = textOf(click.out.replies.at(-1) || click.out.editReplies.at(-1));
  assert.match(answer, /kaputt|veraltet|broken/i);
  assertPrivateToClicker(click.out, 'Kaputte Nachricht');
});

test('Nach einem Neustart wird die Nachricht per Klick wieder in die Registry geholt', async () => {
  const h = await publishFixture();
  const member = h.makeMember('user1');

  // „Neustart“: Registry leeren
  h.ctx.store.deleteGuild('guild1');
  assert.equal(h.ctx.store.countMessages('guild1'), 0);

  const click = makeInteraction({
    isButton: () => true,
    customId: `srl_role_${h.roleA.id}`,
    guild: h.guild,
    member,
    user: { id: 'user1' },
    message: h.message,
  });
  await handleInteraction(h.ctx, click.interaction);

  assert.ok(member._owned.has(h.roleA.id), 'Rolle wurde trotzdem vergeben');
  assert.equal(h.ctx.store.countMessages('guild1'), 1, 'Nachricht ist wieder in der Registry');
});

test('Abgelaufene Editor-Session meldet sich statt „Interaktion fehlgeschlagen“', async () => {
  const h = makeHarness();
  const click = makeInteraction({
    isButton: () => true,
    customId: 'srl_ed_publish_totgeglaubt',
    guild: h.guild,
  });
  await handleInteraction(h.ctx, click.interaction);
  assert.match(textOf(click.out.replies.at(-1)), /abgelaufen|neu gestartet/i);
});

test('Absenden mit nur einer Rolle wird blockiert', async () => {
  const h = makeHarness();
  const { ctx, guild, channel } = h;

  const create = makeInteraction({
    isModalSubmit: () => true,
    customId: 'srl_createmodal_chan1',
    guild,
    fields: { getTextInputValue: (id) => (id === 'title' ? 'T' : 'D') },
  });
  await handleInteraction(ctx, create.interaction);
  const sessionId = [...ctx.sessions._map.keys()][0];

  const add = makeInteraction({
    isModalSubmit: () => true,
    customId: `srl_rolemodal_${sessionId}`,
    guild,
    fields: { getTextInputValue: (id) => (id === 'role_name' ? 'Solo' : 'Solo') },
  });
  await handleInteraction(ctx, add.interaction);

  const publish = makeInteraction({
    isButton: () => true,
    customId: `srl_ed_publish_${sessionId}`,
    guild,
  });
  await handleInteraction(ctx, publish.interaction);

  assert.equal(h.created.length, 0, 'Keine Rolle wurde erstellt');
  assert.equal(h.sentMessages.length, 0, 'Keine Nachricht wurde gesendet');
  const answer = textOf(publish.out.updates.at(-1) || publish.out.editReplies.at(-1));
  assert.match(answer, /Mindestens|At least|2/);
});

test('Doppelte Platzhalter werden im Editor abgelehnt', async () => {
  const h = makeHarness();
  const { ctx, guild } = h;

  const create = makeInteraction({
    isModalSubmit: () => true,
    customId: 'srl_createmodal_chan1',
    guild,
    fields: { getTextInputValue: (id) => (id === 'title' ? 'T' : 'D') },
  });
  await handleInteraction(ctx, create.interaction);
  const sessionId = [...ctx.sessions._map.keys()][0];

  for (let i = 0; i < 2; i++) {
    const add = makeInteraction({
      isModalSubmit: () => true,
      customId: `srl_rolemodal_${sessionId}`,
      guild,
      fields: { getTextInputValue: (id) => (id === 'role_name' ? `Name${i}` : 'Gleicher Text') },
    });
    await handleInteraction(ctx, add.interaction);
  }

  const session = ctx.sessions.get(sessionId);
  assert.equal(session.roles.length, 1, 'Der doppelte Platzhalter wurde nicht übernommen');
  assert.match(session.notice, /schon|exist/i);
});

test('Scheitert das Senden, werden die frisch erstellten Rollen zurückgerollt', async () => {
  const h = makeHarness({ sendFails: true });
  const { ctx, guild } = h;

  const create = makeInteraction({
    isModalSubmit: () => true,
    customId: 'srl_createmodal_chan1',
    guild,
    fields: { getTextInputValue: (id) => (id === 'title' ? 'T' : 'D') },
  });
  await handleInteraction(ctx, create.interaction);
  const sessionId = [...ctx.sessions._map.keys()][0];

  for (const name of ['A', 'B']) {
    const add = makeInteraction({
      isModalSubmit: () => true,
      customId: `srl_rolemodal_${sessionId}`,
      guild,
      fields: { getTextInputValue: (id) => (id === 'role_name' ? name : `Label ${name}`) },
    });
    await handleInteraction(ctx, add.interaction);
  }

  const publish = makeInteraction({
    isButton: () => true,
    customId: `srl_ed_publish_${sessionId}`,
    guild,
  });
  await handleInteraction(ctx, publish.interaction);

  assert.equal(h.created.length, 2, 'Rollen wurden angelegt …');
  assert.equal(h.deletedRoles.length, 2, '… und nach dem Fehlschlag wieder entfernt');
  assert.equal(h.ctx.store.countMessages('guild1'), 0);
});

test('Maximal 10 Self-Roles-Nachrichten pro Server', async () => {
  const h = makeHarness();
  for (let i = 0; i < logic.MAX_MESSAGES; i++) {
    h.ctx.store.set({
      guildId: 'guild1',
      channelId: 'chan1',
      messageId: `m${i}`,
      lang: 'de',
      mode: 'multi',
      title: `T${i}`,
      description: '',
      roles: [{ roleId: '1', label: 'x' }],
    });
  }
  assert.equal(h.ctx.store.hasCapacity('guild1'), false);

  const cmd = makeInteraction({
    isChatInputCommand: () => true,
    commandName: 'create_self_role',
    guild: h.guild,
    options: { getChannel: () => h.channel },
  });
  await handleInteraction(h.ctx, cmd.interaction);
  assert.equal(cmd.out.modals.length, 0, 'Kein Formular mehr');
  assert.match(textOf(cmd.out.replies.at(-1)), /Maximum|Limit|10/);
});

test('Nicht-Admins kommen weder an /create_self_role noch an den Editor', async () => {
  const h = makeHarness();
  const cmd = makeInteraction({
    isChatInputCommand: () => true,
    commandName: 'create_self_role',
    guild: h.guild,
    memberPermissions: { has: () => false },
    options: { getChannel: () => h.channel },
  });
  await handleInteraction(h.ctx, cmd.interaction);
  assert.equal(cmd.out.modals.length, 0);
  assert.match(textOf(cmd.out.replies.at(-1)), /Admins|admin/i);
});

// ---------------------------------------------------------------------------
// /edit_self_role
// ---------------------------------------------------------------------------

test('/edit_self_role lädt die bestehende Konfiguration in den Editor', async () => {
  const h = await publishFixture({ mode: 'single' });

  const pick = makeInteraction({
    isStringSelectMenu: () => true,
    customId: 'srl_pick_message',
    guild: h.guild,
    values: [`chan1:${h.message.id}`],
  });
  await handleInteraction(h.ctx, pick.interaction);

  const sessionId = [...h.ctx.sessions._map.keys()][0];
  const session = h.ctx.sessions.get(sessionId);
  assert.ok(session.editing, 'Session ist im Bearbeiten-Modus');
  assert.equal(session.mode, 'single');
  assert.equal(session.roles.length, 2);
  assert.deepEqual(session.roles.map((r) => r.roleId), [h.roleA.id, h.roleB.id]);

  const view = textOf(pick.out.updates.at(-1));
  assert.match(view, /bestehende|Speichern/i);
});

test('Speichern nach dem Bearbeiten editiert die Nachricht statt eine neue zu senden', async () => {
  const h = await publishFixture();

  const pick = makeInteraction({
    isStringSelectMenu: () => true,
    customId: 'srl_pick_message',
    guild: h.guild,
    values: [`chan1:${h.message.id}`],
  });
  await handleInteraction(h.ctx, pick.interaction);
  const sessionId = [...h.ctx.sessions._map.keys()][0];

  // Titel & Text ändern
  const textModal = makeInteraction({
    isModalSubmit: () => true,
    customId: `srl_textmodal_${sessionId}`,
    guild: h.guild,
    fields: {
      getTextInputValue: (id) => (id === 'title' ? 'Neuer Titel' : 'Neue\nBeschreibung'),
    },
  });
  await handleInteraction(h.ctx, textModal.interaction);

  const before = h.sentMessages.length;
  const save = makeInteraction({
    isButton: () => true,
    customId: `srl_ed_publish_${sessionId}`,
    guild: h.guild,
  });
  await handleInteraction(h.ctx, save.interaction);

  assert.equal(h.sentMessages.length, before, 'Keine neue Nachricht');
  const parsed = parseSelfRoleMessage(h.message);
  assert.equal(parsed.title, 'Neuer Titel');
  assert.equal(parsed.description, 'Neue Beschreibung', 'Auch beim Bearbeiten einzeilig');
  assert.equal(h.created.length, 2, 'Bestehende Rollen wurden NICHT neu erstellt');
});

test('Editor: Rolle entfernen und Modus umschalten funktionieren', async () => {
  const h = await publishFixture();
  const pick = makeInteraction({
    isStringSelectMenu: () => true,
    customId: 'srl_pick_message',
    guild: h.guild,
    values: [`chan1:${h.message.id}`],
  });
  await handleInteraction(h.ctx, pick.interaction);
  const sessionId = [...h.ctx.sessions._map.keys()][0];

  // Modus umschalten
  const mode = makeInteraction({ isButton: () => true, customId: `srl_ed_mode_${sessionId}`, guild: h.guild });
  await handleInteraction(h.ctx, mode.interaction);
  assert.equal(h.ctx.sessions.get(sessionId).mode, 'single');

  // Entfernen-Ansicht öffnen
  const rm = makeInteraction({ isButton: () => true, customId: `srl_ed_remove_${sessionId}`, guild: h.guild });
  await handleInteraction(h.ctx, rm.interaction);
  assert.equal(h.ctx.sessions.get(sessionId).view, 'remove');

  // Erste Rolle rauswerfen
  const sel = makeInteraction({
    isStringSelectMenu: () => true,
    customId: `srl_rm_${sessionId}`,
    guild: h.guild,
    values: ['0'],
  });
  await handleInteraction(h.ctx, sel.interaction);

  const session = h.ctx.sessions.get(sessionId);
  assert.equal(session.roles.length, 1);
  assert.equal(session.view, 'main');
  assert.match(session.notice, /raus|off|Liste/i);
});

test('Abbrechen wirft die Session weg, ohne etwas zu erstellen', async () => {
  const h = makeHarness();
  const create = makeInteraction({
    isModalSubmit: () => true,
    customId: 'srl_createmodal_chan1',
    guild: h.guild,
    fields: { getTextInputValue: (id) => (id === 'title' ? 'T' : 'D') },
  });
  await handleInteraction(h.ctx, create.interaction);
  const sessionId = [...h.ctx.sessions._map.keys()][0];

  const cancel = makeInteraction({ isButton: () => true, customId: `srl_ed_cancel_${sessionId}`, guild: h.guild });
  await handleInteraction(h.ctx, cancel.interaction);

  assert.equal(h.ctx.sessions.get(sessionId), null);
  assert.equal(h.created.length, 0);
  assert.match(textOf(cancel.out.updates.at(-1)), /Abgebrochen|Cancel/i);
});

test('Store findet bestehende Nachrichten beim Scan selbst wieder', async () => {
  const h = await publishFixture();
  h.ctx.store.deleteGuild('guild1'); // Registry-Verlust simulieren

  const count = await h.ctx.store.scanGuild(h.guild);
  assert.equal(count, 1);
  assert.equal(h.ctx.store.countMessages('guild1'), 1);
  assert.equal(h.ctx.store.totalRoles('guild1'), 2);
});
