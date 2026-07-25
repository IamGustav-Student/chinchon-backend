const { v4: uuidv4 } = require('uuid');
const trucoStore = require('../models/truco.store');
const db = require('../models/db');

async function listTables(req, res) {
  const tables = trucoStore.getAll().filter(t => t.status !== 'finished');
  res.json(tables.map(t => ({
    id: t.id,
    buyIn: t.buyIn,
    maxPlayers: t.maxPlayers,
    playerCount: t.players.length,
    status: t.status,
    pointLimit: t.pointLimit,
  })));
}

async function createTable(req, res) {
  const { buyIn = 0, maxPlayers = 2, pointLimit = 15 } = req.body;
  if (![2, 4].includes(maxPlayers)) return res.status(400).json({ error: 'Capacidad inválida' });
  if (![15, 30].includes(pointLimit)) return res.status(400).json({ error: 'Límite de puntos inválido' });
  if (buyIn < 0) return res.status(400).json({ error: 'Apuesta inválida' });

  try {
    const { rows } = await db.query('SELECT balance, avatar FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (buyIn > 0 && rows[0].balance < buyIn) return res.status(400).json({ error: 'Saldo insuficiente' });

    if (buyIn > 0) {
      await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [buyIn, req.user.id]);
      await db.query(`INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'truco-buyin', $2)`, [req.user.id, -buyIn]);
    }

    const table = trucoStore.create({ id: uuidv4(), maxPlayers, buyIn, pointLimit });
    const teamIndex = 0;
    const seatIndex = 0;
    table.players.push({ userId: req.user.id, username: req.user.username, avatar: rows[0].avatar, teamIndex, seatIndex, isMano: false });

    res.status(201).json({ tableId: table.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function joinTable(req, res) {
  const table = trucoStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

  // Reconexión: el jugador ya está sentado, solo re-sincronizar por WS.
  if (table.players.some(p => p.userId === req.user.id)) return res.json({ tableId: table.id });

  if (table.status !== 'waiting') return res.status(400).json({ error: 'La mesa ya está en juego' });
  if (table.players.length >= table.maxPlayers) return res.status(400).json({ error: 'Mesa llena' });

  try {
    const { rows } = await db.query('SELECT balance, avatar FROM users WHERE id = $1', [req.user.id]);
    if (table.buyIn > 0 && rows[0].balance < table.buyIn) return res.status(400).json({ error: 'Saldo insuficiente' });

    if (table.buyIn > 0) {
      await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [table.buyIn, req.user.id]);
      await db.query(`INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'truco-buyin', $2)`, [req.user.id, -table.buyIn]);
    }

    const seatIndex = table.players.length;
    // Teams by seat order: 0,2 → team 0; 1,3 → team 1
    const teamIndex = seatIndex % 2;
    table.players.push({ userId: req.user.id, username: req.user.username, avatar: rows[0].avatar, teamIndex, seatIndex, isMano: false });

    res.json({ tableId: table.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function leaveTable(req, res) {
  const table = trucoStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (table.status !== 'waiting') return res.status(400).json({ error: 'La partida ya comenzó' });

  const idx = table.players.findIndex(p => p.userId === req.user.id);
  if (idx === -1) return res.status(400).json({ error: 'No estás en esta mesa' });

  const [player] = table.players.splice(idx, 1);

  try {
    if (table.buyIn > 0) {
      await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [table.buyIn, player.userId]);
      await db.query(`INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'truco-cashout', $2)`, [player.userId, table.buyIn]);
    }

    if (table.players.length === 0) {
      trucoStore.remove(table.id);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listTables, createTable, joinTable, leaveTable };
