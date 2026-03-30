// /public/assets/js/game-message.js
// Message-reveal game type: single scratch area hides a text message.
// Sender configures a visible title and hidden message. Recipient scratches to reveal.
// v2: style picker, shape picker, "From" sign-off, dark-luxury border ring.

import { attachScratchTile } from './scratch.js';
import { getCardTheme, getResolvedMsgTheme, getSeqStepConfig } from './card-themes.js';
import { getCard, saveCard, setConfiguredAndWait, setRevealedAndWait } from './store.js';
import { copyText } from './utils.js';


// ─── Helpers ─────────────────────────────────────────────────────────

function _escHtml(str){
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}

/** Apply per-style CSS custom properties for foil palette overrides. */
function _applyFoilOverrides(style){
  if (!style) return;
  const root = document.documentElement;
  if (style.foil) root.dataset.foil = style.foil;
  if (style.foilBase) root.style.setProperty('--scratch-foil-base', style.foilBase);
  if (style.foilHi)   root.style.setProperty('--scratch-foil-hi', style.foilHi);
  if (style.foilMid)  root.style.setProperty('--scratch-foil-mid', style.foilMid);
  if (style.foilDark) root.style.setProperty('--scratch-foil-dark', style.foilDark);
  if (style.foilText) root.style.setProperty('--scratch-foil-text', style.foilText);
}

/** Calculate a responsive font size for the hidden message based on length and shape. */
function _messageFontSize(text, shape){
  const len = Math.max(1, (text || '').length);
  const tight = (shape === 'heart' || shape === 'hexagon');
  const max = tight ? 48 : 52;
  const min = tight ? 12 : 13;
  const size = Math.max(min, Math.round(max - (max - min) * Math.sqrt(len / 200)));
  return size + 'px';
}

/** Clear any foil CSS overrides so switching styles starts clean. */
function _clearFoilOverrides(){
  const root = document.documentElement;
  delete root.dataset.foil;
  for (const p of ['--scratch-foil-base','--scratch-foil-hi','--scratch-foil-mid','--scratch-foil-dark','--scratch-foil-text']){
    root.style.removeProperty(p);
  }
}

/** Apply inline title styling from resolved theme. */
function _styleTitleEl(el, resolved){
  if (!el || !resolved) return;
  if (resolved.titleFont)  el.style.fontFamily = resolved.titleFont;
  if (resolved.titleWeight) el.style.fontWeight = resolved.titleWeight;
  if (resolved.titleColor) el.style.color = resolved.titleColor;
  el.style.fontStyle = 'normal';
  if (resolved.titleTransform) el.style.textTransform = resolved.titleTransform;
}

/** Apply inline from-line styling from resolved theme. */
function _styleFromEl(el, resolved){
  if (!el || !resolved) return;
  if (resolved.fromFont)   el.style.fontFamily = resolved.fromFont;
  if (resolved.fromWeight) el.style.fontWeight = resolved.fromWeight;
  if (resolved.fromColor)  el.style.color = resolved.fromColor;
  el.style.fontStyle = resolved.fromStyle || 'normal';
  if (resolved.fromTransform) el.style.textTransform = resolved.fromTransform;
}

/** Apply mask shape to an element. */
function _applyMask(el, maskUrl){
  if (!el || !maskUrl) return;
  el.style.maskImage = `url('${maskUrl}')`;
  el.style.webkitMaskImage = `url('${maskUrl}')`;
}

/** Build the border ring <img> element for dark-luxury. */
function _borderRingHtml(resolved){
  if (!resolved || !resolved.borderRingSrc) return '';
  return `<img class="msg-card__border-ring" src="${resolved.borderRingSrc}" alt="" draggable="false" aria-hidden="true">`;
}


// ─── Setup (sender view) ────────────────────────────────────────────

