const db = require('../models/db');

async function getWeeklyRanking(req, res) {
  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.avatar, r.points, r.earnings
       FROM weekly_ranking r
       JOIN users u ON u.id = r.user_id
       ORDER BY r.points DESC LIMIT 10`
    );
    const nextReset = getNextMonday();
    res.json({ ranking: result.rows, nextReset });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function getAllTimeRanking(req, res) {
  try {
    const result = await db.query(
      `SELECT id, username, avatar, games_won FROM users ORDER BY games_won DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

function getNextMonday() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

module.exports = { getWeeklyRanking, getAllTimeRanking };
