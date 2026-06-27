const https = require('https');
const db = require('../models/db');
const { buildDepositCode } = require('./wallet.controller');

const DEPOSIT_PREFIX = 'JDC-';

function mpGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.mercadopago.com',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function mercadoPagoWebhook(req, res) {
  // Responder 200 inmediatamente para que MP no reintente
  res.sendStatus(200);

  try {
    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return;

    const payment = await mpGet(`/v1/payments/${data.id}`);

    if (payment.status !== 'approved') return;

    const mpPaymentId = String(payment.id);
    const amount = Math.round(payment.transaction_amount);
    const description = (payment.description || '').trim().toUpperCase();

    if (!description.startsWith(DEPOSIT_PREFIX)) return;

    const username = description.slice(DEPOSIT_PREFIX.length).toLowerCase();
    if (!username) return;

    const userResult = await db.query(
      'SELECT id, username FROM users WHERE LOWER(username) = $1',
      [username]
    );
    if (!userResult.rows[0]) return;

    const user = userResult.rows[0];

    // Verificar que el código coincida exactamente (evita colisiones de prefijo)
    if (description !== buildDepositCode(user.username).toUpperCase()) return;

    // Idempotencia: ignorar si ya se procesó este pago
    const existing = await db.query(
      'SELECT id FROM deposit_requests WHERE mp_payment_id = $1',
      [mpPaymentId]
    );
    if (existing.rows[0]) return;

    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO deposit_requests (user_id, amount, sender_name, sender_bank, transaction_id, mp_payment_id, approved)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [user.id, amount, payment.payer?.email || '', 'Mercado Pago', mpPaymentId, mpPaymentId]
      );
      await db.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [amount, user.id]
      );
      await db.query(
        `INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'deposit', $2)`,
        [user.id, amount]
      );
      await db.query('COMMIT');
      console.log(`[MP] Depósito acreditado: user=${user.username} amount=${amount} payment=${mpPaymentId}`);
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('[MP] Error al acreditar depósito:', err.message);
    }
  } catch (err) {
    console.error('[MP] Error en webhook:', err.message);
  }
}

module.exports = { mercadoPagoWebhook };
