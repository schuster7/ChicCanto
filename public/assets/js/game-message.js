// /public/assets/js/game-message.js
// Message-reveal game type: single scratch area hides a text message.
// Sender configures a visible title and hidden message. Recipient scratches to reveal.
// v2: style picker, shape picker, "From" sign-off, dark-luxury border ring.

import { attachScratchTile } from './scratch.js';
import { getCardTheme, getResolvedMsgTheme } from './card-themes.js';
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
  const maxMsg = baseTheme.messageMaxLength || 200;
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
  const existingShape = card.scratch_shape || baseTheme.defaultShape || 'heart';
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
    const cardInner = previewCardWrap.querySelector('.msg-card');
    if (cardInner) cardInner.addEventListener('click', (e) => e.stopPropagation());
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
    }
    if (fromPreview){
      fromPreview.textContent = from ? `${from}` : '';
      fromPreview.classList.toggle('is-hidden', !from);
    }
    if (titleCounter) titleCounter.textContent = String(maxTitle - title.length);
    if (msgCounter) msgCounter.textContent = String(maxMsg - msg.length);
    if (fromCounter) fromCounter.textContent = String(maxFrom - from.length);

    // Enable confirm only when message is filled
    if (confirmBtn){
      confirmBtn.disabled = !msg.trim();
    }
  }

  if (titleInput) titleInput.addEventListener('input', updatePreview);
  if (msgInput) msgInput.addEventListener('input', updatePreview);
  if (fromInput) fromInput.addEventListener('input', updatePreview);
  updatePreview();

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
  const resolved = getResolvedMsgTheme(card.card_key, card.card_style, card.scratch_shape) || {};
  const message = card.message || '';
  const visibleTitle = card.visible_title || '';
  const fromLine = card.from_line || '';

  // Apply foil overrides for this style
  _clearFoilOverrides();
  _applyFoilOverrides(resolved);

  root.innerHTML = `
    <div class="msg-card-wrapper" data-presentation="${resolved.presentation || 'fullscreen'}">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1" data-card-style="${card.card_style || ''}" data-presentation="${resolved.presentation || 'fullscreen'}">
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


// ─── Revealed (returning visitor) ────────────────────────────────────

export function renderMessageRevealed(root, card){
  const resolved = getResolvedMsgTheme(card.card_key, card.card_style, card.scratch_shape) || {};
  const message = card.message || '';
  const visibleTitle = card.visible_title || '';
  const fromLine = card.from_line || '';

  // Apply foil overrides (not strictly needed for revealed but keeps page theme consistent)
  _clearFoilOverrides();
  _applyFoilOverrides(resolved);

  root.innerHTML = `
    <div class="msg-card-wrapper" data-presentation="${resolved.presentation || 'fullscreen'}">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1" data-card-style="${card.card_style || ''}" data-presentation="${resolved.presentation || 'fullscreen'}">
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
  }
}
