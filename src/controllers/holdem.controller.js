const db = require('../models/db');
const holdemStore = require('../models/holdem.store');

const VALID_BUYINS = [0, 500, 1000, 5000, 25000];

async function listTables(req, res) {
  const tables = holdemStore.getAll().filter(t => t.status !== 'finished');
  res.json(tables.map(tableToSummary));
}

async function getTable(req, res) {
  const table = holdemStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  res.json(tableToDetail(table));
}

async function createTable(req, res) {
  const userId = req.user.id;
  const { buyIn, maxPlayers } = req.body;

  if (!VALID_BUYINS.includes(buyIn)) {
    return res.status(400).json({ error: 'Buy-in inválido' });
  }

  // Check user not already at a table
  const existing = holdemStore.getAll().find(t =>
    t.status !== 'finished' && t.seats.some(s => s.userId === userId)
  );
  if (existing) return res.status(400).json({ error: 'Ya estás en una mesa' });

  // Check balance
  const { rows } = await db.query('SELECT balance, avatar FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (buyIn > 0 && rows[0].balance < buyIn) return res.status(400).json({ error: 'Saldo insuficiente' });

  // Deduct buy-in (las mesas gratuitas no mueven saldo real)
  if (buyIn > 0) {
    await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [buyIn, userId]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [userId, 'holdem-buyin', -buyIn]
    );
  }

  const table = holdemStore.create({
    buyIn,
    maxPlayers: maxPlayers || 4,
    creatorId: userId,
    creatorUsername: req.user.username,
    creatorAvatar: rows[0].avatar,
  });

  res.json(tableToDetail(table));
}

async function joinTable(req, res) {
  const userId = req.user.id;
  const table = holdemStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

  if (table.seats.some(s => s.userId === userId)) {
    return res.status(400).json({ error: 'Ya estás en esta mesa' });
  }
  if (table.seats.length >= table.maxPlayers) {
    return res.status(400).json({ error: 'Mesa llena' });
  }
  if (table.status === 'finished') {
    return res.status(400).json({ error: 'La mesa está cerrada' });
  }

  // Check not already at another table
  const existing = holdemStore.getAll().find(t =>
    t.id !== table.id && t.status !== 'finished' && t.seats.some(s => s.userId === userId)
  );
  if (existing) return res.status(400).json({ error: 'Ya estás en otra mesa' });

  // Check balance
  const { rows } = await db.query('SELECT balance, avatar FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (table.buyIn > 0 && rows[0].balance < table.buyIn) return res.status(400).json({ error: 'Saldo insuficiente' });

  // Deduct buy-in (las mesas gratuitas no mueven saldo real)
  if (table.buyIn > 0) {
    await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [table.buyIn, userId]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [userId, 'holdem-buyin', -table.buyIn]
    );
  }

  holdemStore.addSeat(table.id, {
    userId,
    username: req.user.username,
    avatar: rows[0].avatar,
  });

  res.json({ ok: true });
}

async function rebuy(req, res) {
  const userId = req.user.id;
  const table = holdemStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

  const seat = table.seats.find(s => s.userId === userId);
  if (!seat) return res.status(400).json({ error: 'No estás en esta mesa' });
  if (table.buyIn === 0) return res.status(400).json({ error: 'Las mesas gratuitas no tienen recompras' });
  if (seat.stack > 0) return res.status(400).json({ error: 'Aún tenés fichas' });
  if (seat.rebuysUsed >= table.maxRebuys) return res.status(400).json({ error: 'Recompras agotadas' });

  // Check balance
  const { rows } = await db.query('SELECT balance FROM users WHERE id = $1', [userId]);
  if (!rows[0] || rows[0].balance < table.buyIn) {
    return res.status(400).json({ error: 'Saldo insuficiente' });
  }

  await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [table.buyIn, userId]);
  await db.query(
    'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
    [userId, 'holdem-buyin', -table.buyIn]
  );

  seat.stack = table.buyIn;
  seat.rebuysUsed += 1;

  res.json({ ok: true });
}

async function leaveTable(req, res) {
  const userId = req.user.id;
  const table = holdemStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (table.status !== 'waiting') return res.status(400).json({ error: 'La partida ya comenzó' });

  const seat = table.seats.find(s => s.userId === userId);
  if (!seat) return res.status(400).json({ error: 'No estás en esta mesa' });

  if (table.buyIn > 0 && seat.stack > 0) {
    await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [seat.stack, userId]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [userId, 'holdem-cashout', seat.stack]
    );
  }

  holdemStore.removeSeat(table.id, userId);

  if (table.seats.length === 0) {
    holdemStore.remove(table.id);
  }

  res.json({ ok: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tableToSummary(t) {
  return {
    id: t.id,
    buyIn: t.buyIn,
    blindsSmall: t.blindsSmall,
    blindsBig: t.blindsBig,
    maxPlayers: t.maxPlayers,
    playerCount: t.seats.length,
    status: t.status,
    maxRebuys: t.maxRebuys,
  };
}

function tableToDetail(t) {
  return {
    ...tableToSummary(t),
    players: t.seats.map(s => ({
      id: s.userId,
      username: s.username,
      avatar: s.avatar,
      stack: s.stack,
    })),
  };
}

module.exports = { listTables, getTable, createTable, joinTable, rebuy, leaveTable };
