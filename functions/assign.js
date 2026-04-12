import { verifySessionCookie, verifyApiKey } from './_lib/auth.js';

// Cloudflare Pages Function route: POST /assign
// Assigns activation code(s) to an Etsy order, server-side.
// Manual fulfillment v1: user selects card_key + quantity (1 or 4).
// Each activation code is bound to a single card (one redeem = one card).

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

function normalizeOrderId(raw){
  // Keep Etsy order IDs exactly as the fulfiller pasted, but trimmed.
  return String(raw || '').trim();
}

function normalizeCardKey(raw){
  return String(raw || '').trim();
}

function normalizeQuantity(raw){
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (n === 4) return 4;
  return 1;
}

function buildOrderKey(order_id, card_key, quantity){
  return `order:${order_id}:${card_key}:${quantity}`;
}

function buildOrderIndexKey(order_id){
  return `order:${order_id}`;
}

function cardKeyToCodePrefix(card_key){
  // Human-readable prefix for support. Keep it stable once issued.
  const k = String(card_key || '').trim();
  const MAP = {
    'men-novice1': 'CC-MEN-STD1',
    'men-novice-birthday1': 'CC-MEN-BDAY1',
    'women-novice1': 'CC-WOM-STD1',
    'women-novice-birthday1': 'CC-WOM-BDAY1',
    'men-advanced1': 'CC-MEN-ADV1',
    'women-advanced1': 'CC-WOM-ADV1',
    'custom-card': 'CC-CUSTOM',
    'gender-reveal1': 'CC-GENDER',
  };
  return MAP[k] || 'CC-CARD';
}

