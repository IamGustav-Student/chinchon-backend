const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/db');
const tournamentStore = require('../models/tournament.store');
const tableStore = require('../models/table.store');
const gameEvents = require('../events/game.events');
const { getTableSizes, calculateTotalRounds } = require('../controllers/tournament.controller');

// Inyectado desde app.js para evitar dependencia circular con game.ws.js
let _sendToUser = () => {};
let _broadcastToAll = () => {};

function init(sendToUser, broadcastToAll) {
  _sendToUser = sendToUser;
  _broadcastToAll = broadcastToAll;

  // Escuchar fin de partidas para avanzar torneo
  gameEvents.on('game-over', ({ tableId, winnerId }) => {
    handleMatchEnd(tableId, winnerId).catch(err => console.error('Error en handleMatchEnd:', err));
  });

  // Cron: abrir inscripciones — viernes 18:00 ART (21:00 UTC)
  cron.schedule('0 21 * * 5', openRegistrations, { timezone: 'UTC' });

  // Cron: cerrar inscripciones — sábado 17:55 ART (20:55 UTC)
  cron.schedule('55 20 * * 6', closeRegistrations, { timezone: 'UTC' });

  // Cron: iniciar torneo — sábado 18:00 ART (21:00 UTC)
  cron.schedule('0 21 * * 6', startTournament, { timezone: 'UTC' });

  ensureUpcomingTournament();
}

// Garantiza que siempre haya un torneo "upcoming" en el store
function ensureUpcomingTournament() {
  if (tournamentStore.get()) return;
  const { startsAt, deadline } = nextSaturdayTimes();
  tournamentStore.create({ startsAt: startsAt.toISOString(), registrationDeadline: deadline.toISOString() });
  console.log(`Torneo creado para ${startsAt.toISOString()}`);
}

function nextSaturdayTimes() {
  const now = new Date();
  // Próximo sábado a las 18:00 ART (21:00 UTC)
  const daysUntilSat = (6 - now.getUTCDay() + 7) % 7 || 7;
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSat, 21, 0, 0));
  const deadline = new Date(startsAt.getTime() - 5 * 60 * 1000); // 5 min antes
  return { startsAt, deadline };
}

function openRegistrations() {
  const existing = tournamentStore.get();
  if (!existing || existing.status !== 'upcoming') {
    ensureUpcomingTournament();
  }
  const t = tournamentStore.get();
  if (!t || t.status !== 'upcoming') return;

  tournamentStore.setStatus('registration_open');
  console.log(`Inscripciones abiertas para torneo ${t.id}`);
}

async function closeRegistrations() {
  const t = tournamentStore.get();
  if (!t || t.status !== 'registration_open') return;

  if (t.registrations.size < t.minPlayers) {
    await cancelTournament('min_players_not_reached');
  }
}

async function startTournament() {
  const t = tournamentStore.get();
  if (!t || (t.status !== 'registration_open' && t.status !== 'upcoming')) return;
  if (t.registrations.size < t.minPlayers) return;

  tournamentStore.setStatus('in_progress');
  t.currentRound = 1;

  // Persistir en BD
  try {
    await db.query(
      `INSERT INTO tournaments (id, status, starts_at, registration_deadline, entry_fee, min_players, total_players, prize_pool)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET status = $2, total_players = $7, prize_pool = $8`,
      [
        t.id, 'in_progress', t.startsAt, t.registrationDeadline,
        t.entryFee, t.minPlayers,
        t.registrations.size, t.registrations.size * t.entryFee,
      ]
    );
  } catch (err) {
    console.error('Error persistiendo torneo:', err);
  }

  // Notificar inicio a todos los conectados
  _broadcastToAll({
    event: 'tournament-start',
    data: { tournamentId: t.id, totalPlayers: t.registrations.size },
  });

  // Distribuir jugadores en mesas
  await assignRoundMatches(t, 1);

  // Crear próximo torneo para la semana siguiente
  const { startsAt, deadline } = nextSaturdayTimes();
  tournamentStore.create({ startsAt: startsAt.toISOString(), registrationDeadline: deadline.toISOString() });
}

async function assignRoundMatches(t, round) {
  const players = Array.from(t.registrations.keys());
  shuffleArray(players);

  const sizes = getTableSizes(players.length);

  let idx = 0;
  for (const size of sizes) {
    const matchPlayers = players.slice(idx, idx + size);
    idx += size;

    const match = tournamentStore.createMatch(round, matchPlayers);
    const tableId = uuidv4();

    // Crear mesa en tableStore con todos los jugadores pre-cargados
    const creator = t.registrations.get(matchPlayers[0]);
    tableStore.create({
      id: tableId,
      creatorId: matchPlayers[0],
      creatorName: creator.username,
      bet: 0,
      maxPlayers: size,
      pointLimit: 100,
    });
    for (let i = 1; i < matchPlayers.length; i++) {
      const reg = t.registrations.get(matchPlayers[i]);
      tableStore.addPlayer(tableId, matchPlayers[i], reg.username);
    }

    tournamentStore.assignTable(match.id, tableId);

    // Notificar a cada jugador del match
    for (const uid of matchPlayers) {
      _sendToUser(uid, {
        event: 'tournament-match-assigned',
        data: { tournamentId: t.id, round, matchId: match.id, tableId },
      });
    }
  }
}

