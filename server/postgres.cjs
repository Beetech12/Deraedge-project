const { AsyncLocalStorage } = require('node:async_hooks');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

function postgresStore(pool) {
  const context = new AsyncLocalStorage();
  const query = (sql, args = []) => (context.getStore() || pool).query(sql, args);
  // These SQL statements are internal constants; values always use parameters.
  function prepare(sql) {
    let index = 0;
    const text = sql.replace(/\?/g, () => `$${++index}`);
    const rows = result => result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (['amount', 'checked_at', 'initialize_until', 'next_attempt', 'total', 'n', 'count'].includes(key) && value !== null) {
        value = Number(value);
        if (!Number.isSafeInteger(value)) throw new Error('Invalid stored integer.');
      }
      return [key, value];
    })));
    return {
      get: async (...args) => rows(await query(text, args))[0],
      all: async (...args) => rows(await query(text, args)),
      run: async (...args) => ({ changes: (await query(text, args)).rowCount }),
    };
  }
  return {
    async: true, prepare,
    async transaction(action) {
      if (context.getStore()) return action();
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        const result = await context.run(client, action);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
    },
    async lockOrder(reference) {
      if (!context.getStore()) throw new Error('Order lock requires a transaction.');
      await query('SELECT reference FROM orders WHERE reference=$1 FOR UPDATE', [reference]);
    },
    close: () => pool.end(),
  };
}

async function openPostgres(connectionString) {
  const { Pool } = require('pg');
  // Require certificate-verified TLS in production, including with Neon URLs
  // whose sslmode parameters would otherwise override the explicit ssl option.
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !process.env.VERCEL;
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(name);
  const pool = new Pool({ connectionString: url.href, ssl: local ? false : { rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, allowExitOnIdle: true,
    statement_timeout: 15000 });
  pool.on('error', () => console.error('Database connection interrupted.'));
  const db = postgresStore(pool);
  try {
    // Serialize additive schema initialization across cold starts.
    await db.transaction(async () => {
      await db.prepare('SELECT pg_advisory_xact_lock(724193620)').get();
      const schema = await readFile(path.join(__dirname, 'schema-postgres.sql'), 'utf8');
      // Schema contains no dynamic values and is shipped with the function.
      for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    });
    return db;
  } catch { await pool.end(); throw new Error('Payment database unavailable. Check DATABASE_URL and database access.'); }
}
module.exports = { openPostgres, postgresStore };
