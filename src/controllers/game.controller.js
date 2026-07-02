const { v4: uuidv4 } = require('uuid');
const tableStore = require('../models/table.store');
const db = require('../models/db');

async function listTables(req, res) {
  const tables = tableStore.getAll();
  res.json(tables.map(t => ({
    id: t.id,
    creator: t.creatorName,
    bet: t.bet,
    maxPlayers: t.maxPlayers,
    players: t.players.length,
    status: t.status,
  })));
}

async function createTable(req, res) {
  const { bet, maxPlayers, pointLimit } = req.body;
  const validBets = [0, 500, 1000, 2500, 5000, 10000];
  if (!validBets.includes(bet)) return res.status(400).json({ error: 'Apuesta inválida' });
  if (![2, 4].includes(maxPlayers)) return res.status(400).json({ error: 'Capacidad inválida' });

  try {
    const userRow = await db.query('SELECT balance, avatar FROM users WHERE id = $1', [req.user.id]);
    if (!userRow.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (bet > 0 && userRow.rows[0].balance < bet) return res.status(400).json({ error: 'Saldo insuficiente' });

    const table = tableStore.create({
      id: uuidv4(),
      creatorId: req.user.id,
      creatorName: req.user.username,
      creatorAvatar: userRow.rows[0].avatar,
      bet,
      maxPlayers,
      pointLimit: pointLimit || 100,
    });
    res.status(201).json(table);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function joinTable(req, res) {
  const table = tableStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (table.status !== 'waiting') return res.status(400).json({ error: 'La mesa ya está en juego' });
  if (table.players.length >= table.maxPlayers) return res.status(400).json({ error: 'Mesa llena' });
  if (table.players.includes(req.user.id)) return res.status(400).json({ error: 'Ya estás en esta mesa' });

  try {
    if (table.bet > 0) {
      const balance = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
      if (balance.rows[0].balance < table.bet) return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const avatarRow = await db.query('SELECT avatar FROM users WHERE id = $1', [req.user.id]);
    tableStore.addPlayer(table.id, req.user.id, req.user.username, avatarRow.rows[0]?.avatar);
    res.json(tableStore.get(table.id));
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

function getTable(req, res) {
  const table = tableStore.get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  res.json(table);
}

module.exports = { listTables, createTable, joinTable, getTable };
