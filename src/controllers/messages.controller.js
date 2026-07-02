const db = require('../models/db');

async function getMessages(req, res) {
  try {
    const result = await db.query(`
      SELECT m.id, m.sender_id AS "senderId", u.username AS "senderUsername",
        u.avatar AS "senderAvatar", m.recipient_id AS "recipientId",
        m.body, m.read, m.created_at AS "createdAt", m.parent_id AS "parentId"
      FROM private_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.recipient_id = $1
      ORDER BY m.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getUnreadCount(req, res) {
  try {
    const result = await db.query(
      'SELECT COUNT(*) FROM private_messages WHERE recipient_id = $1 AND read = false',
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function sendMessage(req, res) {
  try {
    const { recipientId, body, parentId } = req.body;
    if (!recipientId || !body?.trim()) return res.status(400).json({ error: 'Faltan campos' });
    if (recipientId === req.user.id) return res.status(400).json({ error: 'No podés enviarte mensajes a vos mismo' });

    const recipient = await db.query('SELECT id FROM users WHERE id = $1', [recipientId]);
    if (!recipient.rows[0]) return res.status(404).json({ error: 'Destinatario no encontrado' });

    const result = await db.query(
      `INSERT INTO private_messages (sender_id, recipient_id, body, parent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sender_id AS "senderId", recipient_id AS "recipientId", body, read, created_at AS "createdAt", parent_id AS "parentId"`,
      [req.user.id, recipientId, body.trim(), parentId || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function markRead(req, res) {
  try {
    await db.query(
      'UPDATE private_messages SET read = true WHERE id = $1 AND recipient_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getMessages, getUnreadCount, sendMessage, markRead };
