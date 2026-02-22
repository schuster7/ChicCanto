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

export function setTileSet(tileSet){
  const s = String(tileSet || '').trim();
  if (!s) return;
  _CURRENT_TILE_SET = s;
}

export function getTileSet(){
  return _CURRENT_TILE_SET;
}

/**
 * Tier → symbol filename mapping.
 * Keep tier ids as t1..t4 for logic stability, only swap filenames here.
 */
const TIER_SYMBOL_MAP = {
  t1: 'blowjob',
  t2: 'handjob',
  t3: 'anal',
  t4: 'fantasy'
};

export function tierIconSrc(tier){
  const safe = String(tier || '').toLowerCase();
  const sym = TIER_SYMBOL_MAP[safe] || TIER_SYMBOL_MAP.t1;
  return `/assets/tiles/${_CURRENT_TILE_SET}/${sym}.svg`;
}

/**
 * Buyer choices.
 * Keep tier ids stable (t1–t4). Labels are UI-only and can be redesigned later.
 */
export const REVEAL_OPTIONS = [
  { key: 'A', tier: 't1', label: 'Blowjob' },
  { key: 'B', tier: 't2', label: 'Handjob' },
  { key: 'C', tier: 't3', label: 'Anal' },
  { key: 'D', tier: 't4', label: 'His Fantasy' },
];

export const RANDOM_KEY = 'RANDOM';

// Scratch settings
export const SCRATCH_RADIUS_PX = 18;
export const SCRATCH_THRESHOLD = 0.55; // percent of a tile cleared before it's considered scratched
