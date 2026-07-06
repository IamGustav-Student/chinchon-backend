const db = require('../models/db');

const ITEM_PRICES = {
  tshirt_white: 0,
  tshirt_black: 0,
  hoodie_gold:  500,
  jersey_blue:  300,
  tuxedo:       1000,
  cap_black:    200,
  cap_red:      200,
  beanie_red:   300,
  crown_gold:   1500,
  glasses:      0,
  sunglasses:   400,
};

async function getProfile(req, res) {
  try {
    const result = await db.query(
      `SELECT id, username, email, avatar, balance, bio,
              games_played, games_won, games_lost,
              CASE WHEN is_admin THEN 'admin' ELSE 'user' END AS role,
              COALESCE(owned_items, '[]'::jsonb) AS "ownedItems"
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function purchaseItem(req, res) {
  const { itemId } = req.body;
  if (!itemId || !(itemId in ITEM_PRICES)) {
    return res.status(400).json({ error: 'Ítem inválido' });
  }
  const price = ITEM_PRICES[itemId];

  try {
    const outcome = await db.withTransaction(async (client) => {
      const result = await client.query(
        `SELECT balance, COALESCE(owned_items, '[]'::jsonb) AS owned_items
         FROM users WHERE id = $1 FOR UPDATE`,
        [req.user.id]
      );
      const user = result.rows[0];
      if (!user) return { status: 404, error: 'Usuario no encontrado' };

      const owned = user.owned_items;
      if (owned.includes(itemId)) return { status: 400, error: 'Ya tenés este ítem' };
      if (user.balance < price) return { status: 400, error: 'Saldo insuficiente' };

      const newOwned = [...owned, itemId];
      const updated = await client.query(
        `UPDATE users SET balance = balance - $1, owned_items = $2::jsonb
         WHERE id = $3 RETURNING balance`,
        [price, JSON.stringify(newOwned), req.user.id]
      );

      if (price > 0) {
        await client.query(
          `INSERT INTO wallet_history (user_id, type, amount) VALUES ($1, 'shop-purchase', $2)`,
          [req.user.id, -price]
        );
      }

      return { status: 200, balance: updated.rows[0].balance, ownedItems: newOwned };
    });

    if (outcome.status !== 200) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ balance: outcome.balance, ownedItems: outcome.ownedItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateProfile(req, res) {
  const { avatar, bio } = req.body;
  try {
    const result = await db.query(
      `UPDATE users SET
         avatar = COALESCE($1, avatar),
         bio = COALESCE($2, bio)
       WHERE id = $3
       RETURNING id, username, email, avatar, balance, bio`,
      [avatar, bio, req.user.id]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

function getConfig(req, res) {
  res.json({
    weeklyPrizes: [280000, 230000, 180000, 120000, 90000, 80000, 70000, 60000, 50000, 40000],
    bets: [500, 1000, 2500, 5000, 10000],
    pointLimits: [50, 100],
    maxPlayersOptions: [2, 4],
  });
}

module.exports = { getProfile, updateProfile, getConfig, purchaseItem };