async function handleMatchEnd(tableId, winnerId) {
  const t = tournamentStore.get();
  if (!t || t.status !== 'in_progress') return;

  const match = tournamentStore.getMatchByTableId(tableId);
  if (!match || match.status === 'finished') return;

  tournamentStore.recordMatchWinner(match.id, winnerId);

  const roundMatches = tournamentStore.getRoundMatches(t.currentRound);
  const allFinished = roundMatches.every(m => m.status === 'finished');
  if (!allFinished) return;

  const winners = roundMatches.map(m => m.winnerId);

  _broadcastToAll({
    event: 'tournament-round-end',
    data: { tournamentId: t.id, round: t.currentRound, survivors: winners.length },
  });

  if (winners.length === 1) {
    // Identificar finalista: el que perdió en la última ronda con solo 2 jugadores
    const finalist = roundMatches[0].players.find(p => p !== winners[0]);
    await finishTournament(t, winners[0], finalist);
  } else {
    // Siguiente ronda
    t.currentRound += 1;
    // Reconstruir registrations solo con los ganadores
    const survivorMap = new Map();
    for (const uid of winners) {
      const reg = t.registrations.get(uid);
      if (reg) survivorMap.set(uid, reg);
    }
    t.registrations = survivorMap;
    await assignRoundMatches(t, t.currentRound);
  }
}

async function finishTournament(t, winnerId, finalistId) {
  tournamentStore.setStatus('finished');
  t.winnerId = winnerId;
  t.finalistId = finalistId;

  const prizePool = t.registrations.size * t.entryFee;
  const winnerPrize = Math.floor(prizePool * 0.7);
  const finalistPrize = Math.floor(prizePool * 0.1);

  try {
    await db.query('BEGIN');

    // Acreditar premios
    await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [winnerPrize, winnerId]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [winnerId, 'tournament-win', winnerPrize]
    );

    if (finalistId) {
      await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [finalistPrize, finalistId]);
      await db.query(
        'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
        [finalistId, 'tournament-finalist', finalistPrize]
      );
    }

    // Persistir resultado
    await db.query(
      `UPDATE tournaments SET status = 'finished', winner_id = $1, finalist_id = $2, prize_pool = $3
       WHERE id = $4`,
      [winnerId, finalistId, prizePool, t.id]
    );

    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error finalizando torneo:', err);
  }

  _broadcastToAll({
    event: 'tournament-finished',
    data: { tournamentId: t.id, winnerId, finalistId },
  });
}

async function cancelTournament(reason = 'min_players_not_reached') {
  const t = tournamentStore.get();
  if (!t) return;

  tournamentStore.setStatus('cancelled');

  // Devolver inscripciones
  try {
    await db.query('BEGIN');
    for (const [userId] of t.registrations) {
      await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [t.entryFee, userId]);
      await db.query(
        'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
        [userId, 'tournament-refund', t.entryFee]
      );
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error cancelando torneo:', err);
  }

  _broadcastToAll({
    event: 'tournament-cancelled',
    data: { tournamentId: t.id, reason },
  });

  // Crear el siguiente torneo
  const { startsAt, deadline } = nextSaturdayTimes();
  tournamentStore.create({ startsAt: startsAt.toISOString(), registrationDeadline: deadline.toISOString() });
}

// Se llama desde game.ws.js cuando un jugador se desconecta durante un torneo
function handleTournamentDisconnect(userId) {
  const t = tournamentStore.get();
  if (!t || t.status !== 'in_progress') return;

  const match = Array.from(t.matches.values()).find(
    m => m.round === t.currentRound && m.players.includes(userId) && m.status === 'playing'
  );
  if (!match) return;

  // Cancelar timer anterior si existe
  tournamentStore.clearDisconnectTimer(userId);

  // Enviar aviso solo al jugador desconectado
  _sendToUser(userId, {
    event: 'tournament-disconnect-warning',
    data: { tournamentId: t.id, matchId: match.id, seconds: 50 },
  });

  // Timer de forfeit: 50 segundos
  const timer = setTimeout(() => {
    const currentT = tournamentStore.get();
    const currentMatch = currentT?.matches.get(match.id);
    if (!currentMatch || currentMatch.status === 'finished') return;

    // Elegir ganador: cualquier jugador que no sea el desconectado
    const winner = currentMatch.players.find(p => p !== userId);
    if (winner) {
      gameEvents.emit('game-over', { tableId: match.tableId, winnerId: winner });
    }
  }, 50000);

  tournamentStore.setDisconnectTimer(userId, match.id, timer);
}

// Se llama cuando un jugador se reconecta
function handleTournamentReconnect(userId) {
  tournamentStore.clearDisconnectTimer(userId);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

module.exports = { init, handleTournamentDisconnect, handleTournamentReconnect };
