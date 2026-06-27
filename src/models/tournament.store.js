const { v4: uuidv4 } = require('uuid');

let activeTournament = null;

function create({ startsAt, registrationDeadline, entryFee = 1000, minPlayers = 8 }) {
  activeTournament = {
    id: uuidv4(),
    status: 'upcoming',
    startsAt,
    registrationDeadline,
    entryFee,
    minPlayers,
    registrations: new Map(), // userId -> { id, username, avatar }
    currentRound: 0,
    matches: new Map(),       // matchId -> match
    tableToMatch: new Map(),  // tableId -> matchId
    winnerId: null,
    finalistId: null,
    disconnectTimers: new Map(), // userId -> { timer, matchId }
  };
  return activeTournament;
}

function get() {
  return activeTournament;
}

function getById(id) {
  return activeTournament?.id === id ? activeTournament : null;
}

function setStatus(status) {
  if (activeTournament) activeTournament.status = status;
}

function addRegistration(userId, username, avatar = 'avatar-1') {
  if (!activeTournament) return false;
  activeTournament.registrations.set(userId, { id: userId, username, avatar });
  return true;
}

function removeRegistration(userId) {
  if (!activeTournament) return false;
  return activeTournament.registrations.delete(userId);
}

function createMatch(round, playerIds) {
  const match = {
    id: uuidv4(),
    round,
    players: playerIds,
    tableId: null,
    winnerId: null,
    status: 'pending',
  };
  activeTournament.matches.set(match.id, match);
  return match;
}

function assignTable(matchId, tableId) {
  const match = activeTournament?.matches.get(matchId);
  if (!match) return null;
  match.tableId = tableId;
  match.status = 'playing';
  activeTournament.tableToMatch.set(tableId, matchId);
  return match;
}

function recordMatchWinner(matchId, winnerId) {
  const match = activeTournament?.matches.get(matchId);
  if (!match) return null;
  match.winnerId = winnerId;
  match.status = 'finished';
  return match;
}

function getMatchByTableId(tableId) {
  const matchId = activeTournament?.tableToMatch.get(tableId);
  return matchId ? activeTournament.matches.get(matchId) : null;
}

function getRoundMatches(round) {
  if (!activeTournament) return [];
  return Array.from(activeTournament.matches.values()).filter(m => m.round === round);
}

function setDisconnectTimer(userId, matchId, timer) {
  activeTournament?.disconnectTimers.set(userId, { timer, matchId });
}

function clearDisconnectTimer(userId) {
  const entry = activeTournament?.disconnectTimers.get(userId);
  if (entry) {
    clearTimeout(entry.timer);
    activeTournament.disconnectTimers.delete(userId);
  }
}

function clear() {
  activeTournament = null;
}

module.exports = {
  create, get, getById, setStatus,
  addRegistration, removeRegistration,
  createMatch, assignTable, recordMatchWinner,
  getMatchByTableId, getRoundMatches,
  setDisconnectTimer, clearDisconnectTimer,
  clear,
};
