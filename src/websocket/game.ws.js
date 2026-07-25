const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const tableStore = require('../models/table.store');
const tournamentStore = require('../models/tournament.store');
const engine = require('../game/chinchon.engine');
const db = require('../models/db');
const gameEvents = require('../events/game.events');
const holdemWs = require('./holdem.ws');
const trucoWs = require('./truco.ws');

// userId -> ws
const connections = new Map();

function initWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const token = getTokenFromRequest(req);
    if (!token) return ws.close(1008, 'No autorizado');

    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return ws.close(1008, 'Token inválido');
    }

    connections.set(user.id, ws);
    ws.userId = user.id;
    ws.username = user.username;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Si el jugador tenía un timer de forfeit de torneo, cancelarlo al reconectar
    const { handleTournamentReconnect } = require('../tournament/tournament.scheduler');
    handleTournamentReconnect(user.id);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(ws, user, msg);
      } catch (err) {
        console.error('[ws message]', err.message);
        send(ws, { event: 'error', data: { message: 'Mensaje inválido' } });
      }
    });

    ws.on('close', () => {
      connections.delete(user.id);
      handleDisconnect(user.id);
    });
  });

  // Heartbeat: sin esto, proxies intermediarios (Railway incluido) cierran
  // conexiones WebSocket inactivas tras ~55-60s sin tráfico. En una partida
  // de cartas con turnos lentos eso mata el WS en silencio — el cliente
  // nunca se entera de que dejó de recibir game-state/your-turn y queda
  // mostrando el turno "congelado". El ping cada 25s genera tráfico
  // periódico y además limpia conexiones realmente muertas (que no
  // respondieron al ping anterior).
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        connections.delete(ws.userId);
        handleDisconnect(ws.userId);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  wss.on('close', () => clearInterval(interval));
}

function getTokenFromRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token');
}

function handleMessage(ws, user, { event, data }) {
  if (event.startsWith('holdem-')) {
    return holdemWs.handleHoldemMessage(ws, user, event, data || {});
  }
  if (event.startsWith('truco-')) {
    return trucoWs.handleTrucoMessage(ws, user, event, data || {});
  }
  switch (event) {
    case 'join-table':       return handleJoinTable(ws, user, data);
    case 'draw-card':        return handleDrawCard(ws, user, data);
    case 'discard-card':     return handleDiscardCard(ws, user, data);
    case 'declare-chinchon': return handleDeclareChinchon(ws, user, data);
    case 'cut':              return handleCut(ws, user, data);
    default:
      send(ws, { event: 'error', data: { message: 'Evento desconocido' } });
  }
}

function handleJoinTable(ws, user, { tableId }) {
  const table = tableStore.get(tableId);
  if (!table) return send(ws, { event: 'error', data: { message: 'Mesa no encontrada' } });

  ws.tableId = tableId;

  // Si la partida ya está en curso (jugador reconectado o llegó tarde en torneo)
  if (table.status === 'playing') {
    send(ws, {
      event: 'game-start',
      data: { ...publicState(table, user.id), hand: table.hands[user.id] ?? [] },
    });
    if (table.currentTurn === user.id) {
      send(ws, { event: 'your-turn', data: { tableId: table.id } });
    }
    return;
  }

  broadcast(table, {
    event: 'player-joined',
    data: { id: user.id, username: user.username, avatar: table.playerAvatars?.[user.id] || 'avatar-1' },
  });

  if (table.players.length === table.maxPlayers && table.status === 'waiting') {
    startGame(table);
  } else {
    broadcast(table, { event: 'game-state', data: publicState(table, user.id) });
  }
}

function startGame(table) {
  const deck = engine.createDeck();
  const { hands, deck: remaining } = engine.dealHands(table.players, deck);
  const firstDiscard = remaining.splice(0, 1)[0];

  const updated = tableStore.update(table.id, {
    status: 'playing',
    deck: remaining,
    discard: [firstDiscard],
    hands,
    currentTurn: table.players[0],
    scores: Object.fromEntries(table.players.map(id => [id, 0])),
    round: 1,
  });

  // Descontar apuestas (solo si bet > 0, mesas normales)
  if (updated.bet > 0) {
    deductBets(updated).catch(err => console.error('Error descontando apuestas:', err));
  }

  broadcastAll(updated, (userId) => ({
    event: 'game-start',
    data: { ...publicState(updated, userId), hand: updated.hands[userId] },
  }));

  notifyTurn(updated);
}

async function deductBets(table) {
  try {
    await db.query('BEGIN');
    for (const pid of table.players) {
      await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [table.bet, pid]);
      await db.query(
        'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
        [pid, 'game-loss', -table.bet]
      );
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error en deductBets:', err);
  }
}

