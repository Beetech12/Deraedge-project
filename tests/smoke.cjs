const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8765/';
const paths = ['index.html', 'deraedge-firm/index.html', 'deraedege-academy/index.html', 'deraedge-partnership/index.html', 'deraedge-contact/index.html', 'deraedge-enroll/index.html'];

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    // Keep checks local and deterministic; never send an email or fetch remote fonts.
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const path of paths) {
      await page.goto(new URL(path, base).href);
      await page.waitForSelector('#header[data-ready]');
      if (path === 'index.html') {
        await page.waitForFunction(() => document.querySelector('#research-status').textContent.includes('could not load'));
        assert.equal(await page.locator('.desk-row').count(), 0);
        assert.equal(await page.locator('.desk-provider').isVisible(), true);
      }
      assert.equal(await page.locator('header header, footer footer').count(), 0);
      assert.equal(await page.locator('.reveal').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).opacity === '1')), true);
      const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.href));
      for (const link of new Set(links.filter(link => link.startsWith(locationBase(base))))) {
        assert.equal((await context.request.get(link)).ok(), true, `${path}: broken ${link}`);
      }
      await page.setViewportSize({ width: 375, height: 812 });
      if (path === 'index.html') assert.equal(await page.locator('.desk').isVisible(), true);
      const toggle = page.locator('.menu-toggle');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#primary-nav').isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#primary-nav').isVisible(), false);
      assert.equal(await toggle.evaluate(n => n === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path}: overflow`);
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.goto(new URL('deraedege-academy/index.html', base).href);
    await page.locator('[data-id="mastery"]').click();
    assert.match(await page.locator('#final-cta').getAttribute('href'), /deraedge-enroll\/index.html\?program=mastery(?:&currency=USD)?$/);
    await page.locator('#final-cta').click();
    await page.waitForFunction(() => document.querySelector('#sum-name')?.textContent === 'Mastery Program');
    assert.equal(await page.locator('#sum-name').textContent(), 'Mastery Program');
    assert.equal(await page.locator('input[value="mastery"]').isChecked(), true);

    for (const [path, id] of [['deraedge-contact/index.html', 'contact-form'], ['deraedge-partnership/index.html', 'partner-form']]) {
      await page.goto(new URL(path, base).href);
      const form = page.locator(`#${id}`);
      await form.locator('[type="submit"]').click();
      assert.equal(await form.locator('.email-preview').isVisible(), false);
      for (const input of await form.locator('input[required], textarea[required]').all()) {
        await input.fill(await input.getAttribute('type') === 'email' ? 'test@example.com' : 'Test visitor');
      }
      await form.locator('input[type="email"]').fill('invalid');
      await form.locator('[type="submit"]').click();
      assert.equal(await form.locator('.email-preview').isVisible(), false);
      await form.locator('input[type="email"]').fill('test@example.com');
      if (id === 'partner-form') {
        await form.locator('[type="submit"]').click();
        assert.match(await form.locator('.form-status').textContent(), /at least one/);
        await page.locator('#contribution-row button').first().click();
      }
      // Long content exercises the copy fallback without invoking an external mail client.
      await form.locator('textarea:not([readonly])').first().fill('Test draft content. '.repeat(150));
      await form.locator('[type="submit"]').click();
      const draft = await form.locator('.email-preview textarea').inputValue();
      assert.match(draft, /To: info@deraedge.com/);
      assert.doesNotMatch(draft, /undefined/);
      assert.match(await form.locator('.form-status').textContent(), /not sent/);
      assert.equal(await form.locator('#email').inputValue(), 'test@example.com');
      if (id === 'enroll-form') assert.match(draft, /program: mastery/);
      if (id === 'contact-form') assert.match(draft, /Interest: Foundation Program/);
      if (id === 'partner-form') assert.match(draft, /Contributions: Strategic Capital/);
    }
    await context.route('**/components/*.html', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(base);
    assert.equal(await page.locator('.fallback-nav').isVisible(), true);
    assert.equal(await page.locator('.reveal').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).opacity === '1')), true);
    assert.equal(await page.locator('video source').getAttribute('src'), null);
    assert.deepEqual(errors, []);
    const normal = await browser.newContext();
    await normal.route('https://**/*', route => route.abort());
    await normal.route('**/components/*.html', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    const animated = await normal.newPage();
    await animated.goto(new URL('deraedge-enroll/index.html', base).href);
    await animated.waitForFunction(() => document.querySelector('.reveal').classList.contains('is-visible'));
    assert.equal(await animated.locator('.fallback-nav').isVisible(), true);
    const subdirectory = await browser.newContext({ reducedMotion: 'reduce' });
    await subdirectory.route('https://**/*', route => route.abort());
    await subdirectory.route('**/__preview__/**', async route => {
      const url = route.request().url().replace('/__preview__/', '/');
      await route.fulfill({ response: await route.fetch({ url }) });
    });
    const nested = await subdirectory.newPage();
    await nested.goto(new URL('__preview__/deraedge-enroll/index.html', base).href);
    await nested.waitForSelector('#header[data-ready]');
    assert.match(await nested.locator('#primary-nav a').first().getAttribute('href'), /\/__preview__\/index.html$/);
    assert.equal((await context.request.get(new URL('asset/hero-poster.jpg', base).href)).ok(), true);
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJS.newPage();
    for (const path of paths) {
      await plain.goto(new URL(path, base).href);
      assert.equal(await plain.locator('.fallback-nav').isVisible(), true);
      assert.equal(await plain.locator('.reveal').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).opacity === '1')), true);
      if (await plain.locator('form').count()) assert.equal(await plain.locator('[type="submit"]').isDisabled(), true);
    }
    console.log('PASS: six pages, local links, mobile menu, program selection, validation, email drafts, component failures, reduced motion, and no-JavaScript fallbacks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
function locationBase(url) { return new URL(url).origin; }
