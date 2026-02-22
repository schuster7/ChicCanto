import { qs, makeTokenFromString } from './utils.js';
import { ensureCard } from './store.js';
import { getProductBySlug } from './products.js';

// Allow markup to evolve without breaking JS.
// Prefer stable IDs for JS hooks, but support hyphenated variants too.
function byId(...ids){
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

// --- Activate page: selected card thumbnail tile ---

function _safeSlug(raw){
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_.]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
}

function _thumbCandidates(key){
  const k = _safeSlug(key || '');
  const out = [];
  if (k){
    out.push(`/assets/img/thumb_${k}.jpg`);
  }
  // Fallbacks (legacy)
  out.push('/assets/img/thumb_men-novice1.jpg');
  return out;
}

function setSelectedCardTile({ name, key, statusKind, statusText }){
  const tile = document.getElementById('selectedCardTile');
  if (!tile) return;

  const title = document.getElementById('selectedCardName');
  const chip = document.getElementById('selectedCardChip');
  const img = document.getElementById('selectedCardImg');

  tile.classList.remove('is-hidden');

  if (title) title.textContent = name || 'ChicCanto card';

  if (chip){
    chip.textContent = statusText || '';
    chip.classList.remove('is-ok', 'is-warn', 'is-error');
    if (statusKind === 'ok') chip.classList.add('is-ok');
    else if (statusKind === 'error') chip.classList.add('is-error');
    else chip.classList.add('is-warn');
  }

  if (img){
    const candidates = _thumbCandidates(key);
    let i = 0;

    const tryNext = () => {
      if (i >= candidates.length){
        // No thumbnail found; keep tile, hide image.
        img.removeAttribute('src');
        img.style.display = 'none';
        return;
      }
      img.style.display = 'block';
      img.src = candidates[i++];
    };

    img.onerror = tryNext;
    // Reset alt to avoid awkward screen reader noise
    img.alt = name ? (name + ' thumbnail') : 'Card thumbnail';
    tryNext();
  }
}



function apiBaseCandidates(){
  const bases = [];
  const host = window.location.hostname;

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]';

  if (isLocal){
    // Local Worker/dev API (wrangler dev) on :8787
    bases.push(`${window.location.protocol}//${host}:8787`);
    // Also allow same-origin (in case you proxy locally)
    bases.push(window.location.origin);
  } else {
    // Optional: Netlify Functions, if you ever deploy there again
    const isNetlify =
      host.endsWith('netlify.app') ||
      host.endsWith('netlify.live');

    if (isNetlify){
      bases.push(`${window.location.origin}/.netlify/functions`);
    }

    // Default: same-origin backend (Cloudflare Pages/Workers, or any host with /redeem)
    bases.push(window.location.origin);
  }

  return [...new Set(bases.filter(Boolean))];
}

function getStoreMode(){
  // URL param wins (?store=local|memory|api)
  try{
    const forced = String(new URLSearchParams(window.location.search).get('store') || '').trim().toLowerCase();
    if (forced) return forced;
  }catch{}

  const host = window.location.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]';

  // Local dev defaults to local-only flow unless explicitly forced to API mode.
  if (isLocal) return '';

  // Live/staging defaults to API so activation creates a server-backed token.
  return 'api';
}


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
    void el.offsetHeight;
    el.style.opacity = '1';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => (el.style.opacity = '0'), 1600);
  }catch{}
}
function isLocalhost(){
  const h = String(window.location.hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

async function _fetchJsonWithTimeout(url, options, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try{
    const res = await fetch(url, {
      cache: 'no-store',
      ...options,
      signal: controller.signal,
    });

    let data = null;
    try{ data = await res.json(); }catch(_e){ data = null; }

    return { res, data };
  } finally{
    clearTimeout(timer);
  }
}

async function apiRedeem(code, init){
  const bases = apiBaseCandidates();

  // Keep the UI responsive: don't let any single candidate hang forever.
  const TIMEOUT_MS = 7000;

  let last = { ok: false, status: 0, errorCode: null, retryAfterSeconds: null };

  for (const base of bases){
    const url = base + '/redeem';

    try{
      const { res, data } = await _fetchJsonWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, init }),
      }, TIMEOUT_MS);

      if (res.ok && data && data.ok){
        return data;
      }

      last = {
        ok: false,
        status: res.status || 0,
        errorCode: data && data.errorCode ? data.errorCode : null,
        retryAfterSeconds: data && data.retryAfterSeconds ? data.retryAfterSeconds : null,
      };
    } catch (e){
      last = {
        ok: false,
        status: 0,
        errorCode: 'NETWORK',
        retryAfterSeconds: null,
      };
    }
  }

  return last;
}


