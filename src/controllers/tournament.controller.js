const db = require('../models/db');
const tournamentStore = require('../models/tournament.store');

function getTableSizes(n) {
  if (n <= 1) return [];
  if (n === 2) return [2];
  const rem = n % 4;
  const threes = [0, 3, 2, 1][rem];
  const fours = (n - threes * 3) / 4;
  return [...Array(threes).fill(3), ...Array(fours).fill(4)];
}

function calculateTotalRounds(n) {
  let rounds = 0;
  while (n > 1) {
    const tables = getTableSizes(n);
    n = tables.length;
    rounds++;
  }
  return rounds;
}

async function getCurrent(req, res) {
  const t = tournamentStore.get();
  if (!t) return res.status(404).json({ error: 'No hay torneo programado' });

  const prizePool = t.registrations.size * t.entryFee;
  const response = {
    id: t.id,
    status: t.status,
    startsAt: t.startsAt,
    registrationDeadline: t.registrationDeadline,
    entryFee: t.entryFee,
    registeredCount: t.registrations.size,
    minPlayers: t.minPlayers,
    isRegistered: t.registrations.has(req.user.id),
    prizePool,
    winnerPrize: Math.floor(prizePool * 0.7),
    finalistPrize: Math.floor(prizePool * 0.1),
  };

  if (t.status === 'registration_open') {
    const userIds = [...t.registrations.keys()];
    if (userIds.length > 0) {
      const rows = await db.query(
        `SELECT id, username, avatar FROM users WHERE id = ANY($1)`,
        [userIds]
      );
      response.registeredPlayers = rows.rows;
    } else {
      response.registeredPlayers = [];
    }
  }

  res.json(response);
}

async function register(req, res) {
  const t = tournamentStore.get();
  if (!t) return res.status(404).json({ error: 'No hay torneo programado' });
  if (t.status !== 'registration_open') return res.status(400).json({ error: 'Las inscripciones no están abiertas' });
  if (t.registrations.has(req.user.id)) return res.status(400).json({ error: 'Ya estás inscripto' });

  try {
    const userRes = await db.query('SELECT balance, avatar FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
    if (user.balance < t.entryFee) return res.status(400).json({ error: 'Saldo insuficiente' });

    await db.query('BEGIN');
    await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [t.entryFee, req.user.id]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [req.user.id, 'tournament-entry', -t.entryFee]
    );
    await db.query(
      'INSERT INTO tournament_registrations (tournament_id, user_id) VALUES ($1, $2)',
      [t.id, req.user.id]
    );
    await db.query('COMMIT');

    tournamentStore.addRegistration(req.user.id, req.user.username, user.avatar);
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error registrando en torneo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function unregister(req, res) {
  const t = tournamentStore.get();
  if (!t) return res.status(404).json({ error: 'No hay torneo programado' });
  if (t.status !== 'registration_open') return res.status(400).json({ error: 'No se puede cancelar la inscripción en este momento' });
  if (!t.registrations.has(req.user.id)) return res.status(400).json({ error: 'No estás inscripto' });

  try {
    await db.query('BEGIN');
    await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [t.entryFee, req.user.id]);
    await db.query(
      'INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, $2, $3)',
      [req.user.id, 'tournament-refund', t.entryFee]
    );
    await db.query(
      'DELETE FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2',
      [t.id, req.user.id]
    );
    await db.query('COMMIT');

    tournamentStore.removeRegistration(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Error cancelando inscripción:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function getBracket(req, res) {
  const t = tournamentStore.getById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Torneo no encontrado' });

  const matches = Array.from(t.matches.values()).map(m => ({
    matchId: m.id,
    round: m.round,
    tableId: m.tableId ?? null,
    players: m.players.map(uid => {
      const reg = t.registrations.get(uid);
      return { id: uid, username: reg?.username ?? 'Desconocido', avatar: reg?.avatar ?? 'avatar-1' };
    }),
    winnerId: m.winnerId ?? null,
    status: m.status,
  }));

  const myMatchId = Array.from(t.matches.values()).find(
    m => m.round === t.currentRound && m.players.includes(req.user.id) && m.status !== 'finished'
  )?.id ?? null;

  res.json({
    tournamentId: t.id,
    currentRound: t.currentRound,
    totalRounds: calculateTotalRounds(t.registrations.size),
    matches,
    myMatchId,
  });
}

async function getResult(req, res) {
  const t = tournamentStore.getById(req.params.id);
  if (t && t.status === 'finished') {
    const prizePool = t.registrations.size * t.entryFee;
    return res.json({
      tournamentId: t.id,
      winnerId: t.winnerId,
      winnerUsername: t.registrations.get(t.winnerId)?.username ?? 'Desconocido',
      finalistId: t.finalistId,
      finalistUsername: t.registrations.get(t.finalistId)?.username ?? 'Desconocido',
      prizePool,
      winnerPrize: Math.floor(prizePool * 0.7),
      finalistPrize: Math.floor(prizePool * 0.1),
      totalPlayers: t.registrations.size,
    });
  }

  try {
    const result = await db.query(
      `SELECT t.*, w.username AS winner_username, f.username AS finalist_username
       FROM tournaments t
       LEFT JOIN users w ON t.winner_id = w.id
       LEFT JOIN users f ON t.finalist_id = f.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Torneo no encontrado' });
    const r = result.rows[0];
    res.json({
      tournamentId: r.id,
      winnerId: r.winner_id,
      winnerUsername: r.winner_username,
      finalistId: r.finalist_id,
      finalistUsername: r.finalist_username,
      prizePool: r.prize_pool,
      winnerPrize: Math.floor(r.prize_pool * 0.7),
      finalistPrize: Math.floor(r.prize_pool * 0.1),
      totalPlayers: r.total_players,
    });
  } catch {
    res.status(404).json({ error: 'Resultado no disponible' });
  }
}

module.exports = { getCurrent, register, unregister, getBracket, getResult, getTableSizes, calculateTotalRounds };
