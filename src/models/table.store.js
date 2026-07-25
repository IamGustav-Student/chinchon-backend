// In-memory store para mesas activas (reemplazar por Redis en producción)
const tables = new Map();

function create({ id, creatorId, creatorName, creatorAvatar, bet, maxPlayers, pointLimit }) {
  const table = {
    id,
    creatorId,
    creatorName,
    bet,
    maxPlayers,
    pointLimit,
    players: [creatorId],
    playerNames: { [creatorId]: creatorName },
    playerAvatars: { [creatorId]: creatorAvatar || 'avatar-1' },
    status: 'waiting',
    deck: [],
    discard: [],
    hands: {},
    currentTurn: null,
    hasDrawn: {},
    scores: {},
    round: 0,
  };
  tables.set(id, table);
  return table;
}

function get(id) {
  return tables.get(id) || null;
}

function getAll() {
  return Array.from(tables.values());
}

function addPlayer(id, userId, username, avatar) {
  const table = tables.get(id);
  if (!table) return null;
  table.players.push(userId);
  table.playerNames[userId] = username;
  table.playerAvatars[userId] = avatar || 'avatar-1';
  tables.set(id, table);
  return table;
}

function update(id, data) {
  const table = tables.get(id);
  if (!table) return null;
  const updated = { ...table, ...data };
  tables.set(id, updated);
  return updated;
}

function remove(id) {
  tables.delete(id);
}

module.exports = { create, get, getAll, addPlayer, update, remove };
