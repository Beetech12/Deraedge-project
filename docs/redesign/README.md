# Deraedge institutional redesign

Completed locally on October 2, 2026. Not deployed.

## Source material and architecture

Read the complete `DERAEDGE.COM LTD PROFILE DRAFT.docx` supplied in Downloads. The attached `Deraedge Financial Intelligence Homepage.png` is the design reference. Company positioning, mission, vision, eight disciplines, philosophy, legal notice, Academy curricula, benefits, durations and base USD prices were checked against the profile. No additional products, social accounts, returns or performance claims were added. Removed the unsupported “Most Chosen” program claim.

The ten pages are Home, Firm, Academy, Partnership, Contact, Enrollment, Payment Status, Terms, Privacy and Refund Policy. Header/footer are fetched by `js/components.js`; their loading failure and no-JavaScript navigation fallbacks remain.

The existing Node backend entry is `server/start.cjs`, using the request handler in `server/app.cjs`; Express remains an existing package dependency, with no framework migration. Vercel enters through `api/index.js` and `server/hosting.cjs`. PostgreSQL/Neon uses `server/postgres.cjs` and the existing schema; local development supports SQLite. Existing catalog, checkout, order verification, signed Paystack webhook, message queue and private message-status routes remain unchanged. Environment usage was inspected from source and `.env.example` variable names only; no secret values were copied into frontend files. Vercel configuration, database schema and payment provider logic were not modified.

## Files modified for this redesign

- `index.html`: new editorial homepage, preserved Research Desk and eight separate capability boxes.
- `components/header.html`, `components/footer.html`: navigation, brand lockup, programs/research/legal navigation and exact existing Important Notice.
- `css/home.css`: homepage sections, imagery, hero, responsive grids and restrained motion.
- `deraedge-firm/index.html`: editorial introduction, profile capabilities and philosophy.
- `deraedege-academy/index.html`: editorial image, shared styling, supported program badge; existing program/card/tab IDs preserved.
- `deraedge-partnership/index.html`: editorial introduction; application form unchanged.
- `deraedge-contact/index.html`: contact information first in DOM, form second; labels, validation hooks and review-before-send flow preserved.
- `deraedge-enroll/index.html`, `payment.html`, `terms.html`, `privacy.html`, `refund.html`: shared visual system and skip navigation.
- `js/main.js`: maintenance comments explaining tablet navigation and video fallback rules.
- `js/enroll.js`: customer-friendly unavailable-checkout message without operator diagnostics.
- `js/research-desk.js`: defer third-party widget until near viewport; copper chart styling. Real provider, symbols and error fallback retained.
- `scripts/build-static.cjs`: include WebP files in the existing public asset allowlist.
- `server/app.cjs`: serve `.webp` as `image/webp`; no API behavior changes.
- `tests/smoke.cjs`: scroll to Research Desk before testing its now-lazy widget.

Other existing uncommitted changes predate this redesign and were preserved. The old `css/page-backgrounds.css` and `css/responsive.css` remain on disk but are not loaded by the redesigned pages.

## Files created

- `css/institutional.css`: commented shared design system, components, form surfaces, inner-page treatments and responsive rules.
- `tests/redesign-browser.cjs`: all-page responsive, navigation, image, network, link, curriculum and reduced-motion checks.
- `asset/brand-mark.png`: smaller derivative of the existing logo.
- Six photo families: `asset/institution-{city,markets,energy,partnership,trader,exchange}.jpg`, `.webp`, and `-small.webp`.
- `docs/redesign/assets.json`: exact source URLs, creators, license and sizes.
- `docs/redesign/README.md`: this handoff; PNG browser screenshots in this directory are visual QA artifacts, not public assets.

## Assets and licenses

