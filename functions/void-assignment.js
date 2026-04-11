import { verifySessionCookie, SESSION_COOKIE_NAME } from './_lib/auth.js';

// Cloudflare Pages Function route: POST /void-assignment
// Admin-only: void an existing unactivated assignment for an order so it can be reassigned.

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
  return String(raw || '').trim();
}

function buildOrderKey(order_id, card_key, quantity){
  return `order:${order_id}:${card_key}:${quantity}`;
}

function buildOrderIndexKey(order_id){
  return `order:${order_id}`;
}

async function getJsonKV(env, key){
  const raw = await env.CARDS_KV.get(key);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

function hasActivation(rec){
  const status = String(rec?.status || '').toLowerCase();
  const hasTokens = Array.isArray(rec?.tokens) && rec.tokens.length > 0;
  return hasTokens || status === 'redeemed';
}

export async function onRequestPost(context){
  const { request, env } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

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
  if (!order_id){
    return json({ ok: false, error: 'Missing order_id.' }, 400);
  }

  const orderIndexKey = buildOrderIndexKey(order_id);
  const existingOrder = await getJsonKV(env, orderIndexKey);
  if (!existingOrder || typeof existingOrder !== 'object'){
    return json({ ok: false, error: 'No active assignment found for that order.' }, 404);
  }

  const currentStatus = String(existingOrder.status || 'assigned').toLowerCase();
  if (currentStatus === 'voided'){
    return json({ ok: false, error: 'That assignment is already voided.' }, 409);
  }

  const codes = Array.isArray(existingOrder.codes) ? existingOrder.codes.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!codes.length){
    return json({ ok: false, error: 'Assignment is missing codes and cannot be voided safely.' }, 409);
  }

  const acRecords = [];
  for (const code of codes){
    const rec = await getJsonKV(env, `ac:${code}`);
    if (!rec || typeof rec !== 'object'){
      return json({ ok: false, error: `Code ${code} is missing. Cannot void safely.` }, 409);
    }
    const status = String(rec.status || '').toLowerCase();
    if (status === 'voided'){
      return json({ ok: false, error: `Code ${code} is already voided.` }, 409);
    }
    if (hasActivation(rec)){
      return json({ ok: false, error: 'This assignment has already been activated and cannot be voided here.' }, 409, { assignment_state: 'activated' });
    }
    if (status !== 'assigned'){
      return json({ ok: false, error: `Code ${code} is in state ${status || 'unknown'} and cannot be voided here.` }, 409);
    }
    acRecords.push({ code, rec });
  }

  const voided_at = new Date().toISOString();
  const void_reason = 'admin_reassign_unactivated';

  for (const item of acRecords){
    const next = {
      ...item.rec,
      status: 'voided',
      voided_at,
      void_reason,
    };
    await env.CARDS_KV.put(`ac:${item.code}`, JSON.stringify(next));
  }

  const voidedOrder = {
    ...existingOrder,
    status: 'voided',
    voided_at,
    void_reason,
  };

  const historyKey = `order:voided:${order_id}:${voided_at}`;
  const compositeKey = buildOrderKey(order_id, existingOrder.card_key, existingOrder.quantity);

  await env.CARDS_KV.put(historyKey, JSON.stringify(voidedOrder));
  await env.CARDS_KV.put(compositeKey, JSON.stringify(voidedOrder));
  await env.CARDS_KV.delete(orderIndexKey);

  return json({
    ok: true,
    order_id,
    voided: true,
    card_key: String(existingOrder.card_key || ''),
    quantity: Number(existingOrder.quantity || codes.length || 1),
    codes,
    voided_at,
  });
}

export async function onRequest(context){
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}