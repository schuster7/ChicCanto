import { qs } from './utils.js';
import { ensureCard } from './store.js';
import { getProductBySlug } from './products.js';

function randomToken(){
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bootDemo(){
  const btn = qs('#newBtn');
  const sampleBtn = qs('#sampleBtn');

  btn.addEventListener('click', () => {
    const t = randomToken();
    const card = ensureCard(t);
    const params = new URLSearchParams();
    params.set('token', t);
    params.set('setup', card.setup_key);
    const storeMode = new URLSearchParams(window.location.search).get('store');
    if (storeMode) params.set('store', storeMode);
    window.location.href = '/card/?' + params.toString();
  });

  sampleBtn.addEventListener('click', () => {
    const t = 'demo-1234abcd';
    const card = ensureCard(t);
    const params = new URLSearchParams();
    params.set('token', t);
    params.set('setup', card.setup_key);
    const storeMode = new URLSearchParams(window.location.search).get('store');
    if (storeMode) params.set('store', storeMode);
    window.location.href = '/card/?' + params.toString();
  });
}
