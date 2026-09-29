require('./env.cjs').loadEnvironment();
const { configuration } = require("./config.cjs");
const { openDatabase } = require("./database.cjs");
const { paystack } = require("./paystack.cjs");
const { createApp } = require("./app.cjs");
const { mailConfiguration, createMailer } = require("./mail.cjs");
const { createMessages } = require("./messages.cjs");
async function start() {
  const config = configuration();
  const db = await openDatabase(config);
  const messages = createMessages({ db, mailer: createMailer(mailConfiguration()) });
  const server = createApp({ config, db, provider: paystack(config.secret), messages });
  messages.start();
  server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () => {
      console.log(`Listening on port ${server.address().port}.`);
      console.log(
        `Deraedge server: ${config.publicUrl}. Payments: ${config.ready ? (config.live ? "LIVE" : "TEST") : "NOT CONFIGURED"}.`,
      );
      console.log(`Website email: ${messages.enabled ? "CONFIGURED" : "NOT CONFIGURED"}.`);
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(async () => {
        await messages.stop();
        await db.close();
        process.exit(0);
      }),
    );

}
start().catch(() => { console.error("Server could not start. Check payment configuration and database access."); process.exitCode = 1; });
