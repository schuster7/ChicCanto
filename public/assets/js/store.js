import { DEFAULT_PRODUCT_ID, getProductById } from './products.js';
const PREFIX = 'sc:card:';

// Storage adapter (local now, swappable later).
//
// Modes:
// - local: use localStorage (default)
// - memory: in-memory storage (useful if browser storage is blocked)
// - api: local dev API server (Checkpoint 4)
//
// You can force a mode locally by adding ?store=memory, ?store=local, or ?store=api to the URL.
const _MEMORY_STORE = new Map();


function _getStoreModeFromUrl(){
  try{
    const params = new URLSearchParams(window.location.search);
    const mode = String(params.get('store') || '').trim().toLowerCase();
    return mode || '';
  }catch{}
  return '';
}

function _getRequestedStoreMode(){
  // URL param wins. Examples:
  // - ?store=local
  // - ?store=memory
  // - ?store=api
  const fromUrl = _getStoreModeFromUrl();
  if (fromUrl) return fromUrl;
  // Default: local first, then try API only if local has no record for the token.
  // This keeps local-only flows fast while still allowing clean, shareable links
  // for API-backed tokens.
  return 'auto';
}

// API mode is for local dev (Checkpoint 4) and later for real backends.
// For now we support two backends automatically:
// 1) Local dev API (node dev-api.js) on :8787
// 2) Same-origin backend (Netlify Functions/other) via /redeem and /token/*
function _apiBaseCandidates(){
  const bases = [];
  try{ bases.push(`${window.location.protocol}//${window.location.hostname}:8787`); }catch{}
  try{ bases.push(window.location.origin); }catch{}
  // de-dupe
  return [...new Set(bases.filter(Boolean))];
}

function _apiRequestSync(method, path, bodyObj){
  const bases = _apiBaseCandidates();
  let last = { ok: false, status: 0, data: null };

  for (const base of bases){
    const url = base + path;
    const xhr = new XMLHttpRequest();
    try{
      xhr.open(method, url, false); // sync (keeps the app code unchanged for now)
      xhr.setRequestHeader('Content-Type', 'application/json');
      try{ xhr.timeout = 800; }catch{}

      xhr.send(bodyObj ? JSON.stringify(bodyObj) : null);
    }catch(err){
      last = { ok: false, status: 0, data: null };
      continue;
    }

    const status = xhr.status || 0;
    let data = null;
    try{ if (xhr.responseText) data = JSON.parse(xhr.responseText); }catch{ data = null; }

    const r = { ok: status >= 200 && status < 300, status, data };
    last = r;

    // If the server answered (even 404), don't try another base.
    if (status) return r;
  }

  return last;
}

function _apiGetCard(token){
  const r = _apiRequestSync('GET', '/token/' + encodeURIComponent(token));
  if (!r.ok) return null;

  // Backward compatibility:
  // Some backends previously returned { ok: true, card: {...} }.
  // Frontend expects the card record at the top-level.
  const d = r.data;
  if (d && typeof d === 'object' && d.card && typeof d.card === 'object') return d.card;
  return d;
}

function _apiPutCard(card){
  if (!card || !card.token) return null;
  const r = _apiRequestSync('PUT', '/token/' + encodeURIComponent(card.token), card);
  if (!r.ok) return null;

  // Prefer a returned card record, but tolerate older "ok-only" responses.
  const d = r.data;
  if (d && typeof d === 'object' && d.card && typeof d.card === 'object') return d.card;
  if (d && typeof d === 'object'){
    // If response looks like { ok: true } with no token, return the input card.
    if (d.ok === true && !d.token) return card;
    return d;
  }
  return card;
}


function _storageAdapter(){
  const mode = _getRequestedStoreMode();

  // memory-only store
  if (mode === 'memory'){
    return {
      getItem: (k) => (_MEMORY_STORE.has(k) ? _MEMORY_STORE.get(k) : null),
      setItem: (k, v) => { _MEMORY_STORE.set(k, String(v)); },
      removeItem: (k) => { _MEMORY_STORE.delete(k); }
    };
  }

  // local store with automatic fallback to memory if storage is blocked
  return {
    getItem: (k) => {
      try{ return window.localStorage.getItem(k); }
      catch{ return _MEMORY_STORE.has(k) ? _MEMORY_STORE.get(k) : null; }
    },
    setItem: (k, v) => {
      try{ window.localStorage.setItem(k, v); }
      catch{ _MEMORY_STORE.set(k, String(v)); }
    },
    removeItem: (k) => {
      try{ window.localStorage.removeItem(k); }
      catch{ _MEMORY_STORE.delete(k); }
    }
  };
}


function makeSetupKey(bytesLen = 16){
  try{
    const bytes = new Uint8Array(bytesLen);
    crypto.getRandomValues(bytes);
    // base64url
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }catch{
    // fallback (less strong, but fine for local demo)
    return (
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36)
    ).slice(0, 32);
  }
}

