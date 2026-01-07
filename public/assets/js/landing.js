// public/assets/js/landing.js
// Landing-only behavior: word/card entrances + holo hover + CTA reveal

export function bootLanding(){
  const stage = document.getElementById('holoStage');
  const card = document.getElementById('holoCard');
  const cta = document.querySelector('.landing__cta');

  // Safety: if landing markup is missing, do nothing
  if (!stage || !card) return;

  // Holo hover (desktop only)
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!prefersReduced && canHover){
    const onMove = (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;

      const mx = Math.max(0, Math.min(100, x * 100));
      const my = Math.max(0, Math.min(100, y * 100));

      const rx = (x - 0.5) * 14;
      const ry = (y - 0.5) * 12;

      card.style.setProperty('--mx', mx.toFixed(2));
      card.style.setProperty('--my', my.toFixed(2));
      card.style.setProperty('--rx', rx.toFixed(2));
      card.style.setProperty('--ry', ry.toFixed(2));
      card.classList.add('is-hover');
    };

    const onLeave = () => {
      card.classList.remove('is-hover');
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
      card.style.removeProperty('--rx');
      card.style.removeProperty('--ry');
    };

    card.addEventListener('mousemove', onMove, { passive: true });
    card.addEventListener('mouseleave', onLeave, { passive: true });
  }

  // Entrances (GSAP via CDN)
  if (window.gsap && !prefersReduced){
    const words = Array.from(document.querySelectorAll('[data-anim="word"]'));
    const tl = window.gsap.timeline({ defaults: { ease: 'power2.out' } });

    // Ensure start states are consistent
    tl.set(words, { opacity: 0, y: 26, filter: 'blur(12px)' }, 0);
    tl.set(stage, { opacity: 0, rotationY: -65, rotationX: 6, transformPerspective: 900 }, 0);

    // Words: 1s each, down-to-up + blur
    if (words.length){
      tl.to(words, {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 1,
        stagger: 1
      }, 0);
    }

    // Card flip: starts with the last word
    const lastWordStart = Math.max(0, (words.length - 1));
    tl.to(stage, {
      opacity: 1,
      rotationY: 0,
      rotationX: 0,
      duration: 1,
      ease: 'power3.out'
    }, lastWordStart);

    // CTA: fade in 1s after everything else finishes
    const allDone = Math.max(words.length, lastWordStart + 1);
    if (cta){
      tl.set(cta, { opacity: 0, y: 10, pointerEvents: 'none' }, 0);
      tl.to(cta, {
        opacity: 1,
        y: 0,
        duration: 0.6
      }, allDone + 1);
      tl.set(cta, { pointerEvents: 'auto' }, allDone + 1.01);
}
  } else {
    // No GSAP or reduced motion: reveal CTA after the same total timing (words + flip + 1s)
    if (cta){
      const delayMs = 4000;
      window.setTimeout(() => {
        cta.style.opacity = '1';
        cta.style.transform = 'none';
        cta.style.pointerEvents = 'auto';
      }, delayMs);
    }
}
}
