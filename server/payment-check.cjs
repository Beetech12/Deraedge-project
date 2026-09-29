require('./env.cjs').loadEnvironment();
const { configuration } = require("./config.cjs");

async function check() {
  const config = configuration();
  console.log(`Checkout: ${config.ready ? "configured" : "blocked"}`);
  console.log(`Mode: ${config.live ? "LIVE" : "TEST (no real payments)"}`);
  console.log(`Website: ${config.publicUrl}`);
  for (const issue of config.issues) console.log(`Blocked: ${issue}`);
  for (const [name, url] of Object.entries(config.policies)) {
    if (!url)
      console.log(
        `Missing: ${name.toUpperCase()}_URL (published HTTPS policy page)`,
      );
  }
  for (const currency of ["USD", "NGN"]) {
    const enabled = (process.env.PAYMENT_CURRENCIES || "USD")
      .split(",")
      .map((value) => value.trim())
      .includes(currency);
    if (!enabled) console.log(`${currency}: not enabled in PAYMENT_CURRENCIES`);
    for (const [id, program] of Object.entries(config.catalog)) {
      const amount = program.prices[currency];
      if (amount)
        console.log(`${id}: ${currency} ${(amount / 100).toFixed(2)}`);
      else if (enabled)
        console.log(
          `${id}: ${currency} unavailable until pricing and provider support are configured.`,
        );
    }
  }
  if (!/^sk_(test|live)_[a-zA-Z0-9]+$/.test(config.secret)) {
    console.log("Missing or invalid PAYSTACK_SECRET_KEY.");
    process.exitCode = 1;
    return;
  }
  try {
    // Only authentication is inspected; balances and credentials are never printed.
    const response = await fetch("https://api.paystack.co/balance", {
      headers: { Authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    const authenticated = response.ok && result.status === true;
    console.log(
      authenticated
        ? "Paystack authentication: accepted. Currency eligibility must also be confirmed in Paystack."
        : `Paystack authentication check failed (HTTP ${response.status}).`,
    );
    if (!authenticated) process.exitCode = 1;
  } catch {
    console.log("Could not reach Paystack. Check network access and retry.");
    process.exitCode = 1;
  }
  if (!config.ready) process.exitCode = 1;
}

check().catch(() => {
  console.error(
    "Invalid payment configuration. Check PUBLIC_URL, live-mode settings, policy URLs, currencies, and integer prices.",
  );
  process.exitCode = 1;
});
