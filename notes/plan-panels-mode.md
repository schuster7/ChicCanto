# Plan: Panels message-mode and baby-name1 product

## Overview

Add a fourth `messageMode` called `panels` under `gameType: 'message'`. The mechanic is a row of small foil scratch tiles, each hiding one character of a short word/name. After all non-space tiles are scratched, the characters animate into a centered wordmark with a subtitle and from-line, followed by a Continue button leading to a share screen with JPEG export.

First product: `baby-name1` (baby name reveal card), a natural cross-sell to `gender-reveal1`.

---

## File-by-file change list

### 1. `public/assets/js/game-message.js`

**New import:** None needed — `attachScratchTile`, `getCardTheme`, `getSeqStepConfig`, `store.*`, `copyText` are already imported. Add import for the new `getPanelsConfig` from `card-themes.js`.

**Modified line 7:**
```js
import { getCardTheme, getResolvedMsgTheme, getSeqStepConfig, getPanelsConfig } from './card-themes.js';
```

**Branching in existing exported functions (3 changes):**

1. `renderMessageSetup` (~line 88): Add `else if (baseTheme.messageMode === 'panels')` branch before the existing freetext path, delegating to `_renderPanelsSetup(root, card, container, { previewMode })`.

2. `renderMessageScratch` (~line 519): Add `else if (theme.messageMode === 'panels')` branch, delegating to `_renderPanelsScratch(root, card)`.

3. `renderMessageRevealed` (~line 779): Add `else if (theme.messageMode === 'panels')` branch, delegating to `_renderPanelsRevealed(root, card)`.

**New private functions (appended below sequential section, ~after line 2063):**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `_renderPanelsSetup` | `(root, card, container, { previewMode })` | Sender setup: gender picker (if theme.genderVariants), panel word input, subtitle input, from-line input, Try scratch / Confirm buttons, post-configure share UI |
| `_renderPanelsScratch` | `(root, card)` | Recipient scratch: title, panels row of foil tiles, reveal animation, Continue button |
| `_renderPanelsRevealed` | `(root, card)` | Returning visitor: wordmark + subtitle + from-line + Share button |
| `_renderPanelsShareScreen` | `(root, card)` | Post-reveal share screen with Save/Share buttons |
| `_onPanelTileScratched` | `(root, card, tileIndex, totalNonSpace)` | Per-tile scratch handler: persist progress, check completion, fire reveal |
| `_panelsRevealAnimation` | `(root, card, theme, resolved)` | Orchestrates fade-out + converge + subtitle/from fade-in + Continue |
| `_exportPanelsStacked` | `(card, recipientMessage, returnBlob)` | 1080x1350 JPEG export |
| `_panelsShare` | `(card, recipientMessage, btn)` | Web Share API / download helper |
| `_openPanelsPreviewModal` | `(fakeCard)` | Sender "Try scratch yourself" modal |
| `_titleCase` | `(str)` | Helper: lowercases then Title Cases a string |

### 2. `public/assets/js/card-themes.js`

**New theme entry `'baby-name1'`** added after the `'gender-reveal1'` entry:

```js
'baby-name1': {
  key: 'baby-name1',
  gameType: 'message',
  messageMode: 'panels',
  presentation: 'fullscreen',
  colorMode: 'light',
  genderVariants: true,
  defaultGender: 'neutral',

  // Sender UI labels
  panelLabel: 'Baby name',
  panelPlaceholder: 'e.g. OLIVER',
  panelMaxLength: 12,
  panelAllowedPattern: /^[\p{L}\s\p{M}]*$/u,

  // Tile / wordmark typography
  panelCharFont: "'Dancing Script', cursive",
  panelCharWeight: 500,
  panelCharColor: {
    neutral: '#8a7a6a',
    boy: '#445f75',
    girl: '#6d3f64',
  },

  // Title (above tiles)
  titleText: 'Guess the name',
  titleFont: "'Dancing Script', cursive",
  titleWeight: 400,
  titleColor: {
    neutral: '#8a7a6a',
    boy: '#445f75',
    girl: '#6d3f64',
  },

  // Accent (buttons, wordmark)
  accentColor: {
    neutral: '#8a7a6a',
    boy: '#445f75',
    girl: '#6d3f64',
  },

  // Message font (subtitle / custom_message)
  messageFont: "'Dancing Script', cursive",
  messageWeight: 400,

  // Foil (same neutral aesthetic as gender-reveal1)
  foil: 'neutral',
  foilBase: '#c8bfb4',
  foilHi:   '#d8d0c6',
  foilMid:  '#c0b8ac',
  foilDark: '#b8b0a4',
  foilText: 'rgba(80,65,50,0.45)',

  // Backgrounds — PLACEHOLDER: copied from gender-reveal1, swap before going live
  thumbSrc: '/assets/cards/baby-name1/thumb.jpg',
  bgDesktopSrc: '/assets/cards/baby-name1/bg-desktop.jpg',
  bgMobileSrc: '/assets/cards/baby-name1/bg-mobile.jpg',
  bgVariants: {
    neutral: {
      desktop: '/assets/cards/baby-name1/bg-desktop.jpg',
      mobile: '/assets/cards/baby-name1/bg-mobile.jpg',
    },
    boy: {
      desktop: '/assets/cards/baby-name1/boy/bg-desktop.jpg',
      mobile: '/assets/cards/baby-name1/boy/bg-mobile.jpg',
    },
    girl: {
      desktop: '/assets/cards/baby-name1/girl/bg-desktop.jpg',
      mobile: '/assets/cards/baby-name1/girl/bg-mobile.jpg',
    },
  },

  // Page theme (light, matches gender-reveal1 palette)
  pageBg:  '#fcf8f5',
  pageBg1: '#fcf8f5',
  pageGlowA1: 'rgba(252,248,245,0)',
  pageGlowA2: 'rgba(252,248,245,0)',
  pageGlowA3: 'rgba(252,248,245,0)',
  pageGlowB1: 'rgba(252,248,245,0)',
  pageGlowB2: 'rgba(252,248,245,0)',
},
```

