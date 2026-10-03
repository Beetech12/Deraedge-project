const nodemailer = require("nodemailer");
const recipient = "okolochinedu10@gmail.com";

function mailConfiguration(env = process.env) {
  const host = env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER || "";
  const rawPassword = env.SMTP_PASSWORD || "";
  // Google's four-group display spaces are not part of an app password.
  // Leave other providers' passwords unchanged.
  const password = host.toLowerCase() === "smtp.gmail.com" && /^\S{4}( \S{4}){3}$/.test(rawPassword)
    ? rawPassword.replaceAll(" ", "") : rawPassword;
  const from = env.SMTP_FROM || user;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid SMTP_PORT.");
  if (from && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from))
    throw new Error("SMTP_FROM must be a single email address.");
  return {
    host,
    port,
    user,
    password,
    from,
    ready: Boolean(user && password && from),
  };
}
function createMailer(config, createTransport = nodemailer.createTransport) {
  if (!config.ready) return null;
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    auth: { user: config.user, pass: config.password },
    dnsTimeout: 10000,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(message) {
      const result = await transport.sendMail({
        from: { name: "Deraedge Website", address: config.from },
        to: recipient,
        replyTo: { name: message.name, address: message.email },
        subject: message.subject,
        text: `${message.text}\n\nWebsite reference: ${message.reference}`,
        messageId: `<${message.reference}@${config.from.split("@")[1]}>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (
        !result.accepted?.some(
          (address) => String(address).toLowerCase() === recipient,
        )
      ) {
        throw Object.assign(new Error("Recipient not accepted."), {
          code: "EENVELOPE",
          responseCode: 550,
        });
      }
      return { messageId: result.messageId };
    },
    verify: () => transport.verify(),
    close: () => transport.close(),
  };
}
module.exports = { recipient, mailConfiguration, createMailer };
