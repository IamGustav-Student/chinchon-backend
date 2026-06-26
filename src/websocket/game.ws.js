const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const tableStore = require('../models/table.store');
const engine = require('../game/chinchon.engine');

// Mapa de conexiones: userId -> ws
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

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(ws, user, msg);
      } catch {
        send(ws, { event: 'error', data: { message: 'Mensaje inválido' } });
      }
    });

    ws.on('close', () => {
      connections.delete(user.id);
      handleDisconnect(user.id);
    });
  });
}

function getTokenFromRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token');
}

function handleMessage(ws, user, { event, data }) {
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
  broadcast(table, { event: 'player-joined', data: { userId: user.id, username: user.username } });

  if (table.players.length === table.maxPlayers && table.status === 'waiting') {
    startGame(table);
  } else {
    send(ws, { event: 'game-state', data: publicState(table, user.id) });
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

  broadcastAll(updated, (userId) => ({
    event: 'game-start',
    data: {
      ...publicState(updated, userId),
      hand: updated.hands[userId],
    },
  }));

  notifyTurn(updated);
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
      // Reiniciar mazo con el descarte
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
  for (const pid of table.players) {
    if (pid !== user.id) {
      scores[pid] += table.hands[pid].reduce((s, c) => s + c.points, 0);
    }
    // El que hace Chinchón suma -10 puntos (bonificación)
    scores[user.id] = (scores[user.id] || 0) - 10;
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
    // Nueva ronda
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
  broadcast(table, {
    event: 'game-over',
    data: { winner: winnerId, scores },
  });
  // Eliminar mesa después de 30 segundos
  setTimeout(() => tableStore.remove(table.id), 30000);
}

function handleDisconnect(userId) {
  for (const table of tableStore.getAll()) {
    if (table.players.includes(userId) && table.status === 'playing') {
      broadcast(table, { event: 'player-disconnected', data: { userId } });
    }
  }
}

// Estado público de la mesa (sin mostrar manos ajenas)
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

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
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

module.exports = { initWebSocket };
