// /public/assets/js/card-themes.js
// Single source of truth for card visuals + per-card prize labels/icons.

export const CARD_THEMES = {
  'men-novice1': {
    key: 'men-novice1',
    titleSrc: '/assets/cards/men-novice1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice1.jpg',
    bgDesktopSrc: '/assets/cards/men-novice1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/men-novice1/bg-mobile.jpg',
    legendPanelBg: 'rgba(18, 22, 32, .42)',
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
    legendPanelBg: 'rgba(34, 30, 26, .50)',
    legendPanelBlur: '7px',
    prizeOptions: [
      { tier: 't1', label: 'Massage', icon: 'massage' },
      { tier: 't2', label: 'Oral', icon: 'oral' },
      { tier: 't3', label: 'Sex Toys', icon: 'sex-toys' },
      { tier: 't4', label: 'Her Fantasy', icon: 'fantasy' },
    ],
  },


  'women-novice-birthday1': {
    key: 'women-novice-birthday1',
    titleSrc: '/assets/cards/women-novice-birthday1/title.svg',
    thumbSrc: '/assets/img/thumb_women-novice-birthday1.jpg',
    bgDesktopSrc: '/assets/cards/women-novice-birthday1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/women-novice-birthday1/bg-mobile.jpg',
    legendPanelBg: 'rgba(34, 30, 26, .50)',
    legendPanelBlur: '7px',
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
    legendPanelBg: 'rgba(18, 22, 32, .42)',
    prizeOptions: [
      { tier: 't1', label: 'Blowjob', icon: 'blowjob' },
      { tier: 't2', label: 'Handjob', icon: 'handjob' },
      { tier: 't3', label: 'Anal', icon: 'anal' },
      { tier: 't4', label: 'His Fantasy', icon: 'fantasy' },
    ],
  },

  'men-advanced1': {
    key: 'men-advanced1',
    titleSrc: '/assets/cards/men-advanced1/title.svg',
    thumbSrc: '/assets/img/thumb_men-advanced1.jpg',
    bgDesktopSrc: '/assets/cards/men-advanced1/bg-desktop.jpg',
    bgMobileSrc: '/assets/cards/men-advanced1/bg-mobile.jpg',
    legendPanelBg: 'rgba(18, 22, 32, .42)',
    prizeOptions: [
      { tier: 't1', label: 'Watch Porn', icon: 'watch-porn' },
      { tier: 't2', label: 'Lingerie', icon: 'lingerie' },
      { tier: 't3', label: 'Cum Everywhere', icon: 'cum-everywhere' },
      { tier: 't4', label: 'His Fantasy', icon: 'fantasy' },
    ],
  },

};

export function getCardTheme(card_key){
  const k = String(card_key || '').trim();
  return CARD_THEMES[k] || null;
}
