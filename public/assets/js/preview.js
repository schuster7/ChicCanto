import { qs } from './utils.js';
import { ensureCard, setConfigured } from './store.js';
import { REVEAL_OPTIONS } from './config.js';

const SAMPLE_TOKEN = '1a2b3c4d-5e6f';

export function bootPreview(){
  const btn = qs('#openSample');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // Ensure a configured sample card exists locally so the recipient experience works immediately.
    const card = ensureCard(SAMPLE_TOKEN);

    if (!card.configured){
      const choice = (REVEAL_OPTIONS && REVEAL_OPTIONS[1] && REVEAL_OPTIONS[1].key) ? REVEAL_OPTIONS[1].key : 'B';
      setConfigured(SAMPLE_TOKEN, { choice, reveal_amount: null, fields: Number(card.fields || 9) });
    }

    // Open the recipient view (no setup param).
    const params = new URLSearchParams();
    params.set('token', SAMPLE_TOKEN);
    window.location.href = '/card/?' + params.toString();
  });
}
