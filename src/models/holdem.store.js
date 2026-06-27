const { v4: uuidv4 } = require('uuid');

// tableId -> table object
const tables = new Map();

const BLIND_MAP = {
  500:   { small: 5,   big: 10  },
  1000:  { small: 10,  big: 20  },
  5000:  { small: 50,  big: 100 },
  25000: { small: 250, big: 500 },
};

function create({ buyIn, maxPlayers, creatorId, creatorUsername, creatorAvatar }) {
  const blinds = BLIND_MAP[buyIn] || { small: 10, big: 20 };
  const table = {
    id: uuidv4(),
    buyIn,
    blindsSmall: blinds.small,
    blindsBig: blinds.big,
    maxPlayers: maxPlayers || 4,
    maxRebuys: 3,
    status: 'waiting',
    seats: [{
      userId: creatorId,
      username: creatorUsername,
      avatar: creatorAvatar || 'avatar-1',
      stack: buyIn,
      rebuysUsed: 0,
      seatIndex: 0,
    }],
    // hand state
    phase: null,
    deck: [],
    holeCards: {},
    communityCards: [],
    pot: 0,
    bets: {},
    totalBets: {},
    folded: [],
    allIns: [],
    sidePots: [],
    dealerIndex: 0,
    actionIndex: 0,
    roundStartIndex: 0,
    lastRaiserId: null,
    callAmount: 0,
    minRaise: 0,
    lastActions: {},
    turnTimer: null,
    nextHandTimer: null,
    handActive: false,
  };
  tables.set(table.id, table);
  return table;
}

function get(tableId) { return tables.get(tableId); }
function getAll() { return Array.from(tables.values()); }

function addSeat(tableId, { userId, username, avatar }) {
  const table = tables.get(tableId);
  if (!table) return null;
  const seatIndex = table.seats.length;
  table.seats.push({ userId, username, avatar: avatar || 'avatar-1', stack: table.buyIn, rebuysUsed: 0, seatIndex });
  return table;
}

function removeSeat(tableId, userId) {
  const table = tables.get(tableId);
  if (!table) return null;
  table.seats = table.seats.filter(s => s.userId !== userId);
  return table;
}

function getSeat(tableId, userId) {
  const table = tables.get(tableId);
  return table?.seats.find(s => s.userId === userId) || null;
}

function updateSeat(tableId, userId, updates) {
  const table = tables.get(tableId);
  if (!table) return null;
  const seat = table.seats.find(s => s.userId === userId);
  if (seat) Object.assign(seat, updates);
  return table;
}

function update(tableId, updates) {
  const table = tables.get(tableId);
  if (!table) return null;
  Object.assign(table, updates);
  return table;
}

function remove(tableId) { tables.delete(tableId); }

module.exports = { create, get, getAll, addSeat, removeSeat, getSeat, updateSeat, update, remove, BLIND_MAP };
