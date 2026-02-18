import { bootLanding } from './landing.js';
import { bootRedeem } from './redeem.js';
import { bootPreview } from './preview.js';
import { bootTools } from './tools.js';
import { bootCard } from './card.js';
import { bootFulfill } from './fulfill.js';

const page = document.body.dataset.page;

function prefillCodeFromUrlIfPresent(){
  // Only relevant on the redeem/activate page.
  if (page !== 'redeem') return;

  const input = document.getElementById('code');
  if (!input) return;

  const url = new URL(window.location.href);
  const raw = url.searchParams.get('code');
  if (!raw) return;

  // Normalize: remove whitespace, uppercase. Keep hyphens for readability.
  const cleaned = String(raw).replace(/\s+/g, '').toUpperCase();
  input.value = cleaned;

  // Focus for quick confirmation; safe on desktop + mobile.
  try{
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  } catch {}

  // Remove the code from the address bar to avoid lingering in history/share sheets.
  url.searchParams.delete('code');
  const qs = url.searchParams.toString();
  const newUrl = url.pathname + (qs ? `?${qs}` : '') + url.hash;
  try{
    history.replaceState({}, '', newUrl);
  } catch {}
}

if (page === 'landing') bootLanding();

if (page === 'redeem'){
  prefillCodeFromUrlIfPresent();
  bootRedeem();
}

if (page === 'preview') bootPreview();
if (page === 'tools') bootTools();
if (page === 'card') bootCard();
if (page === 'fulfill') bootFulfill();