**New export function `getPanelsConfig`:**

```js
export function getPanelsConfig(card_key, gender) {
  const theme = getCardTheme(card_key);
  if (!theme || theme.messageMode !== 'panels') return null;

  const g = gender || theme.defaultGender || 'neutral';

  const resolve = (val) => {
    if (!val) return null;
    if (typeof val === 'object' && !Array.isArray(val)) return val[g] || val.neutral || val.boy || null;
    return val;
  };

  // Resolve background from bgVariants (gender-keyed) falling back to theme root
  const variant = theme.bgVariants && theme.bgVariants[g];
  const bgDesktopSrc = (variant && variant.desktop) || theme.bgDesktopSrc || '';
  const bgMobileSrc = (variant && variant.mobile) || theme.bgMobileSrc || bgDesktopSrc;

  return {
    ...theme,
    bgDesktopSrc,
    bgMobileSrc,
    panelCharColor: resolve(theme.panelCharColor),
    titleColor: resolve(theme.titleColor),
    accentColor: resolve(theme.accentColor),
    _gender: g,
  };
}
```

### 3. `functions/token/[token].js`

**In `applyAllowedUpdates`, add `panel_text` to sender-only fields (after `due_month` block, ~line 134):**

```js
if ('panel_text' in body) {
  next.panel_text = (body.panel_text == null) ? null : String(body.panel_text).slice(0, 32);
}
```

No other backend changes. `scratched_indices` and `revealed` are already recipient-writable.

### 4. `public/assets/js/store.js`

**In `setConfiguredAndWait` (~line 398):** Add `panel_text` to the list of fields persisted:

```js
if (panel_text !== undefined) card.panel_text = panel_text;
```

And add `panel_text` to the function's destructured parameter list.

No other store.js changes. `saveCard` already handles any fields on the card object.

### 5. `functions/assign.js`

**In `cardKeyToCodePrefix` MAP (~line 59), add:**

```js
'baby-name1': 'CC-NAME1',
```

### 6. `public/fulfill/index.html`

**In the `<select id="cardKey">` element (~line 46), add after the Gender Reveal option:**

```html
<option value="baby-name1">Baby name reveal</option>
```

### 7. `public/open/index.html`

**In the `getFlavour` function (~line 170), add before the final return:**

```js
if (card_key === 'baby-name1') return "They are revealing a special name";
// NOTE: the existing check for card_key === 'gender-reveal' is a pre-existing bug
// since the real key is 'gender-reveal1', but we are not fixing it in this change.
```

### 8. `public/assets/css/card.css`

**Append a new `/* ── Panels mode ── */` section at the end of the file with these classes:**

