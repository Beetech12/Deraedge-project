/* Responsive and presentation checks. Run against an isolated local preview.
 * External services are blocked; this test never sends mail or starts checkout.
 * Example: BASE_URL=http://localhost:3100 node tests/redesign-browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://localhost:3100';
const routes = ['/', '/deraedge-firm/', '/deraedege-academy/', '/deraedge-partnership/', '/deraedge-contact/', '/deraedge-enroll/', '/deraedge-enroll/payment.html', '/deraedge-enroll/terms.html', '/deraedge-enroll/privacy.html', '/deraedge-enroll/refund.html'];
(async () => {
 const browser = await chromium.launch({ channel: 'msedge', headless: true });
 try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  const errors = [], failedLocal = [], links = new Set();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) failedLocal.push(`${r.status()} ${r.url()}`); });
  for (const width of [320, 390, 768, 1024, 1440]) {
   await page.setViewportSize({ width, height: 900 });
   for (const route of routes) {
    await page.goto(base + route);
    await page.locator('#header[data-ready]').waitFor();
    assert.equal(await page.locator('h1').count(), 1, route + ': one main heading');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflow at ${width}`);
    assert.equal(await page.locator('.skip-link').getAttribute('href'), '#main-content');
    if (width <= 960) {
     await page.locator('.menu-toggle').click();
     assert.equal(await page.locator('#primary-nav').isVisible(), true);
     await page.keyboard.press('Escape');
     assert.equal(await page.locator('#primary-nav').isVisible(), false);
    }
    if (width === 1440) {
     for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.href))) if (href.startsWith(locationOrigin(base))) links.add(href);
    }
    if (route === '/') assert.equal(await page.locator('.cap-grid > .cap').count(), 8);
    if (width === 390 || width === 1440) {
     // Decode lazy images before the full-page capture; scrolling alone can race decode.
     await page.evaluate(async () => { for (const img of document.images) img.loading = 'eager'; await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); });
     assert.deepEqual(await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src)), []);
     const name = route === '/' ? 'home' : route.replaceAll('/', '-').replace(/^-|-$/g, '').replace('.html', '');
     fs.mkdirSync('docs/redesign', { recursive: true });
     await page.screenshot({ path: `docs/redesign/${name}-${width}.png`, fullPage: true });
    }
   }
   console.log(`PASS ${width}px: 10 pages, no overflow, menus, headings and image loading.`);
  }
  for (const href of links) assert.equal((await context.request.get(href)).ok(), true, 'Broken local link: ' + href);
  await page.goto(base + '/deraedege-academy/');
  for (const [id,count] of [['foundation',11],['professional',12],['mastery',13]]) {
   await page.locator(`[data-id="${id}"]`).click();
   assert.equal(await page.locator('#curriculum-list li').count(), count);
  }
  await page.goto(base + '/');
  assert.match(await page.locator('video source').getAttribute('src'), /hero-finance\.mp4$/, 'Background video is available on every screen size');
  assert.deepEqual(errors, []); assert.deepEqual(failedLocal, []);
  console.log(`PASS ${links.size} local links, profile curricula, reduced-motion media, console and local network checks.`);
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
function locationOrigin(url) { return new URL(url).origin; }