function goToCardWithSetup(token, init){
  // Create (or reuse) a sender-only setup key for this token.
  const card = ensureCard(token, init);

  // Query param works on any static server (no rewrite rules needed).
  const params = new URLSearchParams();
  params.set('token', token);
  params.set('setup', card.setup_key);

  // For local-only mode we keep whatever store param the user forced.
  const storeMode = new URLSearchParams(window.location.search).get('store');
  if (storeMode && storeMode !== 'api') params.set('store', storeMode);

  window.location.href = '/card/?' + params.toString();
}

function ensureResultsContainer(){
  let el = document.getElementById('redeemResults');
  if (el) return el;
  const form = byId('redeemForm', 'redeem-form') || qs('#redeemForm') || qs('#redeem-form');
  el = document.createElement('div');
  el.id = 'redeemResults';
  el.className = 'stack';
  if (form) {
    form.insertAdjacentElement('afterend', el);
  } else {
    // As a last resort, avoid throwing on pages that don't contain redeem markup.
    document.body.appendChild(el);
  }
  return el;
}

function buildCardLinks(card){
  const setupParams = new URLSearchParams();
  setupParams.set('token', card.token);
  setupParams.set('setup', card.setup_key);

  const recipParams = new URLSearchParams();
  recipParams.set('token', card.token);

  return {
    setupUrl: '/card/?' + setupParams.toString(),
    recipientUrl: '/card/?' + recipParams.toString()
  };
}

function isProbablyIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

async function copyToClipboard(text, inputEl){
  // 1) Modern Clipboard API (often requires HTTPS on iOS)
  if (navigator.clipboard && navigator.clipboard.writeText){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e){
      // fall through
    }
  }

  // 2) Legacy execCommand fallback (works on many mobile browsers)
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (e){
    // fall through
  }

  // 3) Last resort: select the visible input and show a prompt.
  if (inputEl){
    inputEl.focus();
    inputEl.select();
    inputEl.setSelectionRange(0, inputEl.value.length);
  }

  // prompt is crude, but it always lets the user copy manually
  window.prompt('Copy this link:', text);
  return false;
}

function renderMultiCards(result){
  const wrap = ensureResultsContainer();
  wrap.innerHTML = '';

  const header = document.createElement('div');

  try{ setSelectedCardTile({ name: 'Full set', key: 'fullset', statusKind: 'ok', statusText: 'Activated' }); }catch{}
  header.className = 'small';
  header.textContent = result.existing
    ? 'This code already has cards. Pick one below.'
    : 'This code created multiple cards. Pick one below.';
  wrap.appendChild(header);

  if (!Array.isArray(result.cards) || result.cards.length === 0){
    const err = document.createElement('div');
    err.className = 'small';
    err.textContent = 'Invalid activation code. Check it and try again.';
    wrap.appendChild(err);
    return;
  }

  result.cards.forEach((c, idx) => {
    const links = buildCardLinks(c);

    const block = document.createElement('div');
    block.className = 'card stack';

    const title = document.createElement('div');
    title.className = 'row spread';
    title.innerHTML = `<div class="kicker">Card ${idx + 1}</div><div class="small mono">${c.product_id}</div>`;
    block.appendChild(title);

    const row1 = document.createElement('div');
    row1.className = 'row';

    const aSetup = document.createElement('a');
    aSetup.className = 'btn primary';
    aSetup.href = links.setupUrl;
    aSetup.textContent = 'Open setup';
    row1.appendChild(aSetup);

    const input = document.createElement('input');
    input.className = 'input mono';
    input.readOnly = true;
    input.value = window.location.origin + links.recipientUrl;
    // Tap-to-select makes iOS copy much easier.
    input.addEventListener('focus', () => {
      input.select();
      input.setSelectionRange(0, input.value.length);
    });

    const aRecip = document.createElement('button');
    aRecip.className = 'btn';
    aRecip.type = 'button';
    aRecip.textContent = 'Copy recipient link';
    aRecip.addEventListener('click', async () => {
      const full = window.location.origin + links.recipientUrl;
      if (isLocalhost()) toast('You are on localhost. Use your LAN IP to share links across devices.');
      const ok = await copyToClipboard(full, null);
      toast(ok ? 'Link copied' : 'Copy failed');
    });
    row1.appendChild(aRecip);

    const aOpen = document.createElement('a');
    aOpen.className = 'btn';
    aOpen.href = links.recipientUrl;
    aOpen.textContent = 'Open recipient link';
    row1.appendChild(aOpen);

    // Share (uses share sheet when available, falls back to copy)
    const aShare = document.createElement('button');
    aShare.className = 'btn';
    aShare.type = 'button';
    aShare.textContent = 'Share';
    aShare.addEventListener('click', async () => {
      const full = window.location.origin + links.recipientUrl;
      if (isLocalhost()) toast('You are on localhost. Use your LAN IP to share links across devices.');
      if (navigator.share){
        try{
          await navigator.share({ title: 'ChicCanto', text: 'ChicCanto card link', url: full });
          return;
        }catch{
          // cancelled or failed
        }
      }
      const ok = await copyToClipboard(full, null);
      toast(ok ? 'Link copied' : 'Copy failed');
    });
    row1.appendChild(aShare);

    block.appendChild(row1);

    wrap.appendChild(block);
  });
}


