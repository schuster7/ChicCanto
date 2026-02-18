// Cloudflare Pages Function route: POST /assign
// Assigns an activation code to an Etsy order, server-side.
// Operational mode: generates secure random codes on-demand (no preloaded pool required).

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

function skuPrefix(sku){
  if (sku === 'fullset') return 'CC-F';
  return 'CC-S';
}

function buildMessage({ code, origin, buyerName }){
  const base = `${origin}/`;
  const name = String(buyerName || '').trim();
  const greeting = name ? `Hi ${name},\n\n` : '';

  return (
`${greeting}Thanks for your order, and welcome to ChicCanto.\n\nYour activation code: ${code}\n\nTo activate your card:\n1) Open: ${base}\n2) Enter your activation code and follow the steps on screen\n\nThis is quick, private, and works on both phone and desktop. If you ever need to access it again, just enter the same code on the site and you’ll pick up where you left off.\n\nWant ideas, boundaries, or how it works before you start?\nFAQ: ${base}faq/\n\nSupport: chiccanto@wearrs.com\n\nIf you enjoyed it, keep an eye on the shop. New cards and themes are added regularly.`
  );
}

async function getJsonKV(env, key){
  const raw = await env.CARDS_KV.get(key);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoids 0/O and 1/I

function randomChars(len){
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++){
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function generateUniqueCode(env, sku){
  const prefix = skuPrefix(sku);
  // 16 random chars in 4 groups => PREFIX-XXXX-XXXX-XXXX-XXXX
  for (let attempt = 0; attempt < 12; attempt++){
    const body = randomChars(16);
    const code =
      `${prefix}-${body.slice(0,4)}-${body.slice(4,8)}-${body.slice(8,12)}-${body.slice(12,16)}`;

    const exists = await env.CARDS_KV.get(`ac:${code}`);
    if (!exists) return code;
  }
  throw new Error('Failed to generate a unique code.');
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
    const message_text = buildMessage({ code, origin, buyerName: buyer_name || existingOrder.buyer_name || '' });
    return json({
      ok: true,
      existing: true,
      order_id,
      sku: existingOrder.sku || sku,
      code,
      etsy_message: message_text,
      message_text,
    });
  }

  // Generate a new code on-demand (no pool).
  let chosen = '';
  try{
    chosen = await generateUniqueCode(env, sku);
  } catch {
    return json({ ok: false, error: 'Could not generate a new code. Try again.' }, 500);
  }

  const assigned_at = new Date().toISOString();
  const acKey = `ac:${chosen}`;

  const acRec = {
    code: chosen,
    sku,
    status: 'assigned',
    order_id,
    buyer_name: buyer_name || null,
    assigned_at,
  };
  await env.CARDS_KV.put(acKey, JSON.stringify(acRec));

  const orderRec = {
    order_id,
    sku,
    code: chosen,
    buyer_name: buyer_name || null,
    assigned_at,
  };
  await env.CARDS_KV.put(orderKey, JSON.stringify(orderRec));

  const message_text = buildMessage({ code: chosen, origin, buyerName: buyer_name });
  return json({
    ok: true,
    existing: false,
    order_id,
    sku,
    code: chosen,
    etsy_message: message_text,
    message_text,
  });
}

// --- session cookie verification ---

const SESSION_COOKIE_NAME = 'cc_fulfill';

function getCookie(request, name){
  const header = request.headers.get('Cookie') || '';
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

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const payloadB64 = parts[0];
  const sigB64 = parts[1];

  let payloadJson = '';
  try{
    payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return false;
  }

  let payload = null;
  try{ payload = JSON.parse(payloadJson); } catch { return false; }
  if (!payload || typeof payload !== 'object') return false;

  const exp = Number(payload.exp || 0);
  if (!exp || Date.now() > exp) return false;

  const expectedSig = await hmacSha256(sessionSecret, payloadB64);
  let gotSig = null;
  try{ gotSig = base64UrlToUint8Array(sigB64); } catch { return false; }

  return timingSafeEqual(expectedSig, gotSig);
}
