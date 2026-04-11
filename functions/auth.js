// POST /auth
// Validates the shared password (env.FULFILL_KEY) and sets an HttpOnly signed session cookie.
// GET  /auth
// Returns whether the current request is authenticated (cookie valid).

import { verifySessionCookie, SESSION_COOKIE_NAME, hmacSha256 } from './_lib/auth.js';

const SESSION_TTL_SECONDS = 12 * 60 * 60;

const AUTH_RL_WINDOW_SECONDS = 10 * 60; // 10 minutes
const AUTH_RL_MAX_ATTEMPTS = 10; // per IP per window

function getClientIp(request){
  // Cloudflare sets this. Fallbacks are best-effort.
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    ''
  );
}

async function rateLimitAuth(env, ip){
  // Uses CARDS_KV as the backing store. If missing, rate limiting is skipped.
  if (!env?.CARDS_KV || !ip) return { allowed: true };

  const windowId = Math.floor(Date.now() / 1000 / AUTH_RL_WINDOW_SECONDS);
  const key = `rl:auth:${ip}:${windowId}`;

  const raw = await env.CARDS_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (Number.isFinite(count) && count >= AUTH_RL_MAX_ATTEMPTS){
    return { allowed: false };
  }

  const next = (Number.isFinite(count) ? count : 0) + 1;

  // Keep TTL slightly longer than window so late requests still hit the same bucket.
  await env.CARDS_KV.put(key, String(next), { expirationTtl: AUTH_RL_WINDOW_SECONDS + 30 });

  return { allowed: true };
}

// 12 hours

function json(data, status = 200, extraHeaders = {}){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function uint8ToBase64Url(u8){
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function onRequest(context){
  const { request, env } = context;

  const requiredKey = String(env.FULFILL_KEY || '').trim();
  const sessionSecret = String(env.FULFILL_SESSION_SECRET || '').trim();
  if (!requiredKey){
    return json({ ok: false, error: 'Server misconfigured.' }, 500);
  }
  if (!sessionSecret){
    return json({ ok: false, error: 'Server misconfigured.' }, 500);
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

  // Rate limit login attempts (POST /auth) to reduce brute-force risk.
  const ip = getClientIp(request);
  const rl = await rateLimitAuth(env, ip);
  if (!rl.allowed){
    return json({ ok: false, error: 'Too many attempts. Try again later.' }, 429);
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
