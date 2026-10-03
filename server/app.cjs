const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { asynchronousStore } = require('./database.cjs');
const { validSignature, checkoutUrl } = require('./paystack.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const terminal = new Set(['paid', 'refunded', 'partially_refunded', 'disputed', 'review']);

function validate(body, config) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid enrollment.');
  const program = config.catalog[body.program];
  if (typeof body.program !== 'string' || typeof body.currency !== 'string' || !Object.hasOwn(config.catalog, body.program) || !Object.hasOwn(program.prices, body.currency)) throw fail(400, 'Choose an available program and currency.');
  if (body.consent !== true || body.policyVersion !== config.policyVersion) throw fail(400, 'Review and accept the current enrollment policies.');
  const customer = {};
  for (const [field, max, required] of [['name',120,true],['email',254,true],['phone',40,false],['country',80,true],['experience',100,false],['start',100,false],['goals',2000,false]]) {
    const value = body[field] ?? '';
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) throw fail(400, `Please enter a valid ${field}.`);
    customer[field] = value.trim();
  }
  customer.email = customer.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw fail(400, 'Please enter a valid email.');
  return { program: body.program, currency: body.currency, amount: program.prices[body.currency], name: program.name, customer, policyVersion: config.policyVersion };
}
async function readBody(req, max = 16384) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(413, 'Request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function createHandler({ config, db, provider, messages, serverless = false, root = path.resolve(__dirname, '..') }) {
  if (db) db = asynchronousStore(db);
  const locks = new Map();
  const limits = new Map();
  async function rate(req, kind, limit) {
    if (serverless && db) {
      const window = Math.floor(Date.now() / 60000) * 60000;
      // Vercel overwrites this header; the standalone server never trusts it.
      const address = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const key = hash(`${address}:${kind}`);
      await db.prepare('DELETE FROM api_limits WHERE window_start<?').run(window - 120000);
      const row = await db.prepare('INSERT INTO api_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=CASE WHEN api_limits.window_start=excluded.window_start THEN api_limits.count+1 ELSE 1 END RETURNING count').get(key, window);
      if (row.count > limit) throw fail(429, 'Too many requests. Please wait a minute.');
      return;
    }
    const time = Date.now();
    if (limits.size > 5000) for (const [key, bucket] of limits) if (time - bucket.start > 60000) limits.delete(key);
    const key = `${req.socket.remoteAddress}:${kind}`;
    let bucket = limits.get(key);
    if (!bucket || time - bucket.start > 60000) { bucket = { start: time, count: 0 }; limits.set(key, bucket); }
    if (++bucket.count > limit || limits.size > 10000) throw fail(429, 'Too many requests. Please wait a minute.');
  }
  async function locked(key, action) {
    const pending = (locks.get(key) || Promise.resolve()).catch(() => {}).then(action);
    locks.set(key, pending);
    try { return await pending; } finally { if (locks.get(key) === pending) locks.delete(key); }
  }
  const getOrder = reference => db.prepare('SELECT * FROM orders WHERE reference=?').get(reference);
  function checkTransaction(order, transaction) {
    const customer = JSON.parse(order.customer);
    if (transaction.reference !== order.reference || transaction.amount !== order.amount || transaction.currency !== order.currency || transaction.customer?.email?.toLowerCase() !== customer.email || transaction.domain !== order.payment_mode) throw fail(409, 'Payment details do not match this enrollment. Contact support with your reference.');
  }
  async function applyTransaction(order, transaction) {
    // A webhook may have changed the record while an API verification was in flight.
    order = await getOrder(order.reference);
    checkTransaction(order, transaction);
    if (transaction.status === 'success') {
      await db.prepare("UPDATE orders SET status=CASE WHEN status IN ('refunded','partially_refunded','disputed','review') THEN status ELSE 'paid' END, paid_at=COALESCE(paid_at,?), transaction_id=?, checked_at=? WHERE reference=?")
        .run(transaction.paid_at || now(), String(transaction.id), Date.now(), order.reference);
    } else if (!terminal.has(order.status)) {
      const state = ['reversed', 'reversal_pending'].includes(transaction.status) ? 'review' : ['failed', 'abandoned'].includes(transaction.status) ? 'failed' : 'pending';
      await db.prepare("UPDATE orders SET status=?, checked_at=? WHERE reference=? AND status NOT IN ('paid','refunded','partially_refunded','disputed','review')").run(state, Date.now(), order.reference);
    }
    return getOrder(order.reference);
  }
  async function summary(order) {
    return { reference: order.reference, program: order.program_name, programId: order.program,
      amount: order.amount, currency: order.currency, status: order.status, createdAt: order.created_at,
      paidAt: order.paid_at, testMode: order.payment_mode === 'test',
      refundedAmount: (await db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE reference=? AND status='processed'").get(order.reference)).total,
      checkoutUrl: !config.ready || terminal.has(order.status) || order.payment_mode !== (config.live ? 'live' : 'test') ? null : order.checkout_url };
  }
  async function authorize(req, reference) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const order = await getOrder(reference);
    if (!order || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(order.token_hash, 'hex'), Buffer.from(hash(token), 'hex'))) throw fail(404, 'Enrollment not found. Use the browser that started checkout, or contact support with your payment reference.');
    return order;
  }
  async function createCheckout(req, body) {
    if (!config.ready) throw fail(503, 'Online payment is not available yet. Contact admissions to enroll.');
    const input = validate(body, config);
    const token = req.headers['idempotency-key'] || '';
    if (!/^[a-f0-9]{64}$/.test(token)) throw fail(400, 'Invalid checkout key. Reload the page.');
    const tokenHash = hash(token);
    const fingerprint = hash(JSON.stringify(input));
    return locked(tokenHash, async () => {
      let order = await db.prepare('SELECT * FROM orders WHERE token_hash=?').get(tokenHash);
      if (order && order.payment_mode !== (config.live ? 'live' : 'test')) throw fail(409, 'This checkout belongs to a different payment mode. Contact admissions.');
      if (order && order.fingerprint !== fingerprint) throw fail(409, 'An earlier checkout uses different details. Check its payment status before starting another enrollment.');
      if (!order) {
        const reference = `dera-${randomBytes(18).toString('hex')}`;
        await db.prepare('INSERT INTO orders(reference,token_hash,fingerprint,program,program_name,amount,currency,customer,policy_version,consent_at,created_at,payment_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(token_hash) DO NOTHING')
          .run(reference, tokenHash, fingerprint, input.program, input.name, input.amount, input.currency, JSON.stringify(input.customer), config.policyVersion, now(), now(), config.live ? 'live' : 'test');
        order = await db.prepare('SELECT * FROM orders WHERE token_hash=?').get(tokenHash);
        if (order.fingerprint !== fingerprint || order.payment_mode !== (config.live ? 'live' : 'test')) throw fail(409, 'An earlier checkout uses different details or payment mode. Check its status.');
      }
      if (order.checkout_url || terminal.has(order.status)) return summary(order);
      // A database lease prevents duplicate initialization across Vercel instances.
      // The order is committed BEFORE calling Paystack; a crash cannot lose its reference.
      const lease = Date.now() + 30000;
      const claimed = await db.prepare('UPDATE orders SET initialize_until=? WHERE reference=? AND initialize_until<=? AND checkout_url IS NULL').run(lease, order.reference, Date.now());
      if (!claimed.changes) return { ...await summary(await getOrder(order.reference)), checkoutUnavailable: true };
      // Reuse the SAME reference after a timeout: never initialize a second charge blindly.
      const callback = `${config.publicUrl}/deraedge-enroll/payment.html?reference=${order.reference}`;
      try {
        const result = await provider.initialize({ email: input.customer.email, amount: String(order.amount), currency: order.currency,
          reference: order.reference, callback_url: callback,
          metadata: { program: order.program, enrollment_reference: order.reference, cancel_action: `${callback}&cancelled=1`,
            custom_fields: [{ display_name: 'Program', variable_name: 'program', value: order.program_name }] } });
        if (result.reference !== order.reference || !checkoutUrl(result.authorization_url)) throw new Error('Invalid checkout response.');
        await db.prepare('UPDATE orders SET checkout_url=? WHERE reference=?').run(result.authorization_url, order.reference);
        return summary(await getOrder(order.reference));
      } catch {
        // If initialization succeeded but its response was lost, verification can recover a paid order.
        try {
          const recovered = await applyTransaction(await getOrder(order.reference), await provider.verify(order.reference));
          if (terminal.has(recovered.status)) return summary(recovered);
        } catch { /* Keep pending; provider retries remain tied to the original reference. */ }
        return { ...await summary(await getOrder(order.reference)), checkoutUnavailable: true };
      } finally {
        await db.prepare('UPDATE orders SET initialize_until=0 WHERE reference=? AND initialize_until=?').run(order.reference, lease);
      }
    });
  }
  async function webhook(req) {
    const raw = await readBody(req, 262144);
    if (!validSignature(raw, req.headers['x-paystack-signature'], config.secret)) throw fail(401, 'Invalid signature.');
    let event;
    try { event = JSON.parse(raw); } catch { throw fail(400, 'Invalid event.'); }
    const digest = hash(raw);
    if (!event.event?.startsWith('refund.') && await db.prepare('SELECT 1 FROM events WHERE digest=?').get(digest)) return { received: true };
    const data = event.data;
    const supported = ['charge.success','refund.processed','refund.pending','refund.processing','refund.failed','refund.needs-attention','charge.dispute.create','charge.dispute.resolve'];
    if (!supported.includes(event.event)) return { received: true };
    const reference = event.event === 'charge.success' ? data?.reference : data?.transaction_reference || data?.transaction?.reference;
    if (typeof reference !== 'string') return { received: true };
    const order = await getOrder(reference);
    if (!order) return { received: true };
    let refunds;
    let refundTransaction;
    if (event.event.startsWith('refund.')) {
      // Refund webhooks may omit a refund ID. Reconcile authoritative refund IDs
      // instead of adding webhook amounts, which would double-count retries.
      refundTransaction = await provider.verify(reference);
      checkTransaction(order, refundTransaction);
      refunds = await provider.refunds(refundTransaction.id);
      if (refunds.some(refund => !refund.id || String(refund.transaction?.id || refund.transaction) !== String(refundTransaction.id) || refund.currency !== order.currency || !Number.isSafeInteger(refund.amount) || refund.amount <= 0 || refund.amount > order.amount)) throw fail(409, 'Refund details do not match.');
    }
    await db.transaction(async () => {
      await db.lockOrder(reference);
      if (!event.event.startsWith('refund.') && await db.prepare('SELECT 1 FROM events WHERE digest=?').get(digest)) return;
      if (event.event === 'charge.success') {
        if (data.status !== 'success') throw fail(400, 'Invalid charge state.');
        await applyTransaction(order, data);
      } else if (event.event.startsWith('refund.')) {
        for (const refund of refunds) await db.prepare("INSERT INTO refunds(refund_id,reference,amount,status) VALUES(?,?,?,?) ON CONFLICT(refund_id) DO UPDATE SET status=CASE WHEN refunds.status='processed' THEN 'processed' ELSE excluded.status END")
          .run(String(refund.id), reference, refund.amount, refund.status);
        await db.prepare('UPDATE orders SET paid_at=COALESCE(paid_at,?), transaction_id=? WHERE reference=?').run(refundTransaction.paid_at || null, String(refundTransaction.id), reference);
        const total = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE reference=? AND status='processed'").get(reference)).total;
        if (total > order.amount) throw fail(409, 'Refund total exceeds order amount.');
        if (total > 0) await db.prepare('UPDATE orders SET status=? WHERE reference=?').run(total >= order.amount ? 'refunded' : 'partially_refunded', reference);
      } else {
        // Disputes require an operator decision; do not restore access automatically.
        await db.prepare("UPDATE orders SET status='disputed' WHERE reference=?").run(reference);
      }
      await db.prepare('INSERT INTO events VALUES(?,?,?,?) ON CONFLICT(digest) DO NOTHING').run(digest, reference, event.event, now());
    });
    return { received: true };
  }
  function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const url = new URL(req.url, config.publicUrl);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        if (!db && !['/api/catalog', '/api/messages/config'].includes(pathname)) throw fail(503, 'Payment storage is unavailable. Contact admissions.');
        if (pathname === '/api/paystack/webhook' && req.method === 'POST') return json(res, 200, await webhook(req));
        await rate(req, 'api', 120);
        if (pathname === '/api/messages/config' && req.method === 'GET') return json(res, 200, { enabled: Boolean(messages?.enabled), recipient: 'okolochinedu10@gmail.com' });
        if (pathname === '/api/messages' && req.method === 'POST') {
          await rate(req, 'messages', 5);
          // Permit the standalone server's own loopback form without changing the
          // public payment URL. Never trust forwarded headers for this exception.
          const localOrigins = ['localhost', '127.0.0.1', '[::1]'].map(host => `http://${host}:${req.socket.localPort}`);
          const localForm = !serverless
            && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
            && localOrigins.includes(req.headers.origin)
            && req.headers.origin === `http://${req.headers.host}`;
          if ((!localForm && req.headers.origin !== config.publicUrl) || !req.headers['content-type']?.startsWith('application/json')) throw fail(403, 'Send messages from this website.');
          if (!messages?.enabled) throw fail(503, 'Website sending is not available yet. Your message has not been sent.');
          let body;
          try { body = JSON.parse(await readBody(req, 65536)); } catch (error) { throw error.status ? error : fail(400, 'Invalid JSON.'); }
          const result = await messages.enqueue(body, req.headers['idempotency-key']);
          if (serverless) await messages.drain();
          else messages.drain().catch(() => console.error('Message delivery worker failed; check the outbox.'));
          return json(res, 202, result);
        }
        const messageMatch = /^\/api\/messages\/(msg-[a-f0-9]{36})$/.exec(pathname);
        if (messageMatch && req.method === 'GET') {
          if (!messages) throw fail(404, 'Message not found.');
          if (serverless) await messages.drain();
          return json(res, 200, await messages.status(messageMatch[1], req.headers.authorization?.replace(/^Bearer /, '')));
        }
        if (pathname === '/api/catalog' && req.method === 'GET') return json(res, 200, {
          programs: config.catalog, enabled: Boolean(config.ready), testMode: !config.live, policies: config.policies, policyVersion: config.policyVersion,
          currencies: config.currencies, issues: config.issues,
        });
        if (pathname === '/api/checkout' && req.method === 'POST') {
          await rate(req, 'checkout', 10);
          if (req.headers.origin !== config.publicUrl || !req.headers['content-type']?.startsWith('application/json')) throw fail(403, 'Checkout must be started on this website.');
          let body;
          try { body = JSON.parse(await readBody(req)); } catch (error) { throw error.status ? error : fail(400, 'Invalid JSON.'); }
          return json(res, 200, await createCheckout(req, body));
        }
        const match = /^\/api\/orders\/(dera-[a-f0-9]{36})$/.exec(pathname);
        if (match && req.method === 'GET') {
          let order = await authorize(req, match[1]);
          let verificationUnavailable = false;
          if (order.payment_mode === (config.live ? 'live' : 'test') && !terminal.has(order.status) && Date.now() - order.checked_at >= 15000) {
            order = await locked(`verify:${order.reference}`, async () => {
              const current = await getOrder(order.reference);
              if (terminal.has(current.status) || Date.now() - current.checked_at < 15000) return current;
              try { return await applyTransaction(current, await provider.verify(current.reference)); }
              catch { verificationUnavailable = true; return current; }
            });
          }
          return json(res, 200, { ...await summary(order), verificationUnavailable });
        }
        throw fail(404, 'Not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method not allowed.');
      // Explicit public allowlist: .env, database, server code, tests, and dotfiles are never served.
      const file = pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      if (!/^\/(?:index\.html|deraedge-enroll\/(?:terms|privacy|refund)\.html|(?:deraedge-(?:enroll|firm|contact|partnership)|deraedege-academy)\/(?:index|payment)\.html|(?:js|css|asset|components)\/[a-zA-Z0-9_-]+\.(?:js|css|png|jpg|webp|mp4|html))$/.test(file)) throw fail(404, 'Not found.');
      let content;
      try { content = await readFile(path.join(root, file)); } catch { throw fail(404, 'Not found.'); }
      const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.mp4':'video/mp4' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      json(res, error.status || 503, { error: error.status ? error.message : 'Service temporarily unavailable. Please try again.' });
    }
  };
}
function createApp(options) {
  const server = http.createServer(createHandler(options));
  server.requestTimeout = 20000;
  server.headersTimeout = 15000;
  return server;
}
module.exports = { createApp, createHandler, validate };