export function getCard(token){
  const mode = _getRequestedStoreMode();

  // 1) Local lookup first (fast path) — but only when we're not forcing API.
  // This keeps local-only flows instant, while API mode stays authoritative.
  if (mode !== 'api'){
    const raw = _storageAdapter().getItem(PREFIX + token);
    if (raw){
      try{
        let local = JSON.parse(raw);

        // Backward compatibility: unwrap stored wrappers like { ok: true, card: {...} }
        if (local && typeof local === 'object' && local.card && typeof local.card === 'object'){
          local = local.card;
        }
        if (local && typeof local === 'object') local._store = 'local';
        return local;
      }catch{}
    }
  }

  // 2) API lookup (either forced, or as a fallback when local has no record).
  if (mode === 'api' || mode === 'auto'){
    const fromApi = _apiGetCard(token);
    if (fromApi){
      if (fromApi && typeof fromApi === 'object') fromApi._store = 'api';
      // keep a local mirror as a cache (optional)
      try{ _storageAdapter().setItem(PREFIX + token, JSON.stringify(fromApi)); }catch{}
      return fromApi;
    }
  }

  // 3) In forced API mode, fall back to any local mirror if the API is down.
  if (mode === 'api'){
    const raw = _storageAdapter().getItem(PREFIX + token);
    if (raw){
      try{
        const local = JSON.parse(raw);
        if (local && typeof local === 'object') local._store = 'local';
        return local;
      }catch{}
    }
  }

  return null;
}

export function saveCard(card){
  const mode = _getRequestedStoreMode();

  const wantsApi = (mode === 'api') || (mode === 'auto' && card && card._store === 'api');
  if (wantsApi){
    const saved = _apiPutCard(card);
    if (saved){
      if (saved && typeof saved === 'object') saved._store = 'api';
      // keep a local mirror as a cache (optional)
      try{ _storageAdapter().setItem(PREFIX + card.token, JSON.stringify(saved)); }catch{}
      return saved;
    }
    // If API fails, fall back to local storage so the app still works.
  }

  if (card && typeof card === 'object') card._store = 'local';
  _storageAdapter().setItem(PREFIX + card.token, JSON.stringify(card));
  return card;
}

export function ensureCard(token, init = null){
  const existing = getCard(token);
  if (existing){
    // Backward compatibility: older cards did not have a setup key.
    if (!existing.setup_key){
      existing.setup_key = makeSetupKey();
      saveCard(existing);
    }

    // Backward compatibility: older cards may have stored theme_id without the
    // required "theme-" prefix (or used legacy placeholders). Normalize.
    const needsThemeFix =
      !existing.theme_id ||
      typeof existing.theme_id !== 'string' ||
      !existing.theme_id.startsWith('theme-') ||
      existing.theme_id === 'default';

    if (needsThemeFix){
      const p = getProductById(existing.product_id || DEFAULT_PRODUCT_ID);
      existing.product_id = p.id;
      existing.theme_id = p.theme_id;
      if (!Number.isFinite(existing.fields)) existing.fields = p.fields || 9;
      saveCard(existing);
    }

    return existing;
  }

  const fresh = {
    token,

    // product lock (set at redeem time; must not be switchable later)
    product_id: (init && init.product_id) ? init.product_id : getProductById(DEFAULT_PRODUCT_ID).id,
    theme_id: (init && init.theme_id) ? init.theme_id : getProductById(DEFAULT_PRODUCT_ID).theme_id,

    // sender-only setup secret (recipient links should not include this)
    setup_key: makeSetupKey(),

    // state
    configured: false,
    choice: null,
    reveal_amount: null,
    revealed: false,
    revealed_at: null,

    // product params (kept for backward compatibility + easy rendering)
    fields: (init && Number.isFinite(init.fields)) ? init.fields : (getProductById((init && init.product_id) ? init.product_id : DEFAULT_PRODUCT_ID).fields || 9),

    // persistence for the revealed result (so revealed view + PNG match what was scratched)
    board: null,              // array like ["t2","t4","t1",...]
    scratched_indices: null,  // array of ints, e.g. [0,2,5]

    // reserved for future partial-scratch persistence (array of booleans)
    scratched_fields: null
  };

  return saveCard(fresh);
}

export function setConfigured(token, { choice, reveal_amount, fields, product_id, theme_id }){
  const card = ensureCard(token);

  // Lock product/theme on first configuration only.
  if (!card.configured){
    if (typeof product_id === 'string' && product_id) card.product_id = product_id;
    if (typeof theme_id === 'string' && theme_id) card.theme_id = theme_id;
  }

  // setup locks in the reveal choice (but resets any previous revealed state)
  card.configured = true;
  card.choice = choice;
  card.reveal_amount = reveal_amount;

  if (typeof fields === 'number' && Number.isFinite(fields)) card.fields = fields;

  // reset reveal persistence on (re)configure
  card.revealed = false;
  card.revealed_at = null;
  card.board = null;
  card.scratched_indices = null;
  card.scratched_fields = null;

  return saveCard(card);
}

/**
 * Mark a card as revealed and optionally persist the final board + scratch progress.
 * This keeps existing callers working: setRevealed(token) still works.
 */
export function setRevealed(token, { board = null, scratched_indices = null } = {}){
  const card = ensureCard(token);
  card.revealed = true;
  card.revealed_at = new Date().toISOString();

  if (Array.isArray(board) && board.length){
    card.board = board;
  }
  if (Array.isArray(scratched_indices)){
    card.scratched_indices = scratched_indices;
  }

  return saveCard(card);
}