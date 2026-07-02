const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../models/db');

const WEEKLY_PRIZES = [280000, 230000, 180000, 120000, 90000, 80000, 70000, 60000, 50000, 40000];
const INITIAL_BALANCE = 0;

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
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, balance: user.balance, avatar: user.avatar, role: user.is_admin ? 'admin' : 'user' } });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

function logout(req, res) {
  res.json({ message: 'Sesión cerrada' });
}

module.exports = { register, login, logout };
