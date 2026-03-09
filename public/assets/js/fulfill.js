// Fulfillment page logic
// This page is now protected by a server-issued session cookie (httpOnly).
// If not authenticated, we redirect to /fulfill/login/.

function byId(id){ return document.getElementById(id); }

function setStatus(msg, isErr=false){
  const el = byId('status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? '#ff6961' : '#c7f0c2';
}

function setAssigned(code){
  const el = byId('assignedCode');
  if (!el) return;
  el.value = code || '';
}

function setMessage(msg){
  const el = byId('message');
  if (!el) return;
  el.value = msg || '';

  const copyBtn = byId('copyBtn');
  if (copyBtn) copyBtn.disabled = !(msg && String(msg).trim().length);
}

function syncCustomSelectUI(selectId){
  const sel = byId(selectId);
  if (!sel) return;

  const root = document.querySelector(`.cselect[data-select="#${selectId}"]`);
  if (!root) return;

  const valEl = root.querySelector('.cselect__value');
  const menu = root.querySelector('.cselect__menu');
  const placeholder = root.dataset.placeholder || 'Select…';
  const required = root.dataset.require === 'true';

  if (valEl){
    if (required && !sel.value){
      valEl.textContent = placeholder;
      root.classList.add('is-empty');
    } else {
      const selected = sel.options[sel.selectedIndex];
      valEl.textContent = selected ? selected.textContent : placeholder;
      root.classList.toggle('is-empty', !sel.value);
    }
  }

  if (menu){
    Array.from(menu.querySelectorAll('.cselect__opt')).forEach((n) => {
      n.setAttribute('aria-selected', n.dataset.value === sel.value ? 'true' : 'false');
    });
  }
}

function resetSelect(selectId){
  const sel = byId(selectId);
  if (!sel) return;
  sel.value = '';
  syncCustomSelectUI(selectId);
}

function resetFulfillSelections(){
  resetSelect('cardKey');
  resetSelect('quantity');
}

function hideAssignConfirmation(){
  const box = byId('assignConfirm');
  if (!box) return;
  box.hidden = true;
}

function showAssignConfirmation(summary){
  const box = byId('assignConfirm');
  if (!box) return;

  const orderEl = byId('confirmOrderId');
  const cardEl = byId('confirmCard');
  const qtyEl = byId('confirmQuantity');
  const buyerEl = byId('confirmBuyerName');

  if (orderEl) orderEl.textContent = summary.order_id;
  if (cardEl) cardEl.textContent = summary.card_label;
  if (qtyEl) qtyEl.textContent = summary.quantity_label;
  if (buyerEl) buyerEl.textContent = summary.buyer_name || 'Optional - not set';

  box.hidden = false;
}

function getSelectedOptionText(selectId){
  const sel = byId(selectId);
  if (!sel) return '';
  const selected = sel.options[sel.selectedIndex];
  return selected ? String(selected.textContent || '').trim() : '';
}

function collectAssignmentInput(){
  const order_id = String(byId('orderId')?.value || '').trim();
  const card_key = String(byId('cardKey')?.value || '').trim();
  const quantity = String(byId('quantity')?.value || '').trim();
  const buyer_name = String(byId('buyerName')?.value || '').trim() || null;

  if (!order_id){
    setStatus('Enter an Etsy order number.', true);
    hideAssignConfirmation();
    return null;
  }
  if (!card_key){
    setStatus('Select a card type.', true);
    hideAssignConfirmation();
    return null;
  }
  if (!quantity){
    setStatus('Select a quantity.', true);
    hideAssignConfirmation();
    return null;
  }

  return {
    order_id,
    card_key,
    quantity,
    buyer_name,
    card_label: getSelectedOptionText('cardKey') || card_key,
    quantity_label: getSelectedOptionText('quantity') || quantity,
  };
}

async function isAuthenticated(){
  const r = await fetch('/auth', { method: 'GET', credentials: 'include' });
  const j = await r.json().catch(() => ({}));
  return !!(r.ok && j && j.ok && j.authenticated);
}

function goLogin(){
  // Preserve where we came from
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/fulfill/login/?next=${next}`;
}

async function logout(){
  try{
    await fetch('/auth', { method: 'DELETE', credentials: 'include' });
  }catch(_){
    // ignore
  }
  window.location.href = '/fulfill/login/';
}

function beginAssign(){
  const payload = collectAssignmentInput();
  if (!payload) return;
  showAssignConfirmation(payload);
  setStatus('Confirm assignment.');
}

async function confirmAssign(){
  const btn = byId('confirmAssignBtn');
  const startBtn = byId('assignBtn');
  if (btn) btn.disabled = true;
  if (startBtn) startBtn.disabled = true;

  try{
    // Must have a valid session cookie
    const authed = await isAuthenticated();
    if (!authed){
      goLogin();
      return;
    }

    const payload = collectAssignmentInput();
    if (!payload) return;

    setStatus('Assigning...');
    setAssigned('');
    setMessage('');

    const res = await fetch('/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        order_id: payload.order_id,
        card_key: payload.card_key,
        quantity: payload.quantity,
        buyer_name: payload.buyer_name,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401){
      goLogin();
      return;
    }

    if (!res.ok || !data.ok){
      throw new Error(data.error || 'Request failed.');
    }

    const codes = Array.isArray(data.codes) ? data.codes : (data.code ? [data.code] : []);
    setAssigned(codes.join('\n'));
    setMessage(data.etsy_message || '');

    if (data.existing && data.assignment_conflict){
      setStatus(`Order already had code(s) assigned for ${data.card_key || 'another card type'}. Returned existing code(s).`, true);
    } else if (data.existing){
      setStatus('Order already assigned. Returned existing code(s).');
    } else {
      setStatus('Assigned.');
    }

    hideAssignConfirmation();
    resetFulfillSelections();
  }catch(err){
    setStatus(String(err?.message || err || 'Error'), true);
  }finally{
    if (btn) btn.disabled = false;
    if (startBtn) startBtn.disabled = false;
  }
}

async function copyMessage(){
  const txt = byId('message')?.value || '';
  if (!txt) return;
  try{
    await navigator.clipboard.writeText(txt);
    setStatus('Copied.');
  }catch(_){
    setStatus('Copy failed. Select text and copy manually.', true);
  }
}

export function bootFulfill(){
  // IMPORTANT: do not run the fulfill gate/redirect logic on the login page.
  // The login page has its own JS bundle and should never redirect to itself.
  if (window.location.pathname.startsWith('/fulfill/login')) return;

  const btn = byId('assignBtn');
  const confirmBtn = byId('confirmAssignBtn');
  const cancelBtn = byId('cancelAssignBtn');
  const copyBtn = byId('copyBtn');
  const logoutBtn = byId('logoutBtn');
  if (!btn) return;

  // Gate the page on load
  isAuthenticated()
    .then((authed) => {
      if (!authed) goLogin();
    })
    .catch(() => goLogin());

  btn.addEventListener('click', (e) => { e.preventDefault(); beginAssign(); });
  if (confirmBtn) confirmBtn.addEventListener('click', (e) => { e.preventDefault(); confirmAssign(); });
  if (cancelBtn) cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    hideAssignConfirmation();
    setStatus('Confirmation canceled.');
  });
  if (copyBtn) copyBtn.addEventListener('click', (e) => { e.preventDefault(); copyMessage(); });
  if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); logout(); });

  ['orderId', 'cardKey', 'quantity', 'buyerName'].forEach((id) => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('input', hideAssignConfirmation);
    el.addEventListener('change', hideAssignConfirmation);
  });

  hideAssignConfirmation();
  setStatus('Ready.');
}
