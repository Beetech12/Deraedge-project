const { mailConfiguration, createMailer } = require('./mail.cjs');
const mailer = createMailer(mailConfiguration());
if (!mailer) {
  console.error('Set SMTP_USER, SMTP_PASSWORD, and SMTP_FROM privately in .env.');
  process.exitCode = 1;
} else {
  mailer.verify().then(() => console.log('SMTP connection and authentication succeeded. No email was sent.'))
    .catch(error => { console.error(`SMTP verification failed (${error.code || 'connection error'}). Check your server settings.`); process.exitCode = 1; })
    .finally(() => mailer.close());
}
