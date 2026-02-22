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

async function assign(){
  const btn = byId('assignBtn');
  if (btn) btn.disabled = true;

  try{
    // Must have a valid session cookie
    const authed = await isAuthenticated();
    if (!authed){
      goLogin();
      return;
    }

    const order_id = String(byId('orderId')?.value || '').trim();
    const card_key = String(byId('cardKey')?.value || '').trim();
    const quantity = String(byId('quantity')?.value || '1').trim();
    const buyer_name = String(byId('buyerName')?.value || '').trim() || null;

    if (!order_id){
      setStatus('Enter an Etsy order number.', true);
      return;
    }
    if (!card_key){
      setStatus('Select a card type.', true);
      return;
    }

    setStatus('Assigning...');
    setAssigned('');
    setMessage('');

    const res = await fetch('/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ order_id, card_key, quantity, buyer_name }),
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
    setStatus('Assigned.');
  }catch(err){
    setStatus(String(err?.message || err || 'Error'), true);
  }finally{
    if (btn) btn.disabled = false;
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
  const btn = byId('assignBtn');
  const copyBtn = byId('copyBtn');
  const logoutBtn = byId('logoutBtn');
  if (!btn) return;

  // Gate the page on load
  isAuthenticated()
    .then((authed) => {
      if (!authed) goLogin();
    })
    .catch(() => goLogin());

  btn.addEventListener('click', (e) => { e.preventDefault(); assign(); });
  if (copyBtn) copyBtn.addEventListener('click', (e) => { e.preventDefault(); copyMessage(); });
  if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); logout(); });

  setStatus('Ready.');
}
