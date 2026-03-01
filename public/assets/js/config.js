import { CARD_THEMES } from './card-themes.js';

export const DEFAULT_PRODUCT_ID = 'match3_9';
export const DEFAULT_THEME_ID = 'default';
export const REVEAL_RULE = 'match3';

/**
 * Product registry.
 * Keep product behavior in config so we can add new products later
 * (single-field, 9-field match, etc.) without rewriting the app.
 */
export const PRODUCTS = {
  match3_9: {
    id: 'match3_9',
    label: 'Match 3 (9 tiles)',
    fields: 9
  }
};

/**
 * Generic tier IDs (do not tie logic to specific icon names).
 * Themes can swap the SVGs later without changing any game logic.
 */
export const TIERS = ['t1','t2','t3','t4'];

/**
 * Multi-card: tile set selection.
 * For now, tile sets mirror card keys (e.g. /assets/tiles/men-novice1/*).
 */
let _CURRENT_TILE_SET = 'men-novice1';
_applyThemeForKey(_CURRENT_TILE_SET);

export function setTileSet(tileSet){
  const s = String(tileSet || '').trim();
  if (!s) return;
  _CURRENT_TILE_SET = s;
  _applyThemeForKey(s);
}


export function getTileSet(){
  return _CURRENT_TILE_SET;
}

/**
 * Tier → symbol filename mapping.
 * Keep tier ids as t1..t4 for logic stability, only swap filenames here.
 */
export function tierIconSrc(tier){
  const safe = String(tier || '').toLowerCase();
  const sym = (_CURRENT_TIER_ICON_MAP && _CURRENT_TIER_ICON_MAP[safe]) || 'blowjob';
  return `/assets/tiles/${_CURRENT_TILE_SET}/${sym}.svg`;
}


/**
 * Buyer choices.
 * Keep tier ids stable (t1–t4). Labels are UI-only and can be redesigned later.
 */
export const DEFAULT_REVEAL_OPTIONS = [
  { key: 'A', tier: 't1', label: 'Blowjob' },
  { key: 'B', tier: 't2', label: 'Handjob' },
  { key: 'C', tier: 't3', label: 'Anal' },
  { key: 'D', tier: 't4', label: 'His Fantasy' },
];
let _CURRENT_REVEAL_OPTIONS = DEFAULT_REVEAL_OPTIONS;
let _CURRENT_TIER_ICON_MAP = {
  t1: 'blowjob',
  t2: 'handjob',
  t3: 'anal',
  t4: 'fantasy',
};

function _applyThemeForKey(cardKey){
  const k = String(cardKey || '').trim();
  if (!k) return;
  const theme = CARD_THEMES[k];
  const opts = theme && Array.isArray(theme.prizeOptions) ? theme.prizeOptions : null;
  if (!opts || !opts.length) {
    _CURRENT_REVEAL_OPTIONS = DEFAULT_REVEAL_OPTIONS;
    _CURRENT_TIER_ICON_MAP = { t1:'blowjob', t2:'handjob', t3:'anal', t4:'fantasy' };
    return;
  }

  // Build reveal options in A–D order (t1–t4 stable)
  const byTier = {};
  for (const o of opts) {
    if (!o || !o.tier) continue;
    byTier[String(o.tier).toLowerCase()] = o;
  }

  const t1 = byTier.t1 || { tier:'t1', label:'Prize 1', icon:'blowjob' };
  const t2 = byTier.t2 || { tier:'t2', label:'Prize 2', icon:'handjob' };
  const t3 = byTier.t3 || { tier:'t3', label:'Prize 3', icon:'anal' };
  const t4 = byTier.t4 || { tier:'t4', label:'Prize 4', icon:'fantasy' };

  _CURRENT_REVEAL_OPTIONS = [
    { key:'A', tier:'t1', label: String(t1.label || 'Prize 1') },
    { key:'B', tier:'t2', label: String(t2.label || 'Prize 2') },
    { key:'C', tier:'t3', label: String(t3.label || 'Prize 3') },
    { key:'D', tier:'t4', label: String(t4.label || 'Prize 4') },
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


export const RANDOM_KEY = 'RANDOM';

// Scratch settings
export const SCRATCH_RADIUS_PX = 18;
export const SCRATCH_THRESHOLD = 0.55; // percent of a tile cleared before it's considered scratched
