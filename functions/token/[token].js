// Cloudflare Pages Function route: /token/:token
// GET returns the stored card JSON (with sender-only fields redacted unless setup key matches).
// PUT updates only an allowlisted set of mutable card fields.

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

function sanitizeCardForClient(card, token, { includeSetupKey = false } = {}){
  const out = (card && typeof card === 'object') ? { ...card } : {};

  // Always enforce token from URL, never trust stored/body token blindly.
  out.token = token;

  // Sender-only secret: only include when caller proves setup access.
  if (!includeSetupKey){
    delete out.setup_key;
  }

  return out;
}

function isValidChoice(value){
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isValidTierBoard(value){
  return Array.isArray(value) && value.length > 0 && value.length <= 9 && value.every(v => typeof v === 'string' && v.length <= 16);
}

function isValidIndexList(value){
  return Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0 && v < 100);
}

function applyAllowedUpdates(existing, body){
  const next = { ...existing };

  // Mutable state fields only.
  if ('configured' in body) next.configured = !!body.configured;

  if ('choice' in body){
    next.choice = (body.choice == null) ? null : (isValidChoice(body.choice) ? body.choice : next.choice);
  }

  if ('reveal_amount' in body){
    if (body.reveal_amount == null){
      next.reveal_amount = null;
    } else {
      const n = Number(body.reveal_amount);
      if (Number.isFinite(n) && n >= 0 && n <= 1000000) next.reveal_amount = n;
    }
  }

  if ('revealed' in body) next.revealed = !!body.revealed;

  if ('revealed_at' in body){
    next.revealed_at = (body.revealed_at == null) ? null : String(body.revealed_at);
  }

  if ('fields' in body){
    const n = Number(body.fields);
    if (Number.isInteger(n) && n >= 1 && n <= 9) next.fields = n;
  }

  if ('board' in body){
    next.board = (body.board == null) ? null : (isValidTierBoard(body.board) ? body.board : next.board);
  }

  if ('scratched_indices' in body){
    next.scratched_indices = (body.scratched_indices == null)
      ? null
      : (isValidIndexList(body.scratched_indices) ? body.scratched_indices : next.scratched_indices);
  }

  if ('scratched_fields' in body){
    // Kept permissive for forward compatibility.
    next.scratched_fields = (body.scratched_fields == null) ? null : body.scratched_fields;
  }

  return next;
}

export async function onRequestGet(context){
  const { env, params, request } = context;

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
      const url = new URL(request.url);
      const setupParam = String(
        url.searchParams.get('setup') ||
        url.searchParams.get('setup_key') ||
        url.searchParams.get('setupKey') ||
        ''
      ).trim();
      const includeSetupKey = !!(setupParam && card.setup_key && setupParam === card.setup_key);

      return json(sanitizeCardForClient(card, token, { includeSetupKey }), 200);
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

  // Enforce token consistency if caller includes one.
  if (body.token && String(body.token) !== token){
    return json({ ok: false, error: 'Token mismatch.' }, 409);
  }

  const rawExisting = await env.CARDS_KV.get(token);
  if (!rawExisting) return json({ ok: false, error: 'Not found' }, 404);

  let existing;
  try{
    existing = JSON.parse(rawExisting);
  } catch {
    return json({ ok: false, error: 'Corrupt card record.' }, 500);
  }

  if (!existing || typeof existing !== 'object'){
    return json({ ok: false, error: 'Corrupt card record.' }, 500);
  }

  // Ignore attempts to mutate server-owned/sender-only fields (token/setup/card identity/created_at).
  const next = applyAllowedUpdates(existing, body);
  next.token = token;

  await env.CARDS_KV.put(token, JSON.stringify(next));

  // Never return setup_key from public PUT response.
  return json(sanitizeCardForClient(next, token, { includeSetupKey: false }), 200);
}

export async function onRequest(context){
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