| Class | Purpose |
|-------|---------|
| `.cc-panels-wrapper` | Fullscreen wrapper (uses existing `has-fullscreen-card` body pattern) |
| `.cc-panels-row` | CSS grid container for tiles. `grid-template-columns: repeat(auto-fit, minmax(0, 1fr))`, max 10 per row, wraps to 2 rows above 10 |
| `.cc-panels-tile` | Individual tile. Aspect 3/4 portrait. Position: relative. Overflow: hidden |
| `.cc-panels-char` | Character under foil. Absolutely positioned at center. Uses CSS vars `--panel-char-font`, `--panel-char-color`, `--panel-char-weight` |
| `.cc-panels-title` | Title element above tiles |
| `.cc-panels-wordmark` | Centered wordmark for post-reveal. Uses same CSS vars |
| `.cc-panels-subtitle` | Subtitle below wordmark |
| `.cc-panels-fromline` | From-line below subtitle |
| `.cc-panels-continue` | Continue button wrapper (reuses `seq-continue-wrap` pattern) |
| `.cc-panels-space` | Visible blank gap for space characters (no tile, just gap width) |

CSS variables for theming:
```css
.cc-panels-wrapper {
  --panel-char-font: var(--panels-char-font, 'Dancing Script', cursive);
  --panel-char-color: var(--panels-char-color, #8a7a6a);
  --panel-char-weight: var(--panels-char-weight, 500);
  --panel-accent: var(--panels-accent, #8a7a6a);
}
```

Mobile-first. On mobile (max-width: 699px), tiles scale down, fullscreen via existing `has-fullscreen-card` body class pattern. Tile width calculated from available width divided by character count with min/max bounds.

### 9. Asset directories

**Create `public/assets/cards/baby-name1/` with:**

```
baby-name1/
  thumb.jpg          (copy from gender-reveal1/thumb.jpg)
  bg-desktop.jpg     (copy from gender-reveal1/bg-desktop.jpg)
  bg-mobile.jpg      (copy from gender-reveal1/bg-mobile.jpg)
  boy/
    bg-desktop.jpg   (copy from gender-reveal1/step2-boy/bg-desktop.jpg)
    bg-mobile.jpg    (copy from gender-reveal1/step2-boy/bg-mobile.jpg)
  girl/
    bg-desktop.jpg   (copy from gender-reveal1/step2-girl/bg-desktop.jpg)
    bg-mobile.jpg    (copy from gender-reveal1/step2-girl/bg-mobile.jpg)
  neutral/
    bg-desktop.jpg   (copy from gender-reveal1/bg-desktop.jpg)
    bg-mobile.jpg    (copy from gender-reveal1/bg-mobile.jpg)
```

All are placeholder copies from gender-reveal1. A comment in card-themes.js flags them.

---

## Sender setup UI detail

Fields in order:
1. **Gender variant picker** (only when `theme.genderVariants` is true): Boy / Girl buttons, identical emoji+label component to the sequential gender picker (`seq-gender-btn` pattern). When genderVariants is false, the picker is omitted and the theme uses `defaultGender` ('neutral').
2. **Panel word input**: `<input>` labelled from `theme.panelLabel` ("Baby name"), placeholder from `theme.panelPlaceholder` ("e.g. OLIVER"), `maxlength` from `theme.panelMaxLength` (12). Real-time character counter. Validation via `theme.panelAllowedPattern` — letters and spaces only, lowercased then Title Cased on save.
3. **Subtitle input**: Maps to `custom_message`, max 60 chars, same counter style as sequential.
4. **From input**: Maps to `from_line`, max 40 chars.
5. **Try scratch yourself** and **Confirm & create link** buttons. Double-confirm behavior copied from existing freetext/sequential flows. Disabled state until panel word has >= 2 characters and, if genderVariants is true, a gender is selected.

Post-configure: renders share UI block with Copy/Share buttons identical to sequential configured view.

**Confirm saves these fields via `setConfiguredAndWait`:**
- `panel_text` (Title Cased panel word)
- `gender` (if genderVariants)
- `custom_message` (subtitle, nullable)
- `from_line` (nullable)
- `configured: true`

---

## Recipient scratch UI detail

1. Uses same fullscreen wrapper pattern as sequential (`has-fullscreen-card` body class).
2. Title element populated from `theme.titleText` ("Guess the name"), styled with resolved `titleColor` and `titleFont`.
3. Panels row: one tile per character of `card.panel_text`. Spaces render as `.cc-panels-space` (visible blank gap, same width as a tile but no foil/canvas). Each non-space tile is a fixed 3:4 portrait element with a foil canvas covering a single large character underneath.
4. Character under foil: uses resolved `panelCharFont`, `panelCharColor`, `panelCharWeight`, scales to fit tile via `font-size: clamp(...)`.
5. Each tile wires `attachScratchTile` from `scratch.js` with `onScratched` callback that:
   - Writes that tile's index to `card.scratched_indices`
   - Calls `saveCard` (debounced via existing fire-and-forget pattern)
   - Checks if all non-space indices are present in `scratched_indices`
6. When all non-space indices are scratched, fire the reveal sequence.

