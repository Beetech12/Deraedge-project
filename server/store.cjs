const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS orders (
      reference TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
      program TEXT NOT NULL, program_name TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
      customer TEXT NOT NULL, policy_version TEXT NOT NULL, consent_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', checkout_url TEXT, transaction_id TEXT,
      created_at TEXT NOT NULL, paid_at TEXT, checked_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (digest TEXT PRIMARY KEY, reference TEXT NOT NULL, kind TEXT NOT NULL, received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS refunds (refund_id TEXT PRIMARY KEY, reference TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL);
  `);
  return db;
}
module.exports = { openStore };
