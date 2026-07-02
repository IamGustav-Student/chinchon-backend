const db = require('../models/db');
const holdemStore = require('../models/holdem.store');
const engine = require('../game/holdem.engine');

const TURN_TIMEOUT_MS = 30000;
const NEXT_HAND_DELAY_MS = 4000;

// Injected from game.ws.js
let _sendToUser = () => {};
let _broadcastToAll = () => {};

function init(sendToUser, broadcastToAll) {
  _sendToUser = sendToUser;
  _broadcastToAll = broadcastToAll;
}

// ── Entry point from game.ws.js ───────────────────────────────────────────────

function handleHoldemMessage(ws, user, event, data) {
  switch (event) {
    case 'holdem-join-table': return handleJoinTable(ws, user, data);
    case 'holdem-fold':       return handleAction(user, data, 'fold');
    case 'holdem-check':      return handleAction(user, data, 'check');
    case 'holdem-call':       return handleAction(user, data, 'call');
    case 'holdem-raise':      return handleAction(user, data, 'raise', data.amount);
    case 'holdem-allin':      return handleAction(user, data, 'allin');
  }
}

// Called when a player disconnects
function handleHoldemDisconnect(userId) {
  // If they're at a waiting table, remove them and return chips
  for (const table of holdemStore.getAll()) {
    if (table.status !== 'waiting') continue;
    const seat = table.seats.find(s => s.userId === userId);
    if (!seat) continue;
    returnChipsAndLeave(table, userId);
    break;
  }
}

// ── Join Table ────────────────────────────────────────────────────────────────

function handleJoinTable(ws, user, { tableId }) {
  const table = holdemStore.get(tableId);
  if (!table) {
    return _sendToUser(user.id, { event: 'holdem-error', data: { tableId, message: 'Mesa no encontrada' } });
  }

  const seat = table.seats.find(s => s.userId === user.id);
  if (!seat) {
    return _sendToUser(user.id, { event: 'holdem-error', data: { tableId, message: 'No estás en esta mesa' } });
  }

  // Broadcast updated state to all players at the table
  broadcastGameState(table);

  // If waiting and enough players, schedule start
  if (table.status === 'waiting' && table.seats.length >= 2 && !table.nextHandTimer) {
    table.nextHandTimer = setTimeout(() => {
      table.nextHandTimer = null;
      startHand(table);
    }, 2000);
  }
}

// ── Game Actions ──────────────────────────────────────────────────────────────