**Reveal sequence timing:**
- t=0: All tiles fade to opacity 0 over 500ms
- t=500: Tiles are `display:none`. Characters appear at their tile positions as free-standing elements
- t=600: Characters animate from tile positions to a single centered wordmark using CSS `transform: translate(...)` with `transition: 700ms ease`
- t=1300: Wordmark element visible at center, transitions done
- t=1600: Subtitle (`card.custom_message`) fades in over 300ms
- t=1800: From-line (`card.from_line`) fades in over 200ms
- t=2400: Continue button appears, styled with resolved `accentColor`
- On Continue click: persists `revealed: true` via `setRevealedAndWait`, then renders `_renderPanelsShareScreen`

**Resume handling:** If `card.revealed` is already true on first render, skip scratch UI and go straight to `_renderPanelsRevealed`. If `card.scratched_indices` has partial progress, force-reveal those tiles on render so progress is preserved across page refreshes.

---

## Revealed (returning visitor) detail

Identical to the post-reveal state of the scratch UI minus the scratched tiles:
- Wordmark centered (panel_text, full word, styled)
- Subtitle (custom_message, if present)
- From-line (from_line, if present)
- "Share this card" button that triggers the JPEG export
- No Continue button

---

## Share screen and JPEG export detail

**Share screen:** Reuses gender reveal share screen visual pattern. Background from resolved gender variant. Wordmark centered. Subtitle. Optional recipient message textarea (with emoji picker, same as sequential). Save as image and Share buttons via `#cardActions`.

**JPEG export (`_exportPanelsStacked`):** 1080x1350.
- Background: resolved `bgMobileSrc` cover-filled (gender-variant bg when applicable)
- Wordmark: centered at ~45% vertical, `panelCharFont`, resolved `panelCharColor`
- Subtitle: below wordmark, `messageFont` or Inter
- Optional recipient message: frosted white panel (same as sequential export)
- ChicCanto white logo pinned bottom 60px (same as sequential)
- Filename: `baby-name-{gender}.jpg`

---

## Backend field additions

### `functions/token/[token].js` — `applyAllowedUpdates`

Add `panel_text` as a sender-writable field:

```js
// Panels mode fields (sender-only).
if ('panel_text' in body) {
  next.panel_text = (body.panel_text == null) ? null : String(body.panel_text).slice(0, 32);
}
```

Validation: string, sliced to 32 chars, null accepted. Whitespace normalization is client responsibility. `gender` is already handled. `custom_message` and `from_line` are already handled. `scratched_indices` and `revealed` are already recipient-writable. No other new fields needed.

### `store.js` — `setConfiguredAndWait`

Add `panel_text` to the destructured param and the persistence block:

```js
// In parameter list:
{ ..., panel_text }

// In body:
if (panel_text !== undefined) card.panel_text = panel_text;
```

---

## Decisions made (ambiguity log)

1. **Neutral gender variant for preview:** When `genderVariants: true` but no gender selected yet (preview/setup), use `defaultGender: 'neutral'` which maps to the root-level bg images and a neutral cream accent. This avoids forcing a selection before preview works.

2. **Character convergence animation:** Using JS-calculated CSS transforms rather than FLIP or Web Animations API. Each character gets `position: absolute` with coordinates matching its tile position, then transitions to the wordmark center. Simpler, no dependencies, works with existing patterns.

3. **Tile layout:** CSS grid with `repeat(auto-fit, ...)` for up to 10 tiles per row. For names >10 chars, wrap to second row. This handles the full range of panelMaxLength=12 cleanly.

4. **Tile scratch threshold:** Reusing the existing `SCRATCH_THRESHOLD` (0.55) from `config.js` via `attachScratchTile`. No per-tile threshold override needed since the tiles are small and 55% scratch feels natural.

5. **Scratch hint style:** Using `'thin'` (matching sequential/message cards) rather than the default bold `'scratch'` text, since tiles are small.

6. **Debounce strategy for scratched_indices:** Using the same fire-and-forget `saveCard` pattern the sequential mode uses for `_persistSeqStep` — immediate local write, async API fire-and-forget. No explicit debounce timer needed since `saveCard` already batches optimistically.

7. **No new store.js functions:** `saveCard` already persists any fields on the card object. `setRevealedAndWait` already handles the reveal flow. Only `setConfiguredAndWait` needs `panel_text` added to its parameter list and body.

8. **Title casing:** Implemented client-side via a `_titleCase` helper that lowercases then capitalizes the first letter of each word. Applied on confirm save, not on every keystroke. The raw input shows as-typed.

9. **Export shares sequential's visual language** (frosted panel, bottom logo, cover bg) rather than inventing new patterns. This keeps the product family cohesive and reuses proven code.

