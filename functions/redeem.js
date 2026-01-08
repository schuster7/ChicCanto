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

async function readJson(request){
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) return null;
  try{
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestPost(context){
  const { request, env } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

  const body = await readJson(request);
  if (!body){
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const code = (typeof body.code === 'string' ? body.code : '').trim();
  const init = (body.init && typeof body.init === 'object') ? body.init : null;

  if (!code){
    return json({ ok: false, error: 'Missing activation code.' }, 400);
  }

  // For live testing we accept any non-empty code.
  // We keep an index so re-activating the same code returns existing cards.
  const codeKey = `code:${code}`;

  let tokens = [];
  try{
    const raw = await env.CARDS_KV.get(codeKey);
    if (raw) tokens = JSON.parse(raw) || [];
    if (!Array.isArray(tokens)) tokens = [];
  } catch {
    tokens = [];
  }

  if (tokens.length){
    const cards = [];
    for (const t of tokens){
      const rawCard = await env.CARDS_KV.get(String(t));
      if (!rawCard) continue;
      try{
        const c = JSON.parse(rawCard);
        if (c && typeof c === 'object') cards.push(c);
      } catch {
        // ignore broken entries
      }
    }

    if (cards.length){
      return json({ ok: true, existing: true, cards });
    }

    // Index exists but cards missing/corrupt: reset and fall through to create new.
    tokens = [];
  }

  const card = buildNewCard({ init });

  // Store the card
  await env.CARDS_KV.put(card.token, JSON.stringify(card));

  // Store the code -> tokens index
  await env.CARDS_KV.put(codeKey, JSON.stringify([card.token]));

  return json({ ok: true, existing: false, cards: [card] });
}

export async function onRequest(context){
  // Explicitly reject non-POST to avoid confusing client behavior.
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
