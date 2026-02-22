// public/assets/js/card-bg.js
// Minimal background theming based on the active card's tile folder.
// Keeps layout untouched and only sets CSS variables on .scratch-stage.
//
// Heuristic:
// - If cardKey contains "birthday" (e.g. men-novice-birthday1) => use bg-image.jpg with cover/no-repeat/center
// - Otherwise => use pattern.svg repeating

(function () {
  function getCardKeyFromDom() {
    // Prefer left panel icons (legend), then any revealed tile underlay image.
    const candidates = [
      document.querySelector('.card-legend img'),
      document.querySelector('.card-legend svg image'),
      document.querySelector('.scratch-tile .under img'),
    ].filter(Boolean);

    for (const el of candidates) {
      const src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href'));
      if (!src) continue;
      const m = String(src).match(/\/assets\/tiles\/([^\/]+)\//);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  function applyBg(cardKey) {
    const stage = document.querySelector('.scratch-stage');
    if (!stage || !cardKey) return;

    const isBirthday = /birthday/i.test(cardKey);

    if (isBirthday) {
      stage.style.setProperty('--scratch-card-pattern', `url("/assets/cards/${cardKey}/bg-image.jpg")`);
      stage.style.setProperty('--scratch-card-pattern-repeat', 'no-repeat');
      stage.style.setProperty('--scratch-card-pattern-position', 'center');
      stage.style.setProperty('--scratch-card-pattern-size', 'cover');
      stage.style.setProperty('--scratch-card-pattern-opacity', '1');
    } else {
      stage.style.setProperty('--scratch-card-pattern', `url("/assets/cards/${cardKey}/pattern.svg")`);
      stage.style.setProperty('--scratch-card-pattern-repeat', 'repeat');
      stage.style.setProperty('--scratch-card-pattern-position', '0 0');
      // Keep your existing default sizing, but allow per-card override later.
      stage.style.setProperty('--scratch-card-pattern-size', 'clamp(160px, 18vw, 280px) clamp(160px, 18vw, 280px)');
      stage.style.setProperty('--scratch-card-pattern-opacity', '1');
    }
  }

  function init() {
    const cardKey = getCardKeyFromDom();
    if (!cardKey) return;

    applyBg(cardKey);
  }

  // Run after initial render.
  window.addEventListener('DOMContentLoaded', () => {
    // small delay to allow card.js to render legend/icons first
    setTimeout(init, 0);
  });

  // Also re-run once shortly after, in case assets load async.
  window.addEventListener('load', () => setTimeout(init, 50));
})();
