const trucoStore = require('../models/truco.store');
const db = require('../models/db');
const engine = require('../game/truco.engine');

let _sendToUser = () => {};
let _broadcastToAll = () => {};

function init(sendToUser, broadcastToAll) {
  _sendToUser = sendToUser;
  _broadcastToAll = broadcastToAll;
}

function handleTrucoMessage(ws, user, event, data) {
  switch (event) {
    case 'truco-join-table':    return handleJoin(user, data);
    case 'truco-play-card':     return handlePlayCard(user, data);
    case 'truco-envido':        return handleChallenge(user, data, 'envido');
    case 'truco-envido-envido': return handleChallenge(user, data, 'envido-envido');
    case 'truco-real-envido':   return handleChallenge(user, data, 'real-envido');
    case 'truco-falta-envido':  return handleChallenge(user, data, 'falta-envido');
    case 'truco-truco':         return handleChallenge(user, data, 'truco');
    case 'truco-retruco':       return handleChallenge(user, data, 'retruco');
    case 'truco-vale-cuatro':   return handleChallenge(user, data, 'vale-cuatro');
    case 'truco-quiero':        return handleResponse(user, data, true);
    case 'truco-no-quiero':     return handleResponse(user, data, false);
    case 'truco-irse-al-mazo':  return handleIrseAlMazo(user, data);
    case 'truco-partner-signal': return handlePartnerSignal(user, data);
  }
}

