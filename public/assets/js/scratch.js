import { SCRATCH_RADIUS_PX, SCRATCH_THRESHOLD } from './config.js';


// Optional textured brush for scratch (falls back to circle if it can't load)
// Put your brush at: public/assets/img/brush.png (served as /assets/img/brush.png)
const BRUSH_SRC = '/assets/img/brush.png';
let _brushImg = null;
let _brushTried = false;

function ensureBrush(){
  if (_brushTried) return;
  _brushTried = true;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { _brushImg = img; };
  img.onerror = () => { _brushImg = null; };
  img.src = BRUSH_SRC;
}

/**
 * Foil cover: drawn on canvas so the scratch layer looks like metallic foil.
 * - Default foil = "silver"
 * - Optional: set <html data-foil="gold"> (or "silver") to switch globally (no UI toggle).
 * - Optional: override colors with CSS variables on :root:
 *   --scratch-foil-base, --scratch-foil-hi, --scratch-foil-mid, --scratch-foil-dark, --scratch-foil-text
 */

function getFoilMode(){
  const el = document.documentElement;
  const mode = (el?.dataset?.foil || '').toLowerCase().trim();
  return (mode === 'gold') ? 'gold' : 'silver';
}

function getFoilPalette(){
  const cs = getComputedStyle(document.documentElement);

  // Allow CSS overrides; fall back to reasonable defaults.
  const mode = getFoilMode();

  const defaults = mode === 'gold'
    ? {
        base: '#8a6a1f',
        hi:   '#f7e7a7',
        mid:  '#caa24a',
        dark: '#5a4210',
        text: 'rgba(255,255,255,0.82)'
      }
    : {
        base: '#6a6f7a',
        hi:   '#f5f6f8',
        mid:  '#aeb3bd',
        dark: '#3c4048',
        text: 'rgba(255,255,255,0.72)'
      };

  const pick = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;

  return {
    base: pick('--scratch-foil-base', defaults.base),
    hi:   pick('--scratch-foil-hi', defaults.hi),
    mid:  pick('--scratch-foil-mid', defaults.mid),
    dark: pick('--scratch-foil-dark', defaults.dark),
    text: pick('--scratch-foil-text', defaults.text),
    mode
  };
}

function resizeCanvasToElement(canvas){
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, rect };
}

function paintFoilBase(ctx, rect, pal){
  // Ibelick-style metallic gradient: 45deg + many stops
  const g = ctx.createLinearGradient(0, 0, rect.width, rect.height);

  g.addColorStop(0.00, pal.dark);
  g.addColorStop(0.05, pal.mid);
  g.addColorStop(0.10, pal.hi);
  g.addColorStop(0.30, pal.mid);
  g.addColorStop(0.50, pal.base);
  g.addColorStop(0.70, pal.mid);
  g.addColorStop(0.80, pal.hi);
  g.addColorStop(0.95, pal.mid);
  g.addColorStop(1.00, pal.dark);

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Subtle vertical grain lines (keep, but soften a bit)
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = 1;
  for (let x = 0; x < rect.width; x += 10){
    ctx.strokeStyle = (x % 20 === 0) ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, rect.height);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}


function paintHintText(ctx, rect, pal){
  ctx.fillStyle = pal.text;
  ctx.font = '700 12px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('scratch', rect.width/2, rect.height/2);
}

function paintCover(ctx, rect, { sheenX = null } = {}){
  ctx.save();

  const pal = getFoilPalette();

  // Foil base
  paintFoilBase(ctx, rect, pal);

  // Optional moving sheen stripe (guides the user where to scratch).
  if (typeof sheenX === 'number'){
    const w = rect.width;
    const h = rect.height;
    const stripeW = Math.max(40, Math.min(110, w * 0.22));
    const x0 = sheenX;

    // Sheen gradient: subtle diagonal band (Ibelick-style)
    const sg = ctx.createLinearGradient(x0 - stripeW, 0, x0 + stripeW, h);
    sg.addColorStop(0.00, 'rgba(255,255,255,0)');
    sg.addColorStop(0.20, 'rgba(255,255,255,0)');
    sg.addColorStop(0.40, 'rgba(255,255,255,0)');
    sg.addColorStop(0.50, 'rgba(255,255,255,0.14)');
    sg.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    sg.addColorStop(0.70, 'rgba(255,255,255,0)');
    sg.addColorStop(1.00, 'rgba(255,255,255,0)');


    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Hint text
  paintHintText(ctx, rect, pal);

  ctx.restore();
}

function percentCleared(canvas){
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0,0,width,height).data;

  // count pixels with alpha == 0 (fully cleared)
  let cleared = 0;
  const total = width * height;
  for (let i=3; i<data.length; i+=4){
    if (data[i] === 0) cleared++;
  }
  return cleared / total;
}