function escHtml(s){
  const map = {38:'&amp;',60:'&lt;',62:'&gt;',34:'&quot;'};
  return String(s).replace(/[&<>"]/g, (c) => map[c.charCodeAt(0)] || c);
}

function buildHtmlEmail({ greetingHtml, introLine, codeBlocks, faq }){
  const codeBlocksHtml = codeBlocks.map((item) => {
    const label = item.label
      ? `<p style="margin:0 0 6px;font-size:13px;color:#888;text-align:center;">${escHtml(item.label)}</p>`
      : '';
    return label +
      `<div style="text-align:center;margin:24px 0 8px;">` +
      `<div style="display:inline-block;background:#f5f0e8;border:1px solid #e0d5c5;border-radius:8px;padding:16px 24px;">` +
      `<span style="font-family:'Courier New',Courier,monospace;font-size:22px;font-weight:bold;letter-spacing:0.12em;color:#2c2420;">${escHtml(item.code)}</span>` +
      `</div></div>` +
      `<div style="text-align:center;margin:12px 0 20px;">` +
      `<a href="${item.link}" style="background:#2c2420;color:#ffffff;padding:14px 32px;border-radius:50px;font-size:16px;font-weight:600;text-decoration:none;display:inline-block;">Activate your card</a>` +
      `</div>` +
      `<p style="margin:0 0 24px;text-align:center;font-size:12px;color:#999;">Or copy this link into your browser:<br/>` +
      `<a href="${item.link}" style="color:#999;word-break:break-all;">${item.link}</a></p>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>` +
    `<body style="margin:0;padding:0;background:#f9f6f1;font-family:Georgia,serif;">` +
    `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9f6f1;">` +
    `<tr><td align="center" style="padding:24px 16px;">` +
    `<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">` +
    `<tr><td style="background:#2c2420;padding:20px 24px;text-align:center;">` +
    `<span style="font-family:Georgia,serif;font-size:28px;color:#ffffff;font-style:italic;">ChicCanto</span>` +
    `</td></tr>` +
    `<tr><td style="padding:40px;font-size:16px;color:#2c2420;line-height:1.6;">` +
    `<p style="margin:0 0 16px;">${greetingHtml}</p>` +
    `<p style="margin:0 0 24px;color:#555;">Thanks for your order, and welcome to ChicCanto.</p>` +
    `<p style="margin:0 0 8px;color:#555;">${escHtml(introLine)}</p>` +
    codeBlocksHtml +
    `<p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.6;">` +
    `<strong>Sharing tip:</strong> Use the recipient link you get after setup. It opens an &#8220;Open&#8221; page first, ` +
    `because scratching does not work inside Messenger or Instagram&#8217;s in-app browser. The page will guide them to open it in their browser.</p>` +
    `<p style="margin:0;font-size:14px;color:#555;">Need help? <a href="${faq}" style="color:#2c2420;text-decoration:underline;">FAQ</a></p>` +
    `</td></tr>` +
    `<tr><td style="background:#2c2420;padding:20px 24px;text-align:center;">` +
    `<p style="margin:0 0 6px;font-size:14px;color:#ffffff;">Have fun,<br/>ChicCanto</p>` +
    `<p style="margin:0;font-size:12px;color:#9a918a;">Questions? support@chiccanto.com</p>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

function buildMessage({ codes, origin, buyerName, buyerEmail }){
  const base = `${origin}/`;
  const faq = `${base}faq/`;

  const name = String(buyerName || '').trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const greetingHtml = name ? `Hi ${escHtml(name)},` : 'Hi,';

  const list = (Array.isArray(codes) ? codes : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  const buildActivationLink = (code) => `${base}?code=${encodeURIComponent(code)}`;

  let text;
  let html;

  if (list.length <= 1){
    const assignedCode = list[0] || '';
    const activationLink = buildActivationLink(assignedCode);

    text =
`${greeting}

Thanks for your order, and welcome to ChicCanto.

Your activation code: ${assignedCode}

Quick start (recommended):
Open this link and your code will be filled in automatically:

${activationLink}

Manual option:
1. Open: ${base}
2. Paste your activation code and follow the steps on screen

This is quick, private, and works on both phone and desktop.

Sharing tip (important):
Use the recipient link you get after setup. It opens an "Open" page first, because scratching does not work inside Messenger or Instagram's in-app browser. The page will guide them to open it in their browser.

Need the link again later? Just redeem the same code.

Need help?
FAQ: ${faq}

Have fun,
ChicCanto`;

    html = buildHtmlEmail({
      greetingHtml,
      introLine: 'Your scratch card is ready to set up.',
      codeBlocks: [{ code: assignedCode, link: activationLink }],
      faq,
    });

  } else {
    const codeLines = list.map((code, i) => `Card ${i + 1} code: ${code}`);
    const linkLines = list.map((code, i) => `Card ${i + 1}: ${buildActivationLink(code)}`);

    text =
`${greeting}

Thanks for your order, and welcome to ChicCanto.

Your ${list.length} activation codes (one per card):
${codeLines.join('\n')}

Quick start (recommended):
Open a link below and the matching code will be filled in automatically:

${linkLines.join('\n')}

Manual option:
1. Open: ${base}
2. Paste your activation code and follow the steps on screen

This is quick, private, and works on both phone and desktop.

Sharing tip (important):
Use the recipient link you get after setup. It opens an "Open" page first, because scratching does not work inside Messenger or Instagram's in-app browser. The page will guide them to open it in their browser.

Need the link again later? Just redeem the same code.

Need help?
FAQ: ${faq}

Have fun,
ChicCanto`;

    html = buildHtmlEmail({
      greetingHtml,
      introLine: `Your ${list.length} scratch cards are ready to set up.`,
      codeBlocks: list.map((code, i) => ({
        code,
        link: buildActivationLink(code),
        label: `Card ${i + 1}`,
      })),
      faq,
    });
  }

  return { text, html };
}



async function getJsonKV(env, key){
  const raw = await env.CARDS_KV.get(key);
  if (!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

function isInactiveOrderRecord(rec){
  if (!rec || typeof rec !== 'object') return false;
  const status = String(rec.status || '').toLowerCase();
  return status === 'voided' || status === 'replaced';
}

async function inspectAssignmentState(env, codes){
  const list = Array.isArray(codes) ? codes.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!list.length) return { can_void_unactivated: false, assignment_state: 'unknown' };

  const records = [];
  for (const code of list){
    const rec = await getJsonKV(env, `ac:${code}`);
    if (!rec || typeof rec !== 'object'){
      return { can_void_unactivated: false, assignment_state: 'unknown' };
    }
    records.push(rec);
  }

  const allAssignedUnactivated = records.every((rec) => {
    const status = String(rec.status || '').toLowerCase();
    const hasTokens = Array.isArray(rec.tokens) && rec.tokens.length > 0;
    return status === 'assigned' && !hasTokens;
  });

  if (allAssignedUnactivated){
    return { can_void_unactivated: true, assignment_state: 'assigned_unactivated' };
  }

  const anyVoided = records.some((rec) => String(rec.status || '').toLowerCase() === 'voided');
  if (anyVoided){
    return { can_void_unactivated: false, assignment_state: 'voided' };
  }

  const anyReplaced = records.some((rec) => String(rec.status || '').toLowerCase() === 'replaced');
  if (anyReplaced){
    return { can_void_unactivated: false, assignment_state: 'replaced' };
  }

  const anyActivated = records.some((rec) => {
    const status = String(rec.status || '').toLowerCase();
    const hasTokens = Array.isArray(rec.tokens) && rec.tokens.length > 0;
    return hasTokens || status === 'redeemed';
  });

  if (anyActivated){
    return { can_void_unactivated: false, assignment_state: 'activated' };
  }

  return { can_void_unactivated: false, assignment_state: 'unknown' };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoids 0/O and 1/I

function randomChars(len){
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++){
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function generateUniqueCode(env, prefix){
  // PREFIX-XXXXXXXX (8 random chars)
  for (let attempt = 0; attempt < 12; attempt++){
    const code = `${prefix}-${randomChars(8)}`;
    const exists = await env.CARDS_KV.get(`ac:${code}`);
    if (!exists) return code;
  }
  throw new Error('Failed to generate a unique code.');
}

async function sendActivationEmail(env, { buyerEmail, messageHtml, subject }){
  try{
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ChicCanto <moment@chiccanto.com>',
        to: [buyerEmail],
        subject,
        html: messageHtml,
      }),
    });
    if (res.status >= 200 && res.status < 300){
      return { ok: true };
    }
    let error = `HTTP ${res.status}`;
    try{
      const body = await res.text();
      if (body) error = `${error}: ${body.slice(0, 500)}`;
    } catch {}
    return { ok: false, error };
  } catch (e){
    return { ok: false, error: String((e && e.message) || e || 'fetch failed') };
  }
}

export async function onRequestPost(context){
  const { request, env } = context;

  if (!env || !env.CARDS_KV){
    return json({ ok: false, error: 'Server misconfigured: missing CARDS_KV binding.' }, 500);
  }

  // Auth: accept a valid session cookie OR a valid API key.
  const apiKeyAuthed = await verifyApiKey(request, env);
  if (!apiKeyAuthed){
    const sessionSecret = String(env.FULFILL_SESSION_SECRET || '').trim();
    if (!sessionSecret){
      return json({ ok: false, error: 'Server misconfigured: missing FULFILL_SESSION_SECRET.' }, 500);
    }
    const sessionAuthed = await verifySessionCookie(request, sessionSecret);
    if (!sessionAuthed){
      return json({ ok: false, error: 'Unauthorized.' }, 401);
    }
  }

  const body = await readJson(request);
  if (!body){
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const order_id = normalizeOrderId(body.order_id);
  const card_key = normalizeCardKey(body.card_key);
  const quantity = normalizeQuantity(body.quantity);
  const buyer_name = (typeof body.buyer_name === 'string') ? body.buyer_name.trim() : '';
  const buyer_email = (typeof body.buyer_email === 'string') ? body.buyer_email.trim() : '';

  if (!order_id){
    return json({ ok: false, error: 'Missing order_id.' }, 400);
  }
  if (!card_key){
    return json({ ok: false, error: 'Missing card_key.' }, 400);
  }

  const origin = new URL(request.url).origin;

  // Assignment policy: first assignment wins per order_id.
  // We still keep the composite key for support/idempotency history, but `order:${order_id}` is canonical.
  const orderKey = buildOrderKey(order_id, card_key, quantity);
  const orderIndexKey = buildOrderIndexKey(order_id);

  // Canonical lookup: if this order_id already has any assigned codes, always return them.
  let existingOrder = await getJsonKV(env, orderIndexKey);

  // Backwards compatibility: if older data only exists under the composite key, reuse that too.
  if (isInactiveOrderRecord(existingOrder)) existingOrder = null;

  if (!existingOrder){
    existingOrder = await getJsonKV(env, orderKey);
    if (isInactiveOrderRecord(existingOrder)) existingOrder = null;
  }

  if (existingOrder && typeof existingOrder === 'object' && Array.isArray(existingOrder.codes) && existingOrder.codes.length){
    const codes = existingOrder.codes.map(String);
    const existing_card_key = String(existingOrder.card_key || card_key);
    const existing_quantity = Number(existingOrder.quantity || quantity || codes.length || 1);
    const assignment_conflict = (existing_card_key !== card_key) || (existing_quantity !== quantity);
    const assignmentState = await inspectAssignmentState(env, codes);
    const msg = buildMessage({ codes, origin, buyerName: buyer_name || existingOrder.buyer_name || '', buyerEmail: buyer_email });

    let email_sent;
    let email_error;
    if (buyer_email && env.RESEND_API_KEY){
      const emailResult = await sendActivationEmail(env, {
        buyerEmail: buyer_email,
        messageHtml: msg.html,
        subject: 'Your ChicCanto scratch card is ready 🎉',
      });
      email_sent = !!emailResult.ok;
      if (!emailResult.ok && emailResult.error) email_error = emailResult.error;
    }

    return json({
      ok: true,
      existing: true,
      assignment_conflict,
      can_void_unactivated: !!assignmentState.can_void_unactivated,
      assignment_state: assignmentState.assignment_state,
      order_id,
      card_key: existing_card_key,
      quantity: existing_quantity,
      requested_card_key: card_key,
      requested_quantity: quantity,
      codes,
      etsy_message: msg.text,
      message_text: msg.text,
      message_html: msg.html,
      ...(buyer_email ? { buyer_email } : {}),
      ...(email_sent !== undefined ? { email_sent } : {}),
      ...(email_error ? { email_error } : {}),
    });
  }

  const prefix = cardKeyToCodePrefix(card_key);

  const codes = [];
  for (let i = 0; i < quantity; i++){
    let code = '';
    try{
      code = await generateUniqueCode(env, prefix);
    } catch {
      return json({ ok: false, error: 'Could not generate a new code. Try again.' }, 500);
    }

    const assigned_at = new Date().toISOString();
    const acKey = `ac:${code}`;

    const acRec = {
      code,
      sku: 'single',
      status: 'assigned',
      order_id,
      buyer_name: buyer_name || null,
      assigned_at,
      bundle_index: quantity > 1 ? (i + 1) : null,
      init: { card_key },
    };

    await env.CARDS_KV.put(acKey, JSON.stringify(acRec));
    codes.push(code);
  }

  const orderRec = {
    order_id,
    card_key,
    quantity,
    codes,
    buyer_name: buyer_name || null,
    status: 'assigned',
    assigned_at: new Date().toISOString(),
  };
  // Store both:
  // - composite key = idempotent assignment identity (order + card + quantity)
  // - plain order key = quick lookup/index for later redeem enrichment and support tools
  await env.CARDS_KV.put(orderKey, JSON.stringify(orderRec));
  await env.CARDS_KV.put(orderIndexKey, JSON.stringify(orderRec));

  const msg = buildMessage({ codes, origin, buyerName: buyer_name, buyerEmail: buyer_email });

  let email_sent;
  let email_error;
  if (buyer_email && env.RESEND_API_KEY){
    const emailResult = await sendActivationEmail(env, {
      buyerEmail: buyer_email,
      messageHtml: msg.html,
      subject: 'Your ChicCanto scratch card is ready 🎉',
    });
    email_sent = !!emailResult.ok;
    if (!emailResult.ok && emailResult.error) email_error = emailResult.error;
  }

  return json({
    ok: true,
    existing: false,
    order_id,
    card_key,
    quantity,
    codes,
    etsy_message: msg.text,
    message_text: msg.text,
    message_html: msg.html,
    ...(buyer_email ? { buyer_email } : {}),
    ...(email_sent !== undefined ? { email_sent } : {}),
    ...(email_error ? { email_error } : {}),
  });
}