const { configuration } = require('./config.cjs');
const { openDatabase } = require('./database.cjs');
const { createHandler } = require('./app.cjs');
const { paystack } = require('./paystack.cjs');
const { createMessages } = require('./messages.cjs');
const { createMailer, mailConfiguration } = require('./mail.cjs');

function createHostedHandler({ env = process.env, open = openDatabase, fetcher = fetch, provider } = {}) {
  let database;
  let messages;
  let cached;
  let expires = 0;
  let loading;
  async function initialize() {
    const config = configuration(env);
    if (!env.DATABASE_URL) config.issues.push('Payment storage is not configured. Contact admissions.');
    else if (!database) {
      try { database = await open(config, env); }
      catch { config.issues.push('Payment storage is temporarily unavailable. Please try again later.'); }
    }
    // Confirm that live policies are actually published before offering checkout.
    if (config.live && Object.values(config.policies).every(Boolean)) {
      const published = await Promise.all(Object.values(config.policies).map(async url => {
        try {
          const response = await fetcher(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000) });
          return response.ok && response.headers.get('content-type')?.includes('text/html');
        } catch { return false; }
      }));
      if (!published.every(Boolean)) config.issues.push('Enrollment policies are not yet published. Contact admissions.');
    }
    // Preview deployments can never charge live money, even if someone copied a key.
    if (config.live && env.VERCEL_ENV !== 'production') config.issues.push('Live payments are available only on the production website.');
    config.ready = config.issues.length === 0;
    if (database && !messages) messages = createMessages({ db: database, mailer: createMailer(mailConfiguration(env)), batchSize: 1 });
    cached = createHandler({ config, db: database, provider: provider || paystack(config.secret), messages, serverless: true });
    expires = Date.now() + (config.ready ? 60000 : 10000);
    return cached;
  }
  return async function handler(req, res) {
    try {
      // The rewrite supplies an explicit route; preserve the raw request body.
      const url = new URL(req.url, 'https://localhost');
      const route = req.query?.route ?? url.searchParams.get('route');
      if (typeof route === 'string') req.url = `/api/${route}`;
      if (!cached || Date.now() >= expires) {
        if (!loading) loading = initialize().finally(() => { loading = null; });
        await loading;
      }
      return await cached(req, res);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Payment service is not configured. Please contact admissions.' }));
    }
  };
}
module.exports = { createHostedHandler };
