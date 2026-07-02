const db = require('../models/db');

async function isAdmin(req, res, next) {
  if (!req.user) return res.sendStatus(401);
  const result = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows[0]?.is_admin) return res.sendStatus(403);
  next();
}

module.exports = isAdmin;