export function renderMessageSetup(root, card, container, { previewMode = false } = {}){
  const baseTheme = getCardTheme(card.card_key) || {};
  if (baseTheme.messageMode === 'sequential'){
    return _renderSeqSetup(root, card, container, { previewMode });
  }
  const maxMsgDefault = baseTheme.messageMaxLength || 200;
  function _maxMsgForShape(shape){
    return (shape === 'heart' || shape === 'hexagon') ? 120 : 160;
  }

  const maxTitle = baseTheme.titleMaxLength || 92;
  const maxFrom = baseTheme.fromMaxLength || 60;
  const msgPlaceholder = baseTheme.messagePlaceholder || 'Type your hidden message...';
  const titlePlaceholder = baseTheme.titlePlaceholder || 'Your title here...';
  const fromPlaceholder = baseTheme.fromPlaceholder || 'e.g. Sarah & Tom';

  // Pre-fill from card record if returning to setup
  const existingTitle = card.visible_title || '';
  const existingMsg = card.message || '';
  const existingFrom = card.from_line || '';
  const existingStyle = card.card_style || baseTheme.defaultStyle || 'stardust';
  const existingShape = card.scratch_shape || baseTheme.defaultShape || 'heart'; let maxMsg = _maxMsgForShape(existingShape);
  const isConfigured = !!card.configured;

  const styles = baseTheme.styles || {};
  const shapes = baseTheme.availableShapes || [];

  // Resolve initial theme for preview
  const resolved = getResolvedMsgTheme(card.card_key, existingStyle, existingShape) || {};

  // Build style picker HTML
  const stylePickerHtml = Object.keys(styles).length > 1 ? `
    <div class="msg-setup__field">
      <label class="msg-setup__field-label">Choose your style:</label>
      <div class="msg-style-picker" ${isConfigured ? 'data-locked="true"' : ''}>
        ${Object.entries(styles).map(([key, s]) => `
          <button type="button" class="msg-style-picker__item ${key === existingStyle ? 'is-active' : ''}"
                  data-style="${key}" ${isConfigured ? 'disabled' : ''}>
            <img src="${s.thumbSrc}" alt="${s.label}" draggable="false" loading="lazy">
            <span class="msg-style-picker__label">${s.label}</span>
          </button>
        `).join('')}
      </div>
    </div>
  ` : '';

  // Build shape picker HTML
  const shapePickerHtml = shapes.length > 1 ? `
    <div class="msg-setup__field">
      <label class="msg-setup__field-label">Choose your shape:</label>
      <div class="msg-shape-picker" ${isConfigured ? 'data-locked="true"' : ''}>
        ${shapes.map(s => `
          <button type="button" class="msg-shape-picker__item ${s.key === existingShape ? 'is-active' : ''}"
                  data-shape="${s.key}" ${isConfigured ? 'disabled' : ''}>
            <img src="${s.mask}" alt="${s.label}" draggable="false">
            <span class="msg-shape-picker__label">${s.label}</span>
          </button>
        `).join('')}
      </div>
    </div>
  ` : '';

  root.innerHTML = `
    <section class="flow-screen msg-setup" data-card-style="${existingStyle}">
      <div class="flow-intro">
        <h1 class="flow-title">Create your card</h1>
        <p class="flow-lead muted">Choose a style, write your message, then send the recipient link.</p>
      </div>
      <div class="msg-setup__controls panel panel--glass panel--padded">
        <div class="msg-setup__card">
          <button class="msg-setup__preview-close" type="button" aria-label="Close preview">&times;</button>
          <div class="msg-card" data-card-key="${card.card_key || ''}" data-card-style="${existingStyle}">
            <picture class="card-bg" aria-hidden="true">
              <source media="(min-width: 700px)" srcset="${resolved.bgDesktopSrc || ''}">
              <img src="${resolved.bgMobileSrc || resolved.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
            </picture>
            <div class="msg-card__content">
              <div class="msg-card__title-preview" data-empty-label="${titlePlaceholder}"></div>
              <div class="msg-card__scratch-preview" style="aspect-ratio: ${resolved.scratchAspect || '400 / 350'}">
                ${_borderRingHtml(resolved)}
                <div class="msg-card__foil-preview"></div>
                <div class="msg-card__message-preview" data-empty-label="${msgPlaceholder}"></div>
              </div>
              <div class="msg-card__from-preview"></div>
            </div>
          </div>
        </div>

        ${stylePickerHtml}
        ${shapePickerHtml}

        <div class="msg-setup__field">
          <div class="msg-setup__field-header">
            <label for="msgTitle">Your Title:</label>
            <span class="msg-setup__counter"><span id="titleCount">${maxTitle - existingTitle.length}</span> characters available</span>
          </div>
          <input type="text" id="msgTitle" class="input" maxlength="${maxTitle}" placeholder="${titlePlaceholder}" value="${_escHtml(existingTitle)}" ${isConfigured ? 'disabled' : ''}>
        </div>

        <div class="msg-setup__field">
          <div class="msg-setup__field-header">
            <label for="msgText">Text for under the scratch field:</label>
            <span class="msg-setup__counter"><span id="msgCount">${maxMsg - existingMsg.length}</span> characters available</span>
          </div>
          <textarea id="msgText" class="input" style="white-space:pre-wrap;overflow:auto;font-family:inherit;" maxlength="${maxMsg}" placeholder="${msgPlaceholder}" rows="3" ${isConfigured ? 'disabled' : ''}>${_escHtml(existingMsg)}</textarea>
        </div>

        <div class="msg-setup__field">
          <div class="msg-setup__field-header">
            <label for="msgFrom">Sign-off (hidden if left empty):</label>
            <span class="msg-setup__counter"><span id="fromCount">${maxFrom - existingFrom.length}</span> characters available</span>
          </div>
          <input type="text" id="msgFrom" class="input" maxlength="${maxFrom}" placeholder="${fromPlaceholder}" value="${_escHtml(existingFrom)}" ${isConfigured ? 'disabled' : ''}>
        </div>

        ${isConfigured ? `
          <div class="msg-setup__done">
            <p class="msg-setup__done-text">Your card is ready to share!</p>
            <div class="msg-setup__actions">
              <button class="btn primary" type="button" data-action="copy-link">Copy recipient link</button>
              <button class="btn" type="button" data-action="share-link">Share</button>
            </div>
          </div>
        ` : `
          <div class="msg-setup__actions">
            <button class="btn outline" type="button" data-action="try-scratch" disabled>Try scratch yourself</button>
            <button class="btn" type="button" data-action="confirm" disabled>Confirm &amp; create link</button>
          </div>
          <p class="msg-setup__hint muted">You can preview your card above. Once confirmed, the message cannot be changed.</p>
        `}
      </div>
      <button class="msg-setup__preview-fab" type="button" aria-label="Preview card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Preview
      </button>
    </section>
  `;

  // --- Element refs ---
  const titleInput = root.querySelector('#msgTitle');
  const msgInput = root.querySelector('#msgText');
  const fromInput = root.querySelector('#msgFrom');
  const titlePreview = root.querySelector('.msg-card__title-preview');
  const msgPreview = root.querySelector('.msg-card__message-preview');
  const fromPreview = root.querySelector('.msg-card__from-preview');
  const titleCounter = root.querySelector('#titleCount');
  const msgCounter = root.querySelector('#msgCount');
  const fromCounter = root.querySelector('#fromCount');
  const confirmBtn = root.querySelector('[data-action="confirm"]');
  const tryScratchBtn = root.querySelector('[data-action="try-scratch"]');
  const foilEl = root.querySelector('.msg-card__foil-preview');
  const scratchArea = root.querySelector('.msg-card__scratch-preview');
  const cardEl = root.querySelector('.msg-card');
  const bgPicture = root.querySelector('.msg-card .card-bg');
  const setupEl = root.querySelector('.msg-setup');
  const previewFab = root.querySelector('.msg-setup__preview-fab');
  const previewClose = root.querySelector('.msg-setup__preview-close');
  const previewCardWrap = root.querySelector('.msg-setup__card');

  function _openPreviewModal(){ setupEl && setupEl.classList.add('msg-setup--preview-open'); }
  function _closePreviewModal(){ setupEl && setupEl.classList.remove('msg-setup--preview-open'); }

  if (previewFab) previewFab.addEventListener('click', _openPreviewModal);
  if (previewClose) previewClose.addEventListener('click', _closePreviewModal);
  if (previewCardWrap){
    previewCardWrap.addEventListener('click', _closePreviewModal);
  }

  // --- State ---
  let activeStyle = existingStyle;
  let activeShape = existingShape;

  // --- Apply initial preview styling ---
  _applyPreviewStyle(resolved);

  function _applyPreviewStyle(r){
    // Foil mask
    if (foilEl && r.scratchMask){
      _applyMask(foilEl, r.scratchMask);
      // Set foil color from style
      if (r.foilGradient && r.foilDark && r.foilHi){
        foilEl.style.background = `linear-gradient(to right, ${r.foilDark}, ${r.foilHi})`;
      } else {
        foilEl.style.background = r.foilBase || (r.foil === 'gold' ? '#c9a84c' : '#aeb3bd');
      }
    }
    // Message preview mask
    if (msgPreview && r.scratchMask){
      _applyMask(msgPreview, r.scratchMask);
    }
    // Aspect ratio
    if (scratchArea){
      scratchArea.style.aspectRatio = r.scratchAspect || '400 / 350';
    }
    // Border ring
    const existingRing = root.querySelector('.msg-card__border-ring');
    if (existingRing) existingRing.remove();
    if (r.borderRingSrc && scratchArea){
      const ringImg = document.createElement('img');
      ringImg.className = 'msg-card__border-ring';
      ringImg.src = r.borderRingSrc;
      ringImg.alt = '';
      ringImg.draggable = false;
      ringImg.setAttribute('aria-hidden', 'true');
      scratchArea.insertBefore(ringImg, scratchArea.firstChild);
    }
    // Title styling
    _styleTitleEl(titlePreview, r);
    // From styling
    _styleFromEl(fromPreview, r);
    // Message text color
    if (msgPreview && r.messageColor) msgPreview.style.color = r.messageColor;
    if (msgPreview && r.messageBg) msgPreview.style.background = r.messageBg;
    if (msgPreview){
      const previewText = msgPreview.textContent || '';
      const shape = r.scratchShape || 'heart';
      msgPreview.style.fontSize = _messageFontSize(previewText, shape);
    }
  }

  function _updateBackgrounds(r){
    if (!bgPicture) return;
    const source = bgPicture.querySelector('source');
    const img = bgPicture.querySelector('img');
    if (source) source.srcset = r.bgDesktopSrc || '';
    if (img) img.src = r.bgMobileSrc || r.bgDesktopSrc || '';
  }

  // --- Style picker ---
  if (!isConfigured){
    const styleBtns = root.querySelectorAll('.msg-style-picker__item');
    for (const btn of styleBtns){
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-active')) return;
        for (const b of styleBtns) b.classList.remove('is-active');
        btn.classList.add('is-active');
        activeStyle = btn.dataset.style;

        const r = getResolvedMsgTheme(card.card_key, activeStyle, activeShape) || {};
        _applyPreviewStyle(r);
        _updateBackgrounds(r);

        // Update data attribute for CSS hooks
        const setupEl = root.querySelector('.msg-setup');
        if (setupEl) setupEl.dataset.cardStyle = activeStyle;
        if (cardEl) cardEl.dataset.cardStyle = activeStyle;
      });
    }
  }

  // --- Shape picker ---
  if (!isConfigured){
    const shapeBtns = root.querySelectorAll('.msg-shape-picker__item');
    for (const btn of shapeBtns){
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-active')) return;
        for (const b of shapeBtns) b.classList.remove('is-active');
        btn.classList.add('is-active');
        activeShape = btn.dataset.shape;

        // Update max message length for new shape
        maxMsg = _maxMsgForShape(activeShape);
        if (msgInput){
          msgInput.maxLength = maxMsg;
          // Truncate if current text exceeds new limit
          if (msgInput.value.length > maxMsg){
            msgInput.value = msgInput.value.slice(0, maxMsg);
          }
        }
        updatePreview();

        const r = getResolvedMsgTheme(card.card_key, activeStyle, activeShape) || {};
        _applyPreviewStyle(r);
      });
    }
  }

  // --- Live text preview ---
  function updatePreview(){
    const title = titleInput ? titleInput.value : '';
    const msg = msgInput ? msgInput.value : '';
    const from = fromInput ? fromInput.value : '';

    if (titlePreview){
      titlePreview.textContent = title || '';
      titlePreview.classList.toggle('is-empty', !title);
    }
    if (msgPreview){
      msgPreview.textContent = msg || '';
      msgPreview.classList.toggle('is-empty', !msg);
      msgPreview.style.fontSize = _messageFontSize(msg, activeShape);
    }
    if (fromPreview){
      fromPreview.textContent = from ? `${from}` : '';
      fromPreview.classList.toggle('is-hidden', !from);
    }
    if (titleCounter) titleCounter.textContent = String(maxTitle - title.length);
    if (msgCounter) msgCounter.textContent = String(maxMsg - msg.length);
    if (fromCounter) fromCounter.textContent = String(maxFrom - from.length);

    // Enable confirm + try-scratch only when message is filled
    const hasMsg = !!msg.trim();
    if (confirmBtn) confirmBtn.disabled = !hasMsg;
    if (tryScratchBtn) tryScratchBtn.disabled = !hasMsg;
  }

  if (titleInput) titleInput.addEventListener('input', updatePreview);
  if (msgInput) msgInput.addEventListener('input', updatePreview);
  if (fromInput) fromInput.addEventListener('input', updatePreview);
  updatePreview();

  // --- Try scratch yourself ---
  if (tryScratchBtn){
    tryScratchBtn.addEventListener('click', () => {
      _openTryScratch(container, card, {
        title: (titleInput ? titleInput.value : '').trim(),
        message: (msgInput ? msgInput.value : '').trim(),
        from: (fromInput ? fromInput.value : '').trim(),
        style: activeStyle,
        shape: activeShape
      });
    });
  }

  // --- Confirm ---
  if (confirmBtn){
    let confirmPending = false;
    let confirmTimer = null;

    function resetConfirm(){
      confirmPending = false;
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = null;
      confirmBtn.textContent = 'Confirm & create link';
      confirmBtn.classList.remove('is-confirming');
      // Re-check if should be disabled (no message = disabled)
      const msg = (msgInput ? msgInput.value : '').trim();
      confirmBtn.disabled = !msg;
    }

    confirmBtn.addEventListener('click', async () => {
      const title = (titleInput ? titleInput.value : '').trim();
      const msg = (msgInput ? msgInput.value : '').trim();
      const from = (fromInput ? fromInput.value : '').trim();

      if (!msg){
        if (msgInput) msgInput.focus();
        return;
      }

      // First click: ask for confirmation
      if (!confirmPending){
        confirmPending = true;
        confirmBtn.textContent = 'Are you sure? Tap again to lock';
        confirmBtn.classList.add('is-confirming');
        confirmTimer = setTimeout(resetConfirm, 4000);
        return;
      }

      // Second click: actually lock the card
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmPending = false;
      confirmBtn.disabled = true;
      confirmBtn.classList.remove('is-confirming');
      confirmBtn.textContent = 'Saving...';

      try{
        card.visible_title = title || null;
        card.message = msg;
        card.from_line = from || null;
        card.card_style = activeStyle;
        card.scratch_shape = activeShape;
        card.configured = true;

        if (previewMode){
          await saveCard(card);
        } else {
          await setConfiguredAndWait(card.token, {
            visible_title: card.visible_title,
            message: card.message,
            from_line: card.from_line,
            card_style: card.card_style,
            scratch_shape: card.scratch_shape,
            configured: true,
          });
        }

        renderMessageSetup(root, card, container, { previewMode });
      } catch(e){
        resetConfirm();
        console.error('Failed to save message card:', e);
      }
    });
  }

  // --- Share actions (post-configure) ---
  const copyBtn = root.querySelector('[data-action="copy-link"]');
  const shareBtn = root.querySelector('[data-action="share-link"]');

  if (copyBtn && card.token){
    const recipientUrl = `${window.location.origin}/open/?token=${card.token}`;
    copyBtn.addEventListener('click', async () => {
      try{
        await copyText(recipientUrl);
        copyBtn.textContent = 'Copied!';
        copyBtn.disabled = true;
        setTimeout(() => { copyBtn.textContent = 'Copy recipient link'; copyBtn.disabled = false; }, 1200);
      }catch(_){}
    });

    if (shareBtn){
      shareBtn.addEventListener('click', async () => {
        try{
          if (navigator.share){
            await navigator.share({ url: recipientUrl, text: 'I have a surprise for you!' });
          } else {
            await copyText(recipientUrl);
            shareBtn.textContent = 'Link copied!';
            setTimeout(() => { shareBtn.textContent = 'Share'; }, 1200);
          }
        }catch(_){}
      });
    }
  }
}


