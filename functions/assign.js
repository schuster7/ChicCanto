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

function tryParseLooseArray(raw){
  // Accept values like:
  // 1) ["A","B"] (proper JSON)
  // 2) [A,B]       (quotes got stripped by shell/CLI)
  // 3) A,B         (comma-separated list)
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  let inner = s;
  if (inner.startsWith('[') && inner.endsWith(']')){
    inner = inner.slice(1, -1);
  }

  // If it doesn't look like a list at all, bail.
  if (!inner.includes(',')) return null;

  const items = inner
    .split(',')
    .map(v => v.trim())
    .map(v => v.replace(/^"|"$/g, ''))
    .map(v => v.replace(/^'|'$/g, ''))
    .filter(Boolean);

  return items.length ? items : null;
}

async function getJsonKV(env, key){
  const raw = await env.CARDS_KV.get(key);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch {
    // For inventory lists, accept a loose array representation.
    if (key.startsWith('codes:')){
      const loose = tryParseLooseArray(raw);
      if (loose) return loose;
    }
    return null;
  }
}

export async function onRequestPost(context){
  const { request, env } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

  const requiredKey = String(env.FULFILL_KEY || '').trim();
  if (!requiredKey){
    return json({ ok: false, error: 'Server misconfigured: missing FULFILL_KEY.' }, 500);
  }

  const provided = String(request.headers.get('X-FULFILL-KEY') || '').trim();
  if (!provided || provided !== requiredKey){
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
    let rec = await getJsonKV(env, acKey);

    // If there is no record yet (fresh inventory), treat it as available.
    if (!rec || typeof rec !== 'object'){
      rec = {
        code,
        sku,
        status: 'available',
        created_at: new Date().toISOString(),
      };
    }

    const status = String(rec.status || 'available').toLowerCase();
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

export async function onRequest(){
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
