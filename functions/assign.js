// Cloudflare Pages Function route: POST /assign
// Assigns activation code(s) to an Etsy order, server-side.
// Manual fulfillment v1: user selects card_key + quantity (1 or 4).
// Each activation code is bound to a single card (one redeem = one card).

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

function normalizeOrderId(raw){
  // Keep Etsy order IDs exactly as the fulfiller pasted, but trimmed.
  return String(raw || '').trim();
}

function normalizeCardKey(raw){
  return String(raw || '').trim();
}

function normalizeQuantity(raw){
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (n === 4) return 4;
  return 1;
}

function buildOrderKey(order_id, card_key, quantity){
  return `order:${order_id}:${card_key}:${quantity}`;
}

function buildOrderIndexKey(order_id){
  return `order:${order_id}`;
}

function cardKeyToCodePrefix(card_key){
  // Human-readable prefix for support. Keep it stable once issued.
  const k = String(card_key || '').trim();
  const MAP = {
    'men-novice1': 'CC-MEN-STD1',
    'men-novice-birthday1': 'CC-MEN-BDAY1',
    'women-novice1': 'CC-WOM-STD1',
    'women-novice-birthday1': 'CC-WOM-BDAY1',
    'men-advanced1': 'CC-MEN-ADV1',
    'women-advanced1': 'CC-WOM-ADV1',
  };
  return MAP[k] || 'CC-CARD';
}

function buildMessage({ codes, origin, buyerName }){
  const base = `${origin}/`;

  const name = String(buyerName || '').trim();
  const greeting = name ? `Hi ${name},\n\n` : '';

  const list = (Array.isArray(codes) ? codes : []).filter(Boolean);
  const lines = list.length <= 1
    ? [`Your activation code: ${list[0] || ''}`]
    : [
        `Your ${list.length} activation codes (one per card):`,
        ...list.map((c, i) => `Card ${i + 1}: ${c}`)
      ];

  return (
`${greeting}Thanks for your order, and welcome to ChicCanto.\n\n${lines.join('\n')}\n\nHow to use it:\n1) Open: ${base}\n2) Paste your activation code and follow the steps on screen\n\nThis is quick, private, and works on both phone and desktop. If you ever need to access it again, just use the same code.\n\nNeed help?\nFAQ: ${base}faq/\nSupport: chiccanto@wearrs.com`
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

async function generateUniqueCode(env, prefix){
  // PREFIX-XXXXXXXX (8 random chars)
  for (let attempt = 0; attempt < 12; attempt++){
    const code = `${prefix}-${randomChars(8)}`;
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
  const card_key = normalizeCardKey(body.card_key);
  const quantity = normalizeQuantity(body.quantity);
  const buyer_name = (typeof body.buyer_name === 'string') ? body.buyer_name.trim() : '';

  if (!order_id){
    return json({ ok: false, error: 'Missing order_id.' }, 400);
  }
  if (!card_key){
    return json({ ok: false, error: 'Missing card_key.' }, 400);
  }

  const origin = new URL(request.url).origin;

  // Idempotent per order + card_key + quantity.
  const orderKey = buildOrderKey(order_id, card_key, quantity);
  const orderIndexKey = buildOrderIndexKey(order_id);

  // Check the specific composite key first (canonical for idempotency).
  let existingOrder = await getJsonKV(env, orderKey);

  // Backwards/ops compatibility: if a plain order key exists and matches this exact assignment, reuse it.
  if (!existingOrder){
    const legacyOrder = await getJsonKV(env, orderIndexKey);
    const sameAssignment =
      legacyOrder &&
      typeof legacyOrder === 'object' &&
      String(legacyOrder.card_key || '') === card_key &&
      Number(legacyOrder.quantity || 0) === quantity &&
      Array.isArray(legacyOrder.codes) &&
      legacyOrder.codes.length;
    if (sameAssignment) existingOrder = legacyOrder;
  }

  if (existingOrder && typeof existingOrder === 'object' && Array.isArray(existingOrder.codes) && existingOrder.codes.length){
    const codes = existingOrder.codes.map(String);
    const message_text = buildMessage({ codes, origin, buyerName: buyer_name || existingOrder.buyer_name || '' });
    return json({
      ok: true,
      existing: true,
      order_id,
      card_key,
      quantity,
      codes,
      etsy_message: message_text,
      message_text,
    });
  }

  const prefix = cardKeyToCodePrefix(card_key);

  const codes = [];
  for (let i = 0; i < quantity; i++){
    let code = '';
    try{
      code = await generateUniqueCode(env, prefix);
    } catch {
      return json({ ok: false, error: 'Could not generate a new code. Try again.' }, 500);
    }

    const assigned_at = new Date().toISOString();
    const acKey = `ac:${code}`;

    const acRec = {
      code,
      sku: 'single',
      status: 'assigned',
      order_id,
      buyer_name: buyer_name || null,
      assigned_at,
      bundle_index: quantity > 1 ? (i + 1) : null,
      init: { card_key },
    };

    await env.CARDS_KV.put(acKey, JSON.stringify(acRec));
    codes.push(code);
  }

  const orderRec = {
    order_id,
    card_key,
    quantity,
    codes,
    buyer_name: buyer_name || null,
    assigned_at: new Date().toISOString(),
  };
  // Store both:
  // - composite key = idempotent assignment identity (order + card + quantity)
  // - plain order key = quick lookup/index for later redeem enrichment and support tools
  await env.CARDS_KV.put(orderKey, JSON.stringify(orderRec));
  await env.CARDS_KV.put(orderIndexKey, JSON.stringify(orderRec));

  const message_text = buildMessage({ codes, origin, buyerName: buyer_name });
  return json({
    ok: true,
    existing: false,
    order_id,
    card_key,
    quantity,
    codes,
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
