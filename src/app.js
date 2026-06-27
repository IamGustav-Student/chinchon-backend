require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { initWebSocket, sendToUser, broadcastToAll } = require('./websocket/game.ws');
const tournamentScheduler = require('./tournament/tournament.scheduler');

const authRoutes = require('./routes/auth.routes');
const gameRoutes = require('./routes/game.routes');
const profileRoutes = require('./routes/profile.routes');
const rankingRoutes = require('./routes/ranking.routes');
const walletRoutes = require('./routes/wallet.routes');
const tournamentRoutes = require('./routes/tournament.routes');
const holdemRoutes = require('./routes/holdem.routes');

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

app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const holdemWs = require('./websocket/holdem.ws');

initWebSocket(server);
holdemWs.init(sendToUser, broadcastToAll);
tournamentScheduler.init(sendToUser, broadcastToAll);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
