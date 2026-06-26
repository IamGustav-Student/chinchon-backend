const db = require('../models/db');

async function getBalance(req, res) {
  try {
    const result = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: result.rows[0]?.balance ?? 0 });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function deposit(req, res) {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  try {
    const result = await db.query(
      `UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
      [amount, req.user.id]
    );
    await db.query(
      `INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'deposit', $2)`,
      [req.user.id, amount]
    );
    res.json({ balance: result.rows[0].balance });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function withdraw(req, res) {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  try {
    const check = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    if (check.rows[0].balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const result = await db.query(
      `UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance`,
      [amount, req.user.id]
    );
    await db.query(
      `INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'withdraw', $2)`,
      [req.user.id, amount]
    );
    res.json({ balance: result.rows[0].balance });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function getHistory(req, res) {
  try {
    const result = await db.query(
      `SELECT type, amount, created_at FROM wallet_history
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

module.exports = { getBalance, deposit, withdraw, getHistory };
