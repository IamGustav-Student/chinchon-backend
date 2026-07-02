require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./models/db');
const { initWebSocket, sendToUser, broadcastToAll } = require('./websocket/game.ws');
const tournamentScheduler = require('./tournament/tournament.scheduler');

async function runMigrations() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'models/schema.sql'), 'utf8');
    await db.query(sql);
    console.log('Migraciones ejecutadas correctamente');
  } catch (err) {
    console.error('Error en migraciones:', err.message);
  }
}

const authRoutes = require('./routes/auth.routes');
const gameRoutes = require('./routes/game.routes');
const profileRoutes = require('./routes/profile.routes');
const rankingRoutes = require('./routes/ranking.routes');
const walletRoutes = require('./routes/wallet.routes');
const tournamentRoutes = require('./routes/tournament.routes');
const holdemRoutes = require('./routes/holdem.routes');
const webhookRoutes = require('./routes/webhook.routes');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/perfil', profileRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/tournament', tournamentRoutes);
app.use('/api/holdem', holdemRoutes);
app.use('/api/webhooks', webhookRoutes);

app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/admin/users', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.sendStatus(401);
  const result = await db.query('SELECT id, username, email, is_admin, balance FROM users ORDER BY id');
  res.json(result.rows);
});

app.post('/api/admin/setup', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.sendStatus(401);
  const { username } = req.body;
  await db.query(
    `UPDATE users SET password_hash = $1, is_admin = true WHERE LOWER(username) = LOWER($2)`,
    ['$2b$10$iE3ZPP3BVEfeoIMP/lE/E.S5DQBwDk4oHRUTNlPgpg1eSyC3T84UK', username]
  );
  const result = await db.query(
    'SELECT id, username, email, is_admin FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  res.json(result.rows[0] || { error: 'Usuario no encontrado' });
});

const holdemWs = require('./websocket/holdem.ws');

initWebSocket(server);
holdemWs.init(sendToUser, broadcastToAll);
tournamentScheduler.init(sendToUser, broadcastToAll);

const PORT = process.env.PORT || 3000;
runMigrations().then(() => {
  server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
  });
});
