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
  const confirmed = (env.PAYSTACK_CONFIRMED_CURRENCIES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (confirmed.some(c => !['USD', 'NGN'].includes(c))) throw new Error('Invalid PAYSTACK_CONFIRMED_CURRENCIES.');
  const issues = [];
  if (!/^sk_(test|live)_[a-zA-Z0-9]+$/.test(secret)) issues.push('Missing or invalid PAYSTACK_SECRET_KEY.');
  if (!currencies.length) issues.push('No payment currencies selected.');
  const policies = Object.fromEntries(['terms', 'privacy', 'refund'].map(name => {
    let value = env[`${name.toUpperCase()}_URL`] || '';
    if (value) {
      const url = new URL(value, publicUrl);
      const localPolicy = !live && ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname) && url.origin === publicUrl.origin;
      if ((url.protocol !== 'https:' && !(localPolicy && url.protocol === 'http:')) || url.username || url.password) throw new Error('Policy URLs must use HTTPS (same-origin localhost HTTP is allowed for testing).');
      value = url.href;
    }
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
  for (const [name, value] of Object.entries(policies)) if (!value) issues.push(`Missing ${name.toUpperCase()}_URL.`);
  const availableCurrencies = [];
  for (const currency of new Set(currencies)) {
    const complete = Object.values(catalog).every(p => p.prices[currency]);
    if (!complete) issues.push(`Set valid prices for all programs in ${currency}.`);
    if (!confirmed.includes(currency)) issues.push(`Confirm Paystack account support for ${currency} in PAYSTACK_CONFIRMED_CURRENCIES.`);
    if (complete && confirmed.includes(currency)) availableCurrencies.push(currency);
    // Never advertise a partially configured or unconfirmed NGN option.
    else if (currency === 'NGN') for (const program of Object.values(catalog)) delete program.prices.NGN;
  }
  const ready = issues.length === 0;
  return { publicUrl: publicUrl.origin, secret, live, ready, policies, catalog, issues, currencies: availableCurrencies,
    policyVersion: env.POLICY_VERSION || '1', database: env.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(__dirname, '..', env.DATABASE_PATH || '.data/enrollments.sqlite') };
}
module.exports = { configuration };
