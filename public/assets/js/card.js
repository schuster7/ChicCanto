import { qs, qsa, copyText, formatIso, getTokenFromUrl } from './utils.js';
import { REVEAL_OPTIONS, RANDOM_KEY, tierIconSrc, setTileSet } from './config.js';
import { getCardTheme } from './card-themes.js';
import { getCard, getCardAsync, ensureCard, setConfigured, setRevealed } from './store.js';
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

    // After inlining styles, force the card background layer to a data URL based on card theme.
    // This avoids var() + external URL issues inside the SVG foreignObject snapshot.
    try {
      const cardKey = (card && card.init && card.init.card_key) ? card.init.card_key : (card && card.card_key ? card.card_key : '');
      const theme = getCardTheme(cardKey);
      const innerDst = clone.querySelector('.scratch-stage__inner');

      if (theme && theme.background && innerDst) {
        // Base color on the stage itself
        if (theme.background.color) {
          clone.style.background = theme.background.color;
        }

        if (theme.background.type === 'image' && theme.background.imageSrc) {
          const src = theme.background.imageSrc;
          const abs = src.startsWith('http') ? src : (window.location.origin + src);
          const dataUrl = await _fetchAsDataUrl(abs);

          innerDst.style.backgroundImage = `url("${dataUrl}")`;
          innerDst.style.backgroundRepeat = 'no-repeat';
          innerDst.style.backgroundPosition = 'center';
          innerDst.style.backgroundSize = 'cover';
          innerDst.style.opacity = '1';
        } else if (theme.background.type === 'pattern' && theme.background.patternSrc) {
          const src = theme.background.patternSrc;
          const abs = src.startsWith('http') ? src : (window.location.origin + src);
          const dataUrl = await _fetchAsDataUrl(abs);

          innerDst.style.backgroundImage = `url("${dataUrl}")`;
          innerDst.style.backgroundRepeat = 'repeat';
          innerDst.style.backgroundPosition = '0 0';
          innerDst.style.backgroundSize = theme.background.patternSize || 'clamp(160px, 18vw, 280px) clamp(160px, 18vw, 280px)';
          innerDst.style.opacity = theme.background.patternOpacity || '1';
        }
      }
    } catch {
      // ignore
    }

    // Inline all <img> sources inside the clone so foreignObject renders reliably.
    try {
      const imgs = clone.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        if (!src) continue;
        if (!(src.startsWith('/') || src.startsWith(window.location.origin))) continue;
        const abs = src.startsWith('http') ? src : (window.location.origin + src);
        img.setAttribute('src', await _fetchAsDataUrl(abs));
      }
    } catch {
      // ignore
    }

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
  const idx = Math.floor(Math.random() * REVEAL_OPTIONS.length);
  return REVEAL_OPTIONS[idx];
}