function handleDrawCard(ws, user, { tableId, source }) {
  const table = tableStore.get(tableId);
  if (!table || table.status !== 'playing') return;
  if (table.currentTurn !== user.id) return send(ws, { event: 'error', data: { message: 'No es tu turno' } });
  if (ws.hasDrawn) return send(ws, { event: 'error', data: { message: 'Ya robaste carta' } });

  let card;
  let updatedDeck = [...table.deck];
  let updatedDiscard = [...table.discard];

  if (source === 'discard') {
    if (updatedDiscard.length === 0) return send(ws, { event: 'error', data: { message: 'Descarte vacío' } });
    card = updatedDiscard.pop();
  } else {
    if (updatedDeck.length === 0) {
      const last = updatedDiscard.pop();
      updatedDeck = engine.createDeck().filter(
        c => !updatedDiscard.some(d => d.suit === c.suit && d.value === c.value)
      );
      updatedDiscard = [last];
    }
    card = updatedDeck.pop();
  }

  const updatedHand = [...table.hands[user.id], card];
  const updated = tableStore.update(table.id, {
    deck: updatedDeck,
    discard: updatedDiscard,
    hands: { ...table.hands, [user.id]: updatedHand },
  });

  ws.hasDrawn = true;
  send(ws, { event: 'card-drawn', data: { card, hand: updatedHand } });
  broadcast(updated, { event: 'card-drawn', data: { playerId: user.id, source } }, user.id);
}

function handleDiscardCard(ws, user, { tableId, cardIndex }) {
  const table = tableStore.get(tableId);
  if (!table || table.status !== 'playing') return;
  if (table.currentTurn !== user.id) return send(ws, { event: 'error', data: { message: 'No es tu turno' } });
  if (!ws.hasDrawn) return send(ws, { event: 'error', data: { message: 'Debes robar antes de descartar' } });

  const hand = [...table.hands[user.id]];
  if (cardIndex < 0 || cardIndex >= hand.length) return send(ws, { event: 'error', data: { message: 'Índice inválido' } });

  const [discarded] = hand.splice(cardIndex, 1);
  const updatedDiscard = [...table.discard, discarded];
  const nextTurn = nextPlayer(table);

  const updated = tableStore.update(table.id, {
    discard: updatedDiscard,
    hands: { ...table.hands, [user.id]: hand },
    currentTurn: nextTurn,
  });

  ws.hasDrawn = false;
  broadcast(updated, { event: 'card-discarded', data: { playerId: user.id, card: discarded } });
  notifyTurn(updated);
}

function handleDeclareChinchon(ws, user, { tableId }) {
  const table = tableStore.get(tableId);
  if (!table || table.status !== 'playing') return;
  if (table.currentTurn !== user.id) return send(ws, { event: 'error', data: { message: 'No es tu turno' } });
  if (!ws.hasDrawn) return send(ws, { event: 'error', data: { message: 'Debes robar primero' } });

  const hand = table.hands[user.id];
  if (!engine.validateChinchon(hand)) {
    return send(ws, { event: 'error', data: { message: 'Mano inválida para Chinchón' } });
  }

  const scores = { ...table.scores };
  scores[user.id] = (scores[user.id] || 0) - 10;
  for (const pid of table.players) {
    if (pid !== user.id) {
      scores[pid] += table.hands[pid].reduce((s, c) => s + c.points, 0);
    }
  }

  endRound(table, scores, user.id, 'chinchon');
}

function handleCut(ws, user, { tableId }) {
  const table = tableStore.get(tableId);
  if (!table || table.status !== 'playing') return;
  if (table.currentTurn !== user.id) return send(ws, { event: 'error', data: { message: 'No es tu turno' } });
  if (!ws.hasDrawn) return send(ws, { event: 'error', data: { message: 'Debes robar primero' } });

  const hand = table.hands[user.id];
  const result = engine.validateClose(hand);
  if (!result.valid) {
    return send(ws, { event: 'error', data: { message: 'Mano inválida para cortar' } });
  }

  const scores = { ...table.scores };
  scores[user.id] = (scores[user.id] || 0) + result.points;
  for (const pid of table.players) {
    if (pid !== user.id) {
      scores[pid] += table.hands[pid].reduce((s, c) => s + c.points, 0);
    }
  }

  endRound(table, scores, user.id, 'cut');
}

function endRound(table, scores, winnerId, type) {
  const eliminated = table.players.filter(id => scores[id] >= table.pointLimit);
  const remaining = table.players.filter(id => scores[id] < table.pointLimit);

  const updated = tableStore.update(table.id, { scores });

  broadcast(updated, {
    event: 'round-end',
    data: { type, winnerId, scores, eliminated },
  });

  if (remaining.length <= 1) {
    const gameWinner = remaining[0] || table.players.reduce((a, b) => scores[a] < scores[b] ? a : b);
    endGame(updated, gameWinner, scores);
  } else {
    setTimeout(() => startNewRound(updated, remaining, scores), 3000);
  }
}

