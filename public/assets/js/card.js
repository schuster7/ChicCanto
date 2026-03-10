import { qs, qsa, copyText, formatIso, getTokenFromUrl } from './utils.js';
import { getRevealOptions, RANDOM_KEY, tierIconSrc, setTileSet } from './config.js';
import { getCardTheme } from './card-themes.js';
import { getCard, getCardAsync, ensureCard, saveCard, setConfigured, setConfiguredAndWait, setRevealed, setRevealedAndWait } from './store.js';
import { attachScratchTile } from './scratch.js';

function isLikelyInAppBrowser(){
  const ua = navigator.userAgent || '';
  // Heuristic: FB/IG/Messenger in-app browsers usually expose these tokens.
  return /(FBAN|FBAV|FB_IAB|FB4A|FBMD|Instagram|Messenger)/i.test(ua);
}

function isMobileOrTablet(){
  const ua = navigator.userAgent || '';
  // Coarse filter: only gate on handheld devices.
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

function renderInAppBlocked(container, token){
  const origin = window.location.origin;
  const cardUrl = makeAbsoluteCardLink(token);

  container.innerHTML = `
    <main class="page-main">
      <div class="container">
        <section class="flow-screen">
          <div class="flow-layout">
            <div class="flow-intro">
              <h1 class="flow-title">Open in your browser</h1>
              <p class="flow-lead muted panel-meta">
                This chat app is opening the card inside an in-app browser. That can reset the card while scratching.
                Copy the link and open it in your phone’s browser.
              </p>
            </div>

            <section class="flow-panel--combined panel panel--glass panel--padded" aria-label="Open in browser">
              <div class="panel-meta">
                <div>Step 1</div>
                <div class="flow-panel__hint">Copy the link</div>
              </div>

              <div class="control-grid">
                <div class="field">
                  <label class="label" for="cardLink">Card link</label>
                  <input class="input" id="cardLink" readonly type="text" value="${cardUrl}" />
                </div>

                <div class="actions">
                  <button class="btn primary" id="copyLinkBtn" type="button">Copy link</button>
                </div>

                <div class="muted small" style="margin-top: 2px;">
                  Use the <strong>…</strong> menu in your chat app and choose <strong>Open in browser</strong> (or similar).
                  If you can’t find that option, paste the copied link into your browser.
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  `;

  const copyBtn = container.querySelector('#copyLinkBtn');
  const input = container.querySelector('#cardLink');
  if (copyBtn && input){
    copyBtn.addEventListener('click', async () => {
      try{
        await navigator.clipboard.writeText(cardUrl);
        copyBtn.textContent = 'Copied';
        setTimeout(() => (copyBtn.textContent = 'Copy link'), 1200);
      }catch{
        input.focus();
        input.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied';
        setTimeout(() => (copyBtn.textContent = 'Copy link'), 1200);
      }
    });
  }
}


// --- Patch: ensure "configured" persists so share links work ---
// Some flows update choice/reveal_amount but forget to flip card.configured.
// This helper force-merges the configured state into localStorage for the current token.
function _scStorageKey(token){
  return `sc:card:${token}`;
}

function _forcePersistConfiguredCard(token, nextCard){
  try{
    const key = _scStorageKey(token);
    const raw = localStorage.getItem(key);
    if(raw){
      try{
        const obj = JSON.parse(raw);
        if(obj && typeof obj === 'object' && obj.card && typeof obj.card === 'object'){
          localStorage.setItem(key, JSON.stringify({ ...obj, card: { ...obj.card, ...nextCard } }));
          return;
        }
        if(obj && typeof obj === 'object'){
          localStorage.setItem(key, JSON.stringify({ ...obj, ...nextCard }));
          return;
        }
      }catch(_e){}
    }
    localStorage.setItem(key, JSON.stringify({ ...nextCard }));
  }catch(_e){
    // Ignore storage failures (private mode/quota/etc.)
  }
}
// --- End patch ---


// Inline SVG support (for reliable rendering/export and consistent sizing)
const _INLINE_SVG_CACHE = new Map();

// Token format validation (keeps obviously invalid links from depending on API reachability)
// Supported formats: short (8-4 hex) and full UUID.
const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Global flag: public preview mode (scratch-only, no share links).
let PREVIEW_MODE = false;


// --- UX helpers: toast + safe copy/share (iPhone friendly) ---
let _toastTimer = null;
function toast(message){
  try{
    let el = document.getElementById('appToast');
    if (!el){
      el = document.createElement('div');
      el.id = 'appToast';
      el.style.position = 'fixed';
      el.style.left = '50%';
      el.style.bottom = '18px';
      el.style.transform = 'translateX(-50%)';
      el.style.zIndex = '9999';
      el.style.maxWidth = '92vw';
      el.style.padding = '10px 12px';
      el.style.borderRadius = '12px';
      el.style.background = 'rgba(0,0,0,0.85)';
      el.style.color = '#fff';
      el.style.fontSize = '14px';
      el.style.lineHeight = '1.2';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.style.transition = 'opacity 160ms ease';
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    // force reflow for transition reliability
    void el.offsetHeight;
    el.style.opacity = '1';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 1600);
  }catch{
    // no-op
  }
}

function isLocalhost(){
  const h = String(window.location.hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

async function safeCopyLink(url){
  if (!url) return false;
  if (isLocalhost()){
    toast('You are on localhost. Use your LAN IP to share links across devices.');
  }
  // Always copy URL only (no prefix text), but resolve relative URLs safely.
  const u = String(new URL(String(url), window.location.href));
  const ok = await copyText(u);
  toast(ok ? 'Link copied' : 'Copy failed');
  return ok;
}

async function safeShareLink(url, text){
  if (!url) return false;
  if (isLocalhost()){
    toast('You are on localhost. Use your LAN IP to share links across devices.');
  }
  const u = String(new URL(url, window.location.href));

  // iOS (especially on http) is picky. Share URL-only first for max compatibility.
  if (navigator.share){
    try{
      await navigator.share({ title: 'ChicCanto', url: u });
      return true;
    }catch{
      // cancelled or failed, fall back to copy
    }
  }

  // Fallback: copy (includes optional text + url)
  return safeCopyLink(u);
}

function _sanitizeSvgMarkup(markup) {
  return String(markup)
    .replace(/<\?xml[\s\S]*?\?>\s*/gi, '')
    .replace(/<!doctype[\s\S]*?>\s*/gi, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .trim();
}

async function _fetchSvgMarkup(url) {
  const abs = new URL(url, window.location.href).toString();
  if (_INLINE_SVG_CACHE.has(abs)) return _INLINE_SVG_CACHE.get(abs);

  const p = fetch(abs, { cache: 'force-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch SVG: ${r.status} ${r.statusText}`);
      return r.text();
    })
    .then(_sanitizeSvgMarkup);

  _INLINE_SVG_CACHE.set(abs, p);
  return p;
}

async function _replaceImgWithInlineSvg(img) {
  const src = img.getAttribute('src');
  if (!src) return;

  // Only handle SVG sources.
  if (!/\.svg(\?|#|$)/i.test(src)) return;

  const alt = img.getAttribute('alt') || '';

  const markup = await _fetchSvgMarkup(src);
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  const svg = tpl.content.querySelector('svg');
  if (!svg) throw new Error('No <svg> root found in fetched markup');

  // Let CSS control sizing.
  svg.removeAttribute('width');
  svg.removeAttribute('height');

  // Preserve any classes from the original <img>.
  if (img.className) {
    const existing = svg.getAttribute('class');
    svg.setAttribute('class', existing ? `${existing} ${img.className}` : img.className);
  }

  // Accessibility
  if (alt) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', alt);
    svg.removeAttribute('aria-hidden');
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    svg.removeAttribute('aria-label');
  }

  // Preserve common inline styles/attrs from <img>
  const style = img.getAttribute('style');
  if (style) svg.setAttribute('style', style);
  if (img.id) svg.id = img.id;
  if (img.getAttribute('data-export-ignore')) svg.setAttribute('data-export-ignore', img.getAttribute('data-export-ignore'));

  img.replaceWith(svg);
}

// Replaces all <img src="*.svg"> under root with inline <svg>.
async function inlineAllSvgs(root = document) {
  const imgs = Array.from(root.querySelectorAll('img[src$=".svg"], img[src*=".svg?"], img[src*=".svg#"]'));
  await Promise.all(imgs.map((img) => _replaceImgWithInlineSvg(img)));
}


// ---------- URL helpers ----------
function makeAbsoluteCardLink(token){
  return new URL(`/card/?token=${encodeURIComponent(token)}`, window.location.origin).toString();
}
function makeAbsoluteOpenLink(token){
  return new URL(`/open/?token=${encodeURIComponent(token)}`, window.location.origin).toString();
}
function makeAbsoluteSetupLink(token, setupKey){
  const url = new URL(`/card/?token=${encodeURIComponent(token)}`, window.location.origin);
  if (setupKey) url.searchParams.set('setup', setupKey);
  return url.toString();
}


// ---------- Setup key & sender-only guard ----------
function getSetupKeyFromUrl(){
  const url = new URL(window.location.href);
  return (url.searchParams.get('setup') || '').trim();
}

function hasSetupKey(){
  return !!getSetupKeyFromUrl();
}

function isSenderSetupMode(card){
  // Sender-only setup if:
  // - there is a setup key in the URL, OR
  // - card is not configured yet (first-time owner flow)
  return hasSetupKey() || !card?.configured;
}

function sanitizePublicCard(card){
  if(!card || typeof card !== 'object') return card;
  const copy = { ...card };
  // Never leak setup_key in public/shared flows.
  delete copy.setup_key;
  return copy;
}


// ---------- Small styling helpers ----------
function setText(el, value){
  if (el) el.textContent = value == null ? '' : String(value);
}

function setHtml(el, html){
  if (el) el.innerHTML = html == null ? '' : String(html);
}

function setDisabled(el, disabled){
  if (!el) return;
  el.disabled = !!disabled;
  el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function show(el){
  if (el) el.hidden = false;
}

function hide(el){
  if (el) el.hidden = true;
}


// ---------- API helpers ----------
async function apiGetJson(url){
  const res = await fetch(url, { credentials: 'same-origin' });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `GET ${url} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function apiPostJson(url, body){
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `POST ${url} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function apiPutJson(url, body){
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `PUT ${url} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}


// ---------- Choice / reveal-amount persistence ----------
async function persistChoiceAndMaybeRevealAmount(token, choiceKey, revealAmount){
  const setupKey = getSetupKeyFromUrl();
  const payload = { choice: choiceKey };
  if (typeof revealAmount === 'number' && Number.isFinite(revealAmount)) {
    payload.reveal_amount = revealAmount;
  }

  // Prefer server when setup key exists (authoritative + sharable).
  if (setupKey){
    const url = `/token/${encodeURIComponent(token)}?setup=${encodeURIComponent(setupKey)}`;
    const updated = await apiPutJson(url, payload);

    // Also force local persistence for immediate same-device continuity.
    _forcePersistConfiguredCard(token, {
      choice: updated?.choice ?? choiceKey,
      reveal_amount: typeof updated?.reveal_amount === 'number' ? updated.reveal_amount : revealAmount,
      configured: true
    });

    // Store may already merge the payload, but we also explicitly mark configured.
    try { await setConfiguredAndWait(token, { choice: choiceKey, reveal_amount: revealAmount }); } catch {}
    return updated;
  }

  // Fallback to local store only (first-time setup on same device).
  _forcePersistConfiguredCard(token, {
    choice: choiceKey,
    reveal_amount: typeof revealAmount === 'number' ? revealAmount : undefined,
    configured: true
  });

  try{
    await setConfiguredAndWait(token, { choice: choiceKey, reveal_amount: revealAmount });
  }catch{
    // best effort
  }

  return ensureCard(token);
}


// ---------- Random / board helpers ----------
function shuffleInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomChoice(arr){
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildWinningBoard(prizeKey, allKeys, total = 9){
  const board = new Array(total);
  const winPositions = shuffleInPlace([...Array(total).keys()]).slice(0, 3);
  for (const idx of winPositions) board[idx] = prizeKey;

  const nonPrizeKeys = allKeys.filter((k) => k !== prizeKey);
  const pool = [];
  while (pool.length < total - 3){
    pool.push(randomChoice(nonPrizeKeys));
  }
  shuffleInPlace(pool);

  let p = 0;
  for (let i = 0; i < total; i++){
    if (!board[i]) board[i] = pool[p++];
  }
  return board;
}

function getChoicePrizeOptions(choice){
  const opts = getRevealOptions(choice);
  if (!opts || typeof opts !== 'object') return [];
  const keys = Object.keys(opts).filter((k) => k !== RANDOM_KEY);
  return keys.map((key) => ({
    key,
    label: opts[key]?.label || key,
    tier: opts[key]?.tier || null,
    iconSrc: tierIconSrc(key),
  }));
}

function getChosenPrize(card){
  const choice = card?.choice || '';
  if (!choice || choice === RANDOM_KEY) return null;
  const opts = getRevealOptions(choice);
  const item = opts?.[choice];
  if (!item) return null;
  return {
    key: choice,
    label: item.label || choice,
    tier: item.tier || null,
    iconSrc: tierIconSrc(choice),
  };
}

function getRevealAmountLabel(card){
  const n = Number(card?.reveal_amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(n);
}


// ---------- UI: Setup screen ----------
function renderSetupScreen(container, card){
  const token = card.token;
  const opts = getRevealOptions(card.card_type || card.type || '');
  const theme = getCardTheme(card.card_type || card.type || '');

  const items = Object.entries(opts || {}).map(([key, val]) => ({
    key,
    label: val?.label || key,
    tier: val?.tier || null,
    iconSrc: tierIconSrc(key),
    isRandom: key === RANDOM_KEY
  }));

  const showRevealAmount = items.some((x) => x.isRandom);

  container.innerHTML = `
    <main class="page-main">
      <div class="container">
        <section class="flow-screen">
          <div class="flow-layout">
            <div class="flow-intro">
              <h1 class="flow-title">Choose the prize tier</h1>
              <p class="flow-lead muted panel-meta">
                This choice is private to the sender while setting up the card.
              </p>
            </div>

            <section class="flow-panel--combined panel panel--glass panel--padded" aria-label="Choose prize">
              ${theme?.thumbSrc ? `
                <div class="card-thumb-wrap">
                  <img class="card-thumb" src="${theme.thumbSrc}" alt="" />
                </div>
              ` : ''}

              <div class="control-grid" id="choiceGrid">
                ${items.map((item) => `
                  <button
                    type="button"
                    class="choice-card ${item.isRandom ? 'choice-card--random' : ''}"
                    data-choice="${item.key}"
                    aria-pressed="false"
                  >
                    <div class="choice-card__media">
                      ${item.iconSrc ? `<img class="choice-card__icon" src="${item.iconSrc}" alt="" />` : ''}
                    </div>
                    <div class="choice-card__body">
                      <div class="choice-card__title">${item.label}</div>
                      ${item.tier ? `<div class="choice-card__meta">Tier ${item.tier}</div>` : ''}
                      ${item.isRandom ? `<div class="choice-card__meta">We’ll randomize the prize tier after activation.</div>` : ''}
                    </div>
                  </button>
                `).join('')}
              </div>

              ${showRevealAmount ? `
                <div class="field" id="revealAmountField" hidden>
                  <label class="label" for="revealAmount">Reveal amount</label>
                  <input
                    class="input"
                    id="revealAmount"
                    type="number"
                    inputmode="numeric"
                    min="1"
                    max="99"
                    step="1"
                    value="${Number.isFinite(Number(card.reveal_amount)) ? Number(card.reveal_amount) : 1}"
                  />
                  <div class="muted small" style="margin-top:6px;">
                    Only used when “Surprise me” is selected.
                  </div>
                </div>
              ` : ''}

              <div class="actions" style="margin-top: 14px;">
                <button class="btn primary" id="saveChoiceBtn" type="button" disabled>Save and continue</button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  `;

  const choiceGrid = container.querySelector('#choiceGrid');
  const saveBtn = container.querySelector('#saveChoiceBtn');
  const amountField = container.querySelector('#revealAmountField');
  const amountInput = container.querySelector('#revealAmount');

  let selected = '';

  function refreshSelection(){
    const buttons = Array.from(choiceGrid.querySelectorAll('.choice-card'));
    for (const btn of buttons){
      const active = btn.getAttribute('data-choice') === selected;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    setDisabled(saveBtn, !selected);

    const isRandom = selected === RANDOM_KEY;
    if (amountField){
      amountField.hidden = !isRandom;
    }
  }

  choiceGrid?.addEventListener('click', (e) => {
    const btn = e.target.closest('.choice-card');
    if (!btn) return;
    selected = btn.getAttribute('data-choice') || '';
    refreshSelection();
  });

  saveBtn?.addEventListener('click', async () => {
    if (!selected) return;

    saveBtn.textContent = 'Saving…';
    setDisabled(saveBtn, true);

    try{
      let revealAmount = undefined;
      if (selected === RANDOM_KEY){
        const parsed = Number(amountInput?.value || 1);
        revealAmount = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
      }

      const updated = await persistChoiceAndMaybeRevealAmount(token, selected, revealAmount);

      // Local continuity: get the freshest merged card and go straight into the card UI.
      const next = sanitizePublicCard(updated || ensureCard(token) || { ...card, choice: selected, reveal_amount: revealAmount, configured: true });
      next.token = token;
      next.choice = selected;
      if (selected === RANDOM_KEY) next.reveal_amount = revealAmount;
      next.configured = true;

      renderCardScreen(container, next);
    }catch(err){
      console.error(err);
      toast(err?.message || 'Could not save choice');
      saveBtn.textContent = 'Save and continue';
      setDisabled(saveBtn, false);
    }
  });

  refreshSelection();
}


// ---------- UI: Card screen shell ----------
function baseCardScreenMarkup(card, theme, { senderSetupMode = false } = {}){
  const token = card.token;
  const openUrl = makeAbsoluteOpenLink(token);
  const cardUrl = makeAbsoluteCardLink(token);
  const setupUrl = senderSetupMode ? makeAbsoluteSetupLink(token, card.setup_key || getSetupKeyFromUrl()) : '';

  return `
    <main class="page-main">
      <div class="container">
        <section class="flow-screen card-screen" data-token="${token}">
          <header class="card-header panel panel--glass">
            <div class="brand-mark">ChicCanto</div>
            <div class="card-actions" id="cardActions">
              ${!PREVIEW_MODE ? `<button class="btn" id="copyBtn" type="button">Copy link</button>` : ''}
            </div>
          </header>

          <section class="scratch-stage panel panel--glass" id="scratchStage">
            <picture class="card-bg" aria-hidden="true" data-export-root="1">
              <source media="(max-width: 720px)" srcset="${theme.bgMobileSrc || theme.bgDesktopSrc || ''}">
              <img class="card-bg__img" src="${theme.bgDesktopSrc || theme.bgMobileSrc || ''}" alt="" />
            </picture>

            <div class="card-stage__content" id="cardStageContent">
              <div class="card-stage__title-wrap">
                ${theme.titleSrc ? `<img class="card-stage__title" src="${theme.titleSrc}" alt="" />` : ''}
              </div>

              <div class="card-screen__body">
                <aside class="legend-panel" id="legendPanel">
                  <div class="legend-panel__inner">
                    <h2 class="legend-panel__title">MATCH 3 TO WIN</h2>
                    <p class="legend-panel__subtitle">SCRATCH ALL CIRCLES TO REVEAL ICONS</p>
                    <div class="legend-panel__list" id="legendList"></div>
                  </div>
                </aside>

                <section class="scratch-board" id="scratchBoard" aria-label="Scratch board"></section>
              </div>
            </div>
          </section>

          <footer class="page-footer muted">
            <a href="/privacy/" class="link">Privacy</a>
            <span>•</span>
            <a href="mailto:chiccanto@wearrs.com" class="link">chiccanto@wearrs.com</a>
          </footer>

          <div class="sr-only">
            <a href="${openUrl}" id="openUrlAnchor">Open</a>
            <a href="${cardUrl}" id="cardUrlAnchor">Card</a>
            ${senderSetupMode && setupUrl ? `<a href="${setupUrl}" id="setupUrlAnchor">Setup</a>` : ''}
          </div>
        </section>
      </div>
    </main>
  `;
}


// ---------- Theme → legend styling ----------
function applyLegendPanelTheme(root, theme){
  const panel = root.querySelector('#legendPanel');
  if (!panel || !theme) return;

  // Base panel background / blur / border
  if (theme.legendPanelBg){
    panel.style.background = theme.legendPanelBg;
  }
  if (theme.legendPanelBlur){
    panel.style.backdropFilter = `blur(${theme.legendPanelBlur})`;
    panel.style.webkitBackdropFilter = `blur(${theme.legendPanelBlur})`;
  }
  if (theme.legendPanelBorder){
    panel.style.borderColor = theme.legendPanelBorder;
  }

  // Text colors
  const textColor = theme.legendPanelTextColor || '';
  const mutedColor = theme.legendPanelMutedColor || textColor || '';

  const title = panel.querySelector('.legend-panel__title');
  const subtitle = panel.querySelector('.legend-panel__subtitle');
  if (title && textColor) title.style.color = textColor;
  if (subtitle && mutedColor) subtitle.style.color = mutedColor;

  // Legend row colors are applied after rows are rendered too.
}


// ---------- Legend rendering ----------
function renderLegendRows(root, theme, card){
  const list = root.querySelector('#legendList');
  if (!list) return;

  const items = getChoicePrizeOptions(card.card_type || card.type || '');
  list.innerHTML = items.map((item) => `
    <div class="legend-row" data-prize="${item.key}">
      <div class="legend-row__icon-wrap">
        ${item.iconSrc ? `<img class="legend-row__icon" src="${item.iconSrc}" alt="" />` : ''}
      </div>
      <div class="legend-row__label">${item.label}</div>
    </div>
  `).join('');

  const textColor = theme?.legendPanelTextColor || '';
  const mutedColor = theme?.legendPanelMutedColor || textColor || '';

  list.querySelectorAll('.legend-row').forEach((row) => {
    if (mutedColor) row.style.borderColor = `${mutedColor}22`;
    const label = row.querySelector('.legend-row__label');
    if (label && textColor) label.style.color = textColor;

    const iconWrap = row.querySelector('.legend-row__icon-wrap');
    if (iconWrap && mutedColor){
      iconWrap.style.borderColor = mutedColor;
    }
  });
}


// ---------- Scratch / reveal state ----------
function getCardThemeSafe(card){
  return getCardTheme(card?.card_type || card?.type || '');
}

function getAllPrizeKeysForCard(card){
  return getChoicePrizeOptions(card?.card_type || card?.type || '').map((x) => x.key);
}

function buildBoardForCard(card){
  const allKeys = getAllPrizeKeysForCard(card);
  const chosen = getChosenPrize(card);

  if (chosen?.key){
    return buildWinningBoard(chosen.key, allKeys, 9);
  }

  // Random fallback if no explicit chosen prize.
  const fallback = randomChoice(allKeys);
  return buildWinningBoard(fallback, allKeys, 9);
}

function ensureBoard(card){
  if (Array.isArray(card.board) && card.board.length === 9){
    return card.board.slice();
  }
  const board = buildBoardForCard(card);
  card.board = board.slice();
  saveCard(card);
  return board;
}

function getWinningPrizeKeyFromBoard(board){
  const counts = new Map();
  for (const key of board){
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts.entries()){
    if (count >= 3) return key;
  }
  return null;
}

function getCurrentlyScratchedIndices(card){
  const arr = Array.isArray(card?.scratched_indices) ? card.scratched_indices : [];
  return arr
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 9);
}

function markWinningLegendRow(root, prizeKey){
  qsa('.legend-row', root).forEach((row) => row.classList.remove('is-winning'));
  if (!prizeKey) return;
  const row = root.querySelector(`.legend-row[data-prize="${CSS.escape(prizeKey)}"]`);
  if (row) row.classList.add('is-winning');
}

function renderScratchBoard(root, card, board, scratchedIndices){
  const boardEl = root.querySelector('#scratchBoard');
  if (!boardEl) return;

  const theme = getCardThemeSafe(card);

  boardEl.innerHTML = board.map((prizeKey, idx) => {
    const iconSrc = tierIconSrc(prizeKey);
    const scratched = scratchedIndices.includes(idx);
    return `
      <button
        type="button"
        class="scratch-tile ${scratched ? 'is-scratched' : ''}"
        data-idx="${idx}"
        data-prize="${prizeKey}"
        aria-label="Scratch tile ${idx + 1}"
      >
        <div class="scratch-tile__inner">
          <div class="scratch-tile__revealed">
            ${iconSrc ? `<img class="scratch-tile__icon" src="${iconSrc}" alt="" />` : ''}
          </div>
          <div class="scratch-tile__overlay">
            <span class="scratch-tile__overlay-text">scratch</span>
          </div>
        </div>
      </button>
    `;
  }).join('');

  qsa('.scratch-tile', boardEl).forEach((tile) => {
    if (theme?.tileSet) {
      setTileSet(tile, theme.tileSet);
    }
  });
}

function getTileElements(root){
  return qsa('.scratch-tile', root);
}

function setTileScratched(tile, scratched){
  tile.classList.toggle('is-scratched', !!scratched);
}

function removeAllScratchOverlays(root){
  qsa('.scratch-tile', root).forEach((tile) => setTileScratched(tile, true));
}

function getRevealedPrizeKey(card){
  if (!card?.revealed) return null;
  const board = Array.isArray(card.board) ? card.board : [];
  const scratched = getCurrentlyScratchedIndices(card);
  if (board.length === 9){
    // If explicit winning key can be inferred from board, use it.
    const counts = new Map();
    for (const idx of scratched){
      const key = board[idx];
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key, count] of counts.entries()){
      if (count >= 3) return key;
    }
  }
  return getWinningPrizeKeyFromBoard(board);
}


// ---------- Share / export actions ----------
function renderCardHeaderActions(card, revealed){
  const actions = qs('#cardActions');
  if (!actions) return;

  actions.innerHTML = '';

  if (!PREVIEW_MODE){
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn';
    copyBtn.id = 'copyBtn';
    copyBtn.textContent = 'Copy link';
    copyBtn.addEventListener('click', async () => {
      const url = makeAbsoluteOpenLink(card.token);
      await safeCopyLink(url);
    });
    actions.appendChild(copyBtn);
  }

  if (!revealed) return;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn';
  saveBtn.id = 'savePngBtn';
  saveBtn.textContent = 'Save PNG';
  saveBtn.addEventListener('click', async () => {
    try{
      setDisabled(saveBtn, true);
      saveBtn.textContent = 'Rendering…';
      await exportRevealedPng(card);
      saveBtn.textContent = 'Saved';
      setTimeout(() => (saveBtn.textContent = 'Save PNG'), 1200);
    }catch(err){
      console.error(err);
      toast(err?.message || 'PNG export failed');
      saveBtn.textContent = 'Save PNG';
    }finally{
      setDisabled(saveBtn, false);
    }
  });
  actions.appendChild(saveBtn);

  if (!PREVIEW_MODE){
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'btn primary';
    shareBtn.id = 'shareBtn';
    shareBtn.textContent = 'Share result';
    shareBtn.addEventListener('click', async () => {
      const url = makeAbsoluteOpenLink(card.token);
      await safeShareLink(url, 'Your ChicCanto card');
    });
    actions.appendChild(shareBtn);
  }
}


// ---------- Export helpers ----------
function _waitImageLoad(img){
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) return resolve(img);
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener('error', () => reject(new Error('Image failed to load')), { once: true });
  });
}

function _xmlEscape(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _svgToDataUrl(svgMarkup){
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

async function _fetchAsDataUrl(url){
  const abs = new URL(url, window.location.href).toString();
  const res = await fetch(abs, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status} ${res.statusText}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Failed to read asset as data URL'));
    fr.readAsDataURL(blob);
  });
}

function _cloneForExport(el){
  return el.cloneNode(true);
}

// Copy computed styles from source tree → clone tree (keeps clone visually faithful)
function _inlineStylesDeep(sourceRoot, cloneRoot){
  const sourceWalker = document.createTreeWalker(sourceRoot, NodeFilter.SHOW_ELEMENT);
  const cloneWalker  = document.createTreeWalker(cloneRoot,  NodeFilter.SHOW_ELEMENT);

  const sourceEls = [sourceRoot, ...(() => {
    const out = [];
    let n;
    while ((n = sourceWalker.nextNode())) out.push(n);
    return out;
  })()];

  const cloneEls = [cloneRoot, ...(() => {
    const out = [];
    let n;
    while ((n = cloneWalker.nextNode())) out.push(n);
    return out;
  })()];

  for (let i = 0; i < Math.min(sourceEls.length, cloneEls.length); i++){
    const src = sourceEls[i];
    const dst = cloneEls[i];
    const cs = window.getComputedStyle(src);

    const style = [];
    for (const prop of cs){
      try{
        style.push(`${prop}:${cs.getPropertyValue(prop)};`);
      }catch{}
    }
    dst.setAttribute('style', style.join(''));
  }
}

async function _inlineImagesForExport(cloneRoot){
  const imgs = Array.from(cloneRoot.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src');
    if (!src) return;
    try{
      img.setAttribute('src', await _fetchAsDataUrl(src));
    }catch{
      // best effort; leave original src
    }
  }));
}

async function _inlineCssUrlsInStyleAttr(root){
  const els = Array.from(root.querySelectorAll('[style]'));
  const urlRe = /url\((['"]?)(.*?)\1\)/g;

  await Promise.all(els.map(async (el) => {
    const style = el.getAttribute('style') || '';
    const matches = [...style.matchAll(urlRe)];
    if (!matches.length) return;

    let next = style;
    for (const m of matches){
      const original = m[0];
      const rawUrl = m[2];
      if (!rawUrl || rawUrl.startsWith('data:')) continue;
      try{
        const dataUrl = await _fetchAsDataUrl(rawUrl);
        next = next.replace(original, `url("${dataUrl}")`);
      }catch{
        // keep original
      }
    }
    el.setAttribute('style', next);
  }));
}

function _makeSvgSnapshotMarkup(cloneEl, width, height){
  const html = cloneEl.outerHTML;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject x="0" y="0" width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
          ${html}
        </div>
      </foreignObject>
    </svg>
  `.trim();
}

async function exportRevealedPng(card){
  const stage = qs('#scratchStage');
  if (!stage) throw new Error('Scratch stage not found');

  // Force fully revealed export state when card is revealed.
  const exportCard = { ...card };
  if (exportCard.revealed) {
    exportCard.scratched_indices = [0,1,2,3,4,5,6,7,8];
  }

  // Clone the live stage so current responsive layout is preserved.
  const clone = _cloneForExport(stage);

  // Ensure clone uses revealed state for export (no scratch overlays after reveal).
  if (exportCard.revealed){
    clone.querySelectorAll('.scratch-tile').forEach((tile) => {
      tile.classList.add('is-scratched');
    });
  }

  // Inline computed styles and image sources.
  _inlineStylesDeep(stage, clone);
  await _inlineImagesForExport(clone);
  await _inlineCssUrlsInStyleAttr(clone);

  // 1) Determine export size from the live stage.
  const rect = stage.getBoundingClientRect();
  const width  = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  // 2) Resolve the active card background from the live DOM.
  let exportBgDataUrl = null;
  try{
    const liveBgImg = stage.querySelector('.card-bg__img');
    const picture = stage.querySelector('.card-bg');
    let bgSrc = '';

    if (picture){
      const source = picture.querySelector('source');
      const mq = source?.getAttribute('media') || '';
      const srcset = source?.getAttribute('srcset') || '';
      const desktopSrc = liveBgImg?.getAttribute('src') || '';

      if (mq && srcset && window.matchMedia && window.matchMedia(mq).matches){
        bgSrc = srcset;
      }else{
        bgSrc = liveBgImg?.currentSrc || desktopSrc || srcset || '';
      }
    }else{
      bgSrc = liveBgImg?.currentSrc || liveBgImg?.getAttribute('src') || '';
    }

    if (bgSrc){
      exportBgDataUrl = await _fetchAsDataUrl(bgSrc);
    }
  }catch{
    exportBgDataUrl = null;
  }

  // 3) Hide the cloned DOM background so we don't double-paint.
  clone.querySelectorAll('.card-bg').forEach((el) => {
    el.remove();
  });

  // 4) Snapshot the foreground DOM to SVG.
  const svg = _makeSvgSnapshotMarkup(clone, width, height);
  const img = new Image();
  img.decoding = 'sync';
  img.src = _svgToDataUrl(svg);
  await _waitImageLoad(img);

  // 5) Draw export to canvas.
  const pad = 24;
  const canvas = document.createElement('canvas');
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const ctx = canvas.getContext('2d');

  // Padded dark background so rounded corners stay intact in export.
  ctx.fillStyle = '#0b1017';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 5a) Draw actual active card background image first, if available.
  if (exportBgDataUrl){
    const bgImg = new Image();
    bgImg.decoding = 'sync';
    bgImg.src = exportBgDataUrl;
    await _waitImageLoad(bgImg);

    // Cover behavior to match the live card background.
    const scale = Math.max(width / bgImg.naturalWidth, height / bgImg.naturalHeight);
    const drawW = bgImg.naturalWidth * scale;
    const drawH = bgImg.naturalHeight * scale;
    const dx = pad + (width - drawW) / 2;
    const dy = pad + (height - drawH) / 2;

    // Clip to the stage rounded corners before drawing background.
    const radius = 28;
    ctx.save();
    roundedRectPath(ctx, pad, pad, width, height, radius);
    ctx.clip();
    ctx.drawImage(bgImg, dx, dy, drawW, drawH);
    ctx.restore();
  }

  // 5b) Draw the cloned foreground DOM over the background.
  ctx.drawImage(img, pad, pad);

  // 6) Download
  const a = document.createElement('a');
  const now = new Date();
  a.download = `chiccanto-card-${card.token}-${formatIso(now).replace(/[:.]/g, '_')}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

function roundedRectPath(ctx, x, y, w, h, r){
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}


// ---------- Main card rendering ----------
function renderRevealed(root, card){
  const board = ensureBoard(card);
  const winningPrize = getRevealedPrizeKey(card) || getWinningPrizeKeyFromBoard(board);

  renderScratchBoard(root, card, board, [0,1,2,3,4,5,6,7,8]);
  removeAllScratchOverlays(root);
  markWinningLegendRow(root, winningPrize);
  renderCardHeaderActions(card, true);
}

function renderScratch(root, card){
  const board = ensureBoard(card);
  const scratchedIndices = getCurrentlyScratchedIndices(card);

  renderScratchBoard(root, card, board, scratchedIndices);
  markWinningLegendRow(root, null);
  renderCardHeaderActions(card, false);

  const boardEl = root.querySelector('#scratchBoard');
  const tiles = getTileElements(root);

  // Debounced persistence of scratch progress.
  let scratchSaveTimer = null;
  const schedulePersistScratch = (indices) => {
    clearTimeout(scratchSaveTimer);
    scratchSaveTimer = setTimeout(() => {
      card.scratched_indices = indices;
      saveCard(card);
    }, 120);
  };

  function revealWin(prizeKey, scratchedSet){
    // Force full reveal state both visually and in persisted card state.
    const all = [0,1,2,3,4,5,6,7,8];

    // Cancel any pending stale scratch-progress write first.
    clearTimeout(scratchSaveTimer);

    // Update live in-memory card immediately so no later save can resurrect overlays.
    card.revealed = true;
    card.scratched_indices = all.slice();
    card.board = board.slice();

    // Force current DOM into full revealed state now.
    tiles.forEach((tile) => setTileScratched(tile, true));
    markWinningLegendRow(root, prizeKey);

    // Persist full revealed state.
    void setRevealedAndWait(card.token, {
      board: board.slice(),
      scratched_indices: all.slice()
    });

    renderCardHeaderActions(getCard(card.token) || card, true);
  }

  function onTileScratched(idx){
    const tile = tiles[idx];
    if (!tile || tile.classList.contains('is-scratched')) return;

    setTileScratched(tile, true);

    const nextSet = new Set(getCurrentlyScratchedIndices(card));
    nextSet.add(idx);
    const scratched = [...nextSet].sort((a, b) => a - b);

    // Persist partial scratch progress.
    schedulePersistScratch(scratched);

    // Check for win condition.
    const counts = new Map();
    for (const i of scratched){
      const key = board[i];
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    for (const [prizeKey, count] of counts.entries()){
      if (count >= 3){
        revealWin(prizeKey, nextSet);
        break;
      }
    }
  }

  tiles.forEach((tile) => {
    const idx = Number(tile.getAttribute('data-idx'));
    if (tile.classList.contains('is-scratched')) return;

    attachScratchTile(tile, {
      onComplete: () => onTileScratched(idx)
    });
  });
}

function renderCardScreen(container, card){
  const safeCard = sanitizePublicCard(card);
  const theme = getCardThemeSafe(safeCard);
  const senderSetupMode = isSenderSetupMode(card);

  container.innerHTML = baseCardScreenMarkup(card, theme, { senderSetupMode });
  applyLegendPanelTheme(container, theme);
  renderLegendRows(container, theme, card);

  if (card.revealed){
    renderRevealed(container, card);
  }else{
    renderScratch(container, card);
  }
}


// ---------- Public page boot ----------
async function loadCardForPage(token){
  // Prefer local first for smoother continuity, then hydrate from API if available.
  let local = getCard(token);

  // Token sanity check first, so obviously invalid tokens don't depend on API failures.
  if (!TOKEN_RE.test(token || '')) {
    throw new Error('This card link looks invalid.');
  }

  // If we already have a configured local card and we're not in preview mode, use it immediately.
  // BUT: if the page URL carries a sender setup key, still try the API afterwards so we can
  // merge/setup-authoritative fields (and persist setup_key for later local continuity).
  if (local && local.configured && !PREVIEW_MODE) {
    const setupKey = getSetupKeyFromUrl();
    if (!setupKey) return sanitizePublicCard(local);
  }

  // Remote authoritative read
  try{
    // If URL has a sender setup key, include it so API can return owner-only fields (e.g. setup_key)
    const setupKey = getSetupKeyFromUrl();
    const url = setupKey
      ? `/token/${encodeURIComponent(token)}?setup=${encodeURIComponent(setupKey)}`
      : `/token/${encodeURIComponent(token)}`;

    const remote = await apiGetJson(url);

    // Merge into local store for continuity
    if (remote && typeof remote === 'object'){
      const merged = { ...(local || {}), ...remote };
      try { saveCard(merged); } catch {}
      return sanitizePublicCard(merged);
    }
  }catch(err){
    // Fall back to local, but surface the remote error if nothing usable exists.
    if (local) return sanitizePublicCard(local);
    throw err;
  }

  if (local) return sanitizePublicCard(local);

  throw new Error('Card not found.');
}

function renderErrorScreen(container, message){
  container.innerHTML = `
    <main class="page-main">
      <div class="container">
        <section class="flow-screen">
          <div class="flow-layout">
            <div class="flow-intro">
              <h1 class="flow-title">This card can’t be opened</h1>
              <p class="flow-lead muted panel-meta">${_xmlEscape(message || 'Unknown error')}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  `;
}

export async function bootCardPage(){
  const container = document.getElementById('app');
  if (!container) return;

  const token = getTokenFromUrl();
  if (!token){
    renderErrorScreen(container, 'Missing card token.');
    return;
  }

  // Guard mobile/tablet in-app browsers in recipient view only.
  // Sender setup links (?setup=...) must be allowed so the buyer can configure the card.
  if (!hasSetupKey() && isMobileOrTablet() && isLikelyInAppBrowser()){
    renderInAppBlocked(container, token);
    return;
  }

  try{
    const card = await loadCardForPage(token);

    // If not configured yet, sender must choose prize tier first.
    if (isSenderSetupMode(card)){
      renderSetupScreen(container, card);
      return;
    }

    renderCardScreen(container, card);
  }catch(err){
    console.error(err);
    renderErrorScreen(container, err?.message || 'Could not load this card.');
  }
}


// ---------- /open page boot ----------
export async function bootOpenPage(){
  const container = document.getElementById('app');
  if (!container) return;

  const token = getTokenFromUrl();
  if (!token){
    renderErrorScreen(container, 'Missing card token.');
    return;
  }

  const cardUrl = makeAbsoluteCardLink(token);

  // Messenger/IG in-app browsers: show guidance instead of auto-opening.
  if (isLikelyInAppBrowser()){
    renderInAppBlocked(container, token);
    return;
  }

  // Normal browsers: auto-redirect to /card
  window.location.replace(cardUrl);
}


// ---------- Entry ----------
document.addEventListener('DOMContentLoaded', async () => {
  // Determine mode from URL path.
  const path = window.location.pathname || '';
  PREVIEW_MODE = new URL(window.location.href).searchParams.get('preview') === '1';

  // Make sure SVG titles/icons render/export consistently everywhere.
  try { await inlineAllSvgs(document); } catch (e) { console.warn('inlineAllSvgs failed', e); }

  if (path.startsWith('/open/')){
    bootOpenPage();
  }else if (path.startsWith('/card/')){
    bootCardPage();
  }
});