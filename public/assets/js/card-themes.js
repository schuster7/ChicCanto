// /public/assets/js/card-themes.js
// Single source of truth for card visuals + per-card prize labels/icons.

export const CARD_THEMES = {
  'men-novice1': {
    key: 'men-novice1',
    titleSrc: '/assets/cards/men-novice1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice1.jpg',
    bgDesktopSrc: '/assets/cards/men-novice1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/men-novice1/bg-mobile.jpg',
    prizeOptions: [
      { tier: 't1', label: 'Blowjob', icon: 'blowjob' },
      { tier: 't2', label: 'Handjob', icon: 'handjob' },
      { tier: 't3', label: 'Anal', icon: 'anal' },
      { tier: 't4', label: 'His Fantasy', icon: 'fantasy' },
    ],
  },

  'women-novice1': {
    key: 'women-novice1',
    titleSrc: '/assets/cards/women-novice1/title.svg',
    thumbSrc: '/assets/img/thumb_women-novice1.jpg',
    bgDesktopSrc: '/assets/cards/women-novice1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/women-novice1/bg-mobile.jpg',
    prizeOptions: [
      { tier: 't1', label: 'Massage', icon: 'massage' },
      { tier: 't2', label: 'Oral', icon: 'oral' },
      { tier: 't3', label: 'Sex Toys', icon: 'sex-toys' },
      { tier: 't4', label: 'Her Fantasy', icon: 'fantasy' },
    ],
  },

  'men-novice-birthday1': {
    key: 'men-novice-birthday1',
    foil: 'gold',
    titleSrc: '/assets/cards/men-novice-birthday1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice-birthday1.jpg',
    bgDesktopSrc: '/assets/cards/men-novice-birthday1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/men-novice-birthday1/bg-mobile.jpg',
    prizeOptions: [
      { tier: 't1', label: 'Blowjob', icon: 'blowjob' },
      { tier: 't2', label: 'Handjob', icon: 'handjob' },
      { tier: 't3', label: 'Anal', icon: 'anal' },
      { tier: 't4', label: 'His Fantasy', icon: 'fantasy' },
    ],
  },
};

export function getCardTheme(card_key){
  const k = String(card_key || '').trim();
  return CARD_THEMES[k] || null;
}
