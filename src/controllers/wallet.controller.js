const db = require('../models/db');

const DEPOSIT_PREFIX = 'JDC';
const MP_ALIAS = process.env.MP_ALIAS || 'juegosdecartas';

function buildDepositCode(username) {
  return `${DEPOSIT_PREFIX}-${username.toUpperCase()}`;
}

async function getDepositInfo(req, res) {
  res.json({
    alias: MP_ALIAS,
    code: buildDepositCode(req.user.username),
    instructions: `Transferí a "${MP_ALIAS}" y escribí el código como concepto obligatorio.`,
  });
}

async function getBalance(req, res) {
  try {
    const result = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ balance: result.rows[0]?.balance ?? 0 });
  } catch (err) {
    console.error('[getBalance]', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function deposit(req, res) {
  const { amount, senderName, senderBank, transactionId } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  if (!senderName || !senderBank || !transactionId)
    return res.status(400).json({ error: 'Faltan datos del comprobante' });

  try {
    const userResult = await db.query('SELECT username FROM users WHERE id = $1', [req.user.id]);
    const username = userResult.rows[0]?.username;
    const nameMatches = senderName.trim().toLowerCase() === username?.toLowerCase();

    await db.query(
      `INSERT INTO deposit_requests (user_id, amount, sender_name, sender_bank, transaction_id, approved)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, amount, senderName.trim(), senderBank.trim(), transactionId.trim(), nameMatches]
    );

    if (!nameMatches) {
      return res.status(422).json({
        error: 'El nombre del titular no coincide con el usuario registrado. El depósito quedó pendiente de revisión.',
      });
    }

    const result = await db.query(
      `UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
      [amount, req.user.id]
    );
    await db.query(
      `INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'deposit', $2)`,
      [req.user.id, amount]
    );
    res.json({ balance: result.rows[0].balance });
  } catch (err) {
    console.error('[deposit]', err.message);
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
  } catch (err) {
    console.error('[withdraw]', err.message);
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
  } catch (err) {
    console.error('[getHistory]', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

module.exports = { getDepositInfo, buildDepositCode, getBalance, deposit, withdraw, getHistory };