10. **No `language` field for baby-name1:** Unlike gender-reveal1, baby-name1 has no multi-language support in v1. The name is user-supplied, the title and UI text are English-only. Can be added later if needed.

11. **panelAllowedPattern stored as regex in theme:** Since this is a code-only config (not serialized to JSON/KV), storing as a RegExp literal in card-themes.js is fine. The pattern `/^[\p{L}\s\p{M}]*$/u` allows Unicode letters, spaces, and combining marks.

12. **Tile canvas vs div foil:** Using `attachScratchTile` (canvas-based) per tile, same as all other scratch surfaces. Each tile gets its own canvas. This is proven reliable even with 12 small canvases on mobile.

13. **Space handling:** Spaces in the name render as `.cc-panels-space` elements — visible gaps the same width as a tile but without foil/canvas. Not included in `scratched_indices` tracking. This makes "MARY ANN" render cleanly as two visual word groups.

---

## Manual QA checklist

### Sender setup
- [ ] Open sender link for baby-name1 card
- [ ] Gender picker renders with Boy/Girl buttons and emoji
- [ ] Gender picker toggles correctly, active state matches sequential
- [ ] Panel word input accepts letters and spaces, rejects numbers/symbols
- [ ] Character counter updates in real time
- [ ] Short name (2 chars, e.g. "Al") — Confirm button enables
- [ ] Long name (10+ chars, e.g. "Alessandra") — tiles lay out cleanly, no overflow
- [ ] Name with spaces (e.g. "Mary Ann") — spaces render as gaps, not tiles
- [ ] Confirm button disabled until gender selected AND name >= 2 chars
- [ ] If genderVariants is false (future product), gender picker hidden, Confirm enabled with just name
- [ ] Subtitle input works, character counter shows, maps to custom_message
- [ ] From input works, character counter shows, maps to from_line
- [ ] "Try scratch yourself" button opens preview modal
- [ ] Preview modal renders tiles correctly, scratch works, reveal animation fires
- [ ] Preview modal close button and backdrop click work, CSS state restored
- [ ] Double-confirm flow: first click shows "Are you sure?", second click saves
- [ ] After confirm: share UI shows with Copy/Share buttons
- [ ] Copy button copies recipient link, shows "Copied!"
- [ ] Share button triggers Web Share API or fallback copy

### Recipient scratch
- [ ] Open recipient link (no setup key in URL)
- [ ] Title "Guess the name" renders with correct font/color
- [ ] Correct number of tiles renders (one per non-space character)
- [ ] Spaces render as visible gaps
- [ ] Foil renders on each tile with sheen animation
- [ ] Scratching a tile reveals the character underneath
- [ ] Characters use correct font/color/weight from theme
- [ ] Partial scratch progress persists across page refresh
- [ ] Scratching all tiles fires reveal animation:
  - [ ] Tiles fade out (500ms)
  - [ ] Characters converge to center wordmark (700ms)
  - [ ] Subtitle fades in (300ms after wordmark settles)
  - [ ] From-line fades in (200ms after subtitle)
  - [ ] Continue button appears (600ms after from-line)
- [ ] Continue button click persists revealed=true and renders share screen

### Share screen
- [ ] Share screen renders with correct gender-variant background
- [ ] Wordmark centered and styled correctly
- [ ] Subtitle and from-line render if present
- [ ] Recipient message textarea works with emoji picker
- [ ] "Save as image" downloads 1080x1350 JPEG
- [ ] JPEG contains: bg, wordmark, subtitle, recipient message panel, logo
- [ ] "Share" button uses Web Share API with JPEG file

### Returning visitor
- [ ] Opening recipient link after reveal shows revealed state directly
- [ ] Wordmark, subtitle, from-line render without animation
- [ ] "Share this card" button triggers JPEG export

### Returning sender
- [ ] Opening setup link after configure shows share UI
- [ ] Copy and Share buttons work

### Fulfill page
- [ ] Card type dropdown shows "Baby name reveal" option
- [ ] Selecting it and assigning generates CC-NAME1-XXXXXXXX code

### assign.js
- [ ] API generates code with CC-NAME1 prefix

### Open page
- [ ] Flavour text shows "They are revealing a special name" for baby-name1

---

## Non-goals (explicitly excluded)

- Do not touch the `isFinal` hardcode in `game-message.js` line 1398
- Do not add token PUT rate limiting
- Do not refactor `card.js` or split `game-message.js`
- Do not modify `/open/` page beyond the flavour line addition
- No new dependencies, no build step
- No changes to `config.js`, `scratch.js`, or `base.css`
