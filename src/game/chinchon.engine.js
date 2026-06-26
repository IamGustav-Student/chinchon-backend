// Motor del juego Chinchón con baraja española de 48 cartas

const SUITS = ['oro', 'copa', 'basto', 'espada'];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value, points: cardPoints(value) });
    }
  }
  return shuffle(deck);
}

function cardPoints(value) {
  if (value === 10) return 8;
  if (value === 11) return 9;
  if (value === 12) return 10;
  return value;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealHands(players, deck) {
  const hands = {};
  const remaining = [...deck];
  for (const playerId of players) {
    hands[playerId] = remaining.splice(0, 7);
  }
  return { hands, deck: remaining };
}

// Verifica si un grupo de cartas es válido (escalera o trío/cuarteto del mismo palo)
function isValidGroup(cards) {
  if (cards.length < 3) return false;
  if (isRun(cards)) return true;
  if (isSet(cards)) return true;
  return false;
}

// Escalera: mismo palo, valores consecutivos
function isRun(cards) {
  if (new Set(cards.map(c => c.suit)).size !== 1) return false;
  const vals = cards.map(c => normalizeRunValue(c.value)).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) return false;
  }
  return true;
}

function normalizeRunValue(v) {
  // En baraja española no hay 8 ni 9, el 10 sigue al 7
  if (v === 10) return 8;
  if (v === 11) return 9;
  if (v === 12) return 10;
  return v;
}

// Trío o cuarteto: mismo valor, palos distintos
function isSet(cards) {
  const values = cards.map(c => c.value);
  const suits = cards.map(c => c.suit);
  return new Set(values).size === 1 && new Set(suits).size === suits.length;
}

// Valida que una mano completa se pueda organizar en grupos válidos con una carta de descarte
function validateClose(hand) {
  if (hand.length !== 7) return { valid: false };
  // Probar todas las combinaciones de 6 cartas en grupos y 1 de descarte
  for (let i = 0; i < hand.length; i++) {
    const discard = hand[i];
    const rest = hand.filter((_, idx) => idx !== i);
    if (canFormGroups(rest)) {
      return { valid: true, discard, points: discard.points };
    }
  }
  return { valid: false };
}

// Chinchón: todas las 7 cartas forman grupos válidos (sin descartar)
function validateChinchon(hand) {
  if (hand.length !== 7) return false;
  return canFormGroups(hand);
}

// Intenta particionar las cartas en grupos válidos (backtracking)
function canFormGroups(cards) {
  if (cards.length === 0) return true;
  for (let size = 3; size <= Math.min(4, cards.length); size++) {
    const combos = combinations(cards, size);
    for (const group of combos) {
      if (isValidGroup(group)) {
        const rest = cards.filter(c => !group.includes(c));
        if (canFormGroups(rest)) return true;
      }
    }
  }
  return false;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// Calcula los puntos de las cartas que sobran en la mano al corte
function handPoints(hand, groups) {
  const usedCards = groups.flat();
  const leftover = hand.filter(c => !usedCards.some(u => u.suit === c.suit && u.value === c.value));
  return leftover.reduce((sum, c) => sum + c.points, 0);
}

module.exports = {
  createDeck,
  dealHands,
  isValidGroup,
  validateClose,
  validateChinchon,
  handPoints,
  cardPoints,
};
