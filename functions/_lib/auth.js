// Shared authentication helpers for ChicCanto admin routes.
// Extracted from assign.js, auth.js, replace-assignment.js, void-assignment.js.

export const SESSION_COOKIE_NAME = 'cc_fulfill';

export function getCookie(request, name){
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

export function base64UrlToUint8Array(b64url){
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hmacSha256(secret, data){
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

export function timingSafeEqual(a, b){
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= (a[i] ^ b[i]);
  return out === 0;
}

export async function verifySessionCookie(request, sessionSecret){
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

export async function verifyApiKey(request, env){
  const secret = String(env?.FULFILL_API_KEY || '').trim();
  if (!secret) return false;

  const header = String(request.headers.get('Authorization') || '').trim();
  if (!header.startsWith('Bearer ')) return false;

  const provided = header.slice(7);
  if (!provided) return false;

  const enc = new TextEncoder();
  const a = enc.encode(secret);
  const b = enc.encode(provided);

  return timingSafeEqual(a, b);
}
