const tables = new Map();

function create({ id, maxPlayers, buyIn, pointLimit }) {
  const table = {
    id,
    status: 'waiting',
    maxPlayers,
    buyIn,
    pointLimit,
    players: [],         // [{ userId, username, avatar, teamIndex, seatIndex, isMano }]
    hands: {},           // userId → [{ suit, value, played }]
    teamScores: [0, 0],
    currentTurnId: null,
    currentTrickPlays: [], // [{ userId, card }]
    tricks: [],          // [{ winnerId/winnerTeam, plays }]
    envidoOpen: true,
    challenge: null,     // { type, callerId, callerTeam, pointsIfAccepted, pointsIfRejected }
    handNumber: 0,
    manoIndex: 0,        // index in players[] who is mano this hand
  };
  tables.set(id, table);
  return table;
}

function get(id) { return tables.get(id) || null; }
function getAll() { return Array.from(tables.values()); }
function remove(id) { tables.delete(id); }

module.exports = { create, get, getAll, remove };