export function attachScratchTile(canvas, { onScratched }){
  let isDown = false;
  let scratched = false;
  let hasInteracted = false;
  let lastClientX = 0;
  let lastClientY = 0;

  let { ctx, rect } = resizeCanvasToElement(canvas);
  paintCover(ctx, rect);

  // Begin loading brush immediately (non-blocking)
  ensureBrush();

  // Make sure touch scrolling doesn't interfere with scratching
  canvas.style.touchAction = 'none';

  // --- Sheen (guidance) animation ---
  // Stops as soon as the user interacts (so it won't distract).
  let rafId = null;
  let start = performance.now();

  function startSheen(){
    stopSheen();
    start = performance.now();

    const loop = (t) => {
      if (scratched || hasInteracted) return;

      const elapsed = t - start;
      const period = 1400; // ms
      const p = (elapsed % period) / period;

      // Sweep fully off-canvas -> fully off-canvas (prevents cut-off/popping)
      const w = rect.width;
      const stripeW = Math.max(40, Math.min(110, w * 0.22));
      const startX = -stripeW * 2;
      const endX = w + stripeW * 2;
      const x = startX + (endX - startX) * p;

      // Redraw full cover each frame (only while untouched).
      paintCover(ctx, rect, { sheenX: x });

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
  }

  function stopSheen(){
    if (rafId){
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  startSheen();

  function scratchStamp(localX, localY){
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';

    if (_brushImg && _brushImg.complete && _brushImg.naturalWidth){
      // Textured brush stamp for a more natural scratch edge
      const size = SCRATCH_RADIUS_PX * 2.6;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(_brushImg, localX - size/2, localY - size/2, size, size);
    } else {
      // Fallback: original circle brush
      ctx.beginPath();
      ctx.arc(localX, localY, SCRATCH_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function scratchAt(clientX, clientY){
    const r = canvas.getBoundingClientRect();
    scratchStamp(clientX - r.left, clientY - r.top);
  }

  function scratchSegment(fromClientX, fromClientY, toClientX, toClientY){
    const r = canvas.getBoundingClientRect();
    const x0 = fromClientX - r.left;
    const y0 = fromClientY - r.top;
    const x1 = toClientX - r.left;
    const y1 = toClientY - r.top;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);

    // Stamp spacing: small enough to feel continuous
    const step = Math.max(3, SCRATCH_RADIUS_PX * 0.55);
    const n = Math.max(1, Math.ceil(dist / step));

    for (let i = 0; i <= n; i++){
      const t = i / n;
      scratchStamp(x0 + dx * t, y0 + dy * t);
    }
  }

  
  function finishCheck(){
    if (scratched) return;
    // expensive, only check at pointer up
    const p = percentCleared(canvas);
    if (p >= SCRATCH_THRESHOLD){
      scratched = true;
      stopSheen();
      onScratched?.();
    }
  }

  function onDown(e){
    if (scratched) return;
    hasInteracted = true;
    stopSheen();

    // Make sure brush is loading (safe to call repeatedly)
    ensureBrush();

    isDown = true;
    canvas.setPointerCapture?.(e.pointerId);

    // Prevent scroll / pull-to-refresh while scratching
    e.preventDefault?.();

    lastClientX = e.clientX;
    lastClientY = e.clientY;
    scratchAt(e.clientX, e.clientY);
  }
  function onMove(e){
    if (!isDown || scratched) return;

    e.preventDefault?.();

    // Stamp along the path for continuous scratch
    scratchSegment(lastClientX, lastClientY, e.clientX, e.clientY);
    lastClientX = e.clientX;
    lastClientY = e.clientY;
  }
  function onUp(){
    if (!isDown) return;
    isDown = false;
    finishCheck();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  window.addEventListener('resize', () => {
    ({ ctx, rect } = resizeCanvasToElement(canvas));

    if (scratched){
      // Keep revealed on resize.
      ctx.clearRect(0, 0, rect.width, rect.height);
      stopSheen();
      return;
    }

    paintCover(ctx, rect);
    if (!hasInteracted) startSheen();
  });

  return {
    reset(){
      ({ ctx, rect } = resizeCanvasToElement(canvas));
      scratched = false;
      isDown = false;
      hasInteracted = false;
      paintCover(ctx, rect);
      startSheen();
    },
    forceReveal(){
      ({ ctx, rect } = resizeCanvasToElement(canvas));
      ctx.clearRect(0,0,rect.width,rect.height);
      scratched = true;
      isDown = false;
      hasInteracted = true;
      stopSheen();
    }
  };
}