All six photographs and the reused city footage use the [Pexels License](https://www.pexels.com/license/), which permits website/commercial use and modification without mandatory attribution. The source pages and per-file byte sizes are in `assets.json`. Images illustrate market contexts; they do not imply endorsement, owned offices, employees, partners or performance. The screenshot itself is not sliced into production assets. Existing AI city assets remain on disk for history but are not used by the redesigned pages.

The active real city video is `asset/hero-finance.mp4`, **3,060,852 bytes**, with existing 146,144-byte desktop and 61,815-byte mobile posters. The six full-size WebP photos total 362,424 bytes. Each has a 480px mobile alternative and JPEG fallback. The optimized logo is 17,323 bytes.

## Design system

`--bg-dark: #071014`; `--bg-dark-soft: #0d171b`; `--surface-dark: #111c21`; `--background-light: #f4efe7`; `--background-cream: #faf7f1`; `--text-light: #f5f1e9`; `--text-dark: #171717`; `--text-muted: #65625d`; `--accent: #c88745`; `--accent-light: #e5ad70`; `--accent-ink: #97531e`. The darker copper is used for readable accent text on light sections. Borders use translucent white or black by surface.

Cormorant Garamond/Georgia editorial headings pair with Karla/Arial interface text. Fluid heading scales, a 1360px maximum container and 60–88px section spacing establish the shared rhythm. Gradients are limited to CTA buttons and media readability overlays. Styles, HTML section boundaries, media logic and checks include maintenance comments.

## Responsive, performance and accessibility

- Deliberate desktop, laptop, tablet and phone rules. Tablet menu at 960px and below; two/three/six-column capability indicators; 4/2/1 discipline cards; program cards adapt independently of desktop; all forms stack on phones.
- Visible keyboard focus, skip-to-main links, one H1 per page, labeled controls, retained ARIA statuses, correct menu state/Escape handling and larger touch controls.
- Reduced-motion disables reveals/transitions and background video. No-JavaScript content/navigation fallback remains visible.
- Locally hosted responsive WebP/JPEG assets with explicit dimensions, lazy loading and async decoding. No new frontend framework or dependency.
- `preload="none"`, poster-first, silent inline looping video, paused when offscreen/hidden, with user pause/play. Mobile, reduced-motion, Save-Data and 3G/slow links request no MP4.
- Third-party TradingView script starts only near the Research Desk. Real quotes are not replaced with invented values when unavailable.
- Existing review-before-send remains in Contact and Partnership. No new unsupported subject field or newsletter signup was introduced.

## Validation and second refinement pass

- `npm test`: **31/31 passed**, covering payment validation, idempotency, signed webhooks, refunds, database persistence, PostgreSQL/Vercel behavior, private files, message queues and SMTP behavior.
- `tests/payment-browser.cjs`: passed USD/NGN display, consent/validation, hosted redirect, verified receipt, recovery, timeout, unavailable checkout and mobile layout with a fake provider. No real charges.
- `tests/message-browser.cjs`: both forms passed review/edit/send, preserved input, delivery status, duplicate prevention, reload and failure paths with mock transport. No real emails.
- `tests/smoke.cjs`: passed main-page links, menu, program selection, form review, failed component loads, reduced motion and no-JavaScript fallbacks.
- `tests/redesign-browser.cjs`: all ten pages at **320, 390, 768, 1024 and 1440px**, no horizontal overflow; **51 local links**, expected curriculum counts **11/12/13**, no page JavaScript errors or failed local network responses; images decoded successfully.
- Media checks: normal desktop playback/pause/resume; no video request in reduced-motion, mobile, Save-Data or slow-network modes; lazy widget failure fallback verified.
- Desktop and mobile screenshots inspected. Second pass widened the content container, reduced oversized spacing, aligned program cards, refined image crops, differentiated exchange imagery, improved checkout failure copy and corrected no-JavaScript navigation contrast.
- Static build passed. Public output continues to exclude server files, data and environment files.

Browser checks used an isolated preview on `http://localhost:3100` with an in-memory database and no live providers. Functional payment/email tests use mock providers. Production credentials, live charging and actual email delivery were not exercised. Remote fonts and TradingView were blocked during deterministic tests, so screenshots use font fallbacks and the chart fallback state.

## Remaining differences from the reference

The reference combines multiple sections side-by-side in one design board; the implementation is a continuous, responsive website. It uses licensed real photography and real Times Square footage instead of the reference's bespoke office scene, globe composite, handshake and branded building. The original Deraedge logo is retained. All **three** profile programs are shown (the reference shows only two cards). Eight capability boxes and the existing Research Desk are retained below the principal editorial sections. No unsupported search, social accounts or newsletter subscription was added. Deployment is still a separate action.