function handleTrucoDisconnect(userId) {
  for (const table of trucoStore.getAll()) {
    if (table.status !== 'waiting') continue;
    const idx = table.players.findIndex(p => p.userId === userId);
    if (idx === -1) continue;
    table.players.splice(idx, 1);
    broadcastState(table);
    break;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(userId, tableId, msg) {
  _sendToUser(userId, { event: 'truco-error', data: { message: msg } });
}

function broadcastState(table) {
  for (const p of table.players) {
    _sendToUser(p.userId, { event: 'truco-game-state', data: publicState(table, p.userId) });
  }
}

function publicState(table, forUserId) {
  return {
    tableId: table.id,
    status: table.status,
    maxPlayers: table.maxPlayers,
    buyIn: table.buyIn,
    pointLimit: table.pointLimit,
    players: table.players.map(p => ({
      id: p.userId,
      username: p.username,
      avatar: p.avatar,
      teamIndex: p.teamIndex,
      seatIndex: p.seatIndex,
      isMano: p.isMano,
      cardCount: (table.hands[p.userId] || []).filter(c => !c.played).length,
      cardPlayed: (table.currentTrickPlays || []).find(x => x.userId === p.userId)?.card || null,
      lastAction: p.lastAction || null,
    })),
    myCards: table.hands[forUserId] || [],
    teamScores: table.teamScores,
    currentTurnId: table.currentTurnId,
    envidoOpen: table.envidoOpen,
    challenge: table.challenge,
    tricks: table.tricks.map(t => ({ winnerTeam: t.winnerTeam })),
    currentTrickPlays: table.currentTrickPlays || [],
  };
}

function teamOf(table, userId) {
  return table.players.find(p => p.userId === userId)?.teamIndex ?? 0;
}

function nextTurnAfter(table, userId) {
  const idx = table.players.findIndex(p => p.userId === userId);
  return table.players[(idx + 1) % table.players.length].userId;
}

// ── Join ──────────────────────────────────────────────────────────────────────

function handleJoin(user, { tableId }) {
  const table = trucoStore.get(tableId);
  if (!table) return err(user.id, tableId, 'Mesa no encontrada');

  const existing = table.players.find(p => p.userId === user.id);
  if (!existing) return err(user.id, tableId, 'No estás en esta mesa');

  _sendToUser(user.id, { event: 'truco-game-state', data: publicState(table, user.id) });
  broadcastState(table);

  if (table.status === 'waiting' && table.players.length === table.maxPlayers) {
    startHand(table);
  }
}

// ── Start hand ────────────────────────────────────────────────────────────────

function startHand(table) {
  table.status = 'playing';
  table.handNumber++;
  table.envidoOpen = true;
  table.challenge = null;
  table.tricks = [];
  table.currentTrickPlays = [];

  const playerIds = table.players.map(p => p.userId);
  table.hands = engine.deal(playerIds);

  // Mark mano
  const manoPlayer = table.players[table.manoIndex % table.players.length];
  table.players.forEach(p => { p.isMano = p.userId === manoPlayer.userId; p.lastAction = null; });
  table.currentTurnId = manoPlayer.userId;

  broadcastState(table);
  _sendToUser(table.currentTurnId, { event: 'truco-your-turn', data: {} });
}

// ── Play card ─────────────────────────────────────────────────────────────────

function handlePlayCard(user, { tableId, suit, value }) {
  const table = trucoStore.get(tableId);
  if (!table || table.status !== 'playing') return err(user.id, tableId, 'No hay partida activa');
  if (table.currentTurnId !== user.id) return err(user.id, tableId, 'No es tu turno');
  if (table.challenge) return err(user.id, tableId, 'Hay un canto pendiente');

  const hand = table.hands[user.id];
  const cardIdx = hand.findIndex(c => !c.played && c.suit === suit && c.value === value);
  if (cardIdx === -1) return err(user.id, tableId, 'Carta inválida');

  hand[cardIdx].played = true;
  table.currentTrickPlays.push({ userId: user.id, card: { suit, value } });

  // After playing, envido can no longer be called (after first card of first trick)
  if (table.tricks.length === 0) table.envidoOpen = false;

  if (table.currentTrickPlays.length === table.players.length) {
    resolveTrick(table);
  } else {
    table.currentTurnId = nextTurnAfter(table, user.id);
    broadcastState(table);
    _sendToUser(table.currentTurnId, { event: 'truco-your-turn', data: {} });
  }
}

function resolveTrick(table) {
  const plays = table.currentTrickPlays;
  let winnerTeam = null;
  let winnerUserId = null;

  if (table.maxPlayers === 2) {
    winnerUserId = engine.trickWinner(plays);
    winnerTeam = winnerUserId !== null ? teamOf(table, winnerUserId) : null;
  } else {
    winnerTeam = engine.trickWinnerTeam(plays, uid => teamOf(table, uid));
    if (winnerTeam !== null) {
      // Find highest card of winning team
      const teamPlays = plays.filter(p => teamOf(table, p.userId) === winnerTeam);
      winnerUserId = teamPlays.reduce((best, p) =>
        engine.cardPower(p.card) > engine.cardPower(best.card) ? p : best
      ).userId;
    }
  }

  table.tricks.push({ winnerTeam, winnerUserId, plays: [...plays] });
  table.currentTrickPlays = [];

  const teamTricks = [
    table.tricks.filter(t => t.winnerTeam === 0).length,
    table.tricks.filter(t => t.winnerTeam === 1).length,
  ];

  // Check if we have a truco result
  const trucoType = table.resolvedTruco; // set when truco was accepted
  const trucoPoints = trucoType ? engine.TRUCO_ACCEPT[trucoType] : 1;

  // Game ends after all 3 tricks OR one team wins 2
  const done = table.tricks.length === 3 || teamTricks[0] >= 2 || teamTricks[1] >= 2;

  if (done) {
    endHand(table, teamTricks, trucoPoints);
  } else {
    // Next trick starts: trick winner plays first (or mano on parda)
    const nextPlayer = winnerUserId || table.players[table.manoIndex % table.players.length].userId;
    table.currentTurnId = nextPlayer;
    broadcastState(table);
    _sendToUser(table.currentTurnId, { event: 'truco-your-turn', data: {} });
  }
}

function endHand(table, teamTricks, trucoPoints) {
  // Determine winning team
  let winnerTeam;
  if (teamTricks[0] > teamTricks[1]) winnerTeam = 0;
  else if (teamTricks[1] > teamTricks[0]) winnerTeam = 1;
  else winnerTeam = table.manoIndex % 2; // mano wins parda

  table.teamScores[winnerTeam] += trucoPoints;
  const envidoPts = table.resolvedEnvido || 0;
  // (envido points already added when resolved)

  const summary = {
    winnerTeam,
    trucoPoints,
    envidoPoints: envidoPts,
    details: '',
    teamScores: [...table.teamScores],
  };

  for (const p of table.players) {
    _sendToUser(p.userId, { event: 'truco-hand-end', data: summary });
  }

  // Check game over
  if (table.teamScores[0] >= table.pointLimit || table.teamScores[1] >= table.pointLimit) {
    const winner = table.teamScores[0] >= table.pointLimit ? 0 : 1;
    table.status = 'finished';
    finishGame(table, winner);
    return;
  }

  // Next hand
  table.manoIndex = (table.manoIndex + 1) % table.players.length;
  table.resolvedTruco = null;
  table.resolvedEnvido = 0;
  setTimeout(() => {
    if (trucoStore.get(table.id)) startHand(table);
  }, 3000);
}

// ── Challenge (envido / truco) ─────────────────────────────────────────────────

function handleChallenge(user, { tableId }, type) {
  const table = trucoStore.get(tableId);
  if (!table || table.status !== 'playing') return err(user.id, tableId, 'No hay partida activa');
  if (table.currentTurnId !== user.id) return err(user.id, tableId, 'No es tu turno');
  if (table.challenge) return err(user.id, tableId, 'Ya hay un canto pendiente');

  const isEnvido = engine.ENVIDO_CHAIN.includes(type);
  const isTruco  = engine.TRUCO_CHAIN.includes(type);

  if (isEnvido && !table.envidoOpen) return err(user.id, tableId, 'Ya no se puede cantar envido');
  if (isTruco && table.resolvedTruco) return err(user.id, tableId, 'Truco ya fue cantado');

  const callerTeam = teamOf(table, user.id);
  let pts;
  if (isEnvido) {
    pts = engine.envidoPoints(type, table.teamScores, table.pointLimit, table.teamScores);
  } else {
    pts = { accept: engine.TRUCO_ACCEPT[type], reject: engine.TRUCO_REJECT[type] };
  }

  table.challenge = {
    type,
    callerId: user.id,
    callerTeam,
    pointsIfAccepted: pts.accept,
    pointsIfRejected: pts.reject,
  };

  for (const p of table.players) {
    _sendToUser(p.userId, { event: 'truco-challenge', data: { type, callerUsername: user.username } });
  }
  broadcastState(table);
}

// ── Response ──────────────────────────────────────────────────────────────────

function handleResponse(user, { tableId }, accepted) {
  const table = trucoStore.get(tableId);
  if (!table || !table.challenge) return err(user.id, tableId, 'No hay canto pendiente');

  const ch = table.challenge;
  if (teamOf(table, user.id) === ch.callerTeam) return err(user.id, tableId, 'No podés responder tu propio canto');

  const isEnvido = engine.ENVIDO_CHAIN.includes(ch.type);
  const isTruco  = engine.TRUCO_CHAIN.includes(ch.type);

  table.challenge = null;

  if (accepted) {
    if (isEnvido) {
      // Compare envido points
      const scores = table.players.map(p => ({ userId: p.userId, pts: engine.calcEnvido(table.hands[p.userId]) }));
      const team0best = Math.max(...scores.filter(s => teamOf(table, s.userId) === 0).map(s => s.pts));
      const team1best = Math.max(...scores.filter(s => teamOf(table, s.userId) === 1).map(s => s.pts));
      const winTeam = team0best >= team1best ? 0 : 1; // mano wins tie
      table.teamScores[winTeam] += ch.pointsIfAccepted;
      table.resolvedEnvido = (table.resolvedEnvido || 0) + ch.pointsIfAccepted;
      if (ch.type !== 'falta-envido') table.envidoOpen = false;
    } else if (isTruco) {
      table.resolvedTruco = ch.type;
    }
  } else {
    // No-quiero: caller gets rejection points
    table.teamScores[ch.callerTeam] += ch.pointsIfRejected;
    if (isTruco) {
      // End hand immediately
      const teamTricks = [0, 0];
      endHand(table, teamTricks, ch.pointsIfRejected);
      return;
    }
    if (isEnvido) table.envidoOpen = false;
  }

  // Turn goes back to whoever's turn it was (the caller)
  table.currentTurnId = ch.callerId;
  broadcastState(table);
  _sendToUser(table.currentTurnId, { event: 'truco-your-turn', data: {} });
}

// ── Irse al mazo ──────────────────────────────────────────────────────────────

function handleIrseAlMazo(user, { tableId }) {
  const table = trucoStore.get(tableId);
  if (!table || table.status !== 'playing') return err(user.id, tableId, 'No hay partida activa');

  const loserTeam = teamOf(table, user.id);
  const winnerTeam = 1 - loserTeam;

  // Winner gets: 1 pt if no truco, or rejection points
  const trucoType = table.resolvedTruco || table.challenge?.type;
  const pts = (trucoType && engine.TRUCO_CHAIN.includes(trucoType))
    ? engine.TRUCO_REJECT[trucoType] || 1
    : 1;

  table.challenge = null;
  table.teamScores[winnerTeam] += pts;

  const teamTricks = [0, 0];
  teamTricks[winnerTeam] = 2;
  endHand(table, teamTricks, 0);
}

// ── Partner signal ─────────────────────────────────────────────────────────────

function handlePartnerSignal(user, { tableId, signal }) {
  const table = trucoStore.get(tableId);
  if (!table || table.maxPlayers !== 4) return;

  const myTeam = teamOf(table, user.id);
  const partner = table.players.find(p => p.teamIndex === myTeam && p.userId !== user.id);
  if (!partner) return;

  _sendToUser(partner.userId, { event: 'truco-partner-signal', data: { signal } });
}

// ── Finish game ───────────────────────────────────────────────────────────────

async function finishGame(table, winnerTeam) {
  for (const p of table.players) {
    _sendToUser(p.userId, { event: 'truco-game-over', data: { winnerTeam } });
  }

  if (table.buyIn > 0) {
    const winners = table.players.filter(p => p.teamIndex === winnerTeam);
    const totalPot = table.buyIn * table.players.length * 0.8; // 20% platform fee
    const share = Math.floor(totalPot / winners.length);
    for (const p of winners) {
      await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [share, p.userId]).catch(() => {});
      await db.query(`INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'game-win', $2)`, [p.userId, share]).catch(() => {});
    }
    const losers = table.players.filter(p => p.teamIndex !== winnerTeam);
    for (const p of losers) {
      await db.query(`INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'game-loss', $2)`, [p.userId, -table.buyIn]).catch(() => {});
    }
  }

  setTimeout(() => trucoStore.remove(table.id), 30000);
}

module.exports = { handleTrucoMessage, handleTrucoDisconnect, init };
