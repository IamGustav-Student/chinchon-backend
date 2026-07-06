const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DB_URL });

// Ejecuta fn(client) dentro de una transacción real: BEGIN/COMMIT/ROLLBACK
// corren sobre la MISMA conexión. pool.query('BEGIN') seguido de más
// pool.query(...) NO garantiza esto — cada llamada puede tomar una
// conexión distinta del pool.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  withTransaction,
};