// ─── Scratch (recipient view) ────────────────────────────────────────

export function renderMessageScratch(root, card){
  const theme = getCardTheme(card.card_key) || {};
  if (theme.messageMode === 'sequential'){
    return _renderSeqScratch(root, card);
  }
  const resolved = getResolvedMsgTheme(card.card_key, card.card_style, card.scratch_shape) || {};
  const message = card.message || '';
  const visibleTitle = card.visible_title || '';
  const fromLine = card.from_line || '';

  // Apply foil overrides for this style
  _clearFoilOverrides();
  _applyFoilOverrides(resolved);

  root.innerHTML = `
    <div class="msg-card-wrapper" data-presentation="fullscreen">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1" data-card-style="${card.card_style || ''}" data-presentation="fullscreen">
          <picture class="card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${resolved.bgDesktopSrc || ''}">
            <img src="${resolved.bgMobileSrc || resolved.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
          </picture>
          <div class="msg-card__content">
            ${visibleTitle ? `<div class="msg-card__visible-title">${_escHtml(visibleTitle)}</div>` : ''}
            <div class="msg-card__scratch-area" style="aspect-ratio: ${resolved.scratchAspect || '400 / 350'}">
              ${_borderRingHtml(resolved)}
              <div class="msg-card__under-message">${_escHtml(message)}</div>
              <div class="msg-card__scratch-tile" id="msgScratchTile">
                <canvas id="msgScratchCanvas"></canvas>
              </div>
            </div>
            ${fromLine ? `<div class="msg-card__from-line">${_escHtml(fromLine)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  // --- Apply style-driven visuals ---
  const titleEl = root.querySelector('.msg-card__visible-title');
  _styleTitleEl(titleEl, resolved);

  const fromEl = root.querySelector('.msg-card__from-line');
  _styleFromEl(fromEl, resolved);

  // Scratch tile + message mask
  const tileEl = root.querySelector('#msgScratchTile');
  const canvas = root.querySelector('#msgScratchCanvas');
  if (!tileEl || !canvas) return;

  if (resolved.scratchMask){
    _applyMask(tileEl, resolved.scratchMask);
    const underMsg = root.querySelector('.msg-card__under-message');
    if (underMsg){
      _applyMask(underMsg, resolved.scratchMask);
      if (resolved.messageColor) underMsg.style.color = resolved.messageColor;
      if (resolved.messageBg) underMsg.style.background = resolved.messageBg;
      if (resolved.messageFontSize) underMsg.style.fontSize = resolved.messageFontSize;
      if (resolved.messageFont) underMsg.style.fontFamily = resolved.messageFont;
      if (resolved.messageWeight) underMsg.style.fontWeight = resolved.messageWeight;
      if (resolved.messageTransform) underMsg.style.textTransform = resolved.messageTransform;
      underMsg.style.fontSize = _messageFontSize(message, resolved.scratchShape);
    }
  }

  // Attach the scratch interaction
  attachScratchTile(canvas, {
    onScratched: () => {
      _onScratchComplete(root, card, resolved);
    },
    hintStyle: 'thin'
  });
}


async function _onScratchComplete(root, card, resolved){
  // Mark as revealed
  card.revealed = true;

  // Synchronous localStorage write (same pattern as match-3)
  try{
    const lsKey = `sc:card:${card.token}`;
    const raw = localStorage.getItem(lsKey);
    if (raw){
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object'){
        obj.revealed = true;
        obj.revealed_at = new Date().toISOString();
        localStorage.setItem(lsKey, JSON.stringify(obj));
      }
    }
  }catch(_){}

  // Async persist
  try{
    await setRevealedAndWait(card.token, {});
  }catch(_){}

  // Transition to revealed state
  const tileEl = root.querySelector('#msgScratchTile');
  if (tileEl){
    tileEl.style.transition = 'opacity 600ms ease';
    tileEl.style.opacity = '0';
  }

  // Show the message clearly after foil fades
  setTimeout(() => {
    if (tileEl) tileEl.style.display = 'none';
    const msgEl = root.querySelector('.msg-card__under-message');
    if (msgEl) msgEl.classList.add('is-revealed');
  }, 650);
}


