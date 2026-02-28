// Card theme registry (client-side).
// Maps server-provided card_key -> assets.
// Backgrounds are always images (desktop + mobile) to keep PNG export deterministic.

export const CARD_THEMES = {
  'men-novice1': {
    key: 'men-novice1',
    titleSrc: '/assets/cards/men-novice1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice1.jpg',
    bgDesktopSrc: '/assets/cards/men-novice1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/men-novice1/bg-mobile.jpg'
  },
  'men-novice-birthday1': {
    key: 'men-novice-birthday1',
    foil: 'gold',
    titleSrc: '/assets/cards/men-novice-birthday1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice-birthday1.jpg',
    bgDesktopSrc: '/assets/cards/men-novice-birthday1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/men-novice-birthday1/bg-mobile.jpg'
  }
};

export function getCardTheme(card_key){
  const k = String(card_key || '').trim();
  return CARD_THEMES[k] || null;
}
