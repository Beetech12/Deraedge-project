CREATE TABLE IF NOT EXISTS orders (
  reference TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
  program TEXT NOT NULL, program_name TEXT NOT NULL, amount BIGINT NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL, customer TEXT NOT NULL, policy_version TEXT NOT NULL,
  consent_at TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  checkout_url TEXT, paid_at TEXT, transaction_id TEXT, checked_at BIGINT NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'test', initialize_until BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  digest TEXT PRIMARY KEY, reference TEXT NOT NULL, kind TEXT NOT NULL, received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  refund_id TEXT PRIMARY KEY, reference TEXT NOT NULL, amount BIGINT NOT NULL CHECK (amount > 0), status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  reference TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
  content TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, sent_at TEXT, next_attempt BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_due ON messages (status, next_attempt);
CREATE TABLE IF NOT EXISTS api_limits (
  key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count INTEGER NOT NULL
);
