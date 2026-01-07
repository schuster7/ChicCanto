import crypto from 'node:crypto';
import { getOrderRecord, setOrderRecord, getTokenRecord, setTokenRecord } from './_db.js';

function json(status, obj){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function makeTokenFromString(seed){
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  const short = hash.slice(0, 12); // 12 hex chars
  return `${short.slice(0, 8)}-${short.slice(8)}`;
}

function base64url(bytes){
  return Buffer.from(bytes).toString('base64url');
}

async function ensureTokenForOrder(orderCode, index, init){
  const token = makeTokenFromString(`${orderCode}:${index}:${init.product_id}`);

  // If it already exists, keep it (idempotent)
  const existing = await getTokenRecord(token);
  if (existing) {
    return { token, setup_key: existing.setup_key, product_id: existing.product_id };
  }

  const setup_key = base64url(crypto.randomBytes(16));
  const card = {
    version: 1,
    token,
    product_id: init.product_id,
    theme_id: init.theme_id || 'default',
    fields: init.fields || {},
    setup_key,
    created_at: Date.now(),
    configured: false,
    outcome_mode: 'we_pick'
  };

  await setTokenRecord(token, card);
  return { token, setup_key, product_id: init.product_id };
}

export default async function handler(request){
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const code = (body?.code || '').toString().trim();
  const init = body?.init;

  if (!code) return json(400, { ok: false, error: 'Missing code' });
  if (!init || typeof init !== 'object' || !init.product_id) {
    return json(400, { ok: false, error: 'Missing init' });
  }

  const requestedInits = [init];

  // Idempotent order: if already exists, return existing cards.
  const existingOrder = await getOrderRecord(code);
  if (existingOrder?.cards?.length) {
    return json(200, { ok: true, existing: true, cards: existingOrder.cards });
  }

  const cards = [];
  for (let i = 0; i < requestedInits.length; i++) {
    const c = await ensureTokenForOrder(code, i + 1, requestedInits[i]);
    cards.push(c);
  }

  await setOrderRecord(code, { code, created_at: Date.now(), cards });

  return json(200, { ok: true, existing: false, cards });
}
