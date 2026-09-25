const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { configuration } = require('../server/config.cjs');
const { openStore } = require('../server/store.cjs');
const { createApp } = require('../server/app.cjs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const config = configuration({ PUBLIC_URL: 'http://localhost:3000', PAYSTACK_SECRET_KEY: 'sk_test_browser_fixture', PAYMENT_CURRENCIES: 'USD,NGN',
    PRICE_FOUNDATION_NGN: '15000000', PRICE_PROFESSIONAL_NGN: '30000000', PRICE_MASTERY_NGN: '75000000',
    TERMS_URL: 'https://example.com/terms', PRIVACY_URL: 'https://example.com/privacy', REFUND_URL: 'https://example.com/refund' });
  const db = openStore(':memory:');
  const payments = new Map();
  let charges = 0;
  let rejectInitialize = false;
  let outcome = 'success';
  const provider = {
    async initialize(data) {
      if (rejectInitialize) throw new Error('Simulated provider timeout');
      charges++;
      payments.set(data.reference, { id: charges, reference: data.reference, amount: Number(data.amount), currency: data.currency,
        customer: { email: data.email }, status: 'pending', domain: 'test' });
      return { reference: data.reference, authorization_url: `https://checkout.paystack.com/${data.reference}` };
    },
    async verify(reference) { if (!payments.has(reference)) throw new Error('Not found'); return payments.get(reference); },
    async refunds() { return []; },
  };
  const server = createApp({ config, db, provider });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config.publicUrl = base;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('https://**/*', route => route.abort());
    // Simulate ONLY inside this test: production has no mock payment endpoint.
    await context.route('https://checkout.paystack.com/**', async route => {
      const reference = new URL(route.request().url()).pathname.slice(1);
      const payment = payments.get(reference);
      assert.ok(payment);
      payment.status = outcome;
      if (outcome === 'success') payment.paid_at = new Date().toISOString();
      await route.fulfill({ status: 302, headers: { Location: `${base}/deraedge-enroll/payment.html?reference=${reference}${outcome === 'pending' ? '&cancelled=1' : ''}` } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/deraedege-academy/index.html`);
    await page.waitForFunction(() => !document.getElementById('academy-currency').disabled);
    await page.selectOption('#academy-currency', 'NGN');
    assert.match(await page.locator('#foundation .price').textContent(), /150,000/);
    await page.locator('#foundation a[href*="deraedge-enroll"]').click();
    await page.waitForFunction(() => document.getElementById('currency').value === 'NGN');
    assert.match(await page.locator('#sum-price').textContent(), /150,000/);
    await page.locator('#submit-btn').click();
    assert.equal(charges, 0);
    await page.fill('#name', 'Test Student'); await page.fill('#email', 'student@example.com'); await page.fill('#country', 'Nigeria');
    await page.locator('#submit-btn').click();
    assert.equal(charges, 0, 'consent is required');
    await page.check('#consent');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'dera-checkout-mobile.png'), fullPage: true });
    await page.locator('#submit-btn').click();
    await page.waitForFunction(() => document.getElementById('payment-title')?.textContent === 'Payment confirmed');
    assert.equal(charges, 1);
    assert.match(await page.locator('#receipt-total').textContent(), /150,000/);
    assert.equal(await page.locator('#print-receipt').isVisible(), true);
    assert.equal(await page.locator('#payment-test-note').isVisible(), true);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('payment-title')?.textContent === 'Payment confirmed');
    assert.equal(charges, 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'dera-payment-confirmed.png'), fullPage: true });
    const receiptUrl = page.url();
    const stranger = await browser.newPage();
    await stranger.route('https://**/*', route => route.abort());
    await stranger.goto(receiptUrl);
    assert.equal(await stranger.locator('#payment-title').textContent(), 'Payment lookup unavailable');
    assert.equal(await stranger.locator('#payment-receipt').isVisible(), false);
    await stranger.close();
    await page.goto(`${base}/deraedge-enroll/index.html`);
    await page.waitForFunction(() => !document.getElementById('submit-btn').disabled);
    assert.equal(await page.locator('#previous-checkout').isVisible(), true);
    await page.locator('#previous-checkout-link').click();
    await page.waitForFunction(() => !document.getElementById('another-enrollment').hidden);
    await page.locator('#another-enrollment').click();
    await page.waitForFunction(() => !document.getElementById('submit-btn').disabled);
    outcome = 'pending';
    await page.fill('#name', 'Test Student'); await page.fill('#email', 'student@example.com'); await page.fill('#country', 'Nigeria'); await page.check('#consent');
    await page.locator('#submit-btn').click();
    await page.waitForFunction(() => document.getElementById('payment-title')?.textContent === 'Payment not yet confirmed');
    assert.equal(await page.locator('#resume-payment').isVisible(), true);
    assert.equal(await page.locator('#print-receipt').isVisible(), false);
    assert.equal(charges, 2);
    await page.evaluate(() => sessionStorage.removeItem('dera-checkout'));
    rejectInitialize = true;
    await page.goto(`${base}/deraedge-enroll/index.html`);
    await page.waitForFunction(() => !document.getElementById('submit-btn').disabled);
    await page.fill('#name', 'Test Student'); await page.fill('#email', 'student@example.com'); await page.fill('#country', 'Nigeria'); await page.check('#consent');
    await page.locator('#submit-btn').click();
    await page.waitForURL('**/payment.html?reference=*');
    await page.waitForFunction(() => document.getElementById('payment-message')?.textContent.includes('temporarily unavailable'));
    assert.equal(await page.locator('#print-receipt').isVisible(), false);
    assert.equal(charges, 2);
    config.ready = false;
    await page.goto(`${base}/deraedge-enroll/index.html`);
    await page.waitForFunction(() => document.getElementById('checkout-status').textContent.includes('not available'));
    assert.equal(await page.locator('#submit-btn').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: Academy NGN pricing, enrollment validation and consent, hosted-checkout redirect, verified receipt, reload recovery, private lookup, provider timeout, unconfigured checkout, and mobile layout. No real charges made.');
    console.log(`Screenshots: ${path.join(os.tmpdir(), 'dera-checkout-mobile.png')} and ${path.join(os.tmpdir(), 'dera-payment-confirmed.png')}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
