const SUITS = ['espada', 'basto', 'oro', 'copa'];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

// Power level for trick comparison (higher = stronger)
const POWER_MAP = {};
for (const s of SUITS) for (const v of VALUES) POWER_MAP[`${v}-${s}`] = 0;
POWER_MAP['1-espada'] = 14;
POWER_MAP['1-basto']  = 13;
POWER_MAP['7-espada'] = 12;
POWER_MAP['7-oro']    = 11;
for (const s of SUITS) POWER_MAP[`3-${s}`] = 10;
for (const s of SUITS) POWER_MAP[`2-${s}`] = 9;
POWER_MAP['1-oro']  = 7;
POWER_MAP['1-copa'] = 7;
for (const s of SUITS) POWER_MAP[`12-${s}`] = 6;
for (const s of SUITS) POWER_MAP[`11-${s}`] = 5;
for (const s of SUITS) POWER_MAP[`10-${s}`] = 4;
POWER_MAP['7-copa']  = 3;
POWER_MAP['7-basto'] = 3;
for (const s of SUITS) POWER_MAP[`6-${s}`] = 2;
for (const s of SUITS) POWER_MAP[`5-${s}`] = 1;
for (const s of SUITS) POWER_MAP[`4-${s}`] = 0;

function cardPower(card) {
  return POWER_MAP[`${card.value}-${card.suit}`] ?? 0;
}

// Envido point value of a single card (face cards = 0)
function envidoVal(card) {
  return card.value <= 7 ? card.value : 0;
}

// Calculate envido score from 3 cards
function calcEnvido(cards) {
  const bySuit = {};
  for (const card of cards) {
    (bySuit[card.suit] = bySuit[card.suit] || []).push(envidoVal(card));
  }
  let best = 0;
  for (const vals of Object.values(bySuit)) {
    if (vals.length >= 2) {
      vals.sort((a, b) => b - a);
      best = Math.max(best, 20 + vals[0] + vals[1]);
    }
  }
  if (best === 0) {
    for (const vals of Object.values(bySuit)) {
      best = Math.max(best, Math.max(...vals));
    }
  }
  return best;
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const value of VALUES) deck.push({ suit, value });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deal cards to players (returns map userId → [card, card, card])
function deal(playerIds) {
  const deck = shuffle(buildDeck());
  const hands = {};
  playerIds.forEach((id, i) => {
    hands[id] = deck.slice(i * 3, i * 3 + 3).map(c => ({ ...c, played: false }));
  });
  return hands;
}

// Determine trick winner index from plays [{userId, card}] — returns userId or null on parda
function trickWinner(plays) {
  let best = -1;
  let winner = null;
  let tie = false;
  for (const { userId, card } of plays) {
    const p = cardPower(card);
    if (p > best) { best = p; winner = userId; tie = false; }
    else if (p === best) { tie = true; }
  }
  return tie ? null : winner;
}

// Determine which team wins a trick (for 4-player)
// Returns teamIndex (0 or 1) or null for parda
function trickWinnerTeam(plays, teamOf) {
  let bestPower = [-1, -1];
  for (const { userId, card } of plays) {
    const team = teamOf(userId);
    const p = cardPower(card);
    if (p > bestPower[team]) bestPower[team] = p;
  }
  if (bestPower[0] > bestPower[1]) return 0;
  if (bestPower[1] > bestPower[0]) return 1;
  return null; // parda
}

// Envido cantos escalation chain
const ENVIDO_CHAIN = ['envido', 'envido-envido', 'real-envido', 'falta-envido'];
const TRUCO_CHAIN  = ['truco', 'retruco', 'vale-cuatro'];

// Points if accepted for truco
const TRUCO_ACCEPT = { truco: 2, retruco: 3, 'vale-cuatro': 4 };
const TRUCO_REJECT = { truco: 1, retruco: 2, 'vale-cuatro': 3 };

// Compute envido points for a challenge
function envidoPoints(type, prizePool, pointLimit, currentScore) {
  if (type === 'envido') return { accept: 2, reject: 1 };
  if (type === 'envido-envido') return { accept: 4, reject: 1 };
  if (type === 'real-envido') return { accept: 3, reject: 1 };
  if (type === 'falta-envido') {
    const needed = pointLimit - Math.max(...currentScore);
    return { accept: needed, reject: 1 };
  }
  return { accept: 1, reject: 1 };
}

module.exports = { cardPower, calcEnvido, deal, trickWinner, trickWinnerTeam, ENVIDO_CHAIN, TRUCO_CHAIN, TRUCO_ACCEPT, TRUCO_REJECT, envidoPoints };
