# ChicCanto - Project Context

## What is this?
ChicCanto is a digital scratch card platform sold on Etsy. Buyers purchase physical scratch cards that include an activation code. The code unlocks a digital card experience: the buyer configures it (picks a prize or writes a message), shares a link, and the recipient scratches to reveal the outcome in their browser.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (ES modules), no framework, no bundler, no npm dependencies for frontend
- **Backend**: Cloudflare Pages Functions (serverless, V8 isolates — NOT Node.js)
- **Storage**: Cloudflare Workers KV (eventually consistent key-value store)
- **Deployment**: Git push to main → automatic Cloudflare Pages deploy. No build step.
- **Static hosting**: `public/` directory served as-is

## Game Types
1. **match3** — 9 scratch tiles, match 3 icons to win a prize (the "naughty" cards). Code lives in `card.js`.
2. **message** — Single heart-shaped scratch area hides a custom message. Code lives in `game-message.js`.

Both game types share the same frame: page backgrounds, header, export pipeline, border FX, activation/fulfillment flow.

## Folder Structure
```
public/assets/cards/
  naughty/          # Match-3 naughty scratch cards
    {card_key}/     # Each card is self-contained
      bg-desktop.jpg
      bg-mobile.jpg
      title.svg
      thumb.jpg
      tiles/        # Prize icons for this card
        blowjob.svg, handjob.svg, etc.
  custom/           # Message-reveal cards
    heart-gold/
      bg-desktop.jpg
      bg-mobile.jpg

public/assets/img/
  masks/            # Shared scratch area shapes
    heart.svg
  logo1.svg
  brush.png
  noise.png
```

## Key Files
| File | Purpose |
|------|---------|
| `public/assets/js/card.js` | Main card logic — frame (boot, routing, export, FX, page theme) + match-3 game |
| `public/assets/js/game-message.js` | Message-reveal game module |
| `public/assets/js/card-themes.js` | Per-card visual config: backgrounds, prizes, page themes, game type |
| `public/assets/js/config.js` | Prize tier mapping, scratch settings, tile path construction |
| `public/assets/js/scratch.js` | Generic canvas scratch interaction (foil, brush, threshold) |
| `public/assets/js/store.js` | Client storage adapter (localStorage + API) |
| `public/assets/js/redeem.js` | Activation page logic |
| `public/assets/js/fulfill.js` | Admin fulfillment page logic |
| `public/assets/js/landing.js` | Landing page animation |
| `public/assets/css/base.css` | Global styles, page backgrounds, layout |
| `public/assets/css/card.css` | Card-specific styles: scratch game, message card, FX |
| `functions/token/[token].js` | GET/PUT card record API |
| `functions/assign.js` | Admin: assign activation code to order |
| `functions/redeem.js` | Buyer: redeem activation code, create card tokens |
| `functions/auth.js` | Admin login/session |

## Non-Negotiables
- **Uploaded zip = source of truth.** Never assume file contents from memory.
- **Full file delivery as .txt with timestamp filenames** (e.g., `card.js_20260315-150000.txt`), never diffs unless asked.
- **Regression prevention**: Confirm all existing features work before delivering core files.
- **Include exact git commands** with every delivery.
- **Security rules**: setup_key never in recipient links, sender-only fields require setup key on PUT, activation codes locked to card_key.

## Card Theme System
Each card type is a key in `card-themes.js`. The theme controls:
- `gameType`: 'match3' (default) or 'message'
- Background images, title SVG, thumbnail
- Page background colors (CSS custom properties on `<html>`)
- Legend panel styling (match-3 only)
- Prize options and tile icons (match-3 only)
- Scratch mask, message config (message cards only)
- Foil style: 'gold' or 'silver'

Adding a new card = new theme entry + design assets. No code changes.

## Per-Card Page Backgrounds
CSS custom properties on `:root` in `base.css`:
`--page-bg`, `--page-bg1`, `--page-glow-a1/a2/a3`, `--page-glow-b1/b2`, `--page-glow-a-opacity`, `--page-glow-b-opacity`
Set by `applyPageTheme()` in `card.js` from theme values. Body gradient and animated glow layers reference these.

## Export Pipeline (match-3 only, not used for message cards)
Background JPEG fetched → painted on canvas → SVG foreignObject overlay → ChicCanto logo at top → promo text at bottom → JPEG at 0.92 quality. Per-card `pageBg` used for padding color.

## Testing
- Local: `npx serve public` (static only, no backend)
- Preview mode: `/card/?preview` (match-3) or `/card/?preview&card_key=custom-card1` (message)
- Mobile via LAN: `http://192.168.0.48:3000`
- Backend requires live deployment (Cloudflare Pages Functions + KV)

## Environment
| Name | Type | Purpose |
|------|------|---------|
| CARDS_KV | KV binding | All persistent state |
| FULFILL_KEY | Secret | Admin password |
| FULFILL_SESSION_SECRET | Secret | HMAC key for session cookies |