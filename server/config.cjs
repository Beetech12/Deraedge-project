const path = require('node:path');
const programs = {
  foundation: { name: 'Foundation Program', duration: '4 Weeks', cert: 'Certificate of Completion', usd: 10000 },
  professional: { name: 'Professional Program', duration: '6 Weeks', cert: 'Certificate of Completion', usd: 20000 },
  mastery: { name: 'Mastery Program', duration: '10 Weeks', cert: 'Certificate of Mastery', usd: 50000 },
};
function configuration(env = process.env) {
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:3000');
  if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('PUBLIC_URL must be the site origin, without a path or credentials.');
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('Invalid PUBLIC_URL protocol.');
  const secret = env.PAYSTACK_SECRET_KEY || '';
  const live = secret.startsWith('sk_live_');
  if (live && (env.ALLOW_LIVE_PAYMENTS !== 'true' || publicUrl.protocol !== 'https:')) throw new Error('Live payments require ALLOW_LIVE_PAYMENTS=true and an HTTPS PUBLIC_URL.');
  const currencies = (env.PAYMENT_CURRENCIES || 'USD').split(',').map(s => s.trim()).filter(Boolean);
  if (currencies.some(c => !['USD', 'NGN'].includes(c))) throw new Error('Supported currencies: NGN, USD.');
  const policies = Object.fromEntries(['terms', 'privacy', 'refund'].map(name => {
    const value = env[`${name.toUpperCase()}_URL`] || '';
    if (value && new URL(value).protocol !== 'https:') throw new Error('Policy URLs must use HTTPS.');
    return [name, value];
  }));
  const catalog = Object.fromEntries(Object.entries(programs).map(([id, details]) => {
    const prices = {};
    for (const currency of currencies) {
      const raw = env[`PRICE_${id.toUpperCase()}_${currency}`] ?? (currency === 'USD' ? String(details.usd) : '');
      if (raw === '') continue;
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0 || value > 10000000000) throw new Error(`Invalid minor-unit price for ${id} ${currency}.`);
      prices[currency] = value;
    }
    const { usd, ...metadata } = details;
    return [id, { ...metadata, prices }];
  }));
  const ready = /^sk_(test|live)_\S+$/.test(secret) && Object.values(policies).every(Boolean) && Object.values(catalog).some(p => Object.keys(p.prices).length);
  return { publicUrl: publicUrl.origin, secret, live, ready, policies, catalog,
    policyVersion: env.POLICY_VERSION || '1', database: path.resolve(env.DATABASE_PATH || '.data/enrollments.sqlite') };
}
module.exports = { configuration };
