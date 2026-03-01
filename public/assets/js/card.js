import { qs, qsa, copyText, formatIso, getTokenFromUrl } from './utils.js';
import { getRevealOptions, RANDOM_KEY, tierIconSrc, setTileSet } from './config.js';
import { getCardTheme } from './card-themes.js';
import { getCard, getCardAsync, ensureCard, setConfigured, setConfiguredAndWait, setRevealed } from './store.js';
import { attachScratchTile } from './scratch.js';

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
  svg.setAttribute('focusable', 'false');

  img.replaceWith(svg);
}

async function hydrateInlineSvgs(root = document) {
  const imgs = Array.from(root.querySelectorAll('img[data-inline-svg="true"]'));
  if (!imgs.length) return;

  await Promise.allSettled(
    imgs.map(async (img) => {
      if (img.dataset.inlineSvgHydrated === '1') return;
      img.dataset.inlineSvgHydrated = '1';
      try {
        await _replaceImgWithInlineSvg(img);
      } catch {
        // Keep the <img> fallback if anything fails.
      }
    }),
  );
}

function statusBadge(card){
  if (!card.configured) return '<span class="badge warn">Not configured</span>';
  if (card.revealed) return '<span class="badge ok">Revealed</span>';
  return '<span class="badge">Ready</span>';
}

function makeAbsoluteCardLink(token){
  const url = new URL(window.location.href);
  url.pathname = '/card/';

  // If token is malformed, don't build a share link.
  if (!TOKEN_RE.test(token)) return null;

  const params = new URLSearchParams();
  params.set('token', token);
  url.search = '?' + params.toString();
  url.hash = '';
  return url.toString();
}

function uniq(arr){ return Array.from(new Set(arr)); }

function clearActionsBar(){
  const el = document.getElementById('cardActions');
  if (el) el.innerHTML = '';
}

function renderCardHeaderActions(card, revealed){
  clearActionsBar();
  const el = document.getElementById('cardActions');
  if (!el || !card) return;

  // Preview mode: no copy/share link (token is not meant to be shared).
  // Only show result actions after reveal.
  if (PREVIEW_MODE){

    const mkBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost';
      b.textContent = label;
      return b;
    };

    const saveBtn = mkBtn('Save PNG');
    saveBtn.id = 'savePngBtn';
    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      try{
        saveBtn.disabled = true;
        const prev = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';
        await exportRevealedPng(card);
        saveBtn.textContent = prev;
      }catch (err){
        console.error('PNG export failed:', err);
        alert('Could not export PNG. Please try again.');
      }finally{
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save PNG';
      }
    }, { passive: true });
    el.appendChild(saveBtn);

    const shareBtn = mkBtn('Share result');
    shareBtn.id = 'shareResultBtn';
    shareBtn.addEventListener('click', async () => {
      try{
        // In preview, sharing the URL is not meaningful, but you may still want the share sheet.
        // If you prefer, change this to share text only.
        const url = makeAbsoluteCardLink(card.token);
        const opt = resolveOptionFromCard(card);
        const label = opt && opt.label ? `Scratch card result: ${opt.label}` : 'Scratch card result';
        await safeShareLink(url, label);
      }catch (e){
        console.error('Share error:', e);
      }
    }, { passive: true });
    el.appendChild(shareBtn);

    // Preview-only: let testers jump to activation at any time.
    const activateA = document.createElement('a');
    activateA.className = 'btn ghost';
    activateA.href = '/activate/';
    activateA.textContent = 'Activate';
    el.appendChild(activateA);

    return;
  }

  // Normal mode: existing behavior
  const url = makeAbsoluteCardLink(card.token);

  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost';
    b.textContent = label;
    return b;
  };

  const copyBtn = mkBtn('Copy link');
  copyBtn.addEventListener('click', async () => {
    await safeCopyLink(url, 'Scratch card link');
  }, { passive: true });

  el.appendChild(copyBtn);

  if (!revealed) return;

  const saveBtn = mkBtn('Save PNG');
  saveBtn.id = 'savePngBtn';
  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    try{
      saveBtn.disabled = true;
      const prev = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';
      await exportRevealedPng(card);
      saveBtn.textContent = prev;
    }catch (err){
      console.error('PNG export failed:', err);
      alert('Could not export PNG. Please try again.');
    }finally{
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save PNG';
    }
  }, { passive: true });

  el.appendChild(saveBtn);

  const shareBtn = mkBtn('Share result');
  shareBtn.id = 'shareResultBtn';
  shareBtn.addEventListener('click', async () => {
    try{
      const opt = resolveOptionFromCard(card);
      const label = opt && opt.label ? `Scratch card result: ${opt.label}` : 'Scratch card result';
      await safeShareLink(url, label);
    }catch (e){
      console.error('Share error:', e);
      await safeCopyLink(url, 'Scratch card result');
    }
  }, { passive: true });

  el.appendChild(shareBtn);
}



function renderRevealedActions(card){
  // Always show header actions (Copy link). Extra actions only when revealed.
  renderCardHeaderActions(card, !!(card && card.revealed));
}

