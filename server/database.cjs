const { AsyncLocalStorage } = require('node:async_hooks');
const wrappers = new WeakMap();

// Serialize a local SQLite connection while an async transaction owns it.
// Tests/operator scripts can still use the original synchronous store API.
function asynchronousStore(raw) {
  if (raw.async) return raw;
  if (wrappers.has(raw)) return wrappers.get(raw);
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  function exclusive(action) {
    if (context.getStore()) return Promise.resolve().then(action);
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  }
  const db = {
    async: true,
    prepare(sql) {
      return Object.fromEntries(['get', 'all', 'run'].map(method => [method, (...args) => exclusive(() => raw.prepare(sql)[method](...args))]));
    },
    transaction(action) {
      if (context.getStore()) return action();
      return exclusive(() => context.run(true, async () => {
        raw.exec('BEGIN IMMEDIATE');
        try { const result = await action(); raw.exec('COMMIT'); return result; }
        catch (error) { raw.exec('ROLLBACK'); throw error; }
      }));
    },
    lockOrder: async () => {}, // BEGIN IMMEDIATE holds the SQLite writer lock.
    close: () => raw.close(),
  };
  wrappers.set(raw, db);
  return db;
}

async function openDatabase(config, env = process.env) {
  if (env.DATABASE_URL) return require('./postgres.cjs').openPostgres(env.DATABASE_URL);
  if (env.VERCEL) throw new Error('Vercel requires a persistent DATABASE_URL. SQLite is local-only.');
  return asynchronousStore(require('./store.cjs').openStore(config.database));
}
module.exports = { asynchronousStore, openDatabase };
