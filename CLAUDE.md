# ChicCanto - Project Context

## What is this?
ChicCanto is a digital scratch card platform sold on Etsy. Buyers activate a code online, configure their card, and share a recipient link. The recipient scratches to reveal the outcome in their browser. No app, no account.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (ES modules), no framework, no bundler
- **Backend**: Cloudflare Pages Functions (serverless, V8 isolates — NOT Node.js)
- **Storage**: Cloudflare Workers KV
- **Deployment**: git push to main triggers automatic Cloudflare Pages deploy. No build step.
- **Domain**: chiccanto.com (custom domain on Cloudflare Pages)

## Game Types
1. **match3** — 9 scratch tiles, match 3 icons to win a prize (the naughty cards). Code in `card.js`.
2. **message** — Single shaped scratch area hides a custom message. Code in `game-message.js`.
3. **sequential** — Multi-step scratch reveal. First product: gender-reveal1. Code in `game-message.js`. All product behaviour is config-driven via the `steps[]` array in `card-themes.js` — no JS changes needed for new sequential products.

All three types share the same frame: page backgrounds, header, activation/fulfillment flow.

## Product Mechanics (locked)
New products require only a new theme entry in `card-themes.js` plus design assets. No JS changes.
- **Themed cards** (match3 / message): fixed end-to-end config, buyer has minimal choices.
- **Sequential cards**: `steps[]` array drives the full multi-step flow generically.

## Key Files
| File | Purpose |
|------|---------|
| `public/assets/js/card.js` | Main card logic: boot, routing, match-3 game, export, FX, page theme |
| `public/assets/js/game-message.js` | message + sequential game module |
| `public/assets/js/card-themes.js` | Single source of truth for all card visuals and product config |
| `public/assets/js/config.js` | Prize tier mapping, scratch settings, tile path construction |
| `public/assets/js/scratch.js` | Canvas scratch interaction (foil, brush, threshold) |
| `public/assets/js/store.js` | Client storage adapter (localStorage + Cloudflare KV API) |
| `public/assets/js/redeem.js` | Activation page logic |
| `public/assets/js/fulfill.js` | Admin fulfilment page logic |
| `public/assets/css/base.css` | Global styles, color mode system, page backgrounds |
| `public/assets/css/card.css` | Card styles: scratch game, message card, sequential flow, FX |
| `functions/token/[token].js` | GET/PUT card record API |
| `functions/assign.js` | Admin: assign activation code to order |
| `functions/redeem.js` | Buyer: redeem activation code, create card tokens |
| `functions/auth.js` | Admin login/session |
| `functions/_lib/cards.js` | Shared backend helpers (token gen, setup key gen) |

## Current Products (all live)
| card_key | Type |
|----------|------|
| men-novice1 | match3 |
| men-advanced1 | match3 |
| women-novice1 | match3 |
| women-advanced1 | match3 |
| men-novice-birthday1 | match3 |
| women-novice-birthday1 | match3 |
| custom-card | message |
| gender-reveal1 | sequential |

## Known Open Bugs (do not fix until ordered)
- **isFinal hardcoded in `_onSeqStepScratched`** (~line 1398 of `game-message.js`): `const isFinal = stepIndex === 1`. Must be fixed before adding any sequential product with more than 2 steps.
- **Token PUT endpoint has no rate limiting.** Low severity.
- **Export DOM indexing in `_inlineStylesDeep` is fragile** to DOM order changes.

## Planned Work (do not start until ordered)
- **Make.com automation DONE** — Etsy Watch Shop Receipts triggers POST /assign. Email sent directly from /assign via Resend. Make.com scenario is 2 modules only.
- **isFinal fix in `_onSeqStepScratched`** (required before next sequential product).
- **Future**: scratch platform may move to `app.chiccanto.com` when a Shopify storefront takes `chiccanto.com` root. Requires adding `app.chiccanto.com` as a second custom domain on the Cloudflare Pages project and setting up path redirects for `/open/`, `/card/`, `/activate/` from `chiccanto.com`.

## Working Conventions
- **Uploaded zip = only source of truth.** Never use prior chat file versions.
- Read the zip before planning or writing any prompt.
- Deliver work as a single consolidated Claude Code prompt in plain text only — no markdown code blocks, no rendered HTML, no bullet points that break copy/paste.
- End every Claude Code prompt with: `git add -A && git commit -m "..." && git push origin main`
- Use `/effort medium` by default, `/effort high` for big changes.
- Plan before coding. No code until explicitly ordered.

## Security Rules
- `setup_key` never appears in recipient links.
- Sender-only fields (`configured`, `message`, `title`, `from_line`, `card_style`, `scratch_shape`, `language`, `gender`, `custom_message`, `due_month`) require valid setup key on PUT.
- Activation codes are locked to one `card_key` and one `order_id`.

## Environment
| Name | Type | Purpose |
|------|------|---------|
| CARDS_KV | KV binding | All persistent state |
| FULFILL_KEY | Secret | Admin password |
| FULFILL_SESSION_SECRET | Secret | HMAC key for session cookies |
| RESEND_API_KEY | Secret | Resend API key for transactional email |
