require('./env.cjs').loadEnvironment();

async function check() {
  const origin = new URL(process.env.PUBLIC_URL || 'http://localhost:3000');
  if (origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid origin');
  for (const route of ['/api/catalog', '/deraedge-enroll/terms.html', '/deraedge-enroll/privacy.html', '/deraedge-enroll/refund.html']) {
    const response = await fetch(new URL(route, origin.origin), { redirect: 'error', signal: AbortSignal.timeout(20000) });
    const json = route === '/api/catalog';
    const correctType = response.headers.get('content-type')?.includes(json ? 'application/json' : 'text/html');
    console.log(`${route}: HTTP ${response.status}${correctType ? '' : ' (unexpected response type)'}`);
    if (!response.ok || !correctType) { process.exitCode = 1; continue; }
    if (json) {
      const catalog = await response.json();
      console.log(`Deployed checkout: ${catalog.enabled === true ? 'enabled' : 'blocked'}`);
      // Only known fields; never dump provider responses or environment values.
      console.log(`NGN available: ${Array.isArray(catalog.currencies) && catalog.currencies.includes('NGN')}`);
      if (catalog.enabled !== true) process.exitCode = 1;
    }
  }
}
check().catch(() => { console.error('Deployment check failed. Check the public origin and network access.'); process.exitCode = 1; });
