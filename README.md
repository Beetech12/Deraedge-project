# Deraedge website

HTML, CSS, and JavaScript frontend with a Node.js 24+ payment server. No frontend framework or build step is required. Enrollment now uses Paystack; contact and partnership forms still prepare email drafts.

## Run locally

Run `npm start` from the project directory and open `http://localhost:3000/`. The server works without credentials; checkout is visibly unavailable until configured. Node.js 24+ is required for the built-in SQLite database. There are no production npm dependencies.

For payment configuration, copy `.env.example` to `.env` and set values privately. Do not put secret keys in browser JavaScript or commit `.env`. Use the Node server, not a generic static server: the Node server explicitly prevents public access to secrets, database files, server code, and tests.

## Payment features

- Academy and enrollment read the server catalog and support configured USD/NGN prices.
- Server-side input validation, policy consent recording, and price calculation; client amounts are ignored.
- Paystack hosted checkout, with all payment methods supported by the merchant's account shown by Paystack. Card details never pass through this application.
- Persistent SQLite enrollment/order records, random payment references, and private lookup tokens stored only in the initiating browser session.
- Repeated checkout requests reuse the same order and Paystack reference. An uncertain initialization never blindly generates another charge.
- Raw-body HMAC-SHA512 webhook verification; amount, currency, reference, customer email, and provider mode checks before confirming payment.
- Payment verification on return, bounded status polling, pending/failed states, cancellation recovery, same-checkout retry, and a printable payment confirmation.
- Refund reconciliation from Paystack's authoritative refund list, including partial/full refunds, duplicate notifications, and out-of-order successful charge notifications. Disputes are flagged for operator review.
- Same-origin checkout checks, request size limits, rate limiting, private file restrictions, and explicit test/live mode separation.

The receipt is a payment confirmation, not a tax invoice. Payment does not automatically provision an LMS account or course access; admissions handles cohort placement and access. No LMS or student authentication system currently exists in this project.

## Paystack setup

1. Use a **test secret key** from your Paystack dashboard in `PAYSTACK_SECRET_KEY`. No public key is needed for this hosted redirect integration.
2. Set `PUBLIC_URL` to the website's exact origin. Local default: `http://localhost:3000`. The API and frontend must share the same origin; deploy the payment app at the domain root.
3. Set `PAYMENT_CURRENCIES` to currencies activated on your Paystack account. USD prices default to the existing $100/$200/$500. **NGN has no production prices yet**. Add approved fixed prices as integer kobo in the three `PRICE_*_NGN` settings and add `NGN` to `PAYMENT_CURRENCIES` when ready. No automatic exchange rate is used. Browser-test naira prices are fixtures only, not business prices.
4. Set `TERMS_URL`, `PRIVACY_URL`, and `REFUND_URL` to your actual published HTTPS policy pages. Set `POLICY_VERSION` when policies change. Checkout stays disabled without the policies, a key, and at least one configured price.
5. Set the Paystack webhook URL to `https://YOUR-DOMAIN/api/paystack/webhook`. For local provider tests, use an HTTPS tunnel that forwards to this server and use the tunnel origin as `PUBLIC_URL`. Enable both test and live webhook settings in the respective Paystack modes.
6. In Paystack, configure customer receipts and merchant payment notifications. These emails are sent by Paystack; this app does not send its own emails. Refunds and disputes are managed in the Paystack dashboard, with updates reflected in local order records via webhooks.
7. Complete Paystack sandbox checks for success, failed payment, cancellation, repeat clicks, pending payments, refund, and webhook retries. Automated repository tests use an injected fake provider and do not prove that your merchant account accepts USD or has been activated.
8. For live use, supply the live key, use an HTTPS `PUBLIC_URL`, and set `ALLOW_LIVE_PAYMENTS=true`. The server refuses a live key without these settings. Confirm prices are the total amounts you intend to charge; this app does not calculate tax or add surcharges.