function resolveOptionFromCard(card){
  if (card?.choice){
    const o1 = REVEAL_OPTIONS.find(o => o.key === card.choice);
    if (o1) return o1;
  }
  if (card?.reveal_amount){
    const o2 = REVEAL_OPTIONS.find(o => o.amount === card.reveal_amount);
    if (o2) return o2;
  }
  return REVEAL_OPTIONS[0];
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
  const options = REVEAL_OPTIONS.map(o => `
      <button class="btn" data-choice="${o.key}" type="button">${o.label}</button>
    `).join('');

  root.innerHTML = `
    <div class="flow-screen stack">
      <div class="flow-layout">
        <div class="flow-intro">
          <div class="flow-kicker">Sender setup</div>
          <h1 class="flow-title">Select the prize</h1>
          <p class="flow-lead muted">Pick a prize tier and send the recipient link.</p>
          <div class="flow-sub muted small">After you confirm, you have 5 seconds to change your mind.</div>
        </div>

        <section class="flow-panel--combined panel panel--glass panel--padded" aria-label="Sender controls">
          <div class="flow-section" aria-label="Prize level">
            <div class="flow-panel__head">
              <div class="flow-panel__title">Prize level</div>
              <div class="flow-panel__meta muted small">Locks after confirmation</div>
            </div>

            <div class="choice-grid" role="group" aria-label="Choose a prize level">
              ${options}
              <button class="btn" data-choice="${RANDOM_KEY}" type="button">Surprise me</button>
            </div>

            <div class="flow-status muted small" id="setupStatus"></div>
          </div>

          <div class="flow-divider" role="separator" aria-hidden="true"></div>

          <div class="flow-section" aria-label="Share link">
            <div class="flow-panel__head">
              <div class="flow-panel__title">Recipient link</div>
            </div>

            <div class="sharebar">
              <div class="sharebar__url mono" id="shareUrl">Pick a prize to generate the link</div>

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
    copyBtn.disabled = true;
    if (shareBtn) shareBtn.disabled = true;
    openBtn.href = '#';
    openBtn.style.pointerEvents = 'none';
    openBtn.style.opacity = '.5';
    changeRow.style.display = 'none';
    lockHintEl.textContent = '';
  }

  function enableShare(){
    shareUrlEl.textContent = shareUrl;
    copyBtn.disabled = false;
    if (shareBtn) shareBtn.disabled = false;
    openBtn.href = shareUrl;
    openBtn.style.pointerEvents = 'auto';
    openBtn.style.opacity = '1';
    changeRow.style.display = 'none';
    lockHintEl.textContent = '';
  }

  function showPending(choice, chosen, secondsLeft){
    const label = chosen?.label || 'Your choice';
    shareUrlEl.textContent = `Selected ${label}. Locking in ${secondsLeft}…`;
    copyBtn.disabled = true;
    if (shareBtn) shareBtn.disabled = true;
    openBtn.href = '#';
    openBtn.style.pointerEvents = 'none';
    openBtn.style.opacity = '.5';

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

    // Keep the existing store update (whatever backend it's using)...
    setConfigured(card.token, {
      choice,
      reveal_amount: chosen.amount,
      fields: Number(card.fields || 9)
    });

    // ...but also force-persist the configured flag locally so the share link works reliably.
    _forcePersistConfiguredCard(card.token, nextCard);

    shareUrl = makeAbsoluteCardLink(card.token);
    enableShare();

    // Lock setup after first configuration so the outcome can't be changed accidentally.
    setChoiceButtonsEnabled(false);
  }

  changeBtn.addEventListener('click', cancelPending);

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
      else chosen = REVEAL_OPTIONS.find(o => o.key === choice) || REVEAL_OPTIONS[0];

      // Confirm before we start the lock countdown (prevents accidental taps).
      const confirmMsg = (choice === RANDOM_KEY)
        ? 'Confirm Surprise me? This locks a random prize tier and cannot be changed.'
        : `Confirm ${chosen.label}? This locks your choice and cannot be changed.`;

      if (!window.confirm(confirmMsg)) return;

      // Micro-step: brief lock countdown with a Cancel option.
      setChoiceButtonsEnabled(false);

      let secondsLeft = 5;
      showPending(choice, chosen, secondsLeft);

      pending = { interval: null, choice, chosen };
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
  // (Previously this was treated like an <a href>, but the UI uses a <button>.)
  if (openBtn){
    openBtn.addEventListener('click', () => {
      if (!shareUrl) return;
      try{
        const w = window.open(shareUrl, '_blank', 'noopener,noreferrer');
        // If blocked, fall back to same-tab navigation.
        if (!w) window.location.href = shareUrl;
      }catch{
        window.location.href = shareUrl;
      }
    });
  }
}

function renderNotReady(root, card){
  const url = window.location.href;

  root.innerHTML = `
    <div class="card stack">
      <h2>Not ready yet</h2>
      <p>The sender is still setting it up. Ask them for the recipient link, or try again in a moment.</p>

      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <button class="btn primary" type="button" data-action="refresh">Refresh</button>
        <button class="btn" type="button" data-action="copy">Copy this link</button>
        <button class="btn" type="button" data-action="share">Share</button>
      </div>

      <hr>

      <p class="small">If you are the sender, open your setup link. This recipient link cannot be configured.</p>
    </div>
  `;

  const btnRefresh = root.querySelector('[data-action="refresh"]');
  const btnCopy = root.querySelector('[data-action="copy"]');
  const btnShare = root.querySelector('[data-action="share"]');

  if (btnRefresh){
    btnRefresh.addEventListener('click', () => location.reload());
  }

  if (btnCopy){
    btnCopy.addEventListener('click', async () => {
      await safeCopyLink(url);
    });
  }

  if (btnShare){
    btnShare.addEventListener('click', async () => {
      try{
        if (navigator.share){
          await navigator.share({ title: 'ChicCanto', url });
          return;
        }
      }catch{}
      await safeShareLink(url, 'Scratch card link');
    });
  }
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
  const rows = REVEAL_OPTIONS.map((o, idx) => {
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
  const titleSrc = (theme && theme.titleSrc) ? theme.titleSrc : '/assets/cards/men-novice1/title.svg';

  renderCardHeaderActions(card, false);
  const shareUrl = makeAbsoluteCardLink(card.token);

  const opt = resolveOptionFromCard(card);
  const winTier = opt.tier || 't1';
  const tiers = uniq(REVEAL_OPTIONS.map(o => o.tier)).filter(Boolean);
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
            <div class="scratch-stage__inner" data-export-root="1"></div>
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
  const shareUrl = makeAbsoluteCardLink(card.token);

  const opt = resolveOptionFromCard(card);
  const winTier = opt.tier || 't1';
  const tiers = uniq(REVEAL_OPTIONS.map(o => o.tier)).filter(Boolean);
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
          <div class="scratch-stage__inner" data-export-root="1"></div>
            <h1 class="scratch-stage__title card-heading" aria-label="Scratch Match Up Game">
<svg class="scratch-title-svg" viewBox="0 0 500 27.115" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<g fill="currentColor">
	<polygon points="16.514,16.952 16.282,16.952 4.895,0.36 0,0.36 0,26.741 5.577,26.741 5.577,10.138 5.771,10.138 17.248,26.741 
		22.066,26.741 22.066,0.36 16.514,0.36 	"/>
	<path d="M34.341,0.36l-9.107,26.381h5.977l1.957-6.016h9.525l1.953,6.016h5.977L41.529,0.36H34.341z M34.585,16.372l3.248-9.984
		h0.206l3.242,9.984H34.585z"/>
	<path d="M70.087,17.016c0,1.004-0.221,1.897-0.663,2.679s-1.065,1.396-1.867,1.843c-0.804,0.447-1.745,0.669-2.828,0.669
		c-1.074,0-2.014-0.222-2.821-0.669c-0.808-0.447-1.432-1.061-1.875-1.843c-0.442-0.782-0.663-1.675-0.663-2.679V0.36h-5.577v17.132
		c0,1.924,0.455,3.607,1.366,5.049c0.91,1.443,2.185,2.566,3.826,3.37c1.64,0.802,3.555,1.204,5.745,1.204
		c2.181,0,4.092-0.402,5.732-1.204c1.64-0.804,2.917-1.926,3.832-3.37c0.915-1.442,1.372-3.126,1.372-5.049V0.36h-5.578V17.016z"/>
	<path d="M92.616,16.822h5.659c-0.023,1.052-0.254,1.974-0.706,2.758c-0.477,0.824-1.164,1.461-2.061,1.912
		c-0.898,0.452-1.977,0.677-3.24,0.677c-1.392,0-2.598-0.337-3.62-1.011c-1.022-0.675-1.812-1.656-2.371-2.943
		c-0.558-1.289-0.837-2.851-0.837-4.689s0.283-3.395,0.85-4.669c0.567-1.276,1.359-2.248,2.377-2.918
		c1.018-0.67,2.201-1.005,3.549-1.005c0.721,0,1.38,0.091,1.977,0.271c0.597,0.181,1.129,0.441,1.597,0.779
		c0.468,0.34,0.865,0.751,1.191,1.237s0.58,1.041,0.76,1.668h5.668c-0.18-1.305-0.588-2.5-1.224-3.587
		c-0.636-1.086-1.453-2.025-2.454-2.815c-1-0.79-2.144-1.402-3.433-1.835C95.012,0.216,93.621,0,92.126,0
		c-1.743,0-3.362,0.305-4.856,0.914c-1.495,0.611-2.805,1.499-3.929,2.667c-1.125,1.168-1.999,2.591-2.621,4.27
		c-0.623,1.679-0.934,3.587-0.934,5.726c0,2.782,0.522,5.185,1.565,7.208c1.043,2.022,2.501,3.581,4.373,4.676
		c1.872,1.095,4.044,1.642,6.518,1.642c2.216,0,4.182-0.448,5.9-1.346c1.718-0.897,3.066-2.176,4.045-3.838s1.468-3.652,1.468-5.971
		v-3.323H92.616V16.822z"/>
	<polygon points="124.742,11.245 113.42,11.245 113.42,0.36 107.842,0.36 107.842,26.741 113.42,26.741 113.42,15.844 
		124.742,15.844 124.742,26.741 130.307,26.741 130.307,0.36 124.742,0.36 	"/>
	<polygon points="133.901,4.958 141.977,4.958 141.977,26.741 147.491,26.741 147.491,4.958 155.568,4.958 155.568,0.36 
		133.901,0.36 	"/>
	<polygon points="170.124,11.722 169.866,11.722 163.85,0.36 157.603,0.36 167.225,17.416 167.225,26.741 172.764,26.741 
		172.764,17.416 182.386,0.36 176.139,0.36 	"/>
	<polygon points="208.29,18.084 207.981,18.084 200.716,0.36 193.837,0.36 193.837,26.741 199.247,26.741 199.247,9.506 
		199.466,9.506 206.293,26.613 209.978,26.613 216.805,9.571 217.024,9.571 217.024,26.741 222.434,26.741 222.434,0.36 
		215.555,0.36 	"/>
	<path d="M234.697,0.36l-9.107,26.381h5.977l1.957-6.016h9.525l1.953,6.016h5.977L241.884,0.36H234.697z M234.94,16.372l3.248-9.984
		h0.206l3.242,9.984H234.94z"/>
	<polygon points="249.897,4.958 257.973,4.958 257.973,26.741 263.487,26.741 263.487,4.958 271.564,4.958 271.564,0.36 
		249.897,0.36 	"/>
	<path d="M282.358,5.944c1.014-0.674,2.203-1.011,3.569-1.011c0.756,0,1.458,0.108,2.106,0.323c0.648,0.214,1.222,0.523,1.72,0.927
		c0.498,0.403,0.906,0.891,1.224,1.461c0.318,0.572,0.528,1.222,0.631,1.952h5.642c-0.18-1.528-0.59-2.885-1.23-4.071
		c-0.64-1.185-1.466-2.187-2.48-3.008c-1.014-0.819-2.175-1.444-3.485-1.874C288.745,0.215,287.326,0,285.798,0
		c-2.318,0-4.406,0.53-6.261,1.59c-1.855,1.061-3.323,2.6-4.406,4.619s-1.623,4.466-1.623,7.342c0,2.868,0.535,5.312,1.603,7.329
		c1.069,2.019,2.529,3.56,4.38,4.625c1.851,1.066,3.952,1.597,6.306,1.597c1.692,0,3.209-0.255,4.553-0.766
		c1.345-0.511,2.504-1.207,3.479-2.087c0.975-0.881,1.752-1.881,2.332-3.002c0.579-1.12,0.942-2.287,1.088-3.497l-5.642-0.027
		c-0.129,0.705-0.358,1.332-0.689,1.881c-0.33,0.55-0.745,1.015-1.243,1.397c-0.498,0.382-1.067,0.672-1.707,0.87
		c-0.64,0.197-1.333,0.296-2.081,0.296c-1.332,0-2.503-0.327-3.516-0.98s-1.801-1.618-2.363-2.899
		c-0.563-1.279-0.844-2.86-0.844-4.74c0-1.829,0.279-3.385,0.837-4.669C280.559,7.597,281.346,6.619,282.358,5.944z"/>
	<polygon points="318.155,11.245 306.832,11.245 306.832,0.36 301.254,0.36 301.254,26.741 306.832,26.741 306.832,15.844 
		318.155,15.844 318.155,26.741 323.719,26.741 323.719,0.36 318.155,0.36 	"/>
	<path d="M353.024,17.016c0,1.004-0.221,1.897-0.663,2.679c-0.443,0.782-1.065,1.396-1.868,1.843
		c-0.804,0.447-1.745,0.669-2.827,0.669c-1.074,0-2.015-0.222-2.821-0.669c-0.808-0.447-1.432-1.061-1.875-1.843
		c-0.442-0.782-0.663-1.675-0.663-2.679V0.36h-5.577v17.132c0,1.924,0.455,3.607,1.366,5.049c0.909,1.443,2.185,2.566,3.826,3.37
		c1.64,0.802,3.555,1.204,5.745,1.204c2.181,0,4.092-0.402,5.732-1.204c1.64-0.804,2.918-1.926,3.832-3.37
		c0.915-1.442,1.373-3.126,1.373-5.049V0.36h-5.579V17.016z"/>
	<path d="M378.711,1.5c-1.409-0.76-3.113-1.14-5.114-1.14h-10.408v26.381h5.577v-8.554h4.689c2.026,0,3.754-0.373,5.184-1.12
		c1.43-0.747,2.523-1.79,3.278-3.13c0.756-1.339,1.134-2.885,1.134-4.637s-0.371-3.3-1.114-4.644
		C381.194,3.312,380.119,2.26,378.711,1.5z M376.784,11.599c-0.347,0.666-0.872,1.185-1.572,1.559
		c-0.699,0.374-1.586,0.561-2.659,0.561h-3.787V4.921h3.762c1.081,0,1.975,0.182,2.679,0.547c0.704,0.364,1.231,0.875,1.578,1.533
		c0.348,0.657,0.522,1.423,0.522,2.299C377.306,10.168,377.133,10.934,376.784,11.599z"/>
	<path d="M407.461,16.822h5.659c-0.023,1.052-0.254,1.974-0.706,2.758c-0.477,0.824-1.164,1.461-2.061,1.912
		c-0.898,0.452-1.977,0.677-3.24,0.677c-1.392,0-2.599-0.337-3.62-1.011c-1.022-0.675-1.812-1.656-2.371-2.943
		c-0.558-1.289-0.838-2.851-0.838-4.689s0.284-3.395,0.85-4.669c0.567-1.276,1.359-2.248,2.377-2.918
		c1.018-0.67,2.201-1.005,3.549-1.005c0.721,0,1.38,0.091,1.977,0.271c0.597,0.181,1.129,0.441,1.597,0.779
		c0.469,0.34,0.865,0.751,1.192,1.237c0.327,0.486,0.579,1.041,0.76,1.668h5.667c-0.18-1.305-0.588-2.5-1.224-3.587
		c-0.636-1.086-1.453-2.025-2.454-2.815c-1-0.79-2.144-1.402-3.433-1.835C409.857,0.216,408.466,0,406.972,0
		c-1.743,0-3.362,0.305-4.856,0.914c-1.494,0.611-2.804,1.499-3.929,2.667s-1.999,2.591-2.621,4.27
		c-0.623,1.679-0.935,3.587-0.935,5.726c0,2.782,0.522,5.185,1.566,7.208c1.043,2.022,2.5,3.581,4.373,4.676
		c1.872,1.095,4.044,1.642,6.517,1.642c2.216,0,4.183-0.448,5.9-1.346c1.718-0.897,3.066-2.176,4.044-3.838
		c0.979-1.662,1.469-3.652,1.469-5.971v-3.323h-11.04V16.822z"/>
	<path d="M429.54,0.36l-9.107,26.381h5.977l1.957-6.016h9.525l1.953,6.016h5.977L436.727,0.36H429.54z M429.783,16.372l3.248-9.984
		h0.205l3.242,9.984H429.783z"/>
	<polygon points="463.443,18.084 463.134,18.084 455.869,0.36 448.99,0.36 448.99,26.741 454.4,26.741 454.4,9.506 454.62,9.506 
		461.446,26.613 465.131,26.613 471.958,9.571 472.177,9.571 472.177,26.741 477.587,26.741 477.587,0.36 470.708,0.36 	"/>
	<polygon points="487.75,22.142 487.75,15.844 499.034,15.844 499.034,11.245 487.75,11.245 487.75,4.958 499.949,4.958 
		499.949,0.36 482.173,0.36 482.173,26.741 500,26.741 500,22.142 	"/>
</g>
</svg>
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

  // Legend: highlight the revealed tier only (neutral until revealed)
  qsa('.prize-row__tag[data-role="prize-tag"]', root).forEach(el => {
    el.hidden = true;
    el.textContent = '';
  });
  qsa('.prize-row.is-winner', root).forEach(el => el.classList.remove('is-winner'));
  const winRow = qs(`.prize-row[data-tier="${opt.tier}"]`, root);
  if (winRow){
    winRow.classList.add('is-winner');
    const tag = qs('[data-role="prize-tag"]', winRow);
    if (tag){
      tag.hidden = true;
    }
  }

  async function doCopy(btn){
    const ok = await copyText(shareUrl);
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => btn.textContent = 'Copy link', 900);
  }
  copyLinkTop.addEventListener('click', () => doCopy(copyLinkTop));
// Keep the external actions bar behavior.
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
