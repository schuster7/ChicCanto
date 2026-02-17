function byId(id){ return document.getElementById(id); }

function setStatus(msg, isErr=false){
  const el = byId('status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? '#ff6961' : '#c7f0c2';
}

function getNext(){
  const url = new URL(window.location.href);
  const next = url.searchParams.get('next');
  return next && next.startsWith('/') ? next : '/fulfill/';
}

async function alreadyAuthed(){
  const r = await fetch('/auth', { method:'GET', credentials:'include' });
  const j = await r.json().catch(() => ({}));
  return !!(r.ok && j && j.ok && j.authenticated);
}

async function login(key){
  const r = await fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password: key })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || 'Wrong password.');
}

export async function boot(){
  try{
    if (await alreadyAuthed()){
      window.location.href = getNext();
      return;
    }
  }catch(_){ /* ignore */ }

  const form = byId('loginForm');
  const btn = byId('loginBtn');
  const keyEl = byId('key');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = String(keyEl?.value || '').trim();
    if (!key){ setStatus('Enter the password.', true); return; }

    try{
      if (btn) btn.disabled = true;
      setStatus('Signing in...');
      await login(key);
      setStatus('Signed in.');
      window.location.href = getNext();
    }catch(err){
      setStatus(String(err?.message || err || 'Error'), true);
    }finally{
      if (btn) btn.disabled = false;
    }
  });
}

boot();
