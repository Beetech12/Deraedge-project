const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configuration } = require('../server/config.cjs');
const { openStore } = require('../server/store.cjs');
const { createApp } = require('../server/app.cjs');
const { validSignature, checkoutUrl, paystack } = require('../server/paystack.cjs');

const env = { PUBLIC_URL: 'http://localhost:3000', PAYSTACK_SECRET_KEY: 'sk_test_fixture', PAYMENT_CURRENCIES: 'USD,NGN',
  PRICE_FOUNDATION_NGN: '15000000', PRICE_PROFESSIONAL_NGN: '30000000', PRICE_MASTERY_NGN: '75000000',
  TERMS_URL: 'https://example.com/terms', PRIVACY_URL: 'https://example.com/privacy', REFUND_URL: 'https://example.com/refunds' };
const enrollment = { program: 'professional', currency: 'USD', name: 'Test Student', email: 'student@example.com', country: 'Nigeria', consent: true, policyVersion: '1' };

async function fixture(t, options = {}) {
  const db = openStore(':memory:');
  const config = { ...configuration(env), ...options.config };
  let initCount = 0;
  const transactions = new Map();
  const refunds = [];
  const provider = {
    async initialize(data) {
      initCount++;
      transactions.set(data.reference, { id: initCount, domain: 'test', reference: data.reference, status: 'pending', amount: Number(data.amount), currency: data.currency, customer: { email: data.email } });
      if (options.failInitialize) throw new Error('Timeout');
      return { reference: data.reference, authorization_url: options.url || `https://checkout.paystack.com/${data.reference}` };
    },
    async verify(reference) {
      if (options.failVerify) throw new Error('Provider unavailable');
      if (!transactions.has(reference)) throw new Error('Unknown transaction');
      return { ...transactions.get(reference) };
    },
    async refunds() { return refunds; },
  };
  const server = createApp({ config, db, provider });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const token = randomBytes(32).toString('hex');
  async function checkout(body = enrollment, key = token, origin = config.publicUrl) {
    const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': key }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  async function event(event, data, signature) {
    const raw = JSON.stringify({ event, data });
    return fetch(`${base}/api/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature ?? createHmac('sha512', config.secret).update(raw).digest('hex') }, body: raw });
  }
  async function status(reference, key = token) {
    const response = await fetch(`${base}/api/orders/${reference}`, { headers: { Authorization: `Bearer ${key}` } });
    return { status: response.status, data: await response.json() };
  }
  return { db, base, checkout, event, status, token, transactions, refunds, initCount: () => initCount };
}

test('currencies are explicit; naira is never derived from an invented FX rate', () => {
  const cfg = configuration({ PAYMENT_CURRENCIES: 'USD,NGN' });
  assert.deepEqual(cfg.catalog.professional.prices, { USD: 20000 });
  assert.equal(Boolean(cfg.ready), false);
  assert.throws(() => configuration({ ...env, PRICE_FOUNDATION_NGN: '-1' }));
  assert.throws(() => configuration({ ...env, PAYSTACK_SECRET_KEY: 'sk_live_fixture' }));
  assert.throws(() => configuration({ ...env, PRIVACY_URL: 'javascript:alert(1)' }));
});
test('price tampering is ignored, consent required, and checkout requests must be same-origin', async t => {
  const f = await fixture(t);
  assert.equal((await f.checkout({ ...enrollment, consent: false })).status, 400);
  assert.equal((await f.checkout({ ...enrollment, email: 'bad' })).status, 400);
  assert.equal((await f.checkout({ ...enrollment, program: '__proto__' })).status, 400);
  assert.equal((await f.checkout(enrollment, f.token, 'https://evil.example')).status, 403);
  const order = await f.checkout({ ...enrollment, amount: 1 });
  assert.equal(order.status, 200);
  assert.equal(order.data.amount, 20000);
  assert.equal(f.transactions.get(order.data.reference).amount, 20000);
  assert.equal((await f.status(order.data.reference, 'a'.repeat(64))).status, 404);
  assert.equal(JSON.stringify((await f.status(order.data.reference)).data).includes(enrollment.email), false);
});
test('concurrent retries create only one provider transaction', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, () => f.checkout()));
  assert.equal(f.initCount(), 1);
  assert.equal(new Set(results.map(r => r.data.reference)).size, 1);
  assert.equal((await f.checkout({ ...enrollment, program: 'foundation' })).status, 409);
});
test('redirects and unsigned webhooks cannot confirm payment; signed duplicates are idempotent', async t => {
  const f = await fixture(t);
  const { data: order } = await f.checkout();
  assert.equal((await f.status(order.reference)).data.status, 'pending');
  const transaction = { ...f.transactions.get(order.reference), status: 'success', paid_at: '2026-09-25T12:00:00Z' };
  assert.equal((await f.event('charge.success', transaction, 'f'.repeat(128))).status, 401);
  assert.equal((await f.event('charge.success', { ...transaction, amount: 1 })).status, 409);
  assert.equal((await f.event('charge.success', { ...transaction, currency: 'NGN' })).status, 409);
  assert.equal((await f.event('charge.success', { ...transaction, customer: { email: 'other@example.com' } })).status, 409);
  assert.equal((await f.event('charge.success', transaction)).status, 200);
  assert.equal((await f.event('charge.success', transaction)).status, 200);
  assert.equal((await f.status(order.reference)).data.status, 'paid');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  assert.equal((await f.checkout()).data.checkoutUrl, null);
});
test('verification recovers missed webhooks and never treats provider outages as success', async t => {
  const f = await fixture(t);
  const { data: order } = await f.checkout();
  f.transactions.get(order.reference).status = 'success';
  assert.equal((await f.status(order.reference)).data.status, 'paid');
  const unavailable = await fixture(t, { failVerify: true });
  const pending = (await unavailable.checkout()).data;
  const result = (await unavailable.status(pending.reference)).data;
  assert.equal(result.status, 'pending');
  assert.equal(result.verificationUnavailable, true);
});
test('initialization timeouts preserve the reference and reject unsafe redirect URLs', async t => {
  const f = await fixture(t, { failInitialize: true });
  const first = await f.checkout();
  const second = await f.checkout();
  assert.equal(first.data.reference, second.data.reference);
  assert.equal(second.data.checkoutUnavailable, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  const bad = await fixture(t, { url: 'https://checkout.paystack.com.evil.example/pay' });
  assert.equal((await bad.checkout()).data.checkoutUnavailable, true);
  assert.equal(checkoutUrl('https://checkout.paystack.com/path'), true);
  assert.equal(checkoutUrl('javascript:alert(1)'), false);
});
test('refund reconciliation handles Paystack transaction_reference events, retries, partial/full and late success', async t => {
  const f = await fixture(t);
  const { data: order } = await f.checkout();
  const transaction = { ...f.transactions.get(order.reference), status: 'success', paid_at: '2026-09-25T12:00:00Z' };
  f.transactions.set(order.reference, transaction);
  await f.event('charge.success', transaction);
  f.refunds.push({ id: 1, transaction: transaction.id, amount: 5000, currency: 'USD', status: 'processed' });
  const payload = { transaction_reference: order.reference, amount: '5000', currency: 'USD', refund_reference: null };
  assert.equal((await f.event('refund.processed', payload)).status, 200);
  assert.equal((await f.event('refund.processed', payload)).status, 200);
  assert.equal((await f.status(order.reference)).data.refundedAmount, 5000);
  assert.equal((await f.status(order.reference)).data.status, 'partially_refunded');
  f.refunds.push({ id: 2, transaction: transaction.id, amount: 15000, currency: 'USD', status: 'processed' });
  await f.event('refund.processed', payload);
  assert.equal((await f.status(order.reference)).data.status, 'refunded');
  await f.event('charge.success', { ...transaction, duplicate: true });
  assert.equal((await f.status(order.reference)).data.status, 'refunded');
});
test('private files are inaccessible and unconfigured checkout fails closed', async t => {
  const f = await fixture(t, { config: { ready: false } });
  assert.equal((await f.checkout()).status, 503);
  for (const file of ['/.env', '/server/config.cjs', '/.data/enrollments.sqlite', '/tests/payments.test.cjs', '/package.json']) assert.equal((await fetch(f.base + file)).status, 404);
  assert.equal((await fetch(`${f.base}/deraedge-enroll/payment.html`)).status, 200);
});
test('order storage survives reopening the database', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dera-payments-'));
  const file = path.join(temp, 'test.sqlite');
  let db;
  try {
    db = openStore(file);
    db.prepare('INSERT INTO events VALUES(?,?,?,?)').run('test', 'ref', 'charge.success', 'today');
    db.close();
    db = openStore(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  } finally {
    db?.close();
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temp));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    rmSync(temp, { recursive: true, force: true });
  }
});
test('Paystack adapter uses the server secret and raw-body HMAC', async () => {
  const secret = 'sk_test_fixture';
  const raw = Buffer.from('{"event":"charge.success"}');
  const signature = createHmac('sha512', secret).update(raw).digest('hex');
  assert.equal(validSignature(raw, signature, secret), true);
  assert.equal(validSignature(Buffer.from('{}'), signature, secret), false);
  const adapter = paystack(secret, async (url, options) => {
    assert.equal(url, 'https://api.paystack.co/transaction/verify/dera-test');
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    return { ok: true, json: async () => ({ status: true, data: { status: 'pending' } }) };
  });
  assert.equal((await adapter.verify('dera-test')).status, 'pending');
});
