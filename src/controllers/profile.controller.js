const db = require('../models/db');

async function getProfile(req, res) {
  try {
    const result = await db.query(
      `SELECT id, username, email, avatar, balance,
              games_played, games_won, games_lost
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function updateProfile(req, res) {
  const { avatar } = req.body;
  try {
    const result = await db.query(
      `UPDATE users SET avatar = COALESCE($1, avatar)
       WHERE id = $2 RETURNING id, username, email, avatar, balance`,
      [avatar, req.user.id]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

function getConfig(req, res) {
  res.json({
    weeklyPrizes: [280000, 230000, 180000, 120000, 90000, 80000, 70000, 60000, 50000, 40000],
    bets: [500, 1000, 2500, 5000, 10000],
    pointLimits: [50, 100],
    maxPlayersOptions: [2, 4],
  });
}

module.exports = { getProfile, updateProfile, getConfig };
