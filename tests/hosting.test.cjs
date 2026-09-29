const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { postgresStore } = require('../server/postgres.cjs');
const { createHostedHandler } = require('../server/hosting.cjs');
const { createMessages } = require('../server/messages.cjs');
const { openDatabase } = require('../server/database.cjs');

// Isolated PostgreSQL engine: exercise real SQL without production credentials.
// The small pool adapter serializes sessions because PGlite has one connection.
async function database(t) {
  const pg = new PGlite();
  await pg.exec(await readFile(path.join(__dirname, '../server/schema-postgres.sql'), 'utf8'));
  let tail = Promise.resolve();
  async function connect() {
    let release;
    const before = tail;
    tail = new Promise(resolve => { release = resolve; });
    await before;
    return { query: async (sql, args) => {
      const result = await pg.query(sql, args);
      return { rows: result.rows, rowCount: result.affectedRows };
    }, release };
  }
  const pool = {
    connect,
    async query(sql, args) {
      const client = await connect();
      try { return await client.query(sql, args); } finally { client.release(); }
    },
    end: () => pg.close(),
  };
  const db = postgresStore(pool);
  t.after(() => db.close());
  return db;
}

const env = {
  VERCEL: '1', VERCEL_ENV: 'production', PUBLIC_URL: 'https://example.com',
  PAYSTACK_SECRET_KEY: 'sk_live_fixture', ALLOW_LIVE_PAYMENTS: 'true',
  PAYMENT_CURRENCIES: 'NGN', PAYSTACK_CONFIRMED_CURRENCIES: 'NGN',
  // Fixed test fixtures, never production defaults or exchange rates.
  PRICE_FOUNDATION_NGN: '100000', PRICE_PROFESSIONAL_NGN: '200000', PRICE_MASTERY_NGN: '500000',
  TERMS_URL: '/deraedge-enroll/terms.html', PRIVACY_URL: '/deraedge-enroll/privacy.html', REFUND_URL: '/deraedge-enroll/refund.html',
  DATABASE_URL: 'test-fixture-only',
};
const details = { program: 'professional', currency: 'NGN', name: 'Test Student', email: 'student@example.com', country: 'Nigeria', consent: true, policyVersion: '1' };
const published = async () => new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } });

async function host(t, options) {
  const server = http.createServer(createHostedHandler(options));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('Vercel catalog stays readable but checkout is blocked without persistent storage', async t => {
  const base = await host(t, { env: { ...env, DATABASE_URL: '' }, fetcher: published });
  const response = await fetch(`${base}/api/index?route=catalog`);
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.enabled, false);
  assert.deepEqual(catalog.currencies, ['NGN']);
  assert.match(catalog.issues.join(' '), /storage/);
  assert.equal(JSON.stringify(catalog).includes(env.PAYSTACK_SECRET_KEY), false);
  assert.equal((await fetch(`${base}/api/checkout`, { method: 'POST' })).status, 503);
  await assert.rejects(openDatabase({ database: ':memory:' }, { VERCEL: '1' }), /persistent DATABASE_URL/);
});

test('live previews, unpublished policies and unavailable databases fail closed', async t => {
  const db = await database(t);
  for (const options of [
    { env: { ...env, VERCEL_ENV: 'preview' }, open: async () => db, fetcher: published },
    { env, open: async () => db, fetcher: async () => new Response(null, { status: 404 }) },
    { env, open: async () => { throw new Error('private database failure'); }, fetcher: published },
  ]) {
    const base = await host(t, options);
    const catalog = await fetch(`${base}/api/catalog`).then(r => r.json());
    assert.equal(catalog.enabled, false);
    assert.equal(JSON.stringify(catalog).includes('private database failure'), false);
  }
});

