const { configuration } = require("./config.cjs");
const { openStore } = require("./store.cjs");
const { paystack } = require("./paystack.cjs");
const { createApp } = require("./app.cjs");
const { mailConfiguration, createMailer } = require("./mail.cjs");
const { createMessages } = require("./messages.cjs");
const config = configuration();
const db = openStore(config.database);
const messages = createMessages({ db, mailer: createMailer(mailConfiguration()) });
const server = createApp({ config, db, provider: paystack(config.secret), messages });
messages.start();
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () => {
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
      db.close();
      process.exit(0);
    }),
  );
