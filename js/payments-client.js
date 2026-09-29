window.DeraPayments = (() => {
  const root = new URL('/', location.href);
  async function request(route, options = {}) {
    if (!['http:', 'https:'].includes(root.protocol)) throw new Error('Open the website through the Node server at http://localhost:3000.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(new URL(route, root), { ...options, signal: controller.signal, cache: 'no-store' });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The payment API did not return JSON. Open this page through the Node server, not a static preview server.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to connect. Please try again.');
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The payment server timed out. Reload to retry.');
      if (error instanceof TypeError) throw new Error('Cannot reach the payment server. Check your connection and reload.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function save(value) {
    // Only the private lookup token and reference are saved, never enrollment/card details.
    sessionStorage.setItem('dera-checkout', JSON.stringify(value));
    if (value.reference) sessionStorage.setItem(`dera-receipt-${value.reference}`, JSON.stringify(value));
  }
  function saved(reference) {
    try { return JSON.parse(sessionStorage.getItem(reference ? `dera-receipt-${reference}` : 'dera-checkout') || 'null'); } catch { return null; }
  }
  function newToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function statusUrl(reference) {
    return new URL(`deraedge-enroll/payment.html?reference=${encodeURIComponent(reference)}`, root).href;
  }
  function safeCheckout(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && !url.port && !url.username && !url.password; }
    catch { return false; }
  }
  const money = (amount, currency) => new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount / 100);
  return { request, save, saved, newToken, statusUrl, safeCheckout, money };
})();
