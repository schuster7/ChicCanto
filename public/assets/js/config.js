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
 * Tier → icon file mapping.
 * Keep tier ids as t1..t4 for logic stability, only swap filenames here.
 */
const TIER_ICON_MAP = {
  t1: '/assets/img/t1-mouth.svg',
  t2: '/assets/img/t2-hand.svg',
  t3: '/assets/img/t3-girl.svg',
  t4: '/assets/img/t4-fantasy.svg'
};

export function tierIconSrc(tier){
  const safe = String(tier || '').toLowerCase();
  if (!TIERS.includes(safe)) return TIER_ICON_MAP.t1;
  return TIER_ICON_MAP[safe] || TIER_ICON_MAP.t1;
}

/**
 * Buyer choices.
 * Keep tier ids stable (t1–t4). Labels are UI-only and can be redesigned later.
 */
export const REVEAL_OPTIONS = [
  { key: 'A', tier: 't1', label: 'Prize 1' },
  { key: 'B', tier: 't2', label: 'Prize 2' },
  { key: 'C', tier: 't3', label: 'Prize 3' },
  { key: 'D', tier: 't4', label: 'Prize 4' },
];

export const RANDOM_KEY = 'RANDOM';

// Scratch settings
export const SCRATCH_RADIUS_PX = 18;
export const SCRATCH_THRESHOLD = 0.55; // percent of a tile cleared before it's considered scratched
