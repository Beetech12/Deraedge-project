const { createHmac, timingSafeEqual } = require('node:crypto');
function validSignature(raw, signature, secret) {
  if (!secret || !/^[a-f0-9]{128}$/i.test(signature || '')) return false;
  const expected = createHmac('sha512', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
function paystack(secret, fetcher = fetch) {
  async function request(endpoint, body) {
    const response = await fetcher(`https://api.paystack.co${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (!response.ok || result.status !== true) throw new Error('Payment provider request failed.');
    return result.data;
  }
  return {
    initialize: body => request('/transaction/initialize', body),
    verify: reference => request(`/transaction/verify/${encodeURIComponent(reference)}`),
    async refunds(transactionId) {
      const refunds = [];
      for (let page = 1; page <= 20; page++) {
        const rows = await request(`/refund?transaction=${encodeURIComponent(transactionId)}&perPage=100&page=${page}`);
        if (!Array.isArray(rows)) throw new Error('Invalid refund list.');
        refunds.push(...rows);
        if (rows.length < 100) return refunds;
      }
      throw new Error('Refund reconciliation needs operator attention.');
    },
  };
}
function checkoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && !url.username && !url.password && !url.port;
  } catch { return false; }
}
module.exports = { paystack, validSignature, checkoutUrl };
