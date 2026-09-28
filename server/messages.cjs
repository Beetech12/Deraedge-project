const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { recipient } = require('./mail.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const interests = ['Foundation Program','Professional Program','Mastery Program','Strategic Partnership','General Enquiry'];
const capacities = ['Individual / Principal','Family Office','Company','Institution','Technology / Infrastructure Partner','Research / Intelligence Partner','Other'];
const contributions = ['Strategic Capital','Market Intelligence','Technology','Institutional Access','Commercial Opportunities','Research / Expertise','Other'];

function validateMessage(body) {
  if (!body || !['contact','partnership'].includes(body.type) || body.reviewed !== true || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) throw error(400, 'Review a valid message before sending.');
  if (body.website) throw error(400, 'Unable to accept this message.');
  const definitions = body.type === 'contact'
    ? [['name','Full name',120,true],['email','Email',254,true],['message','Message',10000,true],['Interest','Interest',100,true]]
    : [['name','Full name / Principal',120,true],['organisation','Organisation',160,false],['position','Position',160,true],['email','Email',254,true],['country','Country',80,true],['proposition','Proposition',10000,true],['source','Source of capital / resources',500,true],['link','Website / profile',1000,false],['why','Why partner with Deraedge',10000,true],['Capacity','Capacity',100,true],['Contributions','Contributions',250,true]];
  const fields = {};
  for (const [key, , max, required] of definitions) {
    const value = body.fields[key] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw error(400, `Please enter a valid ${key}.`);
    fields[key] = value.trim();
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.email) || /[\r\n]/.test(fields.name)) throw error(400, 'Please enter a valid name and email.');
  if (body.type === 'contact' && !interests.includes(fields.Interest)) throw error(400, 'Select a valid interest.');
  if (body.type === 'partnership') {
    const selected = fields.Contributions.split(', ');
    if (!capacities.includes(fields.Capacity) || selected.length < 1 || selected.length > 2 || new Set(selected).size !== selected.length || selected.some(value => !contributions.includes(value))) throw error(400, 'Select a capacity and one or two contribution areas.');
  }
  return { type: body.type, name: fields.name, email: fields.email,
    subject: body.type === 'contact' ? 'Deraedge — Website enquiry' : 'Deraedge — Partnership enquiry',
    text: definitions.map(([key,label]) => `${label}: ${fields[key] || '(not provided)'}`).join('\n\n') };
}

function createMessages({ db, mailer, clock = Date.now }) {
  // SMTP has no universal idempotency key. A process interruption during send
  // needs review, rather than blindly resending an email that may be accepted.
  db.prepare("UPDATE messages SET status='unknown' WHERE status='sending'").run();
  let running;
  let timer;
  let stopped = false;
  const summary = row => ({ reference: row.reference, status: row.status, recipient });
  function enqueue(body, key) {
    if (!mailer) throw error(503, 'Website sending is not available yet. Your message has not been sent; please try again later.');
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw error(400, 'Invalid message key. Reload this page.');
    const message = validateMessage(body);
    const fingerprint = digest(JSON.stringify(message));
    const keyHash = digest(key);
    const previous = db.prepare('SELECT * FROM messages WHERE token_hash=?').get(keyHash);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw error(409, 'This message changed after submission. Check its status before sending another message.');
      return summary(previous);
    }
    const reference = `msg-${randomBytes(18).toString('hex')}`;
    db.prepare('INSERT INTO messages(reference,token_hash,fingerprint,content,status,created_at,next_attempt) VALUES(?,?,?,?,?,?,?)')
      .run(reference, keyHash, fingerprint, JSON.stringify(message), 'queued', new Date(clock()).toISOString(), clock());
    return { reference, status: 'queued', recipient };
  }
  function status(reference, token) {
    const row = db.prepare('SELECT * FROM messages WHERE reference=?').get(reference);
    if (!row || !/^[a-f0-9]{64}$/.test(token || '') || !timingSafeEqual(Buffer.from(row.token_hash, 'hex'), Buffer.from(digest(token), 'hex'))) throw error(404, 'Message not found.');
    return summary(row);
  }
  async function deliver() {
    if (!mailer || stopped) return;
    const due = db.prepare("SELECT * FROM messages WHERE status='queued' AND next_attempt<=? ORDER BY created_at LIMIT 10").all(clock());
    for (const row of due) {
      if (stopped) break;
      const claimed = db.prepare("UPDATE messages SET status='sending',attempts=attempts+1 WHERE reference=? AND status='queued'").run(row.reference);
      if (!claimed.changes) continue;
      try {
        await mailer.send({ ...JSON.parse(row.content), reference: row.reference });
        db.prepare("UPDATE messages SET status='sent',sent_at=? WHERE reference=?").run(new Date(clock()).toISOString(), row.reference);
      } catch (failure) {
        const temporary = (failure.responseCode >= 400 && failure.responseCode < 500) || ['ECONNECTION','EDNS'].includes(failure.code);
        const rejected = ['EAUTH','ETLS','EENVELOPE'].includes(failure.code) || failure.responseCode >= 500;
        const attempts = row.attempts + 1;
        const retry = temporary && attempts < 5;
        const state = retry ? 'queued' : temporary || rejected ? 'failed' : 'unknown';
        db.prepare('UPDATE messages SET status=?,next_attempt=? WHERE reference=?').run(state, clock() + Math.min(600000, 30000 * 2 ** attempts), row.reference);
      }
    }
  }
  function drain() {
    if (!running) running = deliver().finally(() => { running = null; });
    return running;
  }
  return {
    enabled: Boolean(mailer), enqueue, status, drain,
    start() { timer = setInterval(() => { drain().catch(() => console.error('Message delivery worker failed; check the outbox.')); }, 5000); timer.unref(); },
    async stop() { stopped = true; clearInterval(timer); if (running) await running; mailer?.close?.(); },
  };
}
module.exports = { createMessages, validateMessage };
