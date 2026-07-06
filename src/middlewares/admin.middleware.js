const db = require('../models/db');

// Re-consulta la DB en cada request: si el rol o el ban cambiaron durante
// la sesión, el JWT (que puede durar horas) no lo refleja.
async function isAdmin(req, res, next) {
  if (!req.user) return res.sendStatus(401);
  const result = await db.query('SELECT is_admin, banned FROM users WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
  if (!user) return res.sendStatus(401);
  if (user.banned) return res.status(403).json({ error: 'Cuenta suspendida' });
  if (!user.is_admin) return res.sendStatus(403);
  next();
}

function validIdParam(req, res, next) {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'ID inválido' });
  next();
}

module.exports = isAdmin;
module.exports.validIdParam = validIdParam;
