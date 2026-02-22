// Card theme registry (client-side).
// Maps server-provided card_key -> assets + background behavior.
// Keep this file simple and explicit. No runtime guessing.

export const CARD_THEMES = {
  'men-novice1': {
    key: 'men-novice1',
    titleSrc: '/assets/cards/men-novice1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice1.jpg',
    background: {
      type: 'pattern',
      color: '#1c1e1e',
      patternSrc: '/assets/cards/men-novice1/pattern.svg',
      // matches card.css default sizing; tweak per theme if needed
      patternSize: 'clamp(160px, 18vw, 280px) clamp(160px, 18vw, 280px)',
      patternOpacity: '1'
    }
  },
  'men-novice-birthday1': {
    key: 'men-novice-birthday1',
    titleSrc: '/assets/cards/men-novice-birthday1/title.svg',
    thumbSrc: '/assets/img/thumb_men-novice-birthday1.jpg',
    background: {
      type: 'image',
      color: '#0b0b0b',
      imageSrc: '/assets/cards/men-novice-birthday1/bg-image.jpg'
    }
  }
};

export function getCardTheme(card_key){
  const k = String(card_key || '').trim();
  return CARD_THEMES[k] || null;
}
