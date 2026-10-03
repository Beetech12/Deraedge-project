const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { openStore } = require('../server/store.cjs');
const { createMessages, validateMessage } = require('../server/messages.cjs');
const { createMailer, mailConfiguration, recipient } = require('../server/mail.cjs');
const { configuration } = require('../server/config.cjs');
const { createApp } = require('../server/app.cjs');
const key = () => randomBytes(32).toString('hex');
const contact = { type: 'contact', reviewed: true, fields: { name: 'Customer', email: 'customer@example.com', message: 'My enquiry', Interest: 'General Enquiry' } };
const partnership = { type: 'partnership', reviewed: true, fields: { name: 'Partner', email: 'partner@example.com', position: 'Director', country: 'Nigeria', proposition: 'Research collaboration', source: 'Own resources', why: 'Mutual research interests', Capacity: 'Company', Contributions: 'Research / Expertise, Technology' } };
function fixture(t, mailer, clock) {
  const db = openStore(':memory:');
  const service = createMessages({ db, mailer, clock });
  t.after(async () => { await service.stop(); db.close(); });
  return { db, service };
}
test('both forms validate complete data and reject unreviewed or malformed messages', () => {
  assert.match(validateMessage(contact).text, /My enquiry/);
  assert.match(validateMessage(partnership).text, /Research collaboration/);
  for (const bad of [{ ...contact, reviewed: false }, { ...contact, fields: { ...contact.fields, email: 'bad\r\nBcc: victim@example.com' } }, { ...partnership, fields: { ...partnership.fields, Contributions: 'Invalid' } }, { ...contact, fields: { ...contact.fields, message: 'x'.repeat(10001) } }]) assert.throws(() => validateMessage(bad));
});
test('reviewed submissions are durable, private, and duplicate requests send once', async t => {
  const sent = [];
  const { service, db } = fixture(t, { send: async message => { sent.push(message); } });
  const token = key();
  const first = await service.enqueue(contact, token);
  assert.equal(first.status, 'queued');
  assert.equal((await service.enqueue(contact, token)).reference, first.reference);
  await assert.rejects(service.enqueue(partnership, token));
  await Promise.all([service.drain(), service.drain()]);
  assert.equal(sent.length, 1);
  assert.equal((await service.status(first.reference, token)).status, 'sent');
  assert.equal((await service.enqueue(contact, token)).status, 'sent');
  await assert.rejects(service.status(first.reference, key()));
  assert.equal(JSON.stringify(await service.status(first.reference, token)).includes('customer@example.com'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
});
test('temporary connection failures retry automatically and SMTP uncertainty is not retried', async t => {
  let time = 1000, attempts = 0;
  const { service } = fixture(t, { send: async () => { if (++attempts === 1) throw Object.assign(new Error('Offline'), { code: 'ECONNECTION' }); } }, () => time);
  const token = key(), row = await service.enqueue(contact, token);
  await service.drain();
  assert.equal((await service.status(row.reference, token)).status, 'queued');
  time += 60001;
  await service.drain();
  assert.equal(attempts, 2);
  assert.equal((await service.status(row.reference, token)).status, 'sent');
  const unknown = fixture(t, { send: async () => { throw Object.assign(new Error('Connection lost after DATA'), { code: 'ESOCKET' }); } });
  const secret = key(), item = await unknown.service.enqueue(contact, secret);
  await unknown.service.drain();
  assert.equal((await unknown.service.status(item.reference, secret)).status, 'unknown');
  await unknown.service.drain();
  assert.equal(unknown.db.prepare('SELECT attempts FROM messages').get().attempts, 1);
});
test('SMTP rejects show failure and missing configuration never queues or claims delivery', async t => {
  const { service } = fixture(t, { send: async () => { throw Object.assign(new Error('Authentication rejected'), { code: 'EAUTH' }); } });
  const token = key(), item = await service.enqueue(contact, token);
  await service.drain();
  assert.equal((await service.status(item.reference, token)).status, 'failed');
  const absent = fixture(t, null);
  await assert.rejects(absent.service.enqueue(contact, key()), /not available/);
  assert.equal(absent.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
});
test('SMTP transport fixes recipient, uses reply-to, enforces TLS, and rejects nonaccepted recipients', async () => {
  let options, envelope;
  const config = mailConfiguration({ SMTP_USER: 'sender@gmail.com', SMTP_PASSWORD: 'test-only-password' });
  const mailer = createMailer(config, input => {
    options = input;
    return { sendMail: async mail => { envelope = mail; return { accepted: [recipient], messageId: mail.messageId }; } };
  });
  const message = { ...validateMessage(contact), reference: 'msg-test', to: 'attacker@example.com' };
  await mailer.send(message);
  assert.equal(envelope.to, 'okolochinedu10@gmail.com');
  assert.equal(envelope.replyTo.address, 'customer@example.com');
  assert.equal(envelope.from.address, 'sender@gmail.com');
  assert.equal(options.requireTLS, true);
  assert.equal(envelope.disableFileAccess, true);
  assert.equal(envelope.disableUrlAccess, true);
  const rejected = createMailer(config, () => ({ sendMail: async () => ({ accepted: [] }) }));
  await assert.rejects(rejected.send(message), /not accepted/);
  assert.equal(createMailer(mailConfiguration({})), null);
});
test('message API requires same-origin JSON, protects lookup, and ignores injected destinations', async t => {
  const { db, service } = fixture(t, { send: async () => {} });
  const config = configuration({ PUBLIC_URL: 'http://localhost:3000' });
  const server = createApp({ config, db, messages: service, provider: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = key();
  const post = (origin, body = contact) => fetch(`${base}/api/messages`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': token }, body: JSON.stringify(body) });
  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post(config.publicUrl, { ...contact, reviewed: false })).status, 400);
  const response = await post(config.publicUrl, { ...contact, recipient: 'other@example.com' });
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.recipient, recipient);
  assert.equal((await fetch(`${base}/api/messages/${result.reference}`)).status, 404);
  const status = await fetch(`${base}/api/messages/${result.reference}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status.status, 200);
});

test('local message forms work with a production public URL but reject other origins', async t => {
  const { db, service } = fixture(t, { send: async () => {} });
  const config = configuration({ PUBLIC_URL: 'https://deraedge-project.vercel.app' });
  const server = createApp({ config, db, messages: service, provider: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = origin => fetch(`${base}/api/messages`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key() }, body: JSON.stringify(contact) });
  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post('http://127.0.0.1:1')).status, 403);
  assert.equal((await post(`http://localhost:${server.address().port}`)).status, 403, 'Host must match the local origin');
  assert.equal((await post(base)).status, 202);
  assert.equal(config.publicUrl, 'https://deraedge-project.vercel.app');
});

test('Gmail display spaces are removed without altering other SMTP passwords', () => {
  assert.equal(mailConfiguration({ SMTP_PASSWORD: 'abcd efgh ijkl mnop' }).password, 'abcdefghijklmnop');
  assert.equal(mailConfiguration({ SMTP_PASSWORD: 'abcdefghijklmnop' }).password, 'abcdefghijklmnop');
  assert.equal(mailConfiguration({ SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'abcd efgh ijkl mnop' }).password, 'abcd efgh ijkl mnop');
});
