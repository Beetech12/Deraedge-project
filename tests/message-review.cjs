const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://localhost:3000/';
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const outgoing = [];
    page.on('request', request => { if (request.method() === 'POST') outgoing.push(request.url()); });
    for (const [route, id] of [['deraedge-contact/index.html', 'contact-form'], ['deraedge-partnership/index.html', 'partner-form']]) {
      await page.goto(new URL(route, base).href);
      const form = page.locator(`#${id}`);
      await form.locator('[type="submit"]').click();
      assert.equal(await form.locator('.email-preview').isVisible(), false);
      for (const input of await form.locator('input[required], textarea[required]').all()) {
        await input.fill(await input.getAttribute('type') === 'email' ? 'customer@example.com' : 'Customer details');
      }
      if (id === 'partner-form') await page.locator('#contribution-row button').first().click();
      await form.locator('textarea:not([readonly])').first().fill('Please review my message.');
      const originalUrl = page.url();
      await form.locator('[type="submit"]').click();
      assert.equal(await form.locator('.email-preview').isVisible(), true);
      const draft = await form.locator('.email-preview textarea').inputValue();
      assert.match(draft, /To: okolochinedu10@gmail\.com/);
      assert.match(draft, /Please review my message\./);
      assert.equal(page.url(), originalUrl);
      assert.equal(outgoing.length, 0, 'Review must not send anything');
      await form.getByRole('button', { name: 'Edit message', exact: true }).click();
      assert.equal(await form.locator('.email-preview').isVisible(), false);
      assert.equal(await form.locator('#email').inputValue(), 'customer@example.com');
      await form.locator('textarea:not([readonly])').first().fill('My corrected message.');
      await form.locator('[type="submit"]').click();
      assert.match(await form.locator('.email-preview textarea').inputValue(), /My corrected message\./);
      await form.locator('.chip').last().click();
      assert.equal(await form.locator('.email-preview').isVisible(), false, 'Selection changes invalidate the review');
      await form.locator('[type="submit"]').click();
      await form.locator('textarea:not([readonly])').first().fill('Long reviewed message. '.repeat(150));
      await form.locator('[type="submit"]').click();
      assert.match(await form.locator('.email-preview textarea').inputValue(), /Long reviewed message/);
      assert.equal(page.url(), originalUrl);
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: both recipients, validation, review before sending, editing without losing data, selection-change invalidation, and mobile layout. No messages sent.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
