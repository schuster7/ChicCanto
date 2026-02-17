// Cloudflare Pages Function route: POST /assign
// Assigns the next available activation code to an Etsy order, server-side.
// This is the manual fulfillment bridge until the Etsy app is approved.

function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readJson(request){
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) return null;
  try{ return await request.json(); } catch { return null; }
}

function normalizeSku(raw){
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'single') return 'single';
  if (s === 'fullset' || s === 'full_set' || s === 'set' || s === 'bundle') return 'fullset';
  return '';
}

function normalizeOrderId(raw){
  // Keep Etsy order IDs exactly as the fulfiller pasted, but trimmed.
  return String(raw || '').trim();
}

function buildMessage({ code, sku, origin }){
  const base = `${origin}/activate/`;
  if (sku === 'fullset'){
    return (
`Thanks for your order.\n\nYour activation code: ${code}\n\n1) Open the link in your PDF (or go to ${base})\n2) Enter the code and follow the steps\n3) You will get 4 share links after activation\n\nIf you lose the link, enter the same code again to recover it.\nSupport: chiccanto@wearrs.com`
    );
  }

  return (
`Thanks for your order.\n\nYour activation code: ${code}\n\n1) Open the link in your PDF (or go to ${base})\n2) Enter the code and follow the steps\n3) You will get a share link for your recipient\n\nIf you lose the link, enter the same code again to recover it.\nSupport: chiccanto@wearrs.com`
  );
}

async function getJsonKV(env, key){
  const raw = await env.CARDS_KV.get(key);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

export async function onRequestPost(context){
  const { request, env } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

  // Auth: require a valid signed session cookie (set by POST /auth).
  const sessionSecret = String(env.FULFILL_SESSION_SECRET || '').trim();
  if (!sessionSecret){
    return json({ ok: false, error: 'Server misconfigured: missing FULFILL_SESSION_SECRET.' }, 500);
  }

  const authed = await verifySessionCookie(request, sessionSecret);
  if (!authed){
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const body = await readJson(request);
  if (!body){
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const order_id = normalizeOrderId(body.order_id);
  const sku = normalizeSku(body.sku);
  const buyer_name = (typeof body.buyer_name === 'string') ? body.buyer_name.trim() : '';

  if (!order_id){
    return json({ ok: false, error: 'Missing order_id.' }, 400);
  }
  if (!sku){
    return json({ ok: false, error: 'Invalid sku. Use single or fullset.' }, 400);
  }

  const origin = new URL(request.url).origin;
  const orderKey = `order:${order_id}`;

  // Idempotent: if this order already has a code, return it.
  const existingOrder = await getJsonKV(env, orderKey);
  if (existingOrder && typeof existingOrder === 'object' && existingOrder.code){
    const code = String(existingOrder.code);
    const message_text = buildMessage({ code, sku: existingOrder.sku || sku, origin });
    return json({ ok: true, existing: true, order_id, sku: existingOrder.sku || sku, code, message_text });
  }

  // Read code list and pointer.
  const listKey = `codes:${sku}`;
  const pointerKey = `next_index:${sku}`;

  const codeList = await getJsonKV(env, listKey);
  if (!Array.isArray(codeList) || !codeList.length){
    return json({ ok: false, error: `No inventory loaded for sku: ${sku}.` }, 409);
  }

  let pointer = 0;
  try{
    const raw = await env.CARDS_KV.get(pointerKey);
    if (raw) pointer = Math.max(0, parseInt(raw, 10) || 0);
  } catch {}

  const MAX_TRIES = Math.min(200, codeList.length);
  let chosen = '';
  let chosenIndex = -1;
  let chosenRecord = null;

  for (let i = 0; i < MAX_TRIES; i++){
    const idx = (pointer + i) % codeList.length;
    const code = String(codeList[idx] || '').trim();
    if (!code) continue;

    const acKey = `ac:${code}`;
    const rec = await getJsonKV(env, acKey);
    if (!rec || typeof rec !== 'object') continue;

    const status = String(rec.status || '').toLowerCase();
    const recSku = normalizeSku(rec.sku || sku) || sku;
    if (recSku !== sku) continue;
    if (status !== 'available') continue;

    chosen = code;
    chosenIndex = idx;
    chosenRecord = rec;
    break;
  }

  if (!chosen){
    return json({ ok: false, error: `No available codes left for sku: ${sku}.` }, 409);
  }

  const nextPointer = (chosenIndex + 1) % codeList.length;
  await env.CARDS_KV.put(pointerKey, String(nextPointer));

  const assigned_at = new Date().toISOString();
  const acKey = `ac:${chosen}`;
  const updated = {
    ...chosenRecord,
    code: chosen,
    sku,
    status: 'assigned',
    order_id,
    buyer_name: buyer_name || chosenRecord.buyer_name || null,
    assigned_at,
  };
  await env.CARDS_KV.put(acKey, JSON.stringify(updated));

  const orderRec = {
    order_id,
    sku,
    code: chosen,
    buyer_name: buyer_name || null,
    assigned_at,
  };
  await env.CARDS_KV.put(orderKey, JSON.stringify(orderRec));

  const message_text = buildMessage({ code: chosen, sku, origin });
  return json({ ok: true, existing: false, order_id, sku, code: chosen, message_text });
}

// --- session cookie verification ---

const SESSION_COOKIE_NAME = 'cc_fulfill';

function getCookie(request, name){
  const header = request.headers.get('Cookie') || '';
  // naive but safe enough for small cookie sets
  const parts = header.split(/;\s*/);
  for (const part of parts){
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1);
  }
  return '';
}

function base64UrlToUint8Array(b64url){
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret, data){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a, b){
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= (a[i] ^ b[i]);
  return out === 0;
}

async function verifySessionCookie(request, sessionSecret){
  const token = String(getCookie(request, SESSION_COOKIE_NAME) || '').trim();
  if (!token) return false;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payloadJson = '';
  try{
    payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadB64));
  } catch {
    return false;
  }

  let payload;
  try{
    payload = JSON.parse(payloadJson);
  } catch {
    return false;
  }

  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const expectedSig = await hmacSha256(sessionSecret, payloadB64);
  let providedSig;
  try{
    providedSig = base64UrlToUint8Array(sigB64);
  } catch {
    return false;
  }

  return timingSafeEqual(expectedSig, providedSig);
}

export async function onRequest(){
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