function startNewRound(table, players, scores) {
  const deck = engine.createDeck();
  const { hands, deck: remaining } = engine.dealHands(players, deck);
  const firstDiscard = remaining.splice(0, 1)[0];

  const updated = tableStore.update(table.id, {
    players,
    deck: remaining,
    discard: [firstDiscard],
    hands,
    currentTurn: players[0],
    scores,
    round: table.round + 1,
  });

  broadcastAll(updated, (userId) => ({
    event: 'new-round',
    data: { ...publicState(updated, userId), hand: updated.hands[userId] },
  }));

  notifyTurn(updated);
}

function endGame(table, winnerId, scores) {
  tableStore.update(table.id, { status: 'finished' });
  broadcast(table, { event: 'game-over', data: { winner: winnerId, scores } });

  // Actualizar estadísticas y billetera en partidas normales (bet > 0)
  if (table.bet > 0) {
    resolveGameFinances(table, winnerId).catch(err => console.error('Error en resolveGameFinances:', err));
  }

  // Emitir evento para que el scheduler de torneo reaccione
  gameEvents.emit('game-over', { tableId: table.id, winnerId });

  setTimeout(() => tableStore.remove(table.id), 30000);
}

async function resolveGameFinances(table, winnerId) {
  const prize = table.bet * table.players.length;
  const weekStart = getWeekStart();

  try {
    await db.query('BEGIN');

    // Acreditar premio al ganador (el entry ya fue deducido en startGame)
    await db.query('UPDATE users SET balance = balance + $1, games_played = games_played + 1, games_won = games_won + 1 WHERE id = $2', [prize, winnerId]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [winnerId, 'game-win', prize]
    );

    // Actualizar stats de losers
    for (const pid of table.players) {
      if (pid === winnerId) continue;
      await db.query('UPDATE users SET games_played = games_played + 1, games_lost = games_lost + 1 WHERE id = $1', [pid]);
    }

    // Ranking semanal del ganador
    await db.query(
      `INSERT INTO weekly_ranking (user_id, points, earnings, week_start)
       VALUES ($1, 1, $2, $3)
       ON CONFLICT (user_id, week_start) DO UPDATE
       SET points = weekly_ranking.points + 1, earnings = weekly_ranking.earnings + $2`,
      [winnerId, prize - table.bet, weekStart]
    );

    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error en resolveGameFinances:', err);
  }
}

function handleDisconnect(userId) {
  for (const table of tableStore.getAll()) {
    if (!table.players.includes(userId)) continue;

    if (table.status === 'playing') {
      broadcast(table, { event: 'player-disconnected', data: { userId } });
      continue;
    }

    if (table.status === 'waiting') {
      table.players = table.players.filter(id => id !== userId);
      delete table.playerNames[userId];
      delete table.playerAvatars[userId];

      if (table.players.length === 0) {
        tableStore.remove(table.id);
      } else {
        const updated = tableStore.update(table.id, table);
        broadcast(updated, { event: 'game-state', data: updated });
      }
    }
  }

  // Notificar al scheduler de torneo si aplica
  const { handleTournamentDisconnect } = require('../tournament/tournament.scheduler');
  handleTournamentDisconnect(userId);

  // Notificar hold'em y truco
  holdemWs.handleHoldemDisconnect(userId);
  trucoWs.handleTrucoDisconnect(userId);
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function publicState(table, forUserId) {
  return {
    id: table.id,
    status: table.status,
    players: table.players.map(id => ({
      id,
      username: table.playerNames[id],
      cardCount: table.hands[id]?.length ?? 0,
      score: table.scores[id] ?? 0,
    })),
    currentTurn: table.currentTurn,
    discardTop: table.discard[table.discard.length - 1] || null,
    deckCount: table.deck.length,
    round: table.round,
    bet: table.bet,
    pointLimit: table.pointLimit,
  };
}

function nextPlayer(table) {
  const idx = table.players.indexOf(table.currentTurn);
  return table.players[(idx + 1) % table.players.length];
}

function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
  return monday.toISOString().split('T')[0];
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendToUser(userId, payload) {
  const ws = connections.get(userId);
  if (ws) send(ws, payload);
}

function broadcastToAll(payload) {
  for (const [, ws] of connections) {
    send(ws, payload);
  }
}

function broadcast(table, payload, excludeId = null) {
  for (const playerId of table.players) {
    if (playerId === excludeId) continue;
    const ws = connections.get(playerId);
    if (ws) send(ws, payload);
  }
}

function broadcastAll(table, payloadFn) {
  for (const playerId of table.players) {
    const ws = connections.get(playerId);
    if (ws) send(ws, payloadFn(playerId));
  }
}

function notifyTurn(table) {
  const ws = connections.get(table.currentTurn);
  if (ws) send(ws, { event: 'your-turn', data: { tableId: table.id } });
}

module.exports = { initWebSocket, sendToUser, broadcastToAll };
