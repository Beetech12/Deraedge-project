const { configuration } = require('./config.cjs');
const { openStore } = require('./store.cjs');
const { paystack } = require('./paystack.cjs');
const { createApp } = require('./app.cjs');
const config = configuration();
const db = openStore(config.database);
const server = createApp({ config, db, provider: paystack(config.secret) });
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  console.log(`Deraedge server: ${config.publicUrl}. Payments: ${config.ready ? (config.live ? 'LIVE' : 'TEST') : 'NOT CONFIGURED'}.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
