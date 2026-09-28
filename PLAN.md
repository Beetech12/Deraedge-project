# Improvement plan

1. Repair navigation and program links while preserving existing edits.
2. Make shared components resilient and add keyboard-accessible mobile navigation.
3. Consolidate reveal behavior; keep content readable without JavaScript and respect reduced motion.
4. Extract page scripts, share program metadata, and validate all forms. Replace simulated submission with an explicitly configured delivery method.
5. Add focused regression checks for links, component failures, and form behavior; document local serving and deployment.

Completed: links, resilient components, mobile menu, progressive reveal effects, page-script extraction, shared metadata, native validation, and documented browser checks. The owner selected the email-draft fallback; forms explicitly require the visitor to send the draft and preserve entered details.

## Academy payments

Implemented Paystack hosted checkout for the Nigeria-based business, with authoritative server pricing, USD/NGN configuration, SQLite enrollment records, consent, private payment lookup, webhook signature and transaction verification, duplicate-checkout protection, cancellation recovery, printable receipts, and refund/dispute tracking. Contact and partnership retain email drafts; enrollment now uses payment checkout.

USD prices remain $100/$200/$500. NGN prices are intentionally unset until the owner supplies fixed amounts. Live activation requires the owner's Paystack key, account currency activation, published policy URLs, HTTPS hosting with persistent storage, and a configured webhook. No real charge or live deployment has been performed.

## Automatic customer messages

Contact and Partnership now review messages and submit directly to a server-side SMTP outbox addressed to okolochinedu10@gmail.com. Implemented validation, same-origin checks, fixed recipient, Reply-To, private status lookup, duplicate suppression, temporary-failure retries, and honest failure/uncertain-delivery states. SMTP credentials are required for activation; automated tests use a fake transport and do not send real mail.