Nigeria-based businesses can accept USD only when their Paystack account has the required international/USD setup. Confirm eligibility and settlement details with [Paystack's international-payment guidance](https://support.paystack.com/en/articles/2130690). Integration follows [accept payments](https://paystack.com/docs/payments/accept-payments/), [verification](https://paystack.com/docs/payments/verify-payments/), [webhooks](https://paystack.com/docs/payments/webhooks/), and [refunds](https://paystack.com/docs/payments/refunds/).

## Operations and deployment

Deploy on a Node.js 24+ host with **persistent disk** for `DATABASE_PATH` (default `.data/enrollments.sqlite`), HTTPS, outbound access to `api.paystack.co`, and inbound Paystack webhooks. Set `HOST=0.0.0.0` if required by your host. Keep the database outside any independently served static directory. Back it up using SQLite-aware backups and restrict filesystem access: it contains student names, email addresses, enrollment details, and policy consent records. Define an appropriate retention process for these records.

Use one Node server instance with this SQLite implementation. Ephemeral/serverless filesystems and multiple horizontally scaled instances require a shared database and shared rate limiter before deployment. The built-in limiter deliberately uses the socket address rather than trusting spoofable proxy headers; configure per-client rate limiting at a trusted reverse proxy in production. Do not rewrite the Paystack webhook body before signature validation.

Operator commands (run privately on the server):

```text
node --env-file-if-exists=.env server/orders.cjs list
node --env-file-if-exists=.env server/orders.cjs show dera-REFERENCE
```

`list` shows the latest 100 orders and payment states. `show` displays enrollment details for admissions. Neither command exposes lookup tokens. To refund a payment, use its reference in the Paystack dashboard. If initialization timed out and no checkout URL can be recovered, inspect that reference in Paystack before requesting another payment. If a dispute is resolved, review it in Paystack and reconcile the local record through a controlled administrative process; the app intentionally does not automatically restore a disputed enrollment. If a webhook fails, retry it from the Paystack dashboard.

Receipts can be retrieved in the browser session that started checkout. Tokens are not placed in URLs, sent to Paystack, or exposed in logs. A different device or expired browser session needs admissions support using the Paystack reference. Starting another enrollment preserves earlier receipt tokens in that browser session.

## Tests

- `npm test`: backend tests for pricing, validation, consent, duplicate checkout, signatures, verification, refunds, persistence, and private file protection. No network payment requests.
- Install browser test tooling with `npm install --save-dev playwright` and `npx playwright install chromium`.
- `npm run test:payments:browser`: self-contained local server and simulated Paystack, covering Academy-to-checkout navigation, currencies, required consent, verified receipt, reload, private lookup, cancellation, provider errors, and mobile layout. **No real charges are made.**
- `npm run test:browser`: general site smoke checks against a running server. Set `BASE_URL=http://localhost:3000/` for the Node app; the older default is port 8765. Browser tests default to installed Edge; set `BROWSER_CHANNEL=chromium` to use Playwright's bundled Chromium.

## Frontend and other integrations

`components/` contains the shared header/footer. Pages retain fallback navigation if component loading fails. `js/main.js` implements the mobile menu, progressive reveals, and reduced-motion video handling. `js/programs.js` provides static display fallbacks; **server/config.cjs is authoritative for checkout prices**. The existing `deraedege-academy` spelling remains to preserve incoming URLs.

Contact and partnership forms prepare email drafts addressed to `info@deraedge.com`; visitors still need to send the draft. They do not automatically submit enquiries.

The Research Desk embeds TradingView's Market Overview for FOREX.com gold, EUR/USD, and NAS100 cash CFD quotes. It needs access to TradingView and its data hosts; a blocked connection shows a provider link. Feed delays and availability are controlled by TradingView. See the [widget docs](https://www.tradingview.com/widget-docs/widgets/watchlists/market-overview/) and [data FAQ](https://www.tradingview.com/widget-docs/faq/data/).
