// Cloudflare Pages Functions shared helpers for ChicCanto.
// This file is NOT a route. It's imported by the route handlers.

function _hex(bytes){
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function makeToken(){
  // Match the existing frontend's short token style: 8-4 hex, e.g. "02ca8d5e-1a1d"
  const a = new Uint8Array(4);
  const b = new Uint8Array(2);
  crypto.getRandomValues(a);
  crypto.getRandomValues(b);
  return `${_hex(a)}-${_hex(b)}`;
}

function _base64Url(bytes){
  // Workers runtime supports btoa
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function makeSetupKey(){
  // 16 bytes => 22 chars base64url (no padding), similar to your existing setup_key examples.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return _base64Url(bytes);
}

export function nowIso(){
  return new Date().toISOString();
}

export function normalizeInit(init){
  const obj = (init && typeof init === 'object') ? init : {};
  const product_id = (typeof obj.product_id === 'string' && obj.product_id) ? obj.product_id : null;
  const theme_id = (typeof obj.theme_id === 'string' && obj.theme_id) ? obj.theme_id : null;
  const fields = Number.isFinite(obj.fields) ? obj.fields : 9;

  // Multi-card: server-owned card key that selects the correct assets (title, background, tiles).
  const card_key = (typeof obj.card_key === 'string' && obj.card_key.trim())
    ? obj.card_key.trim()
    : null;

  return { product_id, theme_id, fields, card_key };
}

export function buildNewCard({ init } = {}){
  const n = normalizeInit(init);

  return {
    token: makeToken(),
    created_at: nowIso(),

    product_id: n.product_id,
    theme_id: n.theme_id,
    card_key: n.card_key,

    // sender-only secret
    setup_key: makeSetupKey(),

    // state
    configured: false,
    choice: null,
    reveal_amount: null,

    revealed: false,
    revealed_at: null,

    // product params
    fields: n.fields,

    // reveal persistence
    board: null,
    scratched_indices: null,
    scratched_fields: null,
  };
}
