function byId(id){
  return document.getElementById(id);
}

function setStatus(text, isError = false){
  const el = byId('status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff6b6b' : '';
}

async function copyText(text){
  // Clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  // Fallback
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function assign(){
  const key = String(byId('fulfillKey')?.value || '').trim();
  const order_id = String(byId('orderId')?.value || '').trim();
  const sku = String(byId('sku')?.value || '').trim();
  const buyer_name = String(byId('buyerName')?.value || '').trim();

  if (!key){
    setStatus('Missing fulfillment password.', true);
    return;
  }
  if (!order_id){
    setStatus('Missing Etsy order number.', true);
    return;
  }
  if (!sku){
    setStatus('Missing product selection.', true);
    return;
  }

  const btn = byId('assignBtn');
  if (btn) btn.disabled = true;
  setStatus('Assigning…');

  try{
    const res = await fetch('/assign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FULFILL-KEY': key,
      },
      body: JSON.stringify({ order_id, sku, buyer_name }),
    });

    let data = null;
    try{ data = await res.json(); } catch { data = null; }

if (!res.ok || !data || !data.ok){
  const msg = (data && (data.error || data.message)) || `Failed (HTTP ${res.status})`;

  // clear stale UI so we never show an old code/message on failure
  const messageEl = byId('message');
  const codeEl = byId('assignedCode');
  const copyBtn = byId('copyBtn');
  if (messageEl) messageEl.value = '';
  if (codeEl) codeEl.value = '';
  if (copyBtn) copyBtn.disabled = true;

  setStatus(msg, true);
  return;
}


    byId('message').value = String(data.message_text || '');
    byId('assignedCode').value = String(data.code || '');
    const copyBtn = byId('copyBtn');
    if (copyBtn) copyBtn.disabled = !String(data.message_text || '').length;

    setStatus(data.existing ? 'Order already assigned. Returned the existing code.' : 'Assigned. Copy the message and send it in Etsy.');
  } catch (e){
    setStatus(e && e.message ? e.message : 'Request failed.', true);
  } finally{
    if (btn) btn.disabled = false;
  }
}

export function bootFulfill(){
  const btn = byId('assignBtn');
  const copyBtn = byId('copyBtn');
  if (!btn) return;

  btn.addEventListener('click', assign);

  // Enter submits
  const order = byId('orderId');
  if (order){
    order.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){
        e.preventDefault();
        assign();
      }
    });
  }

  if (copyBtn){
    copyBtn.addEventListener('click', async () => {
      const text = String(byId('message')?.value || '');
      if (!text) return;
      const ok = await copyText(text);
      setStatus(ok ? 'Copied.' : 'Copy failed. Select and copy manually.', !ok);
    });
  }

  setStatus('Ready.');
}
