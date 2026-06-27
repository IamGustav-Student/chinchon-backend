const { Hand } = require('pokersolver');

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealHoleCards(deck, playerIds) {
  const d = [...deck];
  const holeCards = {};
  for (const id of playerIds) {
    holeCards[id] = [d.pop(), d.pop()];
  }
  return { holeCards, deck: d };
}

function dealCards(deck, count) {
  const d = [...deck];
  const cards = [];
  for (let i = 0; i < count; i++) cards.push(d.pop());
  return { cards, deck: d };
}

// Convert internal card to pokersolver string
function cardToStr(card) {
  const v = { 1: 'A', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' }[card.value] || String(card.value);
  const s = card.suit[0]; // s, h, d, c
  return v + s;
}

// Evaluate best 5-card hand from hole cards + community cards
function evaluateHand(holeCards, communityCards) {
  if (communityCards.length < 3) return null;
  const all = [...holeCards, ...communityCards].map(cardToStr);
  return Hand.solve(all);
}

// Returns array of { userId, hand } sorted best first
function rankHands(seats, holeCards, communityCards, foldedIds) {
  const active = seats.filter(s => !foldedIds.includes(s.userId) && holeCards[s.userId]);
  return active.map(s => ({
    userId: s.userId,
    hand: evaluateHand(holeCards[s.userId], communityCards),
  })).filter(h => h.hand !== null);
}

// Calculate side pots based on total contributions
// Returns [{ amount, eligiblePlayerIds }]
function calculateSidePots(seats, totalBets, foldedIds) {
  const entries = seats
    .filter(s => (totalBets[s.userId] || 0) > 0)
    .map(s => ({ userId: s.userId, bet: totalBets[s.userId] || 0, folded: foldedIds.includes(s.userId) }))
    .sort((a, b) => a.bet - b.bet);

  if (entries.length === 0) return [];

  const pots = [];
  let processed = 0;

  for (let i = 0; i < entries.length; i++) {
    const level = entries[i].bet;
    if (level <= processed) continue;
    const increment = level - processed;
    const contributors = entries.filter(e => e.bet >= level);
    const amount = increment * contributors.length;
    const eligible = contributors.filter(e => !e.folded).map(e => e.userId);
    if (eligible.length > 0 && amount > 0) {
      // Merge with previous pot if same eligible set (optimization)
      const last = pots[pots.length - 1];
      if (last && JSON.stringify(last.eligiblePlayerIds.slice().sort()) === JSON.stringify(eligible.slice().sort())) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligiblePlayerIds: eligible });
      }
    }
    processed = level;
  }

  return pots;
}

// Determine winners for each pot — returns [{ potIndex, potAmount, winners: [userId], hand }]
function determineWinners(sidePots, handRankings) {
  return sidePots.map((pot, idx) => {
    const eligible = pot.eligiblePlayerIds;
    const eligibleHands = handRankings.filter(h => eligible.includes(h.userId));

    if (eligibleHands.length === 0) {
      return { potIndex: idx, potAmount: pot.amount, winners: eligible, hand: null };
    }
    if (eligibleHands.length === 1) {
      return { potIndex: idx, potAmount: pot.amount, winners: [eligibleHands[0].userId], hand: eligibleHands[0].hand };
    }

    const solverHands = eligibleHands.map(h => h.hand);
    const winners = Hand.winners(solverHands);
    const winnerUserIds = eligibleHands
      .filter(h => winners.includes(h.hand))
      .map(h => h.userId);

    return {
      potIndex: idx,
      potAmount: pot.amount,
      winners: winnerUserIds,
      hand: winners[0],
    };
  });
}

// Friendly hand name for holdem-hand-end
function handName(hand) {
  if (!hand) return '';
  return hand.descr || hand.name || '';
}

module.exports = { createDeck, dealHoleCards, dealCards, evaluateHand, rankHands, calculateSidePots, determineWinners, handName };
