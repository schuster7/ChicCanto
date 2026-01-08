// Cloudflare Pages Function route: /token/:token
// GET returns the stored card JSON.
// PUT overwrites the card JSON.

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
  try{
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestGet(context){
  const { env, params } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

  const token = String(params.token || '').trim();
  if (!token) return json({ ok: false, error: 'Missing token.' }, 400);

  const raw = await env.CARDS_KV.get(token);
  if (!raw) return json({ ok: false, error: 'Not found' }, 404);

  try{
    const card = JSON.parse(raw);
    if (card && typeof card === 'object'){
      // Ensure token is present and matches the URL.
      card.token = token;
      return json(card, 200);
    }
  } catch {}

  return json({ ok: false, error: 'Corrupt card record.' }, 500);
}

export async function onRequestPut(context){
  const { request, env, params } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

  const token = String(params.token || '').trim();
  if (!token) return json({ ok: false, error: 'Missing token.' }, 400);

  const body = await readJson(request);
  if (!body || typeof body !== 'object'){
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  // Enforce token consistency.
  if (body.token && String(body.token) !== token){
    return json({ ok: false, error: 'Token mismatch.' }, 409);
  }
  body.token = token;

  // Minimal shape guardrails (don’t over-validate; frontend evolves)
  if (!('setup_key' in body)) body.setup_key = null;
  if (!('created_at' in body)) body.created_at = new Date().toISOString();

  await env.CARDS_KV.put(token, JSON.stringify(body));

  // Return the saved card (store.js can accept this directly)
  return json(body, 200);
}

export async function onRequest(context){
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
