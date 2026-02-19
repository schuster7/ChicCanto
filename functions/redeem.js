// Cloudflare Pages Function route: POST /redeem
// Stores card state in KV and returns the shape the frontend expects.

import { buildNewCard } from './_lib/cards.js';

function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function err(errorCode, error, status = 400, extra = {}){
  return json({ ok: false, errorCode, error, ...extra }, status);
}

async function readJson(request){
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) return null;
  try{
    return await request.json();
  } catch {
    return null;
  }
}


const REDEEM_RL_WINDOW_SECONDS = 10 * 60; // 10 minutes
const REDEEM_RL_MAX_PER_IP = 60;          // per IP per window (generous for real users)
const REDEEM_RL_MAX_PER_CODE = 20;        // per activation code per window (stops targeted guessing)

function getClientIp(request){
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    ''
  );
}

async function bumpRate(env, key, windowSeconds, max){
  if (!env?.CARDS_KV || !key) return { allowed: true };

  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const k = `rl:${key}:${windowId}`;

  const raw = await env.CARDS_KV.get(k);
  const count = raw ? parseInt(raw, 10) : 0;

  if (Number.isFinite(count) && count >= max){
    return { allowed: false };
  }

  const next = (Number.isFinite(count) ? count : 0) + 1;
  await env.CARDS_KV.put(k, String(next), { expirationTtl: windowSeconds + 30 });
  return { allowed: true };
}

async function rateLimitRedeem(env, request, code){
  const ip = getClientIp(request);

  const ipRes = await bumpRate(env, `redeem:ip:${ip}`, REDEEM_RL_WINDOW_SECONDS, REDEEM_RL_MAX_PER_IP);
  if (!ipRes.allowed) return { allowed: false };

  // Code bucket is optional (only if caller provided a code).
  if (code){
    const codeRes = await bumpRate(env, `redeem:code:${code}`, REDEEM_RL_WINDOW_SECONDS, REDEEM_RL_MAX_PER_CODE);
    if (!codeRes.allowed) return { allowed: false };
  }

  return { allowed: true };
}

export async function onRequestPost(context){
  const { request, env } = context;

  if (!env || !env.CARDS_KV){
    return err('SERVER_MISCONFIG', 'We couldn’t reach the server. Refresh and try again.', 500);
  }

  const body = await readJson(request);
  if (!body){
    return err('BAD_REQUEST', 'That request didn’t look right. Refresh and try again.', 400);
  }

  const rawCode = (typeof body.code === 'string' ? body.code : '').trim();
  const init = (body.init && typeof body.init === 'object') ? body.init : null;

  if (!rawCode){
    return err('INVALID_CODE', 'That activation code doesn’t look right. Check it and try again.', 400);
  }

  // Normalize code for inventory lookups: trim, uppercase, remove spaces.
  const code = rawCode.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');

  // Rate limit redeem attempts to reduce abuse and code guessing.
  const rl = await rateLimitRedeem(env, request, code);
  if (!rl.allowed){
    return err('RATE_LIMITED', 'Too many attempts. Try again in 10 minutes.', 429, { retryAfterSeconds: REDEEM_RL_WINDOW_SECONDS });
  }

  const acKey = `ac:${code}`;

  // Inventory enforcement: code must exist in KV.
  let ac = null;
  try{
    const raw = await env.CARDS_KV.get(acKey);
    if (raw) ac = JSON.parse(raw);
  } catch {}

  if (!ac || typeof ac !== 'object'){
    return err('NOT_FOUND', 'That activation code wasn’t found. Check it and try again.', 404);
  }

  const status = String(ac.status || '').toLowerCase();
  const sku = String(ac.sku || '').toLowerCase();
  const quantity = Number.isFinite(ac.quantity_allowed)
    ? Math.max(1, Math.min(10, ac.quantity_allowed))
    : (sku === 'fullset' ? 4 : 1);

  // If already redeemed and tokens exist, return existing cards.
  if ((status === 'redeemed' || status === 'assigned') && Array.isArray(ac.tokens) && ac.tokens.length){
    const cards = [];
    for (const t of ac.tokens){
      const rawCard = await env.CARDS_KV.get(String(t));
      if (!rawCard) continue;
      try{
        const c = JSON.parse(rawCard);
        if (c && typeof c === 'object') cards.push(c);
      } catch {}
    }
    if (cards.length){
      return json({ ok: true, existing: true, cards });
    }
  }

  // Create cards now.
  const tokens = [];
  const cards = [];

  // Server-owned init wins; fall back to client init only if inventory doesn't specify.
  const invInit = (ac.init && typeof ac.init === 'object') ? ac.init : null;
  const finalInit = invInit || init;

  for (let i = 0; i < quantity; i++){
    const card = buildNewCard({ init: finalInit });
    tokens.push(card.token);
    cards.push(card);
    await env.CARDS_KV.put(card.token, JSON.stringify(card));
  }

  // Update inventory record
  const redeemed_at = new Date().toISOString();
  const updated = {
    ...ac,
    code,
    sku: sku || ac.sku || null,
    status: 'redeemed',
    redeemed_at,
    tokens,
  };
  await env.CARDS_KV.put(acKey, JSON.stringify(updated));

  // Backwards compatible index for older tooling (optional but harmless)
  await env.CARDS_KV.put(`code:${code}`, JSON.stringify(tokens));

  // If an order mapping exists, enrich it with tokens.
  if (ac.order_id){
    const orderKey = `order:${String(ac.order_id).trim()}`;
    try{
      const rawOrder = await env.CARDS_KV.get(orderKey);
      if (rawOrder){
        const o = JSON.parse(rawOrder);
        if (o && typeof o === 'object'){
          o.tokens = tokens;
          o.redeemed_at = redeemed_at;
          await env.CARDS_KV.put(orderKey, JSON.stringify(o));
        }
      }
    } catch {}
  }

  return json({ ok: true, existing: false, cards });
}

export async function onRequest(context){
  // Explicitly reject non-POST to avoid confusing client behavior.
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