// ─── Try scratch modal (sender preview) ──────────────────────────────

function _openTryScratch(container, card, { title, message, from, style, shape }){
  // Remove any existing modal
  const existing = document.querySelector('.cc-try-scratch-modal');
  if (existing) existing.remove();

  const resolved = getResolvedMsgTheme(card.card_key, style, shape) || {};
  const presentation = resolved.presentation || 'fullscreen';

  // Save current foil state so we can restore on close
  const rootEl = document.documentElement;
  const savedFoil = rootEl.dataset.foil || null;
  const foilProps = ['--scratch-foil-base','--scratch-foil-hi','--scratch-foil-mid','--scratch-foil-dark','--scratch-foil-text'];
  const savedFoilVars = {};
  for (const p of foilProps) savedFoilVars[p] = rootEl.style.getPropertyValue(p) || null;

  // Save current page theme CSS variables
  const pageProps = ['--page-bg','--page-bg1','--page-glow-a1','--page-glow-a2','--page-glow-a3','--page-glow-b1','--page-glow-b2','--page-glow-a-opacity','--page-glow-b-opacity'];
  const savedPageVars = {};
  for (const p of pageProps) savedPageVars[p] = rootEl.style.getPropertyValue(p) || null;
  const savedColorMode = rootEl.dataset.colorMode || null;
  const savedBodyBg = document.body.style.background || null;
  const savedBodyBgImage = document.body.style.backgroundImage || null;

  // Apply foil overrides for this style
  _clearFoilOverrides();
  _applyFoilOverrides(resolved);

  // Apply page theme (background colors) — same as applyPageTheme in card.js
  const colorMode = resolved.colorMode || 'dark';
  rootEl.dataset.colorMode = colorMode;
  if (resolved.pageBg){
    rootEl.style.setProperty('--page-bg', resolved.pageBg);
    rootEl.style.setProperty('--page-bg1', resolved.pageBg1 || resolved.pageBg);
  }
  if (resolved.pageGlowA1) rootEl.style.setProperty('--page-glow-a1', resolved.pageGlowA1);
  if (resolved.pageGlowA2) rootEl.style.setProperty('--page-glow-a2', resolved.pageGlowA2);
  if (resolved.pageGlowA3) rootEl.style.setProperty('--page-glow-a3', resolved.pageGlowA3);
  if (resolved.pageGlowB1) rootEl.style.setProperty('--page-glow-b1', resolved.pageGlowB1);
  if (resolved.pageGlowB2) rootEl.style.setProperty('--page-glow-b2', resolved.pageGlowB2);
  if (resolved.pageGlowAOpacity != null) rootEl.style.setProperty('--page-glow-a-opacity', String(resolved.pageGlowAOpacity));
  if (resolved.pageGlowBOpacity != null) rootEl.style.setProperty('--page-glow-b-opacity', String(resolved.pageGlowBOpacity));

  // Build modal with identical HTML structure to renderMessageScratch
  const modal = document.createElement('div');
  modal.className = 'cc-try-scratch-modal';
  modal.innerHTML = `
    <button class="cc-try-scratch-modal__close" type="button" aria-label="Close">&times;</button>
    <div class="msg-card-wrapper" data-presentation="${presentation}">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-card-style="${style || ''}" data-presentation="${presentation}">
          <picture class="card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${resolved.bgDesktopSrc || ''}">
            <img src="${resolved.bgMobileSrc || resolved.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
          </picture>
          <div class="msg-card__content">
            ${title ? `<div class="msg-card__visible-title">${_escHtml(title)}</div>` : ''}
            <div class="msg-card__scratch-area" style="aspect-ratio: ${resolved.scratchAspect || '400 / 350'}">
              ${_borderRingHtml(resolved)}
              <div class="msg-card__under-message">${_escHtml(message)}</div>
              <div class="msg-card__scratch-tile" id="tryScratchTile">
                <canvas id="tryScratchCanvas"></canvas>
              </div>
            </div>
            ${from ? `<div class="msg-card__from-line">${_escHtml(from)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="cc-try-scratch-modal__back"><button class="btn" type="button">Looks good? Go back to setup</button></div>
  `;

  container.appendChild(modal);

  // Apply theme styling
  const titleEl = modal.querySelector('.msg-card__visible-title');
  _styleTitleEl(titleEl, resolved);

  const fromEl = modal.querySelector('.msg-card__from-line');
  _styleFromEl(fromEl, resolved);

  const tileEl = modal.querySelector('#tryScratchTile');
  const canvas = modal.querySelector('#tryScratchCanvas');
  const underMsg = modal.querySelector('.msg-card__under-message');

  if (resolved.scratchMask){
    if (tileEl) _applyMask(tileEl, resolved.scratchMask);
    if (underMsg){
      _applyMask(underMsg, resolved.scratchMask);
      if (resolved.messageColor) underMsg.style.color = resolved.messageColor;
      if (resolved.messageBg) underMsg.style.background = resolved.messageBg;
      if (resolved.messageFont) underMsg.style.fontFamily = resolved.messageFont;
      if (resolved.messageWeight) underMsg.style.fontWeight = resolved.messageWeight;
      if (resolved.messageTransform) underMsg.style.textTransform = resolved.messageTransform;
      underMsg.style.fontSize = _messageFontSize(message, resolved.scratchShape);
    }
  }

  // Attach scratch interaction — no persistence
  if (canvas){
    const backBtn = modal.querySelector('.cc-try-scratch-modal__back');
    attachScratchTile(canvas, {
      onScratched: () => {
        if (tileEl){
          tileEl.style.transition = 'opacity 600ms ease';
          tileEl.style.opacity = '0';
        }
        setTimeout(() => {
          if (tileEl) tileEl.style.display = 'none';
          if (underMsg) underMsg.classList.add('is-revealed');
        }, 650);
        if (backBtn) backBtn.classList.add('is-visible');
      },
      hintStyle: 'thin'
    });
  }

  // Close: remove modal and restore previous foil + page theme state
  function closeModal(){
    modal.remove();
    // Restore foil
    _clearFoilOverrides();
    if (savedFoil) rootEl.dataset.foil = savedFoil;
    for (const p of foilProps){
      if (savedFoilVars[p]) rootEl.style.setProperty(p, savedFoilVars[p]);
    }
    // Restore page theme
    for (const p of pageProps){
      if (savedPageVars[p]) rootEl.style.setProperty(p, savedPageVars[p]);
      else rootEl.style.removeProperty(p);
    }
    if (savedColorMode) rootEl.dataset.colorMode = savedColorMode;
    else delete rootEl.dataset.colorMode;
    if (savedBodyBgImage) document.body.style.backgroundImage = savedBodyBgImage;
    else if (savedBodyBg) document.body.style.background = savedBodyBg;
  }
  modal.querySelector('.cc-try-scratch-modal__close').addEventListener('click', closeModal);
  modal.querySelector('.cc-try-scratch-modal__back .btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}


// ─── Revealed (returning visitor) ────────────────────────────────────

export function renderMessageRevealed(root, card){
  const theme = getCardTheme(card.card_key) || {};
  if (theme.messageMode === 'sequential'){
    return _renderSeqRevealed(root, card);
  }
  const resolved = getResolvedMsgTheme(card.card_key, card.card_style, card.scratch_shape) || {};
  const message = card.message || '';
  const visibleTitle = card.visible_title || '';
  const fromLine = card.from_line || '';

  // Apply foil overrides (not strictly needed for revealed but keeps page theme consistent)
  _clearFoilOverrides();
  _applyFoilOverrides(resolved);

  root.innerHTML = `
    <div class="msg-card-wrapper" data-presentation="fullscreen">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1" data-card-style="${card.card_style || ''}" data-presentation="fullscreen">
          <picture class="card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${resolved.bgDesktopSrc || ''}">
            <img src="${resolved.bgMobileSrc || resolved.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
          </picture>
          <div class="msg-card__content">
            ${visibleTitle ? `<div class="msg-card__visible-title">${_escHtml(visibleTitle)}</div>` : ''}
            <div class="msg-card__scratch-area" style="aspect-ratio: ${resolved.scratchAspect || '400 / 350'}">
              ${_borderRingHtml(resolved)}
              <div class="msg-card__under-message is-revealed">${_escHtml(message)}</div>
            </div>
            ${fromLine ? `<div class="msg-card__from-line">${_escHtml(fromLine)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  // Apply style-driven visuals
  const titleEl = root.querySelector('.msg-card__visible-title');
  _styleTitleEl(titleEl, resolved);

  const fromEl = root.querySelector('.msg-card__from-line');
  _styleFromEl(fromEl, resolved);

  const msgEl = root.querySelector('.msg-card__under-message');
  if (msgEl){
    if (resolved.scratchMask) _applyMask(msgEl, resolved.scratchMask);
    if (resolved.messageColor) msgEl.style.color = resolved.messageColor;
    if (resolved.messageBg) msgEl.style.background = resolved.messageBg;
    if (resolved.messageFontSize) msgEl.style.fontSize = resolved.messageFontSize;
    if (resolved.messageFont) msgEl.style.fontFamily = resolved.messageFont;
    if (resolved.messageWeight) msgEl.style.fontWeight = resolved.messageWeight;
    if (resolved.messageTransform) msgEl.style.textTransform = resolved.messageTransform;
    msgEl.style.fontSize = _messageFontSize(message, resolved.scratchShape);
  }
}


// ─── Sequential mode (gender reveal + future themed products) ────────────────
//
// Activated when theme.messageMode === 'sequential'.
// All three exported render functions branch here.
// Card fields used: language, gender, custom_message, current_step, revealed_steps.


// ── Helpers ──────────────────────────────────────────────────────────────────

/** Apply page theme CSS vars for the sequential card (theme-level, no per-step overrides). */
function _applySeqStepPageTheme(theme){
  const root = document.documentElement;
  root.dataset.colorMode = theme.colorMode || 'light';

  const set = (prop, val) => { if (val) root.style.setProperty(prop, val); };
  set('--page-bg',      theme.pageBg);
  set('--page-bg1',     theme.pageBg1);
  set('--page-glow-a1', theme.pageGlowA1);
  set('--page-glow-a2', theme.pageGlowA2);
  set('--page-glow-a3', theme.pageGlowA3);
  set('--page-glow-b1', theme.pageGlowB1);
  set('--page-glow-b2', theme.pageGlowB2);

  _clearFoilOverrides();
  _applyFoilOverrides(theme);
}

/** Persist step completion to card record (recipient-side). */
async function _persistSeqStep(card, completedStep, nextStep){
  const revealedSteps = Array.isArray(card.revealed_steps) ? [...card.revealed_steps] : [];
  if (!revealedSteps.includes(completedStep)) revealedSteps.push(completedStep);

  card.revealed_steps = revealedSteps;
  card.current_step   = nextStep;

  // Fire-and-forget: local mirror + async API
  saveCard(card);
}


// ── Setup (sender) ────────────────────────────────────────────────────────────

function _renderSeqSetup(root, card, container, { previewMode = false } = {}){
  const theme = getCardTheme(card.card_key) || {};
  const isConfigured = !!card.configured;

  // ── Configured: show share UI ──
  if (isConfigured){
    const lang       = card.language || theme.defaultLanguage || 'en';
    const gender     = card.gender || 'boy';
    const revealText = gender === 'girl' ? 'GIRL!' : 'BOY!';

    root.innerHTML = `
      <section class="flow-screen seq-setup">
        <div class="flow-intro">
          <h1 class="flow-title">Your Gender Reveal is ready!</h1>
          <p class="flow-lead muted">Revealing <strong>${_escHtml(revealText)}</strong> in ${_escHtml(lang === 'de' ? 'Deutsch' : 'English')}. Share the link with your recipient.</p>
        </div>
        <div class="seq-setup__form panel panel--glass panel--padded">
          ${card.custom_message ? `<p class="seq-setup__summary muted">Personal message: <em>${_escHtml(card.custom_message)}</em></p>` : ''}
          <div class="msg-setup__actions">
            <button class="btn primary" type="button" data-action="copy-link">Copy recipient link</button>
            <button class="btn" type="button" data-action="share-link">Share</button>
          </div>
        </div>
      </section>
    `;

    const recipientUrl = `${window.location.origin}/open/?token=${card.token}`;

    root.querySelector('[data-action="copy-link"]')?.addEventListener('click', async function(){
      try{
        await copyText(recipientUrl);
        this.textContent = 'Copied!';
        this.disabled = true;
        setTimeout(() => { this.textContent = 'Copy recipient link'; this.disabled = false; }, 1200);
      }catch(_){}
    });

    root.querySelector('[data-action="share-link"]')?.addEventListener('click', async function(){
      try{
        if (navigator.share){
          await navigator.share({ url: recipientUrl, text: 'I have a surprise for you!' });
        } else {
          await copyText(recipientUrl);
          this.textContent = 'Link copied!';
          setTimeout(() => { this.textContent = 'Share'; }, 1200);
        }
      }catch(_){}
    });

    return;
  }

  // ── Not configured: show setup form ──
  const langs   = theme.availableLanguages || ['en'];
  const activeLang = card.language || theme.defaultLanguage || 'en';

  root.innerHTML = `
    <section class="flow-screen seq-setup">
      <div class="flow-intro">
        <h1 class="flow-title">Set up your Gender Reveal</h1>
        <p class="flow-lead muted">Choose language, pick the reveal, and add an optional personal message.</p>
      </div>
      <div class="seq-setup__form panel panel--glass panel--padded">

        ${langs.length > 1 ? `
        <div class="msg-setup__field">
          <label class="msg-setup__field-label">Language / Sprache:</label>
          <div class="seq-btn-group" id="seqLangBtns">
            ${langs.map(l => `
              <button type="button" class="btn seq-lang-btn${l === activeLang ? ' is-active' : ''}" data-lang="${l}">
                ${l === 'de' ? 'Deutsch' : 'English'}
              </button>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <div class="msg-setup__field">
          <label class="msg-setup__field-label">It&#8217;s a&hellip;</label>
          <div class="seq-btn-group seq-gender-group" id="seqGenderBtns">
            <button type="button" class="btn seq-gender-btn" data-gender="boy">
              <span class="seq-gender-btn__emoji">👦</span>
              <span class="seq-gender-btn__label">BOY</span>
            </button>
            <button type="button" class="btn seq-gender-btn" data-gender="girl">
              <span class="seq-gender-btn__emoji">👧</span>
              <span class="seq-gender-btn__label">GIRL</span>
            </button>
          </div>
        </div>

        <div class="msg-setup__field">
          <div class="msg-setup__field-header">
            <label for="seqCustomMsg">Personal message <span class="muted">(optional):</span></label>
            <span class="msg-setup__counter"><span id="seqMsgCount">60</span> left</span>
          </div>
          <input type="text" id="seqCustomMsg" class="input" maxlength="60"
            placeholder="e.g. We can&#8217;t wait to meet you!">
          <p class="msg-setup__hint muted" style="margin-top:0.25rem">Shown below the BOY! / GIRL! reveal.</p>
        </div>

        <div class="msg-setup__actions">
          <button type="button" class="btn" data-action="confirm" disabled>Confirm &amp; create link</button>
        </div>
        <p class="msg-setup__hint muted">Once confirmed, the reveal cannot be changed.</p>
      </div>
    </section>
  `;

  // ── State ──
  let selectedLang   = activeLang;
  let selectedGender = null;

  const confirmBtn   = root.querySelector('[data-action="confirm"]');
  const customInput  = root.querySelector('#seqCustomMsg');
  const msgCounter   = root.querySelector('#seqMsgCount');

  function _updateConfirmState(){
    if (confirmBtn) confirmBtn.disabled = !selectedGender;
  }

  // ── Language picker ──
  for (const btn of root.querySelectorAll('.seq-lang-btn')){
    btn.addEventListener('click', () => {
      root.querySelectorAll('.seq-lang-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      selectedLang = btn.dataset.lang;
    });
  }

  // ── Gender picker ──
  for (const btn of root.querySelectorAll('.seq-gender-btn')){
    btn.addEventListener('click', () => {
      root.querySelectorAll('.seq-gender-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      selectedGender = btn.dataset.gender;
      _updateConfirmState();
    });
  }

  // ── Custom message counter ──
  if (customInput){
    customInput.addEventListener('input', () => {
      if (msgCounter) msgCounter.textContent = String(60 - customInput.value.length);
    });
  }

  // ── Confirm (double-click) ──
  if (confirmBtn){
    let confirmPending = false;
    let confirmTimer   = null;

    function _resetConfirm(){
      confirmPending = false;
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = null;
      confirmBtn.textContent = 'Confirm & create link';
      confirmBtn.classList.remove('is-confirming');
      confirmBtn.disabled = !selectedGender;
    }

    confirmBtn.addEventListener('click', async () => {
      if (!selectedGender) return;

      if (!confirmPending){
        confirmPending = true;
        confirmBtn.textContent = 'Are you sure? Tap again to lock';
        confirmBtn.classList.add('is-confirming');
        confirmTimer = setTimeout(_resetConfirm, 4000);
        return;
      }

      if (confirmTimer) clearTimeout(confirmTimer);
      confirmPending = false;
      confirmBtn.disabled = true;
      confirmBtn.classList.remove('is-confirming');
      confirmBtn.textContent = 'Saving\u2026';

      const customMsg = customInput ? customInput.value.trim() : '';

      try{
        card.language       = selectedLang;
        card.gender         = selectedGender;
        card.custom_message = customMsg || null;
        card.configured     = true;
        card.current_step   = 0;
        card.revealed_steps = [];

        if (previewMode){
          await saveCard(card);
        } else {
          await setConfiguredAndWait(card.token, {
            language:       selectedLang,
            gender:         selectedGender,
            custom_message: customMsg || null,
            configured:     true,
          });
        }

        _renderSeqSetup(root, card, container, { previewMode });
      }catch(e){
        _resetConfirm();
        console.error('Failed to save gender reveal card:', e);
      }
    });
  }
}


// ── Scratch (recipient) ───────────────────────────────────────────────────────

function _renderSeqScratch(root, card){
  const theme      = getCardTheme(card.card_key) || {};
  const totalSteps = (theme.steps || []).length || 2;
  const stepIndex  = typeof card.current_step === 'number' ? card.current_step : 0;

  if (stepIndex >= totalSteps){
    return _renderSeqRevealed(root, card);
  }

  const lang   = card.language || theme.defaultLanguage || 'en';
  const gender = card.gender || 'boy';
  const cfg    = getSeqStepConfig(card.card_key, stepIndex, lang, gender);

  _applySeqStepPageTheme(theme);

  const isFinal = stepIndex === totalSteps - 1;
  const { title, underText, bgDesktopSrc, bgMobileSrc,
          cloudsRight1Src, cloudsRight2Src, cloudsLeftSrc,
          underlayImageSrc, showCustomMessage, accentColor, revealText,
          applyHeartMaskToUnderlay } = cfg;

  const heartFillColor = theme.heartFillColor || '#ede0cc';

  const continueWrapId = isFinal ? 'seqRevealContinueWrap' : 'seqContinueWrap';
  const continueBtnId  = isFinal ? 'seqRevealContinueBtn'  : 'seqContinueBtn';
  const accentBtnStyle = isFinal && accentColor
    ? `style="background:${accentColor};color:#fff;border-color:transparent;"`
    : '';

  root.innerHTML = `
    <div class="msg-card-wrapper seq-card-wrapper" data-presentation="fullscreen">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1"
             data-card-style="gender-reveal" data-presentation="fullscreen">

          <picture class="card-bg seq-card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${bgDesktopSrc}">
            <img src="${bgMobileSrc || bgDesktopSrc}" alt="" draggable="false" loading="eager">
          </picture>

          <div class="msg-card__content">

            <div class="seq-title"
                 style="font-family:${theme.titleFont || 'inherit'};font-weight:${theme.titleWeight || '400'};color:${theme.titleColor || '#5a4a3a'};">
              ${_escHtml(title)}
            </div>

            <div class="seq-heart-area" style="aspect-ratio: ${theme.scratchAspect || '400 / 350'};">

              <div class="seq-heart-bg" style="background:${heartFillColor};"></div>

              ${underlayImageSrc
                ? `<img class="seq-underlay" src="${underlayImageSrc}" alt="" draggable="false"
                        style="${isFinal ? 'opacity:0;transition:opacity 600ms ease;' : 'opacity:1;'}">`
                : ''}

              ${underText
                ? `<div class="seq-under-foil-text"
                        style="font-family:${theme.messageFont || 'inherit'};font-weight:${theme.messageWeight || '400'};color:${theme.messageColor || '#5a4a3a'};">
                     ${_escHtml(underText)}
                   </div>`
                : ''}

              ${isFinal && revealText
                ? `<div id="seqRevealText" style="
                      font-family:'Dancing Script',cursive;
                      font-weight:700;
                      font-size:clamp(3.5rem,18vw,6rem);
                      color:${accentColor || '#445f75'};
                      text-align:center;
                      opacity:0;
                      transition:opacity 800ms ease;
                      position:absolute;
                      inset:0;
                      display:flex;
                      align-items:center;
                      justify-content:center;
                      pointer-events:none;
                      z-index:3;
                   ">${_escHtml(revealText)}</div>`
                : ''}

              <div class="msg-card__scratch-tile seq-scratch-tile" id="seqScratchTile">
                <canvas id="seqScratchCanvas"></canvas>
              </div>

            </div>

            <div class="seq-continue-wrap" id="${continueWrapId}">
              <button class="btn seq-continue-btn" type="button" id="${continueBtnId}"
                      ${accentBtnStyle}>Continue &rarr;</button>
            </div>

          </div>
        </div>
        ${stepIndex === 0 && (cloudsRight1Src || cloudsLeftSrc) ? `
          ${cloudsRight1Src ? `<img class="seq-cloud seq-cloud-right1" src="${cloudsRight1Src}" alt="" aria-hidden="true" draggable="false">` : ''}
          ${cloudsRight2Src ? `<img class="seq-cloud seq-cloud-right2" src="${cloudsRight2Src}" alt="" aria-hidden="true" draggable="false">` : ''}
          ${cloudsLeftSrc  ? `<img class="seq-cloud seq-cloud-left"   src="${cloudsLeftSrc}"  alt="" aria-hidden="true" draggable="false">` : ''}
        ` : ''}
      </div>
    </div>
  `;

  // Force fullscreen breakout via inline style — overrides any cascade issues
  const wrapper = root.querySelector('.seq-card-wrapper');
  if (wrapper) {
    wrapper.style.width = '100vw';
    wrapper.style.maxWidth = '100%';
    wrapper.style.marginTop = '0';
    wrapper.style.marginBottom = '0';
    requestAnimationFrame(() => {
      const left = wrapper.getBoundingClientRect().left + (window.scrollX || 0);
      if (left !== 0) wrapper.style.marginLeft = `-${left}px`;
    });
  }

  const mask        = theme.scratchMask || '/assets/img/masks/heart.svg';
  const tileEl      = root.querySelector('#seqScratchTile');
  const canvas      = root.querySelector('#seqScratchCanvas');
  const underlayEl  = root.querySelector('.seq-underlay');
  const underFoilEl = root.querySelector('.seq-under-foil-text');
  const heartBgEl   = root.querySelector('.seq-heart-bg');

  if (tileEl)    _applyMask(tileEl, mask);
  if (heartBgEl) _applyMask(heartBgEl, mask);
  if (underlayEl && applyHeartMaskToUnderlay) _applyMask(underlayEl, mask);
  if (underFoilEl) _applyMask(underFoilEl, mask);

  _applyFoilOverrides(theme);

  if (!canvas) return;

  attachScratchTile(canvas, {
    onScratched: () => _onSeqStepScratched(root, card, stepIndex, cfg),
    hintStyle: 'thin',
  });
}


async function _onSeqStepScratched(root, card, stepIndex, stepConfig){
  const isFinal = stepIndex === 1;
  const cfg     = stepConfig;

  const tileEl = root.querySelector('#seqScratchTile');

  // 1. Fade foil tile out
  if (tileEl){
    tileEl.style.transition = 'opacity 600ms ease';
    tileEl.style.opacity    = '0';
  }
  setTimeout(() => {
    if (tileEl) tileEl.style.display = 'none';
  }, 650);

  if (!isFinal){
    // ── Step 0 ──
    const continueWrap = root.querySelector('#seqContinueWrap');

    // 2. After 400ms: drift clouds in (CSS transition-delay staggers them: r1→r2→left)
    setTimeout(() => {
      root.querySelectorAll('.seq-cloud').forEach(el => el.classList.add('is-visible'));
    }, 400);

    // 4. After 800ms: show Continue button
    setTimeout(() => {
      if (continueWrap) continueWrap.classList.add('is-visible');
    }, 800);

    // 5. Persist step
    _persistSeqStep(card, 0, 1);

    // Wire Continue
    const continueBtn = root.querySelector('#seqContinueBtn');
    if (continueBtn){
      continueBtn.addEventListener('click', async () => {
        continueBtn.disabled = true;
        await _persistSeqStep(card, 0, 1);
        const wrapper = root.querySelector('.seq-card-wrapper');
        if (wrapper){
          wrapper.style.transition = 'opacity 300ms ease';
          wrapper.style.opacity    = '0';
        }
        setTimeout(() => { _renderSeqScratch(root, card); }, 300);
      });
    }

  } else {
    // ── Step 1 (final) ──
    const continueWrap = root.querySelector('#seqRevealContinueWrap');

    // 2. Fade out under-foil-text (if present)
    const underFoilEl = root.querySelector('.seq-under-foil-text');
    if (underFoilEl){
      underFoilEl.style.transition = 'opacity 400ms ease';
      underFoilEl.style.opacity    = '0';
    }

    // 3. After 500ms: flood page bg + swap card-bg + fade in heart underlay
    setTimeout(() => {
      const bgColor = cfg.floodPageBg || (card.gender === 'girl' ? '#e8c4de' : '#c5d2ea');
      document.documentElement.style.setProperty('--page-bg',  bgColor);
      document.documentElement.style.setProperty('--page-bg1', bgColor);
      document.documentElement.style.background = bgColor;

      const bgPic = root.querySelector('.seq-card-bg');
      if (bgPic && cfg.bgFloodSrc){
        bgPic.style.transition = 'none';
        bgPic.style.opacity    = '0';
        const source = bgPic.querySelector('source');
        const img    = bgPic.querySelector('img');
        if (source) source.srcset = cfg.bgFloodSrc.desktop || '';
        if (img)    img.src       = cfg.bgFloodSrc.mobile  || cfg.bgFloodSrc.desktop || '';
        bgPic.getBoundingClientRect();
        bgPic.style.transition = 'opacity 600ms ease';
        bgPic.style.opacity    = '1';
      }

      const underlayEl = root.querySelector('.seq-underlay');
      if (underlayEl) underlayEl.classList.add('is-revealed');
    }, 500);

    // 4. After 700ms: fade in pre-rendered reveal text
    setTimeout(() => {
      const revealEl = root.querySelector('#seqRevealText');
      if (revealEl) revealEl.style.opacity = '1';
    }, 700);

    // 5. After 900ms: show Continue → button (leads to share screen)
    setTimeout(() => {
      if (continueWrap) continueWrap.classList.add('is-visible');
    }, 900);

    // 6. Persist full reveal
    try{
      await _persistSeqStep(card, stepIndex, stepIndex + 1);
      await setRevealedAndWait(card.token, {});
      card.revealed = true;
    }catch(e){
      console.error('Failed to persist final seq step:', e);
    }

    // Wire Continue → share screen
    const continueBtn = root.querySelector('#seqRevealContinueBtn');
    if (continueBtn){
      continueBtn.addEventListener('click', () => {
        continueBtn.disabled = true;
        const wrapper = root.querySelector('.seq-card-wrapper');
        if (wrapper){
          wrapper.style.transition = 'opacity 300ms ease';
          wrapper.style.opacity    = '0';
        }
        setTimeout(() => { _renderSeqShareScreen(root, card); }, 300);
      });
    }
  }
}


// ── Revealed (returning visitor) ──────────────────────────────────────────────

function _renderSeqRevealed(root, card){
  // All-done state goes directly to the share screen.
  _renderSeqShareScreen(root, card);
}


// ── Share screen (post-reveal destination) ────────────────────────────────────

function _renderSeqShareScreen(root, card){
  const theme  = getCardTheme(card.card_key) || {};
  const lang   = card.language || theme.defaultLanguage || 'en';
  const gender = card.gender || 'boy';

  const step0cfg = getSeqStepConfig(card.card_key, 0, lang, gender);
  const step1cfg = getSeqStepConfig(card.card_key, 1, lang, gender);

  const accentColor = step1cfg.accentColor || (gender === 'girl' ? '#6d3f64' : '#445f75');
  const bgColor     = step1cfg.floodPageBg  || (gender === 'girl' ? '#e8c4de' : '#c5d2ea');
  const revealText  = step1cfg.revealText  || (gender === 'girl' ? 'Girl' : 'Boy');

  // Flood full viewport
  document.documentElement.style.setProperty('--page-bg',  bgColor);
  document.documentElement.style.setProperty('--page-bg1', bgColor);
  document.documentElement.style.background = bgColor;

  const storkSrc = step0cfg.underlayImageSrc || '';

  root.innerHTML = `
    <div class="msg-card-wrapper seq-card-wrapper seq-share-screen" data-presentation="fullscreen">
      <div class="seq-share-stage msg-stage" data-export-root="1"
           data-card-style="gender-reveal" data-presentation="fullscreen"
           style="background:${bgColor};">

        <div class="seq-share__top">
          ${storkSrc
            ? `<img class="seq-share__stork" src="${storkSrc}" alt="" draggable="false">`
            : ''}
        </div>

        <div class="seq-share__divider" style="background:${accentColor};opacity:0.3;"></div>

        <div class="seq-share__bottom">
          <div class="seq-share__reveal-text" style="
            font-family:'Dancing Script',cursive;
            font-weight:700;
            font-size:clamp(3.5rem,18vw,6rem);
            color:${accentColor};
            text-align:center;
          ">${_escHtml(revealText)}</div>
          ${card.custom_message
            ? `<div class="seq-share__custom-msg" style="
                 font-family:'Dancing Script',cursive;
                 color:${accentColor};
               ">${_escHtml(card.custom_message)}</div>`
            : ''}
          <div class="seq-share__branding" style="color:${accentColor};opacity:0.5;">ChicCanto</div>
        </div>

        <div class="seq-continue-wrap is-visible seq-share__actions">
          <button class="btn" type="button" id="seqSaveBtn"
                  style="background:${accentColor};color:#fff;border-color:transparent;border-radius:50px;padding:0.75rem 2rem;">
            Save as image
          </button>
          <button class="btn" type="button" id="seqShareBtn"
                  style="background:${accentColor};color:#fff;border-color:transparent;border-radius:50px;padding:0.75rem 2rem;">
            Share
          </button>
        </div>

      </div>
    </div>
  `;

  root.querySelector('#seqSaveBtn')?.addEventListener('click', () => _exportSeqStacked(card));
  root.querySelector('#seqShareBtn')?.addEventListener('click', () => _seqShare(card));
}


// ── Share helper ──────────────────────────────────────────────────────────────

async function _seqShare(card){
  const url = `${window.location.origin}/open/?token=${card.token}`;
  try{
    if (navigator.share){
      await navigator.share({ url, text: 'Watch our gender reveal! 🎉' });
    } else {
      await copyText(url);
    }
  }catch(_){}
}


// ── JPEG export (1080×1920) — mirrors share screen layout ────────────────────
//
// Stork top half | divider | Boy/Girl text + custom message | branding

async function _exportSeqStacked(card){
  const theme  = getCardTheme(card.card_key) || {};
  const lang   = card.language || theme.defaultLanguage || 'en';
  const gender = card.gender || 'boy';

  const step0cfg = getSeqStepConfig(card.card_key, 0, lang, gender);
  const step1cfg = getSeqStepConfig(card.card_key, 1, lang, gender);

  const accentColor = step1cfg.accentColor || (gender === 'girl' ? '#6d3f64' : '#445f75');
  const bgColor     = step1cfg.floodPageBg  || (gender === 'girl' ? '#e8c4de' : '#c5d2ea');
  const revealText  = step1cfg.revealText  || (gender === 'girl' ? 'Girl' : 'Boy');

  const W          = 1080;
  const H          = 1920;
  const DIVIDER_Y  = Math.round(H * 0.48);
  const DIVIDER_H  = 3;
  const TOP_H      = DIVIDER_Y;
  const BOT_H      = H - DIVIDER_Y - DIVIDER_H - 100; // 100 = branding zone

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  try{ await document.fonts.ready; }catch(_){}

  function _loadImg(src){
    return new Promise(resolve => {
      if (!src){ resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  const storkImg = await _loadImg(step0cfg.underlayImageSrc).catch(() => null);

  // ── Full bleed bg ──
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // ── Stork top ──
  if (storkImg){
    const maxW  = W * 0.70;
    const maxH  = TOP_H * 0.80;
    const scale = Math.min(maxW / (storkImg.naturalWidth  || 1),
                           maxH / (storkImg.naturalHeight || 1));
    const dw = (storkImg.naturalWidth  || 400) * scale;
    const dh = (storkImg.naturalHeight || 350) * scale;
    const dx = (W - dw) / 2;
    const dy = (TOP_H - dh) / 2;
    try{ ctx.drawImage(storkImg, dx, dy, dw, dh); }catch(_){}
  }

  // ── Divider ──
  ctx.globalAlpha = 0.30;
  ctx.fillStyle   = accentColor;
  ctx.fillRect(W * 0.10, DIVIDER_Y, W * 0.80, DIVIDER_H);
  ctx.globalAlpha = 1;

  // ── Gender text ──
  const font   = 'Dancing Script, cursive';
  const hasMsg = !!card.custom_message;
  ctx.fillStyle    = accentColor;
  ctx.font         = `700 160px ${font}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  const textY = DIVIDER_Y + DIVIDER_H + (hasMsg ? BOT_H * 0.35 : BOT_H * 0.48);
  try{ ctx.fillText(revealText, W / 2, textY); }catch(_){}

  // ── Custom message ──
  if (hasMsg){
    ctx.font  = `400 64px ${font}`;
    const msgY = DIVIDER_Y + DIVIDER_H + BOT_H * 0.65;
    try{ ctx.fillText(card.custom_message, W / 2, msgY); }catch(_){}
  }

  // ── Branding ──
  ctx.globalAlpha = 0.50;
  ctx.font         = '400 32px Inter, system-ui, sans-serif';
  ctx.fillStyle    = accentColor;
  ctx.fillText('ChicCanto', W / 2, H - 50);
  ctx.globalAlpha = 1;

  // ── Download ──
  try{
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href     = dataUrl;
    a.download = 'gender-reveal.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }catch(e){
    console.error('Export failed:', e);
    alert('Export failed. Please try again.');
  }
}
