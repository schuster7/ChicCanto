import { getTokenRecord, setTokenRecord } from './_db.js';

function json(status, obj){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function extractTokenFromPath(urlStr){
  const url = new URL(urlStr);
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.lastIndexOf('token');
  if (idx === -1 || idx >= parts.length - 1) return null;
  return decodeURIComponent(parts[idx + 1]);
}

export default async function handler(request){
  const token = extractTokenFromPath(request.url);
  if (!token) return json(400, { ok: false, error: 'Missing token' });

  if (request.method === 'GET'){
    const record = await getTokenRecord(token);
    if (!record) return json(404, { ok: false, error: 'Token not found' });
    // IMPORTANT: Frontend expects the card record at the top-level (same as dev-api.cjs).
    // Returning a wrapper like { ok: true, card: {...} } breaks store.js (card.setup_key becomes undefined).
    return json(200, record);
  }

  if (request.method === 'PUT'){
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: 'Invalid JSON' });
    }

    if (!body || typeof body !== 'object'){
      return json(400, { ok: false, error: 'Invalid body' });
    }

    // Force path token to be source of truth
    body.token = token;

    await setTokenRecord(token, body);
    // Return the stored record (same shape as GET) so the frontend doesn't clobber state.
    return json(200, body);
  }

  return json(405, { ok: false, error: 'Method not allowed' });
}
