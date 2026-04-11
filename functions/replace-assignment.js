import { verifySessionCookie, SESSION_COOKIE_NAME } from './_lib/auth.js';

// Cloudflare Pages Function route: POST /replace-assignment
// Admin-only: replace an already activated assignment for an order so a correct card can be assigned.

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
  if (currentStatus === 'replaced'){
    return json({ ok: false, error: 'That assignment is already replaced.' }, 409);
  }

  const codes = Array.isArray(existingOrder.codes) ? existingOrder.codes.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!codes.length){
    return json({ ok: false, error: 'Assignment is missing codes and cannot be replaced safely.' }, 409);
  }

  const acRecords = [];
  let foundActivated = false;

  for (const code of codes){
    const rec = await getJsonKV(env, `ac:${code}`);
    if (!rec || typeof rec !== 'object'){
      return json({ ok: false, error: `Code ${code} is missing. Cannot replace safely.` }, 409);
    }
    const status = String(rec.status || '').toLowerCase();
    if (status === 'voided'){
      return json({ ok: false, error: `Code ${code} is voided and cannot be replaced here.` }, 409);
    }
    if (status === 'replaced'){
      return json({ ok: false, error: `Code ${code} is already replaced.` }, 409);
    }
    if (hasActivation(rec)) foundActivated = true;
    acRecords.push({ code, rec });
  }

  if (!foundActivated){
    return json({ ok: false, error: 'This assignment has not been activated yet. Use void instead.', assignment_state: 'assigned_unactivated' }, 409);
  }

  const replaced_at = new Date().toISOString();
  const replace_reason = 'admin_replace_activated_wrong_card';

  for (const item of acRecords){
    const next = {
      ...item.rec,
      status: 'replaced',
      replaced_at,
      replace_reason,
    };
    await env.CARDS_KV.put(`ac:${item.code}`, JSON.stringify(next));

    const tokens = Array.isArray(item.rec.tokens) ? item.rec.tokens.map((v) => String(v || '').trim()).filter(Boolean) : [];
    for (const token of tokens){
      const rawCard = await env.CARDS_KV.get(token);
      if (!rawCard) continue;
      try{
        const card = JSON.parse(rawCard);
        if (!card || typeof card !== 'object') continue;
        const nextCard = {
          ...card,
          status: 'replaced',
          replaced_at,
          replace_reason,
        };
        await env.CARDS_KV.put(token, JSON.stringify(nextCard));
      } catch {}
    }
  }

  const replacedOrder = {
    ...existingOrder,
    status: 'replaced',
    replaced_at,
    replace_reason,
  };

  const historyKey = `order:replaced:${order_id}:${replaced_at}`;
  const compositeKey = buildOrderKey(order_id, existingOrder.card_key, existingOrder.quantity);

  await env.CARDS_KV.put(historyKey, JSON.stringify(replacedOrder));
  await env.CARDS_KV.put(compositeKey, JSON.stringify(replacedOrder));
  await env.CARDS_KV.delete(orderIndexKey);

  return json({
    ok: true,
    order_id,
    replaced: true,
    card_key: String(existingOrder.card_key || ''),
    quantity: Number(existingOrder.quantity || codes.length || 1),
    codes,
    replaced_at,
  });
}

export async function onRequest(context){
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}