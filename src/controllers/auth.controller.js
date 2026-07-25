const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/db');

const WEEKLY_PRIZES = [280000, 230000, 180000, 120000, 90000, 80000, 70000, 60000, 50000, 40000];
const INITIAL_BALANCE = 0;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

// Genera un token de recuperación para userId, lo guarda y devuelve el link.
// TODO: reemplazar el console.log por el envío real vía un proveedor de email
// (SendGrid/Resend/SMTP) — no hay ninguno configurado todavía en el proyecto.
async function issuePasswordResetLink(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await db.query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
  const base = process.env.FRONTEND_URL || 'https://chinchon-frontend.vercel.app';
  const link = `${base}/reset-password?token=${token}`;
  console.log(`[password-reset] Link para user ${userId}: ${link}`);
  return link;
}

async function register(req, res) {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Faltan campos requeridos' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, balance)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, balance, avatar, bio, is_admin`,
      [username, email, hash, INITIAL_BALANCE]
    );
    const u = result.rows[0];
    const token = jwt.sign({ id: u.id, username: u.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { ...u, role: u.is_admin ? 'admin' : 'user' } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Usuario o email ya registrado' });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    if (user.banned) return res.status(403).json({ error: 'Cuenta suspendida' });
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id, username: user.username, email: user.email, balance: user.balance,
        avatar: user.avatar, bio: user.bio ?? '', role: user.is_admin ? 'admin' : 'user',
      },
    });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

function logout(req, res) {
  res.json({ message: 'Sesión cerrada' });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  const genericMessage = { message: 'Si el email existe, recibirás un link para restablecer tu contraseña.' };
  // Siempre respondemos el mismo mensaje, exista o no el email — evita
  // revelar qué cuentas están registradas.
  if (!email) return res.json(genericMessage);

  try {
    const result = await db.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (result.rows[0]) {
      await issuePasswordResetLink(result.rows[0].id);
    }
  } catch (err) {
    console.error('[forgot-password]', err.message);
  }
  res.json(genericMessage);
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Token o contraseña inválidos (mínimo 6 caracteres)' });
  }

  try {
    const outcome = await db.withTransaction(async (client) => {
      const result = await client.query(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token = $1 AND used = false AND expires_at > NOW() FOR UPDATE`,
        [token]
      );
      const reset = result.rows[0];
      if (!reset) return { status: 400, error: 'Token inválido o expirado.' };

      const hash = await bcrypt.hash(newPassword, 10);
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, reset.user_id]);
      await client.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [reset.id]);
      return { status: 200 };
    });

    if (outcome.status !== 200) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ message: 'Contraseña restablecida correctamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

module.exports = { register, login, logout, forgotPassword, resetPassword, issuePasswordResetLink };