function normalizeActivationCode(raw){
  // Customer-friendly normalization:
  // - uppercase
  // - remove spaces and line breaks
  // - keep hyphens
  // - drop any other characters
  const s = String(raw || '').toUpperCase();
  return s
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

export function bootRedeem(){
  // Support both the original hook IDs and the newer hyphenated ones.
  const form = byId('redeemForm', 'redeem-form') || qs('#redeemForm') || qs('#redeem-form');
  if (!form) return; // not on a redeem/landing page

  const input = byId('code', 'redeem-code') || qs('#code') || qs('#redeem-code');

  // Normalize activation code as the customer types/pastes.
  if (input){
    const applyNorm = () => {
      const before = input.value;
      const after = normalizeActivationCode(before);
      if (after !== before){
        const atEnd = input.selectionStart === before.length && input.selectionEnd === before.length;
        input.value = after;
        if (atEnd){
          // keep caret at end for the common case
          input.setSelectionRange(after.length, after.length);
        }
      }
    };

    input.addEventListener('input', applyNorm);

    input.addEventListener('paste', (e) => {
      try{
        const text = (e.clipboardData || window.clipboardData).getData('text') || '';
        if (!text) return;
        e.preventDefault();
        const normalized = normalizeActivationCode(text);
        input.value = normalized;
        input.setSelectionRange(normalized.length, normalized.length);
      }catch{
        // fall back to normal paste, then input event will normalize
      }
    });

    // Run once on load in case code was prefilled from URL.
    applyNorm();
  }

  const msg = byId('msg', 'redeem-error') || qs('#msg') || qs('#redeem-error');
  const productTitleEl = byId('productName', 'product-title') || qs('#productName') || qs('#product-title');
  const statusChip = byId('statusChip') || qs('#statusChip');
  const inlineHint = byId('inlineHint') || qs('#inlineHint');

  // Demo product selection via URL:
  // /activate/?product=christmas  or /activate/?product=couples
  const urlParams = new URLSearchParams(window.location.search);
  const product = getProductBySlug(urlParams.get('product'));
  const init = { product_id: product.id, theme_id: product.theme_id, fields: product.fields };

  // Product label (non-blocking)
  if (productTitleEl) {
    // keep existing prefix in HTML if present
    const prefix = productTitleEl.dataset && productTitleEl.dataset.prefix ? productTitleEl.dataset.prefix : '';
    productTitleEl.textContent = (prefix ? prefix : 'Product: ') + product.name;
  } else if (msg && !msg.textContent) {
    msg.textContent = `Product: ${product.name}`;
  }

  // Show a small "Selected card" tile (thumb is best-effort, falls back gracefully).
  try{
    setSelectedCardTile({
      name: product.name,
      key: (product && (product.slug || product.id || product.name)) || '',
      statusKind: 'warn',
      statusText: 'Not activated'
    });
  }catch{}

  const btn = byId('redeemBtn', 'redeem-btn') || qs('#redeemBtn') || qs('#redeem-btn');
  const originalBtnText = btn ? btn.textContent : 'Activate';
  const storeMode = getStoreMode();

  if (statusChip){
    setStatusChip(statusChip, 'warn', 'Not activated');
  }

  if (inlineHint && input){
    const paintHint = () => {
      const info = activationCodeInfo(input.value);
      setInlineHint(inlineHint, info);
    };
    input.addEventListener('input', paintHint);
    paintHint();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (msg) msg.textContent = '';

    if (statusChip){
      setStatusChip(statusChip, 'warn', 'Checking…');
    }

    const results = document.getElementById('redeemResults');
    if (results) results.innerHTML = '';

    const code = input ? normalizeActivationCode(input.value) : '';
    if (!code) {
      if (msg) msg.textContent = 'Please enter an activation code.';
      if (statusChip) setStatusChip(statusChip, 'warn', 'Not activated');
      return;
    }

    // Client-side validation (keeps UX tight and prevents server spam)
    const info = activationCodeInfo(code);
    if (!info.ok){
      if (msg) msg.textContent = friendlyClientValidationMessage(info);
      if (statusChip) setStatusChip(statusChip, 'warn', 'Not activated');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Activating...';
    }

    // API mode: redeem through the local dev API so we can support multi-purchase.
    if (storeMode === 'api'){
      apiRedeem(code, init)
        .then((result) => {

          if (btn) {
            btn.disabled = false;
            btn.textContent = originalBtnText;
          }

          // Handle API errors cleanly (no JS crashes, customer-friendly message)
          if (!result || result.ok === false){
            if (msg) msg.textContent = friendlyServerMessage(result);
            if (statusChip) setStatusChip(statusChip, 'warn', 'Not activated');
            return;
          }

          if (Array.isArray(result.cards) && result.cards.length === 1){
            const only = result.cards[0];
            const params = new URLSearchParams();
            params.set('token', only.token);
            params.set('setup', only.setup_key);
            if (statusChip) setStatusChip(statusChip, 'ok', result.existing ? 'Link retrieved' : 'Activated');
            window.location.href = '/card/?' + params.toString();
            return;
          }

          if (Array.isArray(result.cards) && result.cards.length > 1){
            renderMultiCards(result);
            if (statusChip) setStatusChip(statusChip, 'ok', result.existing ? 'Link retrieved' : 'Activated');
            return;
          }

          // Unexpected shape
          if (msg) msg.textContent = 'That activation code doesn’t look right. Check it and try again.';
          if (statusChip) setStatusChip(statusChip, 'warn', 'Not activated');

        })
        .catch((err) => {
          if (btn) {
            btn.disabled = false;
            btn.textContent = originalBtnText;
          }
          if (msg) msg.textContent = friendlyNetworkMessage(err);
          if (statusChip) setStatusChip(statusChip, 'warn', 'Not activated');
        });
      return;
    }

    // Local-only: deterministic token from code.
    const token = makeTokenFromString(code);
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalBtnText;
      }
      if (statusChip) setStatusChip(statusChip, 'ok', 'Activated');
      goToCardWithSetup(token, init);
    }, 250);
  });
}

