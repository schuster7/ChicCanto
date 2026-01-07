#!/usr/bin/env node
/**
 * ChicCanto Local Dev API (dependency-free)
 *
 * Purpose:
 * - Provide shared, cross-device token storage while staying fully local.
 * - Mimic the future backend shape without Etsy integration yet.
 *
 * Runs on: http://0.0.0.0:8787
 *
 * Endpoints:
 * - GET   /health
 * - POST  /redeem             (demo receipt simulator; idempotent)
 * - GET   /token/:token
 * - PUT   /token/:token       (creates or updates)
 *
 * Data persistence:
 * - Cards:  ./.data/tokens.json
 * - Orders: ./.data/orders.json (order_code -> [token, token, ...])
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const HOST = '0.0.0.0';
const PORT = 8787;

const DATA_DIR = path.join(process.cwd(), '.data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const MAX_BODY_BYTES = 1024 * 1024; // 1MB

function ensureDataDir(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath, fallback){
  try{
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  }catch{}
  return fallback;
}

function writeJsonFile(filePath, obj){
  ensureDataDir();
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function readTokens(){
  return readJsonFile(TOKENS_FILE, {});
}

function writeTokens(tokens){
  return writeJsonFile(TOKENS_FILE, tokens);
}

function readOrders(){
  return readJsonFile(ORDERS_FILE, {});
}

function writeOrders(orders){
  return writeJsonFile(ORDERS_FILE, orders);
}

function makeShortToken(){
  // 12 hex chars -> format 8-4 to match current demo URLs (e.g. d2eae500-2f01)
  const hex = crypto.randomBytes(6).toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8);
}

function makeSetupKey(){
  // base64url 16 bytes
  return crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function productDefaultsById(productId){
  // Keep in sync with public/assets/js/products.js
  if (productId === 'christmas') return { product_id: 'christmas', theme_id: 'theme-christmas', fields: 9 };
  if (productId === 'couples') return { product_id: 'couples', theme_id: 'theme-couples', fields: 9 };
  return { product_id: 'default', theme_id: 'theme-default', fields: 9 };
}

function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sendEmpty(res, status){
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

function parseTokenFromPath(pathname){
  // /token/<token>
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'token') return parts[1];
  return null;
}

function readBodyJson(req){
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES){
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try{
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) return resolve(null);
        resolve(JSON.parse(raw));
      }catch(err){
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function simulateOrderItems(orderCode, init){

  const cleanInit = (init && typeof init === 'object') ? { ...init } : {};
  return [cleanInit];
}

const server = http.createServer(async (req, res) => {
  try{
    // CORS preflight
    if (req.method === 'OPTIONS'){
      return sendEmpty(res, 204);
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname || '/';

    if (req.method === 'GET' && pathname === '/health'){
      return sendJson(res, 200, { ok: true });
    }

    // Demo redeem (idempotent): returns 1+ cards for an "order".
    // Body: { code: string, init?: { product_id, theme_id, fields } }
    if (req.method === 'POST' && pathname === '/redeem'){
      const body = await readBodyJson(req);
      const code = String(body && body.code ? body.code : '').trim();
      if (!code) return sendJson(res, 400, { error: 'Missing code' });

      const initIn = (body && body.init && typeof body.init === 'object') ? body.init : {};
      const base = productDefaultsById(String(initIn.product_id || 'default'));
      const init = {
        product_id: String(initIn.product_id || base.product_id),
        theme_id: String(initIn.theme_id || base.theme_id),
        fields: Number.isFinite(initIn.fields) ? initIn.fields : base.fields,
      };

      const orders = readOrders();
      const tokens = readTokens();

      const orderKey = code;
      const existingTokens = Array.isArray(orders[orderKey]) ? orders[orderKey] : null;
      if (existingTokens && existingTokens.length){
        const cards = existingTokens
          .map((t) => tokens[t])
          .filter(Boolean)
          .map((c) => ({ token: c.token, setup_key: c.setup_key, product_id: c.product_id, theme_id: c.theme_id, fields: c.fields }));
        return sendJson(res, 200, { ok: true, existing: true, order: orderKey, cards });
      }

      const items = simulateOrderItems(orderKey, init);

      const minted = [];
      for (const it of items){
        let token;
        do{ token = makeShortToken(); }while(tokens[token]);

        const card = {
          token,
          product_id: it.product_id,
          theme_id: it.theme_id,
          setup_key: makeSetupKey(),
          configured: false,
          choice: null,
          reveal_amount: null,
          revealed: false,
          revealed_at: null,
          fields: it.fields,
          board: null,
          scratched_indices: null,
          scratched_fields: null,
        };

        tokens[token] = card;
        minted.push({ token: card.token, setup_key: card.setup_key, product_id: card.product_id, theme_id: card.theme_id, fields: card.fields });
      }

      orders[orderKey] = minted.map((c) => c.token);
      writeTokens(tokens);
      writeOrders(orders);

      return sendJson(res, 200, { ok: true, existing: false, order: orderKey, cards: minted });
    }

    const token = parseTokenFromPath(pathname);
    if (!token){
      return sendJson(res, 404, { error: 'Not found' });
    }

    const tokens = readTokens();

    if (req.method === 'GET'){
      const card = tokens[token];
      if (!card) return sendJson(res, 404, { error: 'Token not found' });
      return sendJson(res, 200, card);
    }

    if (req.method === 'PUT'){
      const body = await readBodyJson(req);
      if (!body || typeof body !== 'object'){
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      // Force token key consistency.
      body.token = token;

      tokens[token] = body;
      writeTokens(tokens);

      return sendJson(res, 200, tokens[token]);
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  }catch(err){
    return sendJson(res, 500, { error: 'Server error', detail: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[dev-api] running on http://${HOST}:${PORT}`);
  console.log(`[dev-api] tokens file: ${TOKENS_FILE}`);
  console.log(`[dev-api] orders file: ${ORDERS_FILE}`);
});
