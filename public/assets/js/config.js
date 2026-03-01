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

  const def = TILE_SET_DEFS[s] || TILE_SET_DEFS['men-novice1'];
  _TIER_SYMBOL_MAP = { ...def.symbolMap };
  REVEAL_OPTIONS = def.revealOptions.slice();
}

export function getTileSet(){
  return _CURRENT_TILE_SET;
}

/**
 * Tier → symbol filename mapping.
 * Keep tier ids as t1..t4 for logic stability, only swap filenames here.
 */
/**
 * Tile set definitions:
 * - symbolMap maps tiers (t1..t4) to icon filenames (without .svg)
 * - revealOptions controls the setup UI labels (tier ids stay stable)
 */
const TILE_SET_DEFS = {
  'men-novice1': {
    symbolMap: { t1: 'blowjob', t2: 'handjob', t3: 'anal', t4: 'fantasy' },
    revealOptions: [
      { key: 'A', tier: 't1', label: 'Blowjob' },
      { key: 'B', tier: 't2', label: 'Handjob' },
      { key: 'C', tier: 't3', label: 'Anal' },
      { key: 'D', tier: 't4', label: 'His Fantasy' },
    ]
  },
  'women-novice1': {
    symbolMap: { t1: 'massage', t2: 'oral', t3: 'sex-toys', t4: 'fantasy' },
    revealOptions: [
      { key: 'A', tier: 't1', label: 'Massage' },
      { key: 'B', tier: 't2', label: 'Oral' },
      { key: 'C', tier: 't3', label: 'Sex Toys' },
      { key: 'D', tier: 't4', label: 'Her Fantasy' },
    ]
  }
};

// Active mapping (updated when tile set changes)
let _TIER_SYMBOL_MAP = { ...TILE_SET_DEFS['men-novice1'].symbolMap };

/**
 * Buyer choices (UI labels + tiers).
 * Exported as a live binding so tile sets can swap labels without breaking imports.
 */
export let REVEAL_OPTIONS = TILE_SET_DEFS['men-novice1'].revealOptions.slice();

export function tierIconSrc(tier){
  const safe = String(tier || '').toLowerCase();
  const sym = _TIER_SYMBOL_MAP[safe] || _TIER_SYMBOL_MAP.t1;
  return `/assets/tiles/${_CURRENT_TILE_SET}/${sym}.svg`;
}

export const RANDOM_KEY = 'RANDOM';

// Scratch settings
export const SCRATCH_RADIUS_PX = 18;
export const SCRATCH_THRESHOLD = 0.55; // percent of a tile cleared before it's considered scratched