function activationCodeInfo(code){
  const c = normalizeActivationCode(code);
  if (!c) return { normalized: '', ok: false, reason: 'empty' };
  const ok = /^CC-(S|F)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c);
  if (ok) return { normalized: c, ok: true, reason: null };
  if (!/^CC-(S|F)-/i.test(c)) return { normalized: c, ok: false, reason: 'prefix' };
  if (c.length < 23) return { normalized: c, ok: false, reason: 'short' };
  return { normalized: c, ok: false, reason: 'format' };
}

function setStatusChip(node, kind, text){
  if (!node) return;
  node.textContent = text;
  node.classList.remove('is-ok', 'is-warn', 'is-error');
  if (kind === 'ok') node.classList.add('is-ok');
  else if (kind === 'error') node.classList.add('is-error');
  else node.classList.add('is-warn');

  // Keep the activate preview tile chip in sync when present.
  try{
    const t = document.getElementById('selectedCardChip');
    if (t && t !== node){
      t.textContent = text;
      t.classList.remove('is-ok', 'is-warn', 'is-error');
      if (kind === 'ok') t.classList.add('is-ok');
      else if (kind === 'error') t.classList.add('is-error');
      else t.classList.add('is-warn');
    }
  }catch{}
}

function setInlineHint(node, info){
  if (!node) return;
  node.classList.remove('is-warn', 'is-error');
  if (!info || !info.normalized || info.ok){
    node.textContent = '';
    return;
  }
  node.classList.add('is-warn');
  if (info.reason === 'short') node.textContent = 'That code looks incomplete.';
  else if (info.reason === 'prefix') node.textContent = 'That code doesn’t look right.';
  else node.textContent = 'Check the code and try again.';
}

function friendlyClientValidationMessage(info){
  if (!info || info.reason === 'empty') return 'Please enter an activation code.';
  if (info.reason === 'short') return 'That activation code looks incomplete. Check it and try again.';
  return 'That activation code doesn’t look right. Check it and try again.';
}

function friendlyServerMessage(result){
  if (result && result.errorCode === 'RATE_LIMITED'){
    const mins = result.retryAfterSeconds ? Math.round(result.retryAfterSeconds / 60) : 10;
    return `Too many attempts. Try again in ${mins} minutes.`;
  }
  if (result && (result.status === 429)){
    return 'Too many attempts. Try again in 10 minutes.';
  }
  if (result && (result.status === 404 || result.errorCode === 'NOT_FOUND')){
    return 'That activation code wasn’t found. Check it and try again.';
  }
  if (result && result.errorCode === 'INVALID_CODE'){
    return 'That activation code doesn’t look right. Check it and try again.';
  }
  return 'Could not activate right now. Please try again.';
}

function friendlyNetworkMessage(){
  return 'We couldn’t reach the server. Refresh and try again.';
}
