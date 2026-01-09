// public/assets/js/landing.js
// Landing-only behavior: word/card entrances + holo hover + CTA reveal

export function bootLanding(){
  const stage = document.getElementById('holoStage');
  const card = document.getElementById('holoCard');
  const cta = document.querySelector('.landing__cta');

  // Preload guard: if <html class="is-preload"> is present, keep content hidden
  // until we set initial animation states, then remove the class to avoid a first-paint flash.
  const root = document.documentElement;
  const removePreload = () => { root.classList.remove('is-preload'); };

  // Safety: if landing markup is missing, do nothing
  if (!stage || !card){
    // Never leave the page stuck hidden if preload CSS is active.
    removePreload();
    return;
  }

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
    const wordUnluck = document.querySelector('.landing__word--unluck');
    const wordThe = document.querySelector('.landing__word--the');
    const wordMoment = document.querySelector('.landing__word--moment');

    // Mobile: keep placement (single line), but animate "The" and "Moment" separately
    const isMobileLayout = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;

    let words = [];
    let momentThePart = null;
    let momentMomentPart = null;

    if (isMobileLayout && wordMoment){
      // Build "The Moment" as inline spans inside the existing Moment element.
      // CSS previously used ::before for "The " on mobile; base.css now blanks that out.
      const theSpan = document.createElement('span');
      theSpan.className = 'landing__wordPart landing__wordPart--the';
      theSpan.textContent = 'The';

      const space = document.createTextNode(' ');

      const momentSpan = document.createElement('span');
      momentSpan.className = 'landing__wordPart landing__wordPart--moment';
      momentSpan.textContent = 'Moment';

      // Only rebuild if we haven't already (avoid duplicating if bootLanding runs twice)
      const alreadySplit = wordMoment.querySelector('.landing__wordPart--moment');
      if (!alreadySplit){
        wordMoment.textContent = '';
        wordMoment.appendChild(theSpan);
        wordMoment.appendChild(space);
        wordMoment.appendChild(momentSpan);
      }

      momentThePart = wordMoment.querySelector('.landing__wordPart--the');
      momentMomentPart = wordMoment.querySelector('.landing__wordPart--moment');

      if (wordUnluck) words.push(wordUnluck);
      if (momentThePart) words.push(momentThePart);
      if (momentMomentPart) words.push(momentMomentPart);
    } else {
      // Desktop / non-mobile: animate the three separate word elements
      if (wordUnluck) words.push(wordUnluck);
      if (wordThe) words.push(wordThe);
      if (wordMoment) words.push(wordMoment);
    }

    // Set initial states immediately (not inside the timeline) so when we remove
    // the preload class, the user never sees the "final" layout for a split second.
    if (words.length){
      window.gsap.set(words, { opacity: 0, y: 22, filter: 'blur(10px)' });
    }
    window.gsap.set(stage, { opacity: 0, rotationY: -62, rotationX: 6, transformPerspective: 900 });
    if (cta){
      window.gsap.set(cta, { opacity: 0, y: 10, pointerEvents: 'none' });
    }

    // Remove preload on the next frame so the above sets have been applied.
    requestAnimationFrame(removePreload);

    const tl = window.gsap.timeline({ defaults: { ease: 'power2.out' } });

    // Faster overall timing
    const wordDur = 0.75;
    const wordStagger = 0.65;
    const cardDur = 0.95;

    // Ensure start states are consistent (kept for safety)
    if (words.length){
      tl.set(words, { opacity: 0, y: 22, filter: 'blur(10px)' }, 0);
    }
    tl.set(stage, { opacity: 0, rotationY: -62, rotationX: 6, transformPerspective: 900 }, 0);

    // Words: down-to-up + blur, sequential
    if (words.length){
      tl.to(words, {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: wordDur,
        stagger: wordStagger
      }, 0);
    }

    // Card flip: starts with the last word
    const lastWordStart = Math.max(0, (words.length - 1) * wordStagger);
    tl.to(stage, {
      opacity: 1,
      rotationY: 0,
      rotationX: 0,
      duration: cardDur,
      ease: 'power3.out'
    }, lastWordStart);

    // CTA: shorter delay after sequence completes
    const wordsDoneAt = (words.length ? ((words.length - 1) * wordStagger + wordDur) : 0);
    const cardDoneAt = lastWordStart + cardDur;
    const allDone = Math.max(wordsDoneAt, cardDoneAt);

    if (cta){
      tl.set(cta, { opacity: 0, y: 10, pointerEvents: 'none' }, 0);
      tl.to(cta, {
        opacity: 1,
        y: 0,
        duration: 0.45
      }, allDone + 0.45);
      tl.set(cta, { pointerEvents: 'auto' }, allDone + 0.46);
    }
  } else {
    // No GSAP or reduced motion: remove preload and reveal CTA quickly
    removePreload();

    if (cta){
      const delayMs = 1800;
      window.setTimeout(() => {
        cta.style.opacity = '1';
        cta.style.transform = 'none';
        cta.style.pointerEvents = 'auto';
      }, delayMs);
    }
  }
}