function _blobDownload(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function _fetchAsDataUrl(url){
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error('Fetch failed: ' + url + ' (' + res.status + ')');
  const buf = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const ext = url.split('.').pop().toLowerCase();
  const mime =
    ext === 'woff2' ? 'font/woff2' :
    ext === 'woff' ? 'font/woff' :
    ext === 'svg' ? 'image/svg+xml' :
    ext === 'png' ? 'image/png' :
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    'application/octet-stream';
  return `data:${mime};base64,${b64}`;
}

async function _embedInterFontCss(){
  // Best-effort: embed the self-hosted Inter fonts into the SVG snapshot.
  // If any file is missing, we continue without embedding.
  const candidates = [
    { weight: 400, path: '/assets/fonts/inter-v20-latin-regular.woff2' },
    { weight: 500, path: '/assets/fonts/inter-v20-latin-500.woff2' },
    { weight: 700, path: '/assets/fonts/inter-v20-latin-700.woff2' },
  ];

  const rules = [];
  for (const c of candidates){
    try{
      const dataUrl = await _fetchAsDataUrl(c.path);
      rules.push(`
@font-face{
  font-family:"Inter";
  font-style:normal;
  font-weight:${c.weight};
  src:url("${dataUrl}") format("woff2");
}`);
    } catch {
      // ignore
    }
  }

  return rules.join('\n');
}

function _copyComputedStyles(sourceEl, targetEl){
  const cs = getComputedStyle(sourceEl);
  let cssText = '';
  for (let i = 0; i < cs.length; i++){
    const prop = cs[i];
    const val = cs.getPropertyValue(prop);
    // Skip properties that can break XML parsing or are irrelevant.
    if (!val) continue;
    cssText += `${prop}:${val};`;
  }
  targetEl.setAttribute('style', cssText);
}

function _inlineStylesDeep(sourceRoot, targetRoot){
  const sourceEls = [sourceRoot, ...sourceRoot.querySelectorAll('*')];
  const targetEls = [targetRoot, ...targetRoot.querySelectorAll('*')];

  for (let i = 0; i < sourceEls.length; i++){
    const s = sourceEls[i];
    const t = targetEls[i];
    if (!t) continue;
    _copyComputedStyles(s, t);
  }
}

function _makeSvgSnapshotMarkup(node, width, height, embeddedCss){
  const serializer = new XMLSerializer();
  const xhtml = serializer.serializeToString(node);

  const safeCss = (embeddedCss || '').replace(/<\/style>/g, '</sty' + 'le>');
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>${safeCss}</style>
      ${xhtml}
    </div>
  </foreignObject>
</svg>`.trim();
}

async function exportRevealedPng(card, opts = {}){
  // Only run on revealed state.
  if (!card || !card.revealed) throw new Error('Card not revealed');

  // Ensure the current view is fully rendered and fonts are ready.
  if (document.fonts && document.fonts.ready){
    // Avoid hanging forever.
    await Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const stage = document.querySelector('.scratch-stage');
  if (!stage) throw new Error('Missing .scratch-stage');

  // Clone only the card stage (no page UI).
  const clone = stage.cloneNode(true);
  clone.classList.add('is-exporting');

  // Ensure no shadow/filters on the clone root, regardless of computed styles.
  clone.style.boxShadow = 'none';
  clone.style.filter = 'none';

  // Best-effort: inline pattern URL to data URL so it renders inside SVG snapshot.
  try{
    const innerSrc = stage.querySelector('.scratch-stage__inner');
    const innerDst = clone.querySelector('.scratch-stage__inner');
    if (innerSrc && innerDst){
      const cs = getComputedStyle(innerSrc);
      const bgImg = cs.getPropertyValue('background-image') || '';
      const m = bgImg.match(/url\(["']?([^"')]+)["']?\)/i);
      if (m && m[1]){
        const url = m[1];
        // Only inline same-origin assets (avoid CORS).
        if (url.startsWith('/') || url.startsWith(window.location.origin)){
          const abs = url.startsWith('http') ? url : (window.location.origin + url);
          const dataUrl = await _fetchAsDataUrl(abs);
          innerDst.style.backgroundImage = `url("${dataUrl}")`;
        }
      }
    }

  // Inline any <img> sources inside the export root so foreignObject renders reliably.
  try{
    const imgsSrc = stage.querySelectorAll('img');
    const imgsDst = clone.querySelectorAll('img');
    const n = Math.min(imgsSrc.length, imgsDst.length);
    for (let i = 0; i < n; i++){
      const src = imgsSrc[i].getAttribute('src') || '';
      if (!src) continue;
      if (!(src.startsWith('/') || src.startsWith(window.location.origin))) continue;
      const abs = src.startsWith('http') ? src : (window.location.origin + src);
      const dataUrl = await _fetchAsDataUrl(abs);
      imgsDst[i].setAttribute('src', dataUrl);
    }
  } catch {
    // ignore
  }

  // Inline stage background image if present (used by image-backed cards).
  try{
    const csStage = getComputedStyle(stage);
    const bgImg = csStage.getPropertyValue('background-image') || '';
    const m = bgImg.match(/url\(["']?([^"')]+)["']?\)/i);
    if (m && m[1]){
      const url = m[1];
      if (url.startsWith('/') || url.startsWith(window.location.origin)){
        const abs = url.startsWith('http') ? url : (window.location.origin + url);
        const dataUrl = await _fetchAsDataUrl(abs);
        clone.style.backgroundImage = `url("${dataUrl}")`;
      }
    }
  } catch {
    // ignore
  }
  } catch {
    // ignore
  }

  // Mount offscreen to compute styles consistently.
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.style.width = stage.getBoundingClientRect().width + 'px';
  wrap.style.height = stage.getBoundingClientRect().height + 'px';
  wrap.style.zIndex = '-1';
  wrap.style.pointerEvents = 'none';
  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  try{
    // Inline all computed CSS into the clone.
    _inlineStylesDeep(stage, clone);

    const rect = stage.getBoundingClientRect();

// Export scale: 1 = same pixel size as on-screen.
// Increase to 2 if you want higher-resolution PNGs.
const scale = 2;

const w0 = Math.max(1, Math.round(rect.width));
const h0 = Math.max(1, Math.round(rect.height));

// Force the cloned root to the exact on-screen size so % widths resolve.
clone.style.width = w0 + 'px';
clone.style.height = h0 + 'px';
clone.style.maxWidth = 'none';
clone.style.margin = '0';
clone.style.display = 'block';

const embeddedFontCss = await _embedInterFontCss();

// SVG is authored at on-screen size; canvas handles pixel scaling.
const svgMarkup = _makeSvgSnapshotMarkup(clone, w0, h0, embeddedFontCss);
const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);

    const img = new Image();
    img.decoding = 'async';

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Snapshot image failed to load'));
      img.src = svgDataUrl;
    });

    const canvas = document.createElement('canvas');
canvas.width = Math.max(1, Math.round(w0 * scale));
canvas.height = Math.max(1, Math.round(h0 * scale));
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('No canvas context');

// Scale drawing so the image fills the canvas (no empty area).
ctx.setTransform(scale, 0, 0, scale, 0, 0);
ctx.drawImage(img, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encode failed');

    const ts = formatIso(new Date()).replace(/[:]/g, '').slice(0, 15);
    const filename = `chiccanto-${card.productId || 'card'}-${card.token}-${ts}.png`;

    const download = opts.download !== false;
    const outName = opts.filename || filename;

    if (download) _blobDownload(blob, outName);
    return blob;
  } finally {
    wrap.remove();
  }
}

function pickRandomOption(){
  const idx = Math.floor(Math.random() * getRevealOptions().length);
  return getRevealOptions()[idx];
}

function resolveOptionFromCard(card){
  if (card?.choice){
    const o1 = getRevealOptions().find(o => o.key === card.choice);
    if (o1) return o1;
  }
  if (card?.reveal_amount){
    const o2 = getRevealOptions().find(o => o.amount === card.reveal_amount);
    if (o2) return o2;
  }
  return getRevealOptions()[0];
}

// --- Deterministic board (no persistence needed) ---
function xfnv1a(str){
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a){
  return function(){
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededRng(seedStr){ return mulberry32(xfnv1a(seedStr)); }

function shuffleWithRng(arr, rng){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Only the winning tier appears 3 times. Other tiers appear at most 2 times.

function buildMatch3Board(totalTiles, winTier, tiers, seedKey){
  const total = Math.max(1, Math.min(9, Number(totalTiles) || 9));
  const rng = seededRng(seedKey);

  const allTiers = tiers && tiers.length ? tiers.slice() : ['t1','t2','t3','t4'];
  const others = allTiers.filter(t => t !== winTier);

  const board = [winTier, winTier, winTier];
  const counts = { [winTier]: 3 };
  let remaining = total - 3;

  for (const t of others){
    if (remaining <= 0) break;
    const add = Math.min(2, remaining);
    for (let i = 0; i < add; i++){
      board.push(t);
      counts[t] = (counts[t] || 0) + 1;
    }
    remaining -= add;
  }

  let guard = 0;
  while (remaining > 0 && guard++ < 200){
    const t = others[Math.floor(rng() * others.length)];
    if ((counts[t] || 0) >= 2) continue;
    board.push(t);
    counts[t] = (counts[t] || 0) + 1;
    remaining--;
  }

  return shuffleWithRng(board, rng);
}

function render(container, token, card){
  // Card is expected to already exist in storage (redeem/setup creates it).
  applyTheme(card.theme_id);

  const contentId = 'content';

  const params = new URLSearchParams(window.location.search);
  const setupParam = params.get('setup') || params.get('setup_key') || params.get('setupKey') || '';
  const hasSetupAccess = PREVIEW_MODE ? false : !!(setupParam && card.setup_key && setupParam === card.setup_key);

  // If a setup param is present, cache it for this token so we can recover sender setup
  // even if the backend redacts setup_key in intermediate responses (KV propagation, etc.).
  if (!PREVIEW_MODE && token && setupParam){
    const looksLikeKey = /^[A-Za-z0-9_-]{10,}$/.test(String(setupParam));
    if (looksLikeKey){
      try{ localStorage.setItem(`sc:setup:${token}`, String(setupParam)); }catch(_e){}
    }
  }


// Persist sender setup key locally so we can recover from accidentally opening the recipient link (token-only).
if (!PREVIEW_MODE && hasSetupAccess && token && card && card.setup_key){
  try{ localStorage.setItem(`sc:setup:${token}`, String(card.setup_key)); }catch(_e){}
}

const previewCta = PREVIEW_MODE ? `
  <div class="preview-line" role="note" aria-label="Preview notice">
    <span class="muted">Preview mode. Scratch for free. Activate to create a recipient link.</span>
  </div>
` : '';


  container.innerHTML = `
    ${previewCta}
    <div id="${contentId}"></div>
  `;

  const content = qs('#' + contentId, container);

  if (card.revealed){
    renderRevealed(content, card);
    return;
  }

  // Sender private link (setup param) should always show setup UI (even after configured),
  // so the buyer can copy/share the recipient link.
  if (hasSetupAccess){
    renderSetup(content, card, container);
    return;
  }

  if (!card.configured){
    renderNotReady(content, card);
    return;
  }

  renderScratch(content, card);
}

function renderSetup(root, card, container){
  const tierOptions = getRevealOptions().map(o => `
      <button class="btn" data-choice="${o.key}" type="button">${o.label}</button>
    `).join('');

  const theme = getCardTheme(card.card_key);
  const thumbSrc = (theme && theme.thumbSrc) ? theme.thumbSrc : '/assets/img/thumb_men-novice1.jpg';
  const cardName = (() => {
    const raw = String(card.card_key || '').trim();
    if (!raw) return 'Selected card';
    const cleaned = raw.replace(/\d+$/, '').replace(/-/g, ' ').trim();
    return cleaned.split(/\s+/).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : '').join(' ');
  })();

  root.innerHTML = `
    <div class="flow-screen stack">
      <div class="flow-layout">
        <div class="flow-intro">
          <h1 class="flow-title">Select the prize</h1>
          <p class="flow-lead muted">Choose what they can win, then send the recipient link.</p>
          <div class="flow-sub muted small">After you confirm, you have 5 seconds to change your mind.</div>
        </div>

        <section class="flow-panel--combined panel panel--glass panel--padded setup-unified" aria-label="Sender controls">
          <div class="panel-meta">
            <div>Step 2 - Choose prize</div>
            <div class="flow-panel__hint">Choose one</div>
          </div>

          <div class="setup-grid">
            <!-- Left: trust + guidance + random -->
            <div class="setup-left stack">
  <div class="setup-thumb">
    <div class="setup-thumb__media">
      <img class="card-preview__img" src="${thumbSrc}" alt="Card thumbnail" />
    </div>
    <div class="setup-thumb__info">
      <div class="mini-panel__kicker">Selected card</div>
      <div class="h3">${cardName}</div>
    </div>
  </div>



  <div class="mini-panel">
    <div class="mini-panel__kicker" style="display:flex; align-items:center; justify-content:space-between;">
      <span>Prefer not to choose?</span>
      <span>We pick</span>
    </div>
    <div class="small muted">Let ChicCanto pick one of the four prizes for you.</div>
    <button class="btn outline w-full" data-choice="${RANDOM_KEY}" type="button" style="margin-top:12px;">Surprise me (we choose)</button>


  </div>
</div><div class="setup-right">
              <div class="flow-section" aria-label="Prize level">
                <div class="flow-panel__head">
                  <div class="flow-panel__title">Prize level</div>
                  <div class="flow-panel__meta muted small">Locks after confirmation</div>
                </div>

                <div class="choice-grid choice-grid--4" role="group" aria-label="Choose a prize level">
                  ${tierOptions}
                </div>

                <div class="flow-status muted small" id="setupStatus"></div>
              </div>

              <div class="flow-divider" role="separator" aria-hidden="true"></div>

              <div class="flow-section" aria-label="Share link">
                <div class="flow-panel__head">
                  <div class="flow-panel__title">Recipient link</div>
                </div>

                <div class="sharebar">
                  <div class="sharebar__url" id="shareUrl">Pick a prize to generate the link</div>

                  <div class="sharebar__actions">
                    <button class="btn" id="copyBtn" type="button">Copy</button>
                    <button class="btn" id="shareBtn" type="button">Share</button>
                    <button class="btn" id="openBtn" type="button">Open as recipient</button>
                  </div>

                  <div class="sharebar__lock" id="changeRow" hidden>
                    <button class="btn" id="changeBtn" type="button">Cancel</button>
                    <div class="small muted" id="lockHint"></div>
                  </div>
                </div>

                <div class="flow-tip muted small">Tip: you can return to this setup link anytime to copy the recipient link again.</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
`;
const shareUrlEl = qs('#shareUrl', root);
  const copyBtn = qs('#copyBtn', root);
  const shareBtn = qs('#shareBtn', root);
  const openBtn = qs('#openBtn', root);
  const changeRow = qs('#changeRow', root);
  const changeBtn = qs('#changeBtn', root);
  const lockHintEl = qs('#lockHint', root);

  let shareUrl = null;

  // Pending lock timer (lets first-time buyers realize it's irreversible without adding extra clicks)
  let pending = null; // { interval, choice, chosen }

  function setChoiceButtonsEnabled(enabled){
    qsa('button[data-choice]', root).forEach(b => {
      b.disabled = !enabled;
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.style.opacity = enabled ? '1' : '0.6';
    });
  }

  function resetShareUI(){
    shareUrl = null;
    shareUrlEl.textContent = 'Pick a prize to generate the link.';
    // Disable actions until a prize is selected
    copyBtn.disabled = true;
    copyBtn.style.opacity = '.5';
    copyBtn.style.pointerEvents = 'none';

    if (shareBtn){
      shareBtn.disabled = true;
      shareBtn.style.opacity = '.5';
      shareBtn.style.pointerEvents = 'none';
    }

    openBtn.disabled = true;
    openBtn.style.opacity = '.5';
    openBtn.style.pointerEvents = 'none';

    changeRow.style.display = 'none';
    lockHintEl.textContent = '';
  }

  function enableShare(){
    shareUrlEl.textContent = shareUrl;

    copyBtn.disabled = false;
    copyBtn.style.opacity = '1';
    copyBtn.style.pointerEvents = 'auto';

    if (shareBtn){
      shareBtn.disabled = false;
      shareBtn.style.opacity = '1';
      shareBtn.style.pointerEvents = 'auto';
    }

    openBtn.disabled = false;
    openBtn.style.opacity = '1';
    openBtn.style.pointerEvents = 'auto';

    changeRow.style.display = 'none';
    lockHintEl.textContent = '';
  }

  function showPending(choice, chosen, secondsLeft){
    const label = chosen?.label || 'Your choice';
    shareUrlEl.textContent = `Selected ${label}. Locking in ${secondsLeft}…`;

    copyBtn.disabled = true;
    copyBtn.style.opacity = '.5';
    copyBtn.style.pointerEvents = 'none';

    if (shareBtn){
      shareBtn.disabled = true;
      shareBtn.style.opacity = '.5';
      shareBtn.style.pointerEvents = 'none';
    }

    openBtn.disabled = true;
    openBtn.style.opacity = '.5';
    openBtn.style.pointerEvents = 'none';

    changeRow.style.display = 'flex';
    lockHintEl.textContent = 'You can cancel until it locks.';
  }

  function cancelPending(){
    if (!pending) return;
    try{ clearInterval(pending.interval); }catch{}
    pending = null;
    setChoiceButtonsEnabled(true);
    resetShareUI();
  }

  async function lockChoice(choice, chosen){
    const nextCard = {
      ...card,
      configured: true,
      choice,
      reveal_amount: chosen.amount,
      fields: Number(card.fields || 9)
    };

    // Persist configuration to backend before enabling the recipient link.
    // This avoids intermittent "Not ready yet" on the recipient side when the sender shares too fast.
    const saved = await setConfiguredAndWait(card.token, {
      choice,
      reveal_amount: chosen.amount,
      fields: Number(card.fields || 9),
      card_key: card.card_key
    });

    if (!saved){
      // Keep local mirror for sender UX, but do not enable sharing until server confirms.
      _forcePersistConfiguredCard(card.token, nextCard);
      setChoiceButtonsEnabled(true);
      resetShareUI();
      window.alert('Could not save the card setup yet. Please try again.');
      return;
    }

    // Also keep local mirror aligned (helps if the browser reloads immediately).
    _forcePersistConfiguredCard(card.token, { ...nextCard, ...saved });

    shareUrl = makeAbsoluteCardLink(card.token);
    enableShare();

    // Lock setup after first configuration so the outcome can't be changed accidentally.
    setChoiceButtonsEnabled(false);
  }

  changeBtn.addEventListener('click', cancelPending);

  // If the card is already configured

  // Default state: actions look disabled until a prize is selected
  resetShareUI();

  // If the card is already configured (e.g. returning to the private setup link),
  // show the recipient link immediately and prevent changing the outcome.
  if (card && card.configured){
    shareUrl = makeAbsoluteCardLink(card.token);
    enableShare();
    setChoiceButtonsEnabled(false);
  }

  qsa('button[data-choice]', root).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (card && card.configured) return;

      // If user clicks again mid-countdown, treat it as a reset.
      if (pending) cancelPending();

      const choice = btn.dataset.choice;

      let chosen = null;
      if (choice === RANDOM_KEY) chosen = pickRandomOption();
      else chosen = getRevealOptions().find(o => o.key === choice) || getRevealOptions()[0];

      // IMPORTANT: persist the actual chosen tier key, not RANDOM_KEY.
      // Some backends treat unknown choice keys as a default and may ignore reveal_amount.
      // By storing the real tier key, the random pick becomes real and stable for the recipient.
      const effectiveChoice = (choice === RANDOM_KEY) ? (chosen?.key || getRevealOptions()[0].key) : choice;

      // Confirm before we start the lock countdown (prevents accidental taps).
      const confirmMsg = (choice === RANDOM_KEY)
        ? 'Confirm Surprise me? This locks a random prize tier and cannot be changed.'
        : `Confirm ${chosen.label}? This locks your choice and cannot be changed.`;

      if (!window.confirm(confirmMsg)) return;

      // Micro-step: brief lock countdown with a Cancel option.
      setChoiceButtonsEnabled(false);

      let secondsLeft = 5;
      showPending(choice, chosen, secondsLeft);

      pending = { interval: null, choice: effectiveChoice, chosen, displayChoice: choice };
      pending.interval = setInterval(async () => {
        secondsLeft -= 1;

        if (!pending) return;

        if (secondsLeft <= 0){
          try{ clearInterval(pending.interval); }catch{}
          const finalChoice = pending.choice;
          const finalChosen = pending.chosen;
          pending = null;
          await lockChoice(finalChoice, finalChosen);
          return;
        }

        showPending(choice, chosen, secondsLeft);
      }, 1000);
    });
  });

  copyBtn.addEventListener('click', async () => {
    if (!shareUrl) return;
    await safeCopyLink(shareUrl);
  });

  if (shareBtn){
    shareBtn.addEventListener('click', async () => {
      if (!shareUrl) return;
      await safeShareLink(shareUrl, 'ChicCanto card');
    });
  }

  // Open recipient link in a new tab/window so the sender can keep setup open.
// IMPORTANT: do not fall back to same-tab navigation, because some in-app browsers
// can return null from window.open() even when they still open a new view.
if (openBtn){
  openBtn.onclick = () => {
    if (!shareUrl) return;
    try{
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }catch{
      // If window.open is blocked, we intentionally do nothing here.
      // The user can use Copy/Share instead.
    }
  };
}
}

function renderNotReady(root, card){
  const url = window.location.href;
  const params = new URLSearchParams(window.location.search);
  const setupParam = params.get('setup') || params.get('setup_key') || params.get('setupKey') || '';
  const tokenParam = params.get('token') || (card && card.token) || '';
  let storedSetup = '';
  if (!setupParam && tokenParam){
    try{ storedSetup = localStorage.getItem(`sc:setup:${tokenParam}`) || ''; }catch(_e){}
  }

  const isRecipientLink = !setupParam;
  const canRecoverSender = isRecipientLink && !!(tokenParam && storedSetup);

  const mainCopy = isRecipientLink
    ? 'This is the recipient link. It cannot be used to set up the card.'
    : 'The sender is still setting it up. Try again in a moment.';

  const senderHint = canRecoverSender
    ? 'If you are the sender on this device, you can jump to your setup link now.'
    : 'If you are the sender, open your setup link (it includes an extra setup code).';

  root.innerHTML = `
    <section class="flow-screen">
      <div class="flow-layout">
        <div class="flow-intro">
          <h1 class="flow-title">Not ready yet</h1>
          <p class="flow-lead muted panel-meta">${mainCopy}</p>
        </div>
        <section class="flow-panel--combined panel panel--glass panel--padded" aria-label="Not ready">
          <div class="panel-meta">
            <div>Step 1</div>
            <div class="flow-panel__hint">${canRecoverSender ? 'Open sender setup' : 'Try again soon'}</div>
          </div>

          <div class="control-grid">
            <div class="actions" style="display:flex; gap:10px; flex-wrap:wrap;">
              ${canRecoverSender
                ? '<button class="btn primary" type="button" data-action="sender">Open sender setup</button>'
                : '<button class="btn primary" type="button" data-action="refresh">Refresh</button>'}
              <button class="btn outline" type="button" data-action="copy">Copy this link</button>
              <button class="btn outline" type="button" data-action="share">Share</button>
            </div>

            <p class="muted small" style="margin-top: 10px;">${senderHint}</p>
          </div>
        </section>
      </div>
    </section>
  `;

  const btnRefresh = root.querySelector('[data-action="refresh"]');
  const btnSender = root.querySelector('[data-action="sender"]');
  const btnCopy = root.querySelector('[data-action="copy"]');
  const btnShare = root.querySelector('[data-action="share"]');

  if (btnRefresh){
    btnRefresh.addEventListener('click', () => window.location.reload());
  }

  if (btnSender){
    btnSender.addEventListener('click', () => {
      if (!tokenParam || !storedSetup) return;
      const next = `${window.location.pathname}?token=${encodeURIComponent(tokenParam)}&setup=${encodeURIComponent(storedSetup)}`;
      window.location.assign(next);
    });
  }

  btnCopy.addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(url);
      btnCopy.textContent = 'Copied';
      setTimeout(() => (btnCopy.textContent = 'Copy this link'), 1200);
    }catch(_e){
      window.prompt('Copy this link:', url);
    }
  });

  btnShare.addEventListener('click', async () => {
    try{
      if (navigator.share){
        await navigator.share({ url });
        return;
      }
    }catch(_e){}
    try{
      await navigator.clipboard.writeText(url);
      btnShare.textContent = 'Copied';
      setTimeout(() => (btnShare.textContent = 'Share'), 1200);
    }catch(_e){
      window.prompt('Share this link:', url);
    }
  });
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function renderInvalidToken(container, token){
  const safeToken = escapeHtml(token);
  container.innerHTML = `
    <div class="card stack">
      <h2>Link not found</h2>
      <p>This card link does not exist or is incomplete. If you copied it manually, double-check the link.</p>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <a class="btn primary" href="/activate/">Go to activation</a>
        <button class="btn" type="button" data-action="copy">Copy this link</button>
      </div>
      <p class="small">Reference: <span class="mono">${safeToken}</span></p>
    </div>
  `;

  const btnCopy = container.querySelector('[data-action="copy"]');
  if (btnCopy){
    btnCopy.addEventListener('click', async () => {
      const ok = await copyText(window.location.href);
      btnCopy.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => (btnCopy.textContent = 'Copy this link'), 1200);
    });
  }
}

function renderApiUnavailable(container, token){
  const safeToken = escapeHtml(token);
  container.innerHTML = `
    <div class="card stack">
      <h2>Service unavailable</h2>
      <p>We could not reach the card service. Check your connection and try again.</p>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <button class="btn primary" type="button" data-action="retry">Try again</button>
        <a class="btn" href="/activate/?store=api">Go to activation</a>
        <button class="btn" type="button" data-action="local">Try local mode</button>
      </div>
      <p class="small">Reference: <span class="mono">${safeToken}</span></p>
    </div>
  `;

  container.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    window.location.reload();
  });

  container.querySelector('[data-action="local"]')?.addEventListener('click', () => {
    const u = new URL(window.location.href);
    u.searchParams.set('store', 'local');
    window.location.href = u.toString();
  });
}


function renderLegendPanel(opt){
  const rows = getRevealOptions().map((o, idx) => {
    const prizeNo = idx + 1;
    const src = tierIconSrc ? tierIconSrc(o.tier) : `/assets/img/${o.tier}.svg`;
    return `
      <div class="prize-row" data-tier="${o.tier}">
        <div class="prize-row__left">
          <div class="prize-row__icon">
            <img src="${src}" alt="${o.tier}" data-inline-svg="true">
          </div>
          <div class="prize-row__label">${o.label} <span class="prize-row__tag" data-role="prize-tag" hidden></span></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card-legend panel panel--glass">
      <h2>Match 3 to win</h2>
      <p class="rule-text">Scratch tiles until you reveal three matching icons</p>
      <div class="prize-list">
        ${rows}
      </div>
    </div>
  `;
}


function applyCardStageTheme(stageEl, theme){
  if (!stageEl || !theme || !theme.background) return;

  const bg = theme.background;

  // Reset
  stageEl.style.backgroundImage = '';
  stageEl.style.backgroundRepeat = '';
  stageEl.style.backgroundSize = '';
  stageEl.style.backgroundPosition = '';
  stageEl.style.backgroundColor = '';
  stageEl.style.removeProperty('--scratch-card-bg');
  stageEl.style.removeProperty('--scratch-card-pattern');
  stageEl.style.removeProperty('--scratch-card-pattern-size');
  stageEl.style.removeProperty('--scratch-card-pattern-opacity');

  const inner = stageEl.querySelector('.scratch-stage__inner');

  if (bg.type === 'image' && bg.imageSrc){
    // Use the stage background for full-cover images.
    stageEl.style.backgroundColor = bg.color || '#000';
    stageEl.style.backgroundImage = `url("${bg.imageSrc}")`;

  // Apply per-card visuals (title is set via template, background/pattern here).
  const stageEl = root.querySelector('.scratch-stage');
  if (stageEl) applyCardStageTheme(stageEl, theme);
    stageEl.style.backgroundRepeat = 'no-repeat';
    stageEl.style.backgroundSize = 'cover';
    stageEl.style.backgroundPosition = 'center';

    // Disable the pattern layer.
    if (inner){
      inner.style.backgroundImage = 'none';
      inner.style.opacity = '0';
    }
    return;
  }

  // Default: flat color + optional repeating pattern on inner layer.
  stageEl.style.setProperty('--scratch-card-bg', bg.color || '#1c1e1e');

  if (inner){
    inner.style.opacity = (bg.patternOpacity != null) ? String(bg.patternOpacity) : '1';
  }

  if (bg.patternSrc){
    stageEl.style.setProperty('--scratch-card-pattern', `url("${bg.patternSrc}")`);
  } else {
    stageEl.style.setProperty('--scratch-card-pattern', 'none');
    if (inner) inner.style.opacity = '0';
  }

  if (bg.patternSize){
    stageEl.style.setProperty('--scratch-card-pattern-size', String(bg.patternSize));
  }
}

function renderScratch(root, card){
  const cardKey = String(card?.card_key || '').trim() || 'men-novice1';
  setTileSet(cardKey);

  const theme = getCardTheme(cardKey);
  // Scratch foil (silver default, gold for birthday themes)
  const foil = (theme && theme.foil) ? theme.foil : (String(cardKey).includes('birthday') ? 'gold' : 'silver');
  document.documentElement.dataset.foil = foil;
  const titleSrc = (theme && theme.titleSrc) ? theme.titleSrc : '/assets/cards/men-novice1/title.svg';

  const bgDesktopSrc = (theme && theme.bgDesktopSrc) ? theme.bgDesktopSrc : '/assets/cards/men-novice1/bg-desktop.jpg';
  const bgMobileSrc  = (theme && theme.bgMobileSrc)  ? theme.bgMobileSrc  : bgDesktopSrc;


  renderCardHeaderActions(card, false);
  const shareUrl = makeAbsoluteCardLink(card.token);

  const opt = resolveOptionFromCard(card);
  const winTier = opt.tier || 't1';
  const tiers = uniq(getRevealOptions().map(o => o.tier)).filter(Boolean);
  const total = Math.max(1, Math.min(9, card.fields || 9));

  const generatedBoard = buildMatch3Board(total, winTier, tiers, `${card.token}|${winTier}`);
  const board = (Array.isArray(card.board) && card.board.length === total)
    ? card.board
    : generatedBoard;

  root.innerHTML = `
    <div class="card-screen">
<div class="scratch-fx">
        <span class="scratch-glow"></span>

            <div class="scratch-stage" data-export-root="1">
            <picture class="card-bg" aria-hidden="true" data-export-root="1">
  <source media="(max-width: 720px)" srcset="${bgMobileSrc}">
  <img class="card-bg__img" src="${bgDesktopSrc}" alt="" />
</picture>
              <h1 class="scratch-stage__title card-heading" aria-label="Scratch Match Up Game"><img class="scratch-title-img" src="${titleSrc}" alt="" /></h1>

              <div class="card-screen__body">
                ${renderLegendPanel(opt)}

                <div class="scratch-board">
                <div class="scratch-grid" id="board"></div>
                </div>
              </div>
            </div>
          </div>  

    </div>
  `;

  const boardEl = qs('#board', root);
  const copyLinkTop = root.querySelector('#copyLinkTop');
  if (copyLinkTop) {
    copyLinkTop.addEventListener('click', async () => {
      await safeCopyLink(shareUrl);
    });
  }

  const scratched = new Array(total).fill(false);
  const counts = {};
  let alreadyWon = false;

  function tierForIndex(i){ return board[i] || winTier; }

  for (let i = 0; i < total; i++){
    const tier = tierForIndex(i);
    const src = tierIconSrc ? tierIconSrc(tier) : `/assets/img/${tier}.svg`;

    const el = document.createElement('div');
    el.className = 'scratch-tile';
    el.dataset.tier = tier;
    el.innerHTML = `
      <div class="under">
        <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
          <img src="${src}" alt="${tier}" data-inline-svg="true">
          <span class="sub">scratch</span>
        </div>
      </div>
      <canvas aria-label="scratch tile"></canvas>
    `;
    boardEl.appendChild(el);

    const canvas = el.querySelector('canvas');
    attachScratchTile(canvas, { onScratched: () => onTileScratched(i, el) });
  }

  void hydrateInlineSvgs(root);

  installRotateGuard(root);

  
  // Exporter (Puppeteer) waits for this flag when present.

  async function markExportReadyWhenStable() {
    try {
      // Wait for fonts (if supported)
      if (document.fonts && document.fonts.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 1500))
        ]);
      }

      // Give layout a couple of frames
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Wait for images inside export root
      const root = document.querySelector('[data-export-root="1"]') || document.querySelector('.scratch-stage') || document.body;
      const imgs = Array.from(root.querySelectorAll('img'));
      await Promise.race([
        Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = () => res(); }))),
        new Promise((r) => setTimeout(r, 2000))
      ]);

    } catch {

    }
  }
// Signal to the server exporter that the card is ready to be captured.
  markExportReadyWhenStable();
function clearLegendState(){
    qsa('.prize-row__tag[data-role="prize-tag"]', root).forEach(el => {
      el.hidden = true;
      el.textContent = '';
    });
    qsa('.prize-row.is-winner', root).forEach(el => el.classList.remove('is-winner'));
  }

  function markLegendWinner(tier){
    clearLegendState();
    const winRow = qs(`.prize-row[data-tier="${tier}"]`, root);
    if (winRow){
      winRow.classList.add('is-winner');
      const tag = qs('[data-role="prize-tag"]', winRow);
      if (tag){
        tag.hidden = false;
      }
    }
  }

  function showWinUI(){
    // Show the result in the rules panel only.
    markLegendWinner(opt.tier);

    // Top-right only.

  }

  function onTileScratched(i, el){

    if (scratched[i]) return;

    scratched[i] = true;
    el.classList.add('done');

    const tier = tierForIndex(i);
    counts[tier] = (counts[tier] || 0) + 1;

    if (!alreadyWon && counts[winTier] >= 3){
      alreadyWon = true;
      const scratched_indices = scratched
        .map((v, idx) => v ? idx : -1)
        .filter(idx => idx !== -1);
      setRevealed(card.token, { board, scratched_indices });
      // Show Save PNG immediately on reveal (no refresh required)
      renderRevealedActions(getCard(card.token) || card);
      fireWinTurboFlash();
      showWinUI();
    }
  }
}

function renderRevealed(root, card){
  renderRevealedActions(card);

  const cardKey = String(card?.card_key || '').trim() || 'men-novice1';
  setTileSet(cardKey);

  const theme = getCardTheme(cardKey);
  const titleSrc = (theme && theme.titleSrc) ? theme.titleSrc : '/assets/cards/men-novice1/title.svg';
  const bgDesktopSrc = (theme && theme.bgDesktopSrc) ? theme.bgDesktopSrc : '/assets/cards/men-novice1/bg-desktop.jpg';
  const bgMobileSrc  = (theme && theme.bgMobileSrc)  ? theme.bgMobileSrc  : bgDesktopSrc;

  const opt = resolveOptionFromCard(card);
  const winTier = opt.tier || 't1';
  const tiers = uniq(getRevealOptions().map(o => o.tier)).filter(Boolean);
  const total = Math.max(1, Math.min(9, card.fields || 9));

  const generatedBoard = buildMatch3Board(total, winTier, tiers, `${card.token}|${winTier}`);
  const board = (Array.isArray(card.board) && card.board.length === total)
    ? card.board
    : generatedBoard;

  root.innerHTML = `
    <div class="card-screen">
      <div class="scratch-fx">
        <span class="scratch-glow"></span>

        <div class="scratch-stage" data-export-root="1">
          <picture class="card-bg" aria-hidden="true" data-export-root="1">
            <source media="(max-width: 720px)" srcset="${bgMobileSrc}">
            <img class="card-bg__img" src="${bgDesktopSrc}" alt="" />
          </picture>

          <h1 class="scratch-stage__title card-heading" aria-label="Scratch Match Up Game">
            <img class="scratch-title-img" src="${titleSrc}" alt="" />
          </h1>

          <div class="card-screen__body">
            ${renderLegendPanel(opt)}
            <div class="scratch-board">
              <div class="scratch-grid" id="boardStatic"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const boardEl = qs('#boardStatic', root);
  for (let i = 0; i < board.length; i++){
    const tier = board[i];
    const src = tierIconSrc(tier);
    const el = document.createElement('div');
    el.className = 'scratch-tile done';
    el.dataset.tier = tier;
    el.innerHTML = `
      <div class="under">
        <div style="display:flex; align-items:center; justify-content:center;">
          <img src="${src}" alt="${tier}" data-inline-svg="true">
        </div>
      </div>
    `;
    boardEl.appendChild(el);
  }

  void hydrateInlineSvgs(root);
  installRotateGuard(root);

  // Legend: highlight the revealed tier only.
  qsa('.prize-row__tag[data-role="prize-tag"]', root).forEach(el => {
    el.hidden = true;
    el.textContent = '';
  });
  qsa('.prize-row.is-winner', root).forEach(el => el.classList.remove('is-winner'));
  const winRow = qs(`.prize-row[data-tier="${opt.tier}"]`, root);
  if (winRow){
    winRow.classList.add('is-winner');
    const tag = qs('[data-role="prize-tag"]', winRow);
    if (tag) tag.hidden = true;
  }
}

export async function bootCard(){
  const container = qs('#app');

  const params = new URLSearchParams(window.location.search);
  let token = getTokenFromUrl();

  // Preview mode is only when explicitly requested and there is no real token in the URL.
  PREVIEW_MODE = params.has('preview') && !token;

  // Public preview: allow scratch without a shareable token in the URL.
  if (!token && PREVIEW_MODE){
    // Keep a stable token per tab session so the preview doesn't reset mid-try.
    const key = 'sc:preview_token';
    let t = '';
    try{ t = sessionStorage.getItem(key) || ''; }catch{}
    if (!TOKEN_RE.test(t)){
      try{
        t = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + '-0000');
      }catch{
        t = (Math.random().toString(16).slice(2) + '-0000');
      }
      try{ sessionStorage.setItem(key, t); }catch{}
    }
    token = t;

    // Ensure a configured preview card exists (recipient scratch flow only).
    const card0 = ensureCard(token);
    if (!card0.configured){
      const opt = pickRandomOption();
      setConfigured(token, { choice: opt.key, reveal_amount: opt.amount, fields: Number(card0.fields || 9) });
    }

    const card = getCard(token);
    if (card){
      render(container, token, card);
      return;
    }
    // If storage is blocked and we can't create a card, fall through to the missing-link screen.
  }

  if (!token){
    container.innerHTML = `
      <div class="card">
        <h2>Link missing</h2>
        <p>Open a ChicCanto card link, or preview an example.</p>
        <div class="row">
          <a class="btn primary" href="/preview/">Preview</a>
          <a class="btn" href="/activate/">Go to activation</a>
        </div>
      </div>
    `;
    return;
  }

  // If the token doesn't even match expected format, treat as an invalid link immediately.
  if (!TOKEN_RE.test(token)){
    renderInvalidToken(container, token);
    return;
  }

  const storeParam = (params.get('store') || '').toLowerCase();

  // Fast path: local mirror (works for same-device refreshes)
  let card = getCard(token);

  // If we didn't find a local record, try the API (same-origin on live/staging).
  const isForceLocal = storeParam === 'local' || storeParam === 'memory';
  if (!card && !isForceLocal){
    card = await getCardAsync(token);
  }

  if (!card){
    renderInvalidToken(container, token);
    return;
  }

  render(container, token, card);
}

