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

    // IMPORTANT:
    // - Desktop needs the dedicated ".landing__word--the" element (to the right of the card).
    // - Mobile needs "The" inline before "Moment" inside the ".landing__word--moment" element.
    // So: hide the dedicated "The" element on mobile only, and restore it on desktop.
    if (wordThe){
      if (isMobileLayout){
        wordThe.style.display = 'none';
        wordThe.setAttribute('aria-hidden', 'true');
      } else {
        wordThe.style.removeProperty('display');
        wordThe.removeAttribute('aria-hidden');
      }
    }

    // If we previously split the Moment element (mobile) and we're now on desktop,
    // restore it back to just "Moment" so desktop does not lose its separate "The".
    if (!isMobileLayout && wordMoment){
      const hadSplit = wordMoment.querySelector('.landing__wordPart--moment');
      if (hadSplit){
        wordMoment.textContent = 'Moment';
      }
    }

    let words = [];
    let momentThePart = null;
    let momentMomentPart = null;

    if (isMobileLayout && wordMoment){
      // Build "The Moment" as inline spans inside the existing Moment element.
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

      // Critical for mobile: transforms won't apply reliably to inline text.
      // Make the animated spans inline-block so y-translate works (down-to-up) on mobile too.
      if (momentThePart) momentThePart.style.display = 'inline-block';
      if (momentMomentPart) momentMomentPart.style.display = 'inline-block';

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

    // Start delay for nicer flow
    const startDelay = 0.30;

    // Timing (slower overall)
    // Goal: word 1 -> word 2 -> word 3 -> card -> button
    const wordDur = 0.80;
    const wordStagger = 0.70;
    const cardDur = 1.00;

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
      }, startDelay);
    }

    // Card flip: AFTER the last word finishes (no overlap)
    const wordsDoneAt = (words.length ? ((words.length - 1) * wordStagger + wordDur) : 0);
    const cardStart = startDelay + wordsDoneAt;

    tl.to(stage, {
      opacity: 1,
      rotationY: 0,
      rotationX: 0,
      duration: cardDur,
      ease: 'power3.out'
    }, cardStart);

    // CTA: AFTER the card finishes
    const cardDoneAt = cardStart + cardDur;

    if (cta){
      // Keep it hidden until its turn (belt + suspenders)
      tl.set(cta, { opacity: 0, y: 10, pointerEvents: 'none' }, 0);

      tl.to(cta, {
        opacity: 1,
        y: 0,
        duration: 0.45
      }, cardDoneAt + 0.35);

      tl.set(cta, { pointerEvents: 'auto' }, cardDoneAt + 0.36);
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
