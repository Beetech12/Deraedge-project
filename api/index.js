const { createHostedHandler } = require('../server/hosting.cjs');

// Vercel environment variables are supplied by the platform, never by a public file.
module.exports = createHostedHandler();
module.exports.config = { api: { bodyParser: false } };