test('Postgres preserves NGN checkout across independent function instances, verifies and reconciles refunds', async t => {
  const db = await database(t);
  const payments = new Map();
  let initialized = 0;
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const refunds = [];
  const provider = {
    async initialize(data) {
      initialized++;
      // Reservation must be committed before any provider side effect.
      assert.ok(await db.prepare('SELECT reference FROM orders WHERE reference=?').get(data.reference));
      payments.set(data.reference, { id: initialized, reference: data.reference, amount: Number(data.amount), currency: data.currency,
        customer: { email: data.email }, domain: 'live', status: 'pending' });
      started(); await gate;
      return { reference: data.reference, authorization_url: `https://checkout.paystack.com/${data.reference}` };
    },
    verify: async reference => payments.get(reference),
    refunds: async () => refunds,
  };
  const options = { env, open: async () => db, fetcher: published, provider };
  const first = await host(t, options);
  const second = await host(t, options);
  const token = randomBytes(32).toString('hex');
  const checkout = base => fetch(`${base}/api/checkout`, { method: 'POST', headers: {
    Origin: env.PUBLIC_URL, 'Content-Type': 'application/json', 'Idempotency-Key': token,
  }, body: JSON.stringify({ ...details, amount: 1 }) }).then(r => r.json());
  const pending = checkout(first);
  await entered;
  const concurrent = await checkout(second);
  assert.equal(concurrent.checkoutUnavailable, true);
  assert.equal(initialized, 1);
  release();
  const order = await pending;
  assert.equal(order.reference, concurrent.reference);
  assert.equal(order.amount, 200000);
  assert.equal(order.currency, 'NGN');
  assert.ok(order.checkoutUrl);
  assert.equal((await checkout(second)).reference, order.reference);
  assert.equal(initialized, 1);
  const headers = { Authorization: `Bearer ${token}` };
  const transaction = payments.get(order.reference);
  transaction.status = 'success';
  assert.equal((await fetch(`${second}/api/orders/${order.reference}`, { headers }).then(r => r.json())).status, 'paid');

  const event = async (type, data, signature) => {
    const raw = JSON.stringify({ event: type, data });
    return fetch(`${first}/api/paystack/webhook`, { method: 'POST', headers: {
      'Content-Type': 'application/json',
      'x-paystack-signature': signature || createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex'),
    }, body: raw });
  };
  assert.equal((await event('charge.success', transaction, 'f'.repeat(128))).status, 401);
  assert.equal((await event('charge.success', transaction)).status, 200);
  assert.equal((await event('charge.success', transaction)).status, 200);
  refunds.push({ id: 'refund1', transaction: transaction.id, currency: 'NGN', amount: 200000, status: 'processed' });
  assert.equal((await event('refund.processed', { transaction_reference: order.reference })).status, 200);
  const refunded = await fetch(`${second}/api/orders/${order.reference}`, { headers }).then(r => r.json());
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.refundedAmount, 200000);
  assert.equal(refunded.checkoutUrl, null);
  assert.equal((await event('charge.success', { ...transaction, late: true })).status, 200);
  assert.equal((await db.prepare('SELECT status FROM orders WHERE reference=?').get(order.reference)).status, 'refunded');
  assert.equal((await fetch(`${second}/api/orders/${order.reference}`)).status, 404);
  // Rate limits are shared across function instances, not reset by a cold start.
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`${i % 2 ? first : second}/api/messages`, { method: 'POST' });
    assert.equal(response.status, i < 5 ? 403 : 429);
  }
});

test('Postgres rolls back failed webhook transactions and does not lose message idempotency on cold starts', async t => {
  const db = await database(t);
  await assert.rejects(db.transaction(async () => {
    await db.prepare('INSERT INTO events VALUES(?,?,?,?)').run('rollback', 'ref', 'test', 'now');
    throw new Error('test rollback');
  }), /test rollback/);
  assert.equal(await db.prepare('SELECT * FROM events WHERE digest=?').get('rollback'), undefined);
  let sent = 0;
  const first = createMessages({ db, mailer: { send: async () => { sent++; } } });
  const second = createMessages({ db, mailer: { send: async () => { sent++; } } });
  const token = randomBytes(32).toString('hex');
  const body = { type: 'contact', reviewed: true, fields: { name: 'Test', email: 'test@example.com', message: 'Hello', Interest: 'General Enquiry' } };
  const [a, b] = await Promise.all([first.enqueue(body, token), second.enqueue(body, token)]);
  assert.equal(a.reference, b.reference);
  await Promise.all([first.drain(), second.drain()]);
  assert.equal(sent, 1);
  assert.equal((await second.status(a.reference, token)).status, 'sent');
});

test('static Vercel output contains policies and excludes private files', async () => {
  await require('../scripts/build-static.cjs').build();
  const root = path.join(__dirname, '../public');
  const names = await readdir(root);
  for (const forbidden of ['.env', '.data', 'server', 'tests', 'package.json']) assert.equal(names.includes(forbidden), false);
  for (const name of ['terms', 'privacy', 'refund', 'payment']) {
    assert.match(await readFile(path.join(root, `deraedge-enroll/${name}.html`), 'utf8'), /<!doctype html>/i);
  }
});
