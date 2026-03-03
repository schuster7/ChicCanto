// /public/assets/js/config.js
// Shared config + per-card prize labels/icon mapping.
//
// IMPORTANT:
// - Prize labels/icons are defined per card in card-themes.js (prizeOptions).
// - Game logic stays stable using tiers t1-t4 and choice keys A-D.

import { CARD_THEMES } from './card-themes.js';

// Defaults (used when a card theme has no prizeOptions)
export const DEFAULT_REVEAL_OPTIONS = [
  { key: 'A', tier: 't1', label: 'Prize 1' },
  { key: 'B', tier: 't2', label: 'Prize 2' },
  { key: 'C', tier: 't3', label: 'Prize 3' },
  { key: 'D', tier: 't4', label: 'Prize 4' },
];

// These MUST be defined before _applyThemeForKey() is called to avoid TDZ issues.
let _CURRENT_REVEAL_OPTIONS = DEFAULT_REVEAL_OPTIONS;
let _CURRENT_TIER_ICON_MAP = { t1: 'blowjob', t2: 'handjob', t3: 'anal', t4: 'fantasy' };

function _applyThemeForKey(cardKey){
  const k = String(cardKey || '').trim();
  if (!k) return;

  const theme = CARD_THEMES[k];
  const opts = theme && Array.isArray(theme.prizeOptions) ? theme.prizeOptions : null;

  // No per-card options → fall back to defaults and a safe icon map.
  if (!opts || !opts.length){
    _CURRENT_REVEAL_OPTIONS = DEFAULT_REVEAL_OPTIONS;
    _CURRENT_TIER_ICON_MAP = { t1: 'blowjob', t2: 'handjob', t3: 'anal', t4: 'fantasy' };
    return;
  }

  // Build byTier (t1-t4 stable)
  const byTier = {};
  for (const o of opts){
    if (!o || !o.tier) continue;
    byTier[String(o.tier).toLowerCase()] = o;
  }

  const t1 = byTier.t1 || { tier: 't1', label: 'Prize 1', icon: 'blowjob' };
  const t2 = byTier.t2 || { tier: 't2', label: 'Prize 2', icon: 'handjob' };
  const t3 = byTier.t3 || { tier: 't3', label: 'Prize 3', icon: 'anal' };
  const t4 = byTier.t4 || { tier: 't4', label: 'Prize 4', icon: 'fantasy' };

  _CURRENT_REVEAL_OPTIONS = [
    { key: 'A', tier: 't1', label: String(t1.label || 'Prize 1') },
    { key: 'B', tier: 't2', label: String(t2.label || 'Prize 2') },
    { key: 'C', tier: 't3', label: String(t3.label || 'Prize 3') },
    { key: 'D', tier: 't4', label: String(t4.label || 'Prize 4') },
  ];

  _CURRENT_TIER_ICON_MAP = {
    t1: String(t1.icon || 'blowjob'),
    t2: String(t2.icon || 'handjob'),
    t3: String(t3.icon || 'anal'),
    t4: String(t4.icon || 'fantasy'),
  };
}

export function getRevealOptions(){
  return _CURRENT_REVEAL_OPTIONS || DEFAULT_REVEAL_OPTIONS;
}

// Choice key used for "surprise me"
export const RANDOM_KEY = 'RANDOM';

// Scratch settings
export const SCRATCH_RADIUS_PX = 18;
export const SCRATCH_THRESHOLD = 0.55;

// Tiles
let TILE_SET = 'men-novice1';

export function getTileSet(){
  return TILE_SET;
}

export function setTileSet(cardKey){
  const k = String(cardKey || '').trim();
  TILE_SET = k || 'men-novice1';
  _applyThemeForKey(TILE_SET);
}

export function tierIconSrc(tier){
  const t = String(tier || '').toLowerCase();
  const name = _CURRENT_TIER_ICON_MAP[t] || 'fantasy';
  return `/assets/tiles/${TILE_SET}/${name}.svg`;
}
