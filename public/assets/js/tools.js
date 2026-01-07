import { qs } from './utils.js';
import { ensureCard } from './store.js';

function isLocalhost(){
  const h = String(window.location.hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

function randomToken(){
  // 8-4 hex token (matches frontend validation).
  const bytes = new Uint8Array(6); // 12 hex chars
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12);
}

const SAMPLE_TOKEN = '1a2b3c4d-5e6f';

export function bootTools(){
  const newBtn = qs('#newBtn');
  const sampleBtn = qs('#sampleBtn');
  const hint = qs('#toolsHint');

  const ok = isLocalhost();

  if (hint){
    hint.textContent = ok
      ? 'Running on localhost. Tools are enabled.'
      : 'Tools are disabled on public URLs.';
  }

  if (newBtn) newBtn.disabled = !ok;
  if (sampleBtn) sampleBtn.disabled = !ok;

  if (!ok) return;

  newBtn?.addEventListener('click', () => {
    const t = randomToken();
    const card = ensureCard(t);
    const params = new URLSearchParams();
    params.set('token', t);
    params.set('setup', card.setup_key);
    const storeMode = new URLSearchParams(window.location.search).get('store');
    if (storeMode) params.set('store', storeMode);
    window.location.href = '/card/?' + params.toString();
  });

  sampleBtn?.addEventListener('click', () => {
    const card = ensureCard(SAMPLE_TOKEN);
    const params = new URLSearchParams();
    params.set('token', SAMPLE_TOKEN);
    params.set('setup', card.setup_key);
    const storeMode = new URLSearchParams(window.location.search).get('store');
    if (storeMode) params.set('store', storeMode);
    window.location.href = '/card/?' + params.toString();
  });
}
