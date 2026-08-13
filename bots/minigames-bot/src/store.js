/** Flüchtige Registry; der dauerhafte Spielstand steckt in den Nachrichten. */

function gameKey(channelId, messageId) {
  return `${channelId}:${messageId}`;
}

function createStore() {
  const games = new Map(); // guildId -> Map<channel:message, entry>
  const languages = new Map(); // guildId -> { lang, changedAt }
  const locks = new Map();

  function guildGames(guildId) {
    if (!games.has(guildId)) games.set(guildId, new Map());
    return games.get(guildId);
  }

  function setGame(entry) {
    if (!entry?.guildId || !entry?.channelId || !entry?.messageId) return null;
    guildGames(entry.guildId).set(gameKey(entry.channelId, entry.messageId), entry);
    return entry;
  }

  function getGame(guildId, channelId, messageId) {
    return guildGames(guildId).get(gameKey(channelId, messageId)) || null;
  }

  function removeGame(guildId, channelId, messageId) {
    return guildGames(guildId).delete(gameKey(channelId, messageId));
  }

  function listGames(guildId) {
    return [...guildGames(guildId).values()];
  }

  function allGames() {
    return [...games.values()].flatMap((map) => [...map.values()]);
  }

  function countGames(guildId) {
    return guildGames(guildId).size;
  }

  function setServerLang(guildId, lang, changedAt = Date.now()) {
    const current = languages.get(guildId);
    const nextTime = Number(changedAt) || Date.now();
    if (!current || nextTime >= current.changedAt) {
      languages.set(guildId, { lang, changedAt: nextTime });
    }
    return languages.get(guildId)?.lang || lang;
  }

  function getServerLang(guildId) {
    return languages.get(guildId)?.lang || null;
  }

  function deleteGuild(guildId) {
    games.delete(guildId);
    languages.delete(guildId);
  }

  function withLock(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.finally(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  return {
    setGame,
    getGame,
    removeGame,
    listGames,
    allGames,
    countGames,
    setServerLang,
    getServerLang,
    deleteGuild,
    withLock,
  };
}

module.exports = { createStore, gameKey };
