import { getStore } from '@netlify/blobs';

// A tiny wrapper around Netlify Blobs with an in-memory fallback.
// The fallback is only for local dev emergencies; it is NOT durable.

const mem = {
  tokens: new Map(),
  orders: new Map()
};

function tryBlobStores(){
  try {
    return {
      tokens: getStore({ name: 'chiccanto_tokens', consistency: 'strong' }),
      orders: getStore({ name: 'chiccanto_orders', consistency: 'strong' })
    };
  } catch (e) {
    return null;
  }
}

let _stores = null;

function stores(){
  if (_stores) return _stores;
  const blob = tryBlobStores();
  _stores = blob ?? {
    tokens: {
      async get(key){ return mem.tokens.has(key) ? mem.tokens.get(key) : null; },
      async set(key, value){ mem.tokens.set(key, value); },
      async delete(key){ mem.tokens.delete(key); }
    },
    orders: {
      async get(key){ return mem.orders.has(key) ? mem.orders.get(key) : null; },
      async set(key, value){ mem.orders.set(key, value); },
      async delete(key){ mem.orders.delete(key); }
    }
  };
  return _stores;
}

export async function getTokenRecord(token){
  const { tokens } = stores();
  const value = await tokens.get(token);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function setTokenRecord(token, record){
  const { tokens } = stores();
  await tokens.set(token, JSON.stringify(record));
}

export async function getOrderRecord(code){
  const { orders } = stores();
  const value = await orders.get(code);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function setOrderRecord(code, record){
  const { orders } = stores();
  await orders.set(code, JSON.stringify(record));
}
