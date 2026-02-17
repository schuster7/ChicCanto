// POST /auth
// Validates the shared password (env.FULFILL_KEY) and sets an HttpOnly signed session cookie.
// GET  /auth
// Returns whether the current request is authenticated (cookie valid).

const SESSION_COOKIE_NAME = 'cc_fulfill';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

function json(data, status = 200, extraHeaders = {}){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

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

function uint8ToBase64Url(u8){
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payloadJson = '';
  try{
    payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadB64));
  } catch {
    return false;
  }

  let payload;
  try{
    payload = JSON.parse(payloadJson);
  } catch {
    return false;
  }

  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const expectedSig = await hmacSha256(sessionSecret, payloadB64);
  let providedSig;
  try{
    providedSig = base64UrlToUint8Array(sigB64);
  } catch {
    return false;
  }

  return timingSafeEqual(expectedSig, providedSig);
}

export async function onRequest(context){
  const { request, env } = context;

  const requiredKey = String(env.FULFILL_KEY || '').trim();
  const sessionSecret = String(env.FULFILL_SESSION_SECRET || '').trim();
  if (!requiredKey){
    return json({ ok: false, error: 'Server misconfigured: missing FULFILL_KEY.' }, 500);
  }
  if (!sessionSecret){
    return json({ ok: false, error: 'Server misconfigured: missing FULFILL_SESSION_SECRET.' }, 500);
  }

  if (request.method === 'GET'){
    const authenticated = await verifySessionCookie(request, sessionSecret);
    return json({ ok: true, authenticated });
  }

  // Logout: clear the session cookie
  if (request.method === 'DELETE'){
    const cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }

  if (request.method !== 'POST'){
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  let body;
  try{
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }

  const password = String(body?.password || '').trim();
  if (!password || password !== requiredKey){
    // Do not leak whether the key exists; just fail.
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const payload = {
    v: 1,
    exp: Date.now() + (SESSION_TTL_SECONDS * 1000),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = uint8ToBase64Url(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(sessionSecret, payloadB64);
  const sigB64 = uint8ToBase64Url(sig);
  const token = `${payloadB64}.${sigB64}`;

  // Strict cookie: only sent over HTTPS, not readable by JS, not cross-site.
  const cookie = `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}