// --- Orientation / minimum tile size guard (mobile) ---

function applyTheme(themeId){
  try{
    const body = document.body;
    // remove existing theme-* classes
    body.className.split(/\s+/).forEach(c => {
      if (c && c.startsWith('theme-')) body.classList.remove(c);
    });
    if (typeof themeId === 'string' && themeId.startsWith('theme-')){
      body.classList.add(themeId);
    }
  }catch{}
}

const CC_MIN_TILE_PX = 56;
let rotateGuardInstalled = false;

function ensureRotateOverlay(){
  let el = document.getElementById('rotateOverlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'rotateOverlay';
  el.className = 'rotate-overlay';
  el.innerHTML = `
    <div class="rotate-overlay__card" role="dialog" aria-modal="true" aria-label="Rotate device">
      <div class="rotate-overlay__title">Rotate for the best scratch experience</div>
      <div class="rotate-overlay__text">
        This screen is a bit too narrow to scratch comfortably. Turn your phone to landscape.
      </div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

function updateRotateGuard(){
  const overlay = ensureRotateOverlay();
  const isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;

  // Measure a tile (if present)
  const tile = document.querySelector('.scratch-board .scratch-tile');
  const w = tile ? tile.getBoundingClientRect().width : 999;

  const needsLandscape = !!(isPortrait && w && w < CC_MIN_TILE_PX);
  document.body.classList.toggle('force-landscape', needsLandscape);

  // Keep overlay in DOM; CSS controls visibility
  overlay.setAttribute('aria-hidden', needsLandscape ? 'false' : 'true');
}

function installRotateGuard(){
  ensureRotateOverlay();
  updateRotateGuard();

  if (rotateGuardInstalled) return;
  rotateGuardInstalled = true;

  window.addEventListener('resize', updateRotateGuard, { passive: true });
  window.addEventListener('orientationchange', updateRotateGuard, { passive: true });
}

function prefersReducedMotion(){
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}


// --- Foil flake burst (lightweight reveal FX) --------------------------------
// Replaces the old fireworks lib (which can freeze iOS Safari and fails on repeated runs).
// Goal: quick, fun "burst" with minimal main-thread work, safe on mobile.

function _ccIsMobile(){
  try{
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }catch(_){ return false; }
}

function _ccLowEndHint(){
  // Conservative: treat unknown as not-low-end.
  try{
    const cores = Number(navigator.hardwareConcurrency || 0);
    const mem = Number(navigator.deviceMemory || 0);
    return (_ccIsMobile() && ((cores && cores <= 4) || (mem && mem <= 4)));
  }catch(_){ return false; }
}

let _ccBurst = null;

function _ccEnsureBurstCanvas(){
  if (_ccBurst && _ccBurst.canvas && _ccBurst.ctx) return _ccBurst;

  const canvas = document.createElement('canvas');
  canvas.id = 'cc-burst-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '9999',
    display: 'none'
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: true });

  _ccBurst = { canvas, ctx, raf: 0, running: false, particles: [] };
  _ccResizeBurstCanvas();
  window.addEventListener('resize', _ccResizeBurstCanvas, { passive: true });

  // Warm-up: avoid "first draw" jank later.
  try{
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }catch(_){}

  return _ccBurst;
}

function _ccResizeBurstCanvas(){
  if (!_ccBurst || !_ccBurst.canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1); // cap DPR for perf
  const w = Math.max(1, Math.floor(window.innerWidth * dpr));
  const h = Math.max(1, Math.floor(window.innerHeight * dpr));
  const c = _ccBurst.canvas;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  _ccBurst.dpr = dpr;
}

function _ccGetBurstOrigin(){
  // Try to burst from the center of the card stage.
  const el = document.querySelector('.scratch-stage, .cc-card, .cc-card-wrap, .card-shell');
  if (el){
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.58 };
}

function _ccCreateFoilParticles(px, py, dpr, config){
  const particles = [];
  const count = config.count;
  const spread = config.spread; // radians-ish factor
  const minSpeed = config.minSpeed;
  const maxSpeed = config.maxSpeed;

  for (let i = 0; i < count; i++){
    // Direction roughly upward with wide spread
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * spread;
    const speed = (minSpeed + Math.random() * (maxSpeed - minSpeed)) * dpr;

    const w = (config.minSize + Math.random() * (config.maxSize - config.minSize)) * dpr;
    const h = (w * (0.4 + Math.random() * 0.9));

    particles.push({
      x: px,
      y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w,
      h,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * config.spin,
      life: 0,
      ttl: config.durationMs,
      // light "metal" palette
      tone: Math.random()
    });
  }

  return particles;
}

function _ccDrawFoil(ctx, p, alpha){
  // Color: mostly silver/white with a hint of warm/cool variation
  let r, g, b;
  if (p.tone < 0.7){
    r = 235; g = 235; b = 245; // cool silver
  } else if (p.tone < 0.9){
    r = 245; g = 240; b = 230; // warm pearl
  } else {
    r = 220; g = 240; b = 255; // icy sparkle
  }

  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgb(${r},${g},${b})`;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.restore();

  // Tiny sparkle cross (very cheap)
  if (alpha > 0.4 && p.life < 260){
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = `rgb(${255},${255},${255})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x - p.w * 0.25, p.y);
    ctx.lineTo(p.x + p.w * 0.25, p.y);
    ctx.moveTo(p.x, p.y - p.h * 0.25);
    ctx.lineTo(p.x, p.y + p.h * 0.25);
    ctx.stroke();
  }
}

function _ccStopBurst(){
  if (!_ccBurst) return;
  _ccBurst.running = false;
  if (_ccBurst.raf) cancelAnimationFrame(_ccBurst.raf);
  _ccBurst.raf = 0;
  _ccBurst.particles = [];
  try{
    _ccBurst.ctx.clearRect(0, 0, _ccBurst.canvas.width, _ccBurst.canvas.height);
  }catch(_){}
  _ccBurst.canvas.style.display = 'none';
}

function _ccStartFoilBurst(originCssX, originCssY){
  const b = _ccEnsureBurstCanvas();
  if (!b.ctx) return;

  // Kill any previous animation cleanly.
  if (b.running) _ccStopBurst();

  const dpr = b.dpr || 1;
  const px = originCssX * dpr;
  const py = originCssY * dpr;

  const isMobile = _ccIsMobile();
  const lowEnd = _ccLowEndHint();

  const config = {
    durationMs: lowEnd ? 650 : (isMobile ? 800 : 1000),
    count: lowEnd ? 18 : (isMobile ? 28 : 56),
    spread: isMobile ? 2.6 : 3.0,
    minSpeed: isMobile ? 420 : 520,
    maxSpeed: isMobile ? 900 : 1200,
    minSize: isMobile ? 6 : 7,
    maxSize: isMobile ? 12 : 14,
    spin: isMobile ? 10 : 14,
    gravity: (isMobile ? 1350 : 1650) * dpr,
    drag: isMobile ? 0.975 : 0.982
  };

  b.particles = _ccCreateFoilParticles(px, py, dpr, config);

  b.canvas.style.display = 'block';
  b.running = true;

  const ctx = b.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none'; // important: no blur filters on iOS

  let start = 0;
  let last = 0;

  function step(t){
    if (!b.running) return;
    if (!start){ start = t; last = t; }

    const dt = Math.min(0.033, (t - last) / 1000); // clamp dt
    last = t;

    const elapsed = t - start;
    const p = Math.min(1, elapsed / config.durationMs);

    ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);

    for (let i = 0; i < b.particles.length; i++){
      const part = b.particles[i];
      part.life = elapsed;

      // Integrate motion
      part.vx *= Math.pow(config.drag, dt * 60);
      part.vy = part.vy * Math.pow(config.drag, dt * 60) + config.gravity * dt;

      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.rot += part.vr * dt;

      const alpha = (1 - p) * 0.95;
      _ccDrawFoil(ctx, part, alpha);
    }

    if (elapsed < config.durationMs){
      b.raf = requestAnimationFrame(step);
    } else {
      _ccStopBurst();
    }
  }

  b.raf = requestAnimationFrame(step);
}

const _ccBurstShown = new Set();


/* --------------------------
   Win FX (border/glow pulse)
   Uses existing .scratch-fx neon border, no canvas.
-------------------------- */

let _ccWinFxStyleInjected = false;

function _ccInjectWinFxStyles(){
  if (_ccWinFxStyleInjected) return;
  _ccWinFxStyleInjected = true;
  const css = `
    /* Win pulse ring: fast, no blur, mobile-safe */
    .scratch-fx.cc-win-pulse::after{
      content:'';
      position:absolute;
      inset:0;
      border-radius: inherit;
      pointer-events:none;
      opacity:0;
      box-shadow: 0 0 0 2px rgba(255,255,255,.55);
      animation: ccWinRing 650ms ease-out 1;
    }
    @keyframes ccWinRing{
      0%   { opacity: 0; transform: scale(0.992); }
      30%  { opacity: 1; transform: scale(1.002); }
      100% { opacity: 0; transform: scale(1.01); }
    }

    /* Slightly lift the existing neon border during the pulse */
    .scratch-fx.cc-win-pulse::before{
      opacity: 1 !important;
      box-shadow: 0 0 0 2px rgba(255,255,255,.12);
    }

    /* Never include win FX in export clones */
    .is-exporting .scratch-fx.cc-win-pulse::after{ display:none !important; }

    /* Star sparkle burst: light celebration, no blur, iOS-safe */
    .cc-sparkle-burst{
      position:absolute;
      inset:0;
      pointer-events:none;
      overflow:visible;
      z-index: 5;
    }
    .cc-sparkle{
      position:absolute;
      left: var(--x, 50%);
      top: var(--y, 50%);
      width: var(--sz, 12px);
      height: var(--sz, 12px);
      margin-left: calc(var(--sz, 12px) * -0.5);
      margin-top: calc(var(--sz, 12px) * -0.5);
      background: linear-gradient(45deg, rgba(255,255,255,.95), rgba(255,255,255,.45));
      opacity: 0;
      transform: translate(0,0) scale(.4) rotate(0deg);
      transform-origin: center;
      /* Star shape */
      -webkit-clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
      clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
      animation: ccSparkleBurst 650ms cubic-bezier(.2,.9,.2,1) var(--dly, 0ms) 1 both;
    }
    @keyframes ccSparkleBurst{
      0%   { opacity: 0; transform: translate(0,0) scale(.35) rotate(0deg); }
      18%  { opacity: 1; transform: translate(calc(var(--dx, 0px) * .15), calc(var(--dy, 0px) * .15)) scale(1.15) rotate(calc(var(--rot, 0deg) * .25)); }
      100% { opacity: 0; transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(.25) rotate(var(--rot, 0deg)); }
    }

    /* Never include sparkle burst in export clones */
    .is-exporting .cc-sparkle-burst{ display:none !important; }
    `;
  const style = document.createElement('style');
  style.id = 'cc-winfx-style';
  style.textContent = css;
  document.head.appendChild(style);
}


function fireWinTurboFlash(){
  try{
    if (prefersReducedMotion()) return;
    const fx = document.querySelector('.scratch-fx');
    if (!fx) return;

    // Temporary turbo + flash driven by card.css (.cc-win-turbo)
    fx.classList.remove('cc-win-turbo');
    void fx.offsetWidth; // restart animation
    fx.classList.add('cc-win-turbo');

    window.setTimeout(() => {
      fx.classList.remove('cc-win-turbo');
    }, 1000);
  } catch(_){}
}

function fireWinPulse(){
  try{
    if (prefersReducedMotion()) return;
    _ccInjectWinFxStyles();
    const fx = document.querySelector('.scratch-fx');
    if (!fx) return;

    // Restart animation reliably
    fx.classList.remove('cc-win-pulse');
    // Force reflow so the animation restarts
    void fx.offsetWidth;
    fx.classList.add('cc-win-pulse');

    window.setTimeout(() => {
      fx.classList.remove('cc-win-pulse');
    }, 800);
  } catch(_){}
}


function fireSparkleBurst(){
  try{
    if (prefersReducedMotion()) return;

    _ccInjectWinFxStyles();

    const fx = document.querySelector('.scratch-fx');
    if (!fx) return;

    // Remove any prior burst remnants
    const old = fx.querySelector('.cc-sparkle-burst');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.className = 'cc-sparkle-burst';

    // Origin: center of the scratch stage (reads well and avoids layout work)
    const originX = 50;
    const originY = 40; // slightly above center feels nicer with the board

    const isMobile = _ccIsMobile();
    const lowEnd = _ccLowEndHint();
    const count = lowEnd ? 8 : (isMobile ? 12 : 16);
    const maxR = lowEnd ? 60 : (isMobile ? 85 : 110);

    for (let i = 0; i < count; i++){
      const s = document.createElement('span');
      s.className = 'cc-sparkle';

      const angle = Math.random() * Math.PI * 2;
      const radius = (0.35 + Math.random() * 0.65) * maxR;

      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius * 0.85;

      const size = (lowEnd ? 10 : (isMobile ? 12 : 14)) + Math.random() * 6;
      const rot = (Math.random() * 260 - 130).toFixed(1) + 'deg';
      const dly = Math.floor(Math.random() * 90) + 'ms';

      s.style.setProperty('--x', originX + '%');
      s.style.setProperty('--y', originY + '%');
      s.style.setProperty('--dx', dx.toFixed(1) + 'px');
      s.style.setProperty('--dy', dy.toFixed(1) + 'px');
      s.style.setProperty('--sz', size.toFixed(1) + 'px');
      s.style.setProperty('--rot', rot);
      s.style.setProperty('--dly', dly);

      wrap.appendChild(s);
    }

    // Insert above stage so it aligns with the neon frame
    fx.appendChild(wrap);

    // Clean up after animation
    window.setTimeout(() => {
      try{ wrap.remove(); } catch(_){}
    }, 900);
  } catch(_){}
}


function fireFoilBurst(token){
  // Burst FX is deprecated (kept for compatibility).
  return;
// Public entry point: safe, fast, and repeatable across multiple cards in one session.
  if (prefersReducedMotion()) return;
  if (typeof window.CC_REVEAL_FX === 'string' && window.CC_REVEAL_FX.toLowerCase() === 'off') return;
  if (!token) token = 'no-token';

  // Once per token per page-load. (No localStorage, so it won't "break" future cards.)
  if (_ccBurstShown.has(token)) return;
  _ccBurstShown.add(token);

  const o = _ccGetBurstOrigin();
  _ccStartFoilBurst(o.x, o.y);
}

// Warm up canvas after DOM is ready (reduces first-run jank on iOS).
// (Burst warmup removed)
