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

const env = { PUBLIC_URL: 'http://localhost:3000', PAYSTACK_SECRET_KEY: 'sk_test_fixture', PAYMENT_CURRENCIES: 'USD,NGN', PAYSTACK_CONFIRMED_CURRENCIES: 'USD,NGN',
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
  return { db, base, checkout, event, status, token, transactions, refunds, config, provider, initCount: () => initCount };
}

test('currencies are explicit; naira is never derived from an invented FX rate', () => {
  const cfg = configuration({ PAYMENT_CURRENCIES: 'USD,NGN' });
  assert.deepEqual(cfg.catalog.professional.prices, { USD: 20000 });
  assert.equal(Boolean(cfg.ready), false);
  assert.throws(() => configuration({ ...env, PRICE_FOUNDATION_NGN: '-1' }));
  assert.throws(() => configuration({ ...env, PAYSTACK_SECRET_KEY: 'sk_live_fixture' }));
  assert.throws(() => configuration({ ...env, PRIVACY_URL: 'javascript:alert(1)' }));
});
test('local policies resolve on the site origin without allowing insecure production policies', () => {
  assert.equal(configuration({ ...env, TERMS_URL: '/deraedge-enroll/terms.html' }).policies.terms, 'http://localhost:3000/deraedge-enroll/terms.html');
  assert.throws(() => configuration({ ...env, TERMS_URL: 'http://example.com/terms' }));
  assert.throws(() => configuration({ ...env, PUBLIC_URL: 'http://example.com', TERMS_URL: '/terms' }));
  assert.throws(() => configuration({ ...env, TERMS_URL: 'https://user:password@example.com/terms' }));
  assert.equal(configuration({ ...env, PUBLIC_URL: 'https://example.com', TERMS_URL: '/terms' }).policies.terms, 'https://example.com/terms');
});
test('all enrollment policy pages are served and a configured NGN checkout is enabled', async t => {
  const f = await fixture(t, { config: configuration({ ...env, PAYMENT_CURRENCIES: 'NGN', TERMS_URL: '/deraedge-enroll/terms.html', PRIVACY_URL: '/deraedge-enroll/privacy.html', REFUND_URL: '/deraedge-enroll/refund.html' }) });
  const catalog = await fetch(`${f.base}/api/catalog`).then(r => r.json());
  assert.equal(catalog.enabled, true);
  assert.deepEqual(Object.keys(catalog.programs.foundation.prices), ['NGN']);
  for (const name of ['terms', 'privacy', 'refund']) {
    const response = await fetch(`${f.base}${new URL(catalog.policies[name]).pathname}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  const result = await f.checkout({ ...enrollment, currency: 'NGN' });
  assert.equal(result.status, 200);
  assert.ok(checkoutUrl(result.data.checkoutUrl));
});
test('price tampering is ignored, consent required, and checkout requests must be same-origin', async t => {
  const f = await fixture(t);
  assert.equal((await f.checkout({ ...enrollment, consent: false })).status, 400);
  assert.equal((await f.checkout({ ...enrollment, email: 'bad' })).status, 400);
  assert.equal((await f.checkout({ ...enrollment, program: '__proto__' })).status, 400);
  assert.equal((await f.checkout({ ...enrollment, currency: 'toString' })).status, 400);
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

test('a late pending verification cannot overwrite a successful webhook', async t => {
  const f = await fixture(t);
  const { data: order } = await f.checkout();
  const snapshot = { ...f.transactions.get(order.reference) };
  let signalStarted, release;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  f.provider.verify = async () => { signalStarted(); await gate; return snapshot; };
  const statusRequest = f.status(order.reference);
  await started;
  assert.equal((await f.event('charge.success', { ...snapshot, status: 'success' })).status, 200);
  release();
  assert.equal((await statusRequest).data.status, 'paid');
});

test('test receipts remain test receipts after switching to live mode', async t => {
  const f = await fixture(t);
  const { data: order } = await f.checkout();
  await f.event('charge.success', { ...f.transactions.get(order.reference), status: 'success' });
  f.config.live = true;
  assert.equal((await f.status(order.reference)).data.testMode, true);
  assert.equal((await f.checkout()).status, 409);
});

test('a reversed transaction never offers another payment checkout', async t => {
  const f = await fixture(t);
  const { data: order } = await f.checkout();
  f.transactions.get(order.reference).status = 'reversed';
  const result = (await f.status(order.reference)).data;
  assert.equal(result.status, 'review');
  assert.equal(result.checkoutUrl, null);
});

test('all requested currencies require complete prices and confirmed provider support', () => {
  const unsupported = configuration({ ...env, PAYSTACK_CONFIRMED_CURRENCIES: 'USD' });
  assert.equal(unsupported.ready, false);
  assert.deepEqual(unsupported.currencies, ['USD']);
  assert.equal(unsupported.catalog.foundation.prices.NGN, undefined);
  const incomplete = configuration({ ...env, PRICE_MASTERY_NGN: '' });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.catalog.foundation.prices.NGN, undefined);
  const usd = configuration({ ...env, PAYMENT_CURRENCIES: 'USD', PAYSTACK_CONFIRMED_CURRENCIES: 'USD' });
  assert.equal(usd.ready, true);
  assert.deepEqual(Object.values(usd.catalog).map(p => p.prices.USD), [10000, 20000, 50000]);
});

test('environment loader preserves shell values and tolerates an absent file', () => {
  const { writeFileSync, unlinkSync } = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const file = path.join(os.tmpdir(), `dera-env-${randomBytes(8).toString('hex')}`);
  const loader = path.resolve(__dirname, '../server/env.cjs');
  try {
    writeFileSync(file, 'DERA_ENV_TEST=from-file\nDERA_ENV_OTHER=loaded\n');
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(loader)}).loadEnvironment(${JSON.stringify(file)}); if (process.env.DERA_ENV_TEST !== 'from-shell' || process.env.DERA_ENV_OTHER !== 'loaded') process.exit(1);`], {
      env: { ...process.env, DERA_ENV_TEST: 'from-shell' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    require(loader).loadEnvironment(file + '-missing');
  } finally { unlinkSync(file); }
});

test('direct startup loads configuration and serves catalog and policy routes', async t => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server/start.cjs')], {
    cwd: os.tmpdir(),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:3000', DATABASE_PATH: ':memory:', DATABASE_URL: '', VERCEL: '',
      PAYSTACK_SECRET_KEY: '', PAYMENT_CURRENCIES: 'USD', PAYSTACK_CONFIRMED_CURRENCIES: '',
      TERMS_URL: '/deraedge-enroll/terms.html', PRIVACY_URL: '/deraedge-enroll/privacy.html', REFUND_URL: '/deraedge-enroll/refund.html',
      SMTP_PASSWORD: '', SMTP_USER: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before listening')); });
    child.stdout.on('data', chunk => {
      const match = /Listening on port (\d+)/.exec(chunk.toString());
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', reject);
  });
  const base = `http://127.0.0.1:${port}`;
  const catalog = await fetch(`${base}/api/catalog`).then(r => r.json());
  assert.equal(catalog.enabled, false);
  assert.equal(catalog.programs.professional.prices.USD, 20000);
  assert.deepEqual(catalog.currencies, []);
  for (const policy of ['terms', 'privacy', 'refund']) assert.equal((await fetch(`${base}/deraedge-enroll/${policy}.html`)).status, 200);
});

test('disabling checkout also hides previously issued checkout links', async t => {
  const f = await fixture(t);
  const order = (await f.checkout()).data;
  f.config.ready = false;
  assert.equal((await f.status(order.reference)).data.checkoutUrl, null);
  assert.equal((await f.checkout()).status, 503);
});

test('frontend API uses the site origin and reports timeouts without hanging', async () => {
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync(path.resolve(__dirname, '../js/payments-client.js'), 'utf8');
  const context = {
    window: {}, location: { href: 'http://localhost:3000/deraedge-enroll/index.html' },
    URL, AbortController, TypeError, Intl,
    setTimeout: callback => setTimeout(callback, 5), clearTimeout,
    fetch: (url, options) => {
      assert.equal(url.href, 'http://localhost:3000/api/catalog');
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  };
  vm.runInNewContext(source, context);
  await assert.rejects(context.window.DeraPayments.request('api/catalog'), /timed out/);
});
