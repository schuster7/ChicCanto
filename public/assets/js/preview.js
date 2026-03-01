// /public/assets/js/preview.js
import { qs } from './utils.js';
import { ensureCard, setConfigured } from './store.js';

// NOTE: Preview only needs a stable, configured sample so the scratch experience opens.
// It does not need the card-specific prize labels here.
const SAMPLE_TOKEN = '1a2b3c4d-5e6f';

export function bootPreview(){
  const btn = qs('#openSample');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // Ensure a configured sample card exists locally so the recipient experience works immediately.
    const card = ensureCard(SAMPLE_TOKEN);

    if (!card.configured){
      // Any valid choice key works for preview. Keep it deterministic.
      const choice = 'B';
      setConfigured(SAMPLE_TOKEN, { choice, reveal_amount: null, fields: Number(card.fields || 9) });
    }

    // Open the recipient view (no setup param).
    const params = new URLSearchParams();
    params.set('token', SAMPLE_TOKEN);
    window.location.href = '/card/?' + params.toString();
  });
}
