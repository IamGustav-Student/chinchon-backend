const db = require('../models/db');
const tournamentScheduler = require('../tournament/tournament.scheduler');

async function getStats(req, res) {
  try {
    const [users, active, tables, pending, revenue, totalBalance] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query(`SELECT COUNT(DISTINCT user_id) FROM wallet_history WHERE created_at > NOW() - INTERVAL '7 days'`),
      db.query(`SELECT COUNT(*) FROM holdem_tables WHERE status IN ('waiting', 'playing')`),
      db.query('SELECT COUNT(*) FROM deposit_requests WHERE approved = false AND (rejected IS NULL OR rejected = false)'),
      db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_history WHERE type = 'tournament-entry' AND created_at > NOW() - INTERVAL '7 days'`),
      db.query('SELECT COALESCE(SUM(balance), 0) AS total FROM users'),
    ]);
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      activeUsers7d: parseInt(active.rows[0].count),
      activeTables: parseInt(tables.rows[0].count),
      pendingDeposits: parseInt(pending.rows[0].count),
      weeklyRevenue: parseInt(revenue.rows[0].total),
      totalBalance: parseInt(totalBalance.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getUsers(req, res) {
  try {
    const { search = '', page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * 20;
    const q = `%${search}%`;
    const [rows, count] = await Promise.all([
      db.query(`
        SELECT id, username, email, avatar, balance,
          CASE WHEN is_admin THEN 'admin' ELSE 'user' END AS role,
          COALESCE(banned, false) AS banned,
          created_at AS "createdAt",
          games_played AS "gamesPlayed",
          games_won AS "gamesWon"
        FROM users
        WHERE username ILIKE $1 OR email ILIKE $1
        ORDER BY id DESC LIMIT 20 OFFSET $2
      `, [q, offset]),
      db.query('SELECT COUNT(*) FROM users WHERE username ILIKE $1 OR email ILIKE $1', [q]),
    ]);
    res.json({ users: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function banUser(req, res) {
  try {
    await db.query('UPDATE users SET banned = true WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, 'ban_user', 'user', req.params.id, {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function unbanUser(req, res) {
  try {
    await db.query('UPDATE users SET banned = false WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, 'unban_user', 'user', req.params.id, {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function editBalance(req, res) {
  try {
    const { balance } = req.body;
    if (typeof balance !== 'number' || balance < 0) return res.status(400).json({ error: 'Saldo inválido' });
    const prev = await db.query('SELECT balance FROM users WHERE id = $1', [req.params.id]);
    const diff = balance - (prev.rows[0]?.balance ?? 0);
    await db.query('UPDATE users SET balance = $1 WHERE id = $2', [balance, req.params.id]);
    if (diff !== 0) {
      await db.query(
        `INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'admin-adjustment', $2)`,
        [req.params.id, diff]
      );
    }
    await logAction(req.user.id, 'edit_balance', 'user', req.params.id, { balance, diff });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function setRole(req, res) {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    await db.query('UPDATE users SET is_admin = $1 WHERE id = $2', [role === 'admin', req.params.id]);
    await logAction(req.user.id, 'set_role', 'user', req.params.id, { role });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getDeposits(req, res) {
  try {
    const { status = 'pending' } = req.query;
    let where;
    if (status === 'approved') where = 'd.approved = true';
    else if (status === 'rejected') where = 'd.rejected = true';
    else where = 'd.approved = false AND (d.rejected IS NULL OR d.rejected = false)';

    const result = await db.query(`
      SELECT d.id, d.user_id AS "userId", u.username, d.amount,
        d.sender_name AS "senderName", d.sender_bank AS "senderBank",
        d.transaction_id AS "transactionId",
        CASE WHEN d.approved THEN 'approved' WHEN d.rejected THEN 'rejected' ELSE 'pending' END AS status,
        d.created_at AS "createdAt"
      FROM deposit_requests d
      JOIN users u ON d.user_id = u.id
      WHERE ${where}
      ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function logAction(adminId, action, targetType, targetId, detail) {
  try {
    await db.query(
      `INSERT INTO admin_actions (admin_id, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5)`,
      [adminId, action, targetType, String(targetId), detail]
    );
  } catch (_) {}
}

async function approveDeposit(req, res) {
  try {
    await db.query('BEGIN');
    const dep = await db.query('SELECT * FROM deposit_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const d = dep.rows[0];
    if (!d || d.approved || d.rejected) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Depósito no válido o ya procesado' });
    }
    await db.query('UPDATE deposit_requests SET approved = true WHERE id = $1', [d.id]);
    await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [d.amount, d.user_id]);
    await db.query(`INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'deposit', $2)`, [d.user_id, d.amount]);
    await db.query('COMMIT');
    await logAction(req.user.id, 'approve_deposit', 'deposit', req.params.id, { amount: d.amount });
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
}

async function rejectDeposit(req, res) {
  try {
    await db.query('UPDATE deposit_requests SET rejected = true WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, 'reject_deposit', 'deposit', req.params.id, {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTables(req, res) {
  try {
    const result = await db.query(`
      SELECT id, 'holdem' AS game, status, 0 AS "playerCount",
        max_players AS "maxPlayers", buy_in AS "buyIn", created_at AS "createdAt"
      FROM holdem_tables
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function closeTable(req, res) {
  try {
    await db.query('DELETE FROM holdem_tables WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTournament(req, res) {
  try {
    const result = await db.query(`
      SELECT t.id, t.status,
        COUNT(r.user_id)::int AS "registeredCount",
        t.min_players AS "minPlayers",
        t.prize_pool AS "prizePool",
        t.starts_at AS "startsAt"
      FROM tournaments t
      LEFT JOIN tournament_registrations r ON r.tournament_id = t.id
      WHERE t.status IN ('upcoming', 'registration_open', 'in_progress')
      GROUP BY t.id
      ORDER BY t.starts_at ASC
      LIMIT 1
    `);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function startTournament(req, res) {
  try {
    await tournamentScheduler.adminStartTournament();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function cancelTournament(req, res) {
  try {
    await tournamentScheduler.adminCancelTournament();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getStats, getUsers, banUser, unbanUser, editBalance, setRole,
  getDeposits, approveDeposit, rejectDeposit,
  getTables, closeTable,
  getTournament, startTournament, cancelTournament,
};
