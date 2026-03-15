// /public/assets/js/game-message.js
// Message-reveal game type: single scratch area hides a text message.
// Sender configures a visible title and hidden message. Recipient scratches to reveal.

import { attachScratchTile } from './scratch.js';
import { getCardTheme } from './card-themes.js';
import { getCard, saveCard, setConfiguredAndWait, setRevealedAndWait } from './store.js';
import { copyText } from './utils.js';

// ─── Setup (sender view) ────────────────────────────────────────────

export function renderMessageSetup(root, card, container, { previewMode = false } = {}){
  const theme = getCardTheme(card.card_key) || {};
  const maxMsg = theme.messageMaxLength || 200;
  const maxTitle = theme.titleMaxLength || 92;
  const msgPlaceholder = theme.messagePlaceholder || 'Type your hidden message...';
  const titlePlaceholder = theme.titlePlaceholder || 'Your title here...';

  // Pre-fill from card record if returning to setup
  const existingTitle = card.visible_title || '';
  const existingMsg = card.message || '';
  const isConfigured = !!card.configured;

  root.innerHTML = `
    <section class="flow-screen msg-setup">
      <div class="msg-setup__card">
        <div class="msg-card" data-card-key="${card.card_key || ''}">
          <picture class="card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${theme.bgDesktopSrc || ''}">
            <img src="${theme.bgMobileSrc || theme.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
          </picture>
          <div class="msg-card__content">
            <div class="msg-card__title-preview" data-empty-label="${titlePlaceholder}"></div>
            <div class="msg-card__heart-area">
              <div class="msg-card__heart-foil"></div>
              <div class="msg-card__heart-message" data-empty-label="${msgPlaceholder}"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="msg-setup__controls panel panel--glass panel--padded">
        <div class="msg-setup__field">
          <div class="msg-setup__field-header">
            <label for="msgTitle">Your Title:</label>
            <span class="msg-setup__counter"><span id="titleCount">${maxTitle - existingTitle.length}</span> characters available</span>
          </div>
          <input type="text" id="msgTitle" class="msg-setup__input" maxlength="${maxTitle}" placeholder="${titlePlaceholder}" value="${_escHtml(existingTitle)}" ${isConfigured ? 'disabled' : ''}>
        </div>

        <div class="msg-setup__field">
          <div class="msg-setup__field-header">
            <label for="msgText">Text for under the scratch field:</label>
            <span class="msg-setup__counter"><span id="msgCount">${maxMsg - existingMsg.length}</span> characters available</span>
          </div>
          <textarea id="msgText" class="msg-setup__textarea" maxlength="${maxMsg}" placeholder="${msgPlaceholder}" rows="3" ${isConfigured ? 'disabled' : ''}>${_escHtml(existingMsg)}</textarea>
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
            <button class="btn primary" type="button" data-action="confirm" disabled>Confirm &amp; create link</button>
          </div>
          <p class="msg-setup__hint muted">You can preview your card above. Once confirmed, the message cannot be changed.</p>
        `}
      </div>
    </section>
  `;

  // --- Live preview ---
  const titleInput = root.querySelector('#msgTitle');
  const msgInput = root.querySelector('#msgText');
  const titlePreview = root.querySelector('.msg-card__title-preview');
  const msgPreview = root.querySelector('.msg-card__heart-message');
  const titleCounter = root.querySelector('#titleCount');
  const msgCounter = root.querySelector('#msgCount');
  const confirmBtn = root.querySelector('[data-action="confirm"]');

  // Load heart mask as foil background
  const foilEl = root.querySelector('.msg-card__heart-foil');
  if (foilEl && theme.scratchMask){
    foilEl.style.maskImage = `url('${theme.scratchMask}')`;
    foilEl.style.webkitMaskImage = `url('${theme.scratchMask}')`;
  }

  function updatePreview(){
    const title = titleInput ? titleInput.value : '';
    const msg = msgInput ? msgInput.value : '';

    if (titlePreview){
      titlePreview.textContent = title || '';
      titlePreview.classList.toggle('is-empty', !title);
    }
    if (msgPreview){
      msgPreview.textContent = msg || '';
      msgPreview.classList.toggle('is-empty', !msg);
    }
    if (titleCounter) titleCounter.textContent = String(maxTitle - title.length);
    if (msgCounter) msgCounter.textContent = String(maxMsg - msg.length);

    // Enable confirm only when message is filled
    if (confirmBtn){
      confirmBtn.disabled = !msg.trim();
    }
  }

  if (titleInput) titleInput.addEventListener('input', updatePreview);
  if (msgInput) msgInput.addEventListener('input', updatePreview);
  updatePreview();

  // --- Confirm ---
  if (confirmBtn){
    confirmBtn.addEventListener('click', async () => {
      const title = (titleInput ? titleInput.value : '').trim();
      const msg = (msgInput ? msgInput.value : '').trim();

      if (!msg){
        if (msgInput) msgInput.focus();
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving...';

      try{
        card.visible_title = title || null;
        card.message = msg;
        card.configured = true;

        if (previewMode){
          await saveCard(card);
        } else {
          await setConfiguredAndWait(card.token, {
            visible_title: card.visible_title,
            message: card.message,
            configured: true,
          });
        }

        // Re-render to show share state
        renderMessageSetup(root, card, container, { previewMode });
      } catch(e){
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & create link';
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
  const message = card.message || '';
  const visibleTitle = card.visible_title || '';

  root.innerHTML = `
    <div class="msg-card-wrapper">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1">
          <picture class="card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${theme.bgDesktopSrc || ''}">
            <img src="${theme.bgMobileSrc || theme.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
          </picture>
          <div class="msg-card__content">
            ${visibleTitle ? `<div class="msg-card__visible-title">${_escHtml(visibleTitle)}</div>` : ''}
            <div class="msg-card__scratch-area">
              <div class="msg-card__under-message">${_escHtml(message)}</div>
              <div class="msg-card__scratch-tile" id="msgScratchTile">
                <canvas id="msgScratchCanvas"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Set up the scratch canvas with heart mask
  const tileEl = root.querySelector('#msgScratchTile');
  const canvas = root.querySelector('#msgScratchCanvas');

  if (!tileEl || !canvas) return;

  // Apply heart mask shape to the scratch tile
  if (theme.scratchMask){
    tileEl.style.maskImage = `url('${theme.scratchMask}')`;
    tileEl.style.webkitMaskImage = `url('${theme.scratchMask}')`;
    // Also mask the message underneath to match the shape
    const underMsg = root.querySelector('.msg-card__under-message');
    if (underMsg){
      underMsg.style.maskImage = `url('${theme.scratchMask}')`;
      underMsg.style.webkitMaskImage = `url('${theme.scratchMask}')`;
    }
  }

  // Style the message text from theme
  const msgEl = root.querySelector('.msg-card__under-message');
  if (msgEl && theme.messageColor) msgEl.style.color = theme.messageColor;
  if (msgEl && theme.messageFontSize) msgEl.style.fontSize = theme.messageFontSize;

  // Set foil style (gold/silver) from theme
  if (theme.foil){
    document.documentElement.dataset.foil = theme.foil;
  }

  // Attach the scratch interaction
  const ctrl = attachScratchTile(canvas, {
    onScratched: () => {
      _onScratchComplete(root, card, theme);
    }
  });
}


async function _onScratchComplete(root, card, theme){
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
  const theme = getCardTheme(card.card_key) || {};
  const message = card.message || '';
  const visibleTitle = card.visible_title || '';

  root.innerHTML = `
    <div class="msg-card-wrapper">
      <div class="scratch-fx">
        <div class="scratch-stage msg-stage" data-export-root="1">
          <picture class="card-bg" aria-hidden="true">
            <source media="(min-width: 700px)" srcset="${theme.bgDesktopSrc || ''}">
            <img src="${theme.bgMobileSrc || theme.bgDesktopSrc || ''}" alt="" draggable="false" loading="eager">
          </picture>
          <div class="msg-card__content">
            ${visibleTitle ? `<div class="msg-card__visible-title">${_escHtml(visibleTitle)}</div>` : ''}
            <div class="msg-card__scratch-area">
              <div class="msg-card__under-message is-revealed">${_escHtml(message)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Style message from theme
  const msgEl = root.querySelector('.msg-card__under-message');
  if (msgEl && theme.messageColor) msgEl.style.color = theme.messageColor;
  if (msgEl && theme.messageFontSize) msgEl.style.fontSize = theme.messageFontSize;
}


// ─── Helpers ─────────────────────────────────────────────────────────

function _escHtml(str){
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}