function handleAction(user, { tableId }, action, raiseAmount) {
  const table = holdemStore.get(tableId);
  if (!table || !table.handActive) {
    return _sendToUser(user.id, { event: 'holdem-error', data: { tableId, message: 'No hay mano activa' } });
  }

  const activeSeat = getActiveSeats(table)[table.actionIndex];
  if (!activeSeat || activeSeat.userId !== user.id) {
    return _sendToUser(user.id, { event: 'holdem-error', data: { tableId, message: 'No es tu turno' } });
  }

  clearTurnTimer(table);

  const seat = table.seats.find(s => s.userId === user.id);

  switch (action) {
    case 'fold':  doFold(table, seat); break;
    case 'check':
      if (table.callAmount > 0) {
        return _sendToUser(user.id, { event: 'holdem-error', data: { tableId, message: 'No podés hacer check' } });
      }
      doCheck(table, seat);
      break;
    case 'call':  doCall(table, seat); break;
    case 'raise': doRaise(table, seat, raiseAmount); break;
    case 'allin': doAllIn(table, seat); break;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function doFold(table, seat) {
  table.folded.push(seat.userId);
  table.lastActions[seat.userId] = 'fold';
  emitAction(table, seat, 'fold', seat.currentBet || 0);
  checkBettingRoundEnd(table);
}

function doCheck(table, seat) {
  table.lastActions[seat.userId] = 'check';
  emitAction(table, seat, 'check', 0);
  advanceAction(table);
}

function doCall(table, seat) {
  const owed = table.callAmount - (table.bets[seat.userId] || 0);
  const actual = Math.min(owed, seat.stack);
  seat.stack -= actual;
  table.bets[seat.userId] = (table.bets[seat.userId] || 0) + actual;
  table.totalBets[seat.userId] = (table.totalBets[seat.userId] || 0) + actual;
  table.pot += actual;

  if (seat.stack === 0) table.allIns.push(seat.userId);
  table.lastActions[seat.userId] = 'call';
  emitAction(table, seat, 'call', table.bets[seat.userId]);
  advanceAction(table);
}

function doRaise(table, seat, amount) {
  const minR = table.minRaise;
  const maxR = seat.stack + (table.bets[seat.userId] || 0);
  if (amount < minR || amount > maxR) {
    return _sendToUser(seat.userId, {
      event: 'holdem-error',
      data: { tableId: table.id, message: `Raise debe ser entre $${minR} y $${maxR}` },
    });
  }
  const owed = amount - (table.bets[seat.userId] || 0);
  seat.stack -= owed;
  table.bets[seat.userId] = amount;
  table.totalBets[seat.userId] = (table.totalBets[seat.userId] || 0) + owed;
  table.pot += owed;

  const raiseBy = amount - table.callAmount;
  table.callAmount = amount;
  table.minRaise = amount + raiseBy;
  table.lastRaiserId = seat.userId;
  if (seat.stack === 0) table.allIns.push(seat.userId);
  table.lastActions[seat.userId] = 'raise';
  emitAction(table, seat, 'raise', amount);
  advanceAction(table);
}

function doAllIn(table, seat) {
  const chips = seat.stack;
  const total = (table.bets[seat.userId] || 0) + chips;
  seat.stack = 0;
  table.bets[seat.userId] = total;
  table.totalBets[seat.userId] = (table.totalBets[seat.userId] || 0) + chips;
  table.pot += chips;

  if (total > table.callAmount) {
    const raiseBy = total - table.callAmount;
    table.callAmount = total;
    table.minRaise = total + raiseBy;
    table.lastRaiserId = seat.userId;
    table.lastActions[seat.userId] = 'allin';
  } else {
    table.lastActions[seat.userId] = 'allin';
  }
  table.allIns.push(seat.userId);
  emitAction(table, seat, 'allin', total);
  advanceAction(table);
}

// ── Betting Round Control ─────────────────────────────────────────────────────

function advanceAction(table) {
  const active = getActiveSeats(table); // non-folded, non-allin, stack > 0
  if (active.length === 0) {
    checkBettingRoundEnd(table);
    return;
  }

  // Move to next active player
  let next = (table.actionIndex + 1) % getPlayableSeats(table).length;
  const playable = getPlayableSeats(table);
  let looped = 0;
  while (looped < playable.length) {
    const candidate = playable[next];
    if (!table.folded.includes(candidate.userId) && !table.allIns.includes(candidate.userId)) {
      break;
    }
    next = (next + 1) % playable.length;
    looped++;
  }
  table.actionIndex = next;

  checkBettingRoundEnd(table);
}

function checkBettingRoundEnd(table) {
  const nonFolded = getPlayableSeats(table).filter(s => !table.folded.includes(s.userId));

  // Only one player left → they win
  if (nonFolded.length === 1) {
    awardPotToSingleWinner(table, nonFolded[0].userId);
    return;
  }

  const active = nonFolded.filter(s => !table.allIns.includes(s.userId) && s.stack > 0);

  // Check if all active players have acted and equalized
  const allEqual = active.every(s => (table.bets[s.userId] || 0) === table.callAmount);
  const allActed = active.every(s =>
    table.lastActions[s.userId] !== undefined || table.allIns.includes(s.userId)
  );

  // Special: last raiser is next → round is done
  const currentPlayable = getPlayableSeats(table);
  const currentSeat = currentPlayable[table.actionIndex];
  const roundDone = allEqual && allActed && (
    active.length === 0 ||
    !currentSeat ||
    currentSeat.userId === table.lastRaiserId ||
    (table.lastRaiserId === null && allActed)
  );

  if (!roundDone && active.length > 0 && currentSeat && !table.folded.includes(currentSeat.userId) && !table.allIns.includes(currentSeat.userId)) {
    startTurnTimer(table, currentSeat.userId);
    return;
  }

  if (active.length === 0 || roundDone) {
    proceedToNextPhase(table);
  } else if (active.length > 0) {
    startTurnTimer(table, currentSeat.userId);
  }
}

function proceedToNextPhase(table) {
  // Recalculate side pots
  table.sidePots = engine.calculateSidePots(table.seats, table.totalBets, table.folded);

  // Reset round bets
  table.bets = {};
  table.lastActions = {};
  table.lastRaiserId = null;

  // Set actionIndex to first non-folded, non-allin player after dealer
  const playable = getPlayableSeats(table);
  const afterDealer = (table.dealerIndex + 1) % playable.length;
  let startIdx = afterDealer;
  for (let i = 0; i < playable.length; i++) {
    const idx = (afterDealer + i) % playable.length;
    const seat = playable[idx];
    if (!table.folded.includes(seat.userId) && !table.allIns.includes(seat.userId) && seat.stack > 0) {
      startIdx = idx;
      break;
    }
  }
  table.actionIndex = startIdx;

  switch (table.phase) {
    case 'preflop': dealFlop(table); break;
    case 'flop':    dealTurn(table); break;
    case 'turn':    dealRiver(table); break;
    case 'river':   doShowdown(table); break;
  }
}

// ── Phases ────────────────────────────────────────────────────────────────────

function dealFlop(table) {
  const { cards, deck } = engine.dealCards(table.deck, 3);
  table.deck = deck;
  table.communityCards = cards;
  table.phase = 'flop';
  table.callAmount = 0;
  table.minRaise = table.blindsBig;

  broadcastTable(table, { event: 'holdem-community-cards', data: { tableId: table.id, phase: 'flop', cards } });
  broadcastGameState(table);

  const active = getActiveSeats(table);
  if (active.length === 0) { proceedToNextPhase(table); return; }
  setActionToFirstAfterDealer(table);
  startTurnTimer(table, getPlayableSeats(table)[table.actionIndex]?.userId);
}

function dealTurn(table) {
  const { cards, deck } = engine.dealCards(table.deck, 1);
  table.deck = deck;
  table.communityCards = [...table.communityCards, ...cards];
  table.phase = 'turn';
  table.callAmount = 0;
  table.minRaise = table.blindsBig;

  broadcastTable(table, { event: 'holdem-community-cards', data: { tableId: table.id, phase: 'turn', cards: table.communityCards } });
  broadcastGameState(table);

  const active = getActiveSeats(table);
  if (active.length === 0) { proceedToNextPhase(table); return; }
  setActionToFirstAfterDealer(table);
  startTurnTimer(table, getPlayableSeats(table)[table.actionIndex]?.userId);
}

function dealRiver(table) {
  const { cards, deck } = engine.dealCards(table.deck, 1);
  table.deck = deck;
  table.communityCards = [...table.communityCards, ...cards];
  table.phase = 'river';
  table.callAmount = 0;
  table.minRaise = table.blindsBig;

  broadcastTable(table, { event: 'holdem-community-cards', data: { tableId: table.id, phase: 'river', cards: table.communityCards } });
  broadcastGameState(table);

  const active = getActiveSeats(table);
  if (active.length === 0) { proceedToNextPhase(table); return; }
  setActionToFirstAfterDealer(table);
  startTurnTimer(table, getPlayableSeats(table)[table.actionIndex]?.userId);
}

function doShowdown(table) {
  table.handActive = false;
  broadcastTable(table, { event: 'holdem-showdown', data: { tableId: table.id } });

  const nonFolded = getPlayableSeats(table).filter(s => !table.folded.includes(s.userId));
  const handRankings = engine.rankHands(nonFolded, table.holeCards, table.communityCards, table.folded);
  const sidePots = table.sidePots.length > 0
    ? table.sidePots
    : [{ amount: table.pot, eligiblePlayerIds: nonFolded.map(s => s.userId) }];

  const results = engine.determineWinners(sidePots, handRankings);
  distributeWinnings(table, results, nonFolded, handRankings);
}

function distributeWinnings(table, results, nonFolded, handRankings) {
  const winnerSummary = [];
  const showdownCards = nonFolded.map(s => ({
    playerId: s.userId,
    cards: table.holeCards[s.userId] || [],
  }));

  for (const result of results) {
    const share = Math.floor(result.potAmount / result.winners.length);
    for (const uid of result.winners) {
      const seat = table.seats.find(s => s.userId === uid);
      if (seat) seat.stack += share;
      const handInfo = handRankings.find(h => h.userId === uid);
      winnerSummary.push({
        playerId: uid,
        amount: share,
        hand: engine.handName(handInfo?.hand),
      });
    }
  }

  const newStacks = Object.fromEntries(table.seats.map(s => [s.userId, s.stack]));

  broadcastTable(table, {
    event: 'holdem-hand-end',
    data: {
      tableId: table.id,
      winners: winnerSummary,
      showdownCards,
      newStacks,
    },
  });

  finishHand(table, winnerSummary);
}

function awardPotToSingleWinner(table, winnerId) {
  clearTurnTimer(table);
  table.handActive = false;

  // Recalc side pots to return uncallable excess
  table.sidePots = engine.calculateSidePots(table.seats, table.totalBets, table.folded);
  const totalPrize = table.sidePots.reduce((s, p) =>
    p.eligiblePlayerIds.includes(winnerId) ? s + p.amount : s, 0
  ) || table.pot;

  const seat = table.seats.find(s => s.userId === winnerId);
  if (seat) seat.stack += totalPrize;

  const newStacks = Object.fromEntries(table.seats.map(s => [s.userId, s.stack]));

  broadcastTable(table, {
    event: 'holdem-hand-end',
    data: {
      tableId: table.id,
      winners: [{ playerId: winnerId, amount: totalPrize, hand: '' }],
      showdownCards: [],
      newStacks,
    },
  });

  finishHand(table, [{ playerId: winnerId, amount: totalPrize }]);
}

// ── Hand lifecycle ────────────────────────────────────────────────────────────

function startHand(table) {
  const playable = table.seats.filter(s => s.stack > 0);
  if (playable.length < 2) return checkTableEnd(table);

  // Reset hand state
  table.phase = 'preflop';
  table.communityCards = [];
  table.pot = 0;
  table.bets = {};
  table.totalBets = {};
  table.folded = [];
  table.allIns = [];
  table.sidePots = [];
  table.lastActions = {};
  table.lastRaiserId = null;
  table.handActive = true;
  table.status = 'playing';

  // Rotate dealer
  table.dealerIndex = (table.dealerIndex + 1) % playable.length;
  const sbIdx = (table.dealerIndex + 1) % playable.length;
  const bbIdx = (table.dealerIndex + 2) % playable.length;

  // Deal
  const deck = engine.createDeck();
  const { holeCards, deck: remaining } = engine.dealHoleCards(deck, playable.map(s => s.userId));
  table.deck = remaining;
  table.holeCards = holeCards;

  // Post blinds
  const sbSeat = playable[sbIdx];
  const bbSeat = playable[bbIdx];

  const sbAmount = Math.min(table.blindsSmall, sbSeat.stack);
  sbSeat.stack -= sbAmount;
  table.bets[sbSeat.userId] = sbAmount;
  table.totalBets[sbSeat.userId] = sbAmount;
  table.pot += sbAmount;

  const bbAmount = Math.min(table.blindsBig, bbSeat.stack);
  bbSeat.stack -= bbAmount;
  table.bets[bbSeat.userId] = bbAmount;
  table.totalBets[bbSeat.userId] = bbAmount;
  table.pot += bbAmount;

  if (sbSeat.stack === 0) table.allIns.push(sbSeat.userId);
  if (bbSeat.stack === 0) table.allIns.push(bbSeat.userId);

  table.callAmount = bbAmount;
  table.minRaise = bbAmount * 2;

  // Pre-flop: first to act is player after BB
  const firstIdx = (bbIdx + 1) % playable.length;
  table.actionIndex = firstIdx;
  table.lastRaiserId = null;

  // Mark dealer/blinds in lastActions so betting round detection works
  // (SB and BB haven't "acted" yet — BB can raise)

  broadcastGameStateAll(table);

  const firstSeat = playable[table.actionIndex];
  if (firstSeat && !table.allIns.includes(firstSeat.userId)) {
    startTurnTimer(table, firstSeat.userId);
  } else {
    checkBettingRoundEnd(table);
  }
}

function finishHand(table, winners) {
  // Record to DB (fire and forget)
  recordHandResult(table, winners).catch(err => console.error('DB error holdem hand:', err));

  // Remove busted players who can't rebuy (already handled via rebuy endpoint)
  // Schedule next hand
  const playersWithChips = table.seats.filter(s => s.stack > 0);
  if (playersWithChips.length >= 2) {
    table.nextHandTimer = setTimeout(() => {
      table.nextHandTimer = null;
      startHand(table);
    }, NEXT_HAND_DELAY_MS);
  } else {
    checkTableEnd(table);
  }
}

function checkTableEnd(table) {
  if (table.seats.length <= 1 || table.seats.filter(s => s.stack > 0).length < 2) {
    // Return remaining chips
    returnAllChips(table);
    table.status = 'finished';
    table.handActive = false;
    broadcastTable(table, { event: 'holdem-game-finished', data: { tableId: table.id } });
    setTimeout(() => holdemStore.remove(table.id), 30000);
  }
}

// ── Chip returns ──────────────────────────────────────────────────────────────

async function returnAllChips(table) {
  try {
    for (const seat of table.seats) {
      if (seat.stack > 0) {
        await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [seat.stack, seat.userId]);
        await db.query(
          'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
          [seat.userId, 'holdem-cashout', seat.stack]
        );
        seat.stack = 0;
      }
    }
  } catch (err) {
    console.error('Error devolviendo fichas:', err);
  }
}

async function returnChipsAndLeave(table, userId) {
  const seat = table.seats.find(s => s.userId === userId);
  if (!seat) return;
  try {
    if (seat.stack > 0) {
      await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [seat.stack, userId]);
      await db.query(
        'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
        [userId, 'holdem-cashout', seat.stack]
      );
    }
  } catch (err) {
    console.error('Error devolviendo fichas al salir:', err);
  }
  holdemStore.removeSeat(table.id, userId);
  broadcastTable(table, {
    event: 'holdem-player-left',
    data: { tableId: table.id, playerId: userId, username: seat.username, avatar: seat.avatar },
  });
  if (table.seats.length === 0) {
    holdemStore.remove(table.id);
  }
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function recordHandResult(table, winners) {
  if (winners.length === 0) return;
  const winner = winners[0];
  await db.query(
    `INSERT INTO holdem_hands (table_id, winner_id, pot, winning_hand) VALUES ($1, $2, $3, $4)`,
    [table.id, winner.playerId, table.pot, winner.hand || '']
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// Seats that are still in play (seats with stack > 0, not yet eliminated)
function getPlayableSeats(table) {
  return table.seats.filter(s => (table.totalBets[s.userId] || 0) > 0 || s.stack > 0 || table.bets[s.userId] > 0);
}

// Active = not folded, not all-in, has chips to act
function getActiveSeats(table) {
  return table.seats.filter(s =>
    !table.folded.includes(s.userId) &&
    !table.allIns.includes(s.userId) &&
    s.stack > 0
  );
}

function setActionToFirstAfterDealer(table) {
  const playable = getPlayableSeats(table);
  for (let i = 1; i <= playable.length; i++) {
    const idx = (table.dealerIndex + i) % playable.length;
    const seat = playable[idx];
    if (!table.folded.includes(seat.userId) && !table.allIns.includes(seat.userId) && seat.stack > 0) {
      table.actionIndex = idx;
      return;
    }
  }
}

function clearTurnTimer(table) {
  if (table.turnTimer) {
    clearTimeout(table.turnTimer);
    table.turnTimer = null;
  }
}

function startTurnTimer(table, userId) {
  if (!userId) return;
  clearTurnTimer(table);
  _sendToUser(userId, { event: 'holdem-your-turn', data: { tableId: table.id, timeoutSeconds: 30 } });
  table.turnTimer = setTimeout(() => {
    table.turnTimer = null;
    if (!table.handActive) return;
    const seat = table.seats.find(s => s.userId === userId);
    if (!seat) return;
    // Auto fold or check
    if (table.callAmount === 0 || (table.bets[userId] || 0) >= table.callAmount) {
      doCheck(table, seat);
    } else {
      doFold(table, seat);
    }
  }, TURN_TIMEOUT_MS);
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

function broadcastTable(table, payload) {
  for (const seat of table.seats) {
    _sendToUser(seat.userId, payload);
  }
}

function sendGameState(table, userId) {
  const seat = table.seats.find(s => s.userId === userId);
  _sendToUser(userId, { event: 'holdem-game-state', data: buildGameState(table, userId) });
}

function broadcastGameState(table) {
  for (const seat of table.seats) {
    _sendToUser(seat.userId, { event: 'holdem-game-state', data: buildGameState(table, seat.userId) });
  }
}

function broadcastGameStateAll(table) {
  broadcastGameState(table);
}

function buildGameState(table, forUserId) {
  const forSeat = table.seats.find(s => s.userId === forUserId);
  const rebuysLeft = forSeat ? (table.maxRebuys - forSeat.rebuysUsed) : 0;

  // Determine dealer/SB/BB indices in playable seats
  const playable = getPlayableSeats(table);
  const dealerSeat = playable[table.dealerIndex % playable.length];
  const sbSeat = playable.length >= 2 ? playable[(table.dealerIndex + 1) % playable.length] : null;
  const bbSeat = playable.length >= 2 ? playable[(table.dealerIndex + 2) % playable.length] : null;

  const activeSeat = playable[table.actionIndex];
  const currentTurn = activeSeat && !table.folded.includes(activeSeat.userId) ? activeSeat.userId : null;

  const players = table.seats.map(s => {
    const isMe = s.userId === forUserId;
    return {
      id: s.userId,
      username: s.username,
      avatar: s.avatar,
      stack: s.stack,
      currentBet: table.bets[s.userId] || 0,
      folded: table.folded.includes(s.userId),
      isAllIn: table.allIns.includes(s.userId),
      seatIndex: s.seatIndex,
      isDealer: dealerSeat?.userId === s.userId,
      isSmallBlind: sbSeat?.userId === s.userId,
      isBigBlind: bbSeat?.userId === s.userId,
      holeCards: isMe ? (table.holeCards[s.userId] || null) : null,
      lastAction: table.lastActions[s.userId] || null,
    };
  });

  const myCurrentBet = table.bets[forUserId] || 0;
  const callAmount = Math.max(0, table.callAmount - myCurrentBet);
  const maxRaise = forSeat ? forSeat.stack : 0;

  return {
    id: table.id,
    status: table.status,
    phase: table.phase,
    players,
    communityCards: table.communityCards,
    pot: table.pot,
    sidePots: table.sidePots,
    currentTurn,
    callAmount,
    minRaise: table.minRaise,
    maxRaise,
    buyIn: table.buyIn,
    blindsSmall: table.blindsSmall,
    blindsBig: table.blindsBig,
    maxRebuys: table.maxRebuys,
    rebuysLeft,
  };
}

function emitAction(table, seat, action, totalBet) {
  const playable = getPlayableSeats(table);
  let nextIdx = (table.actionIndex + 1) % playable.length;
  let looped = 0;
  while (looped < playable.length) {
    const candidate = playable[nextIdx];
    if (!table.folded.includes(candidate.userId) && !table.allIns.includes(candidate.userId) && candidate.stack > 0) break;
    nextIdx = (nextIdx + 1) % playable.length;
    looped++;
  }
  const nextSeat = looped < playable.length ? playable[nextIdx] : null;

  broadcastTable(table, {
    event: 'holdem-action',
    data: {
      tableId: table.id,
      playerId: seat.userId,
      action,
      totalBet,
      stack: seat.stack,
      pot: table.pot,
      callAmount: table.callAmount,
      nextPlayerId: nextSeat?.userId || null,
    },
  });
}

module.exports = { init, handleHoldemMessage, handleHoldemDisconnect };
