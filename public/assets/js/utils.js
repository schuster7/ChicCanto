export function qs(sel, root=document){ return root.querySelector(sel); }
export function qsa(sel, root=document){ return [...root.querySelectorAll(sel)]; }

export function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch{
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try{
      document.execCommand('copy');
      return true;
    }catch{
      return false;
    }finally{
      ta.remove();
    }
  }
}

export function formatIso(ts){
  try{
    return new Date(ts).toLocaleString();
  }catch{
    return ts || '';
  }
}

export function getTokenFromUrl(){
  // Supports:
  // - /card/<token>
  // - /card/index.html?token=<token>
  const path = window.location.pathname;
  const m = path.match(/\/card\/(.+)$/);
  if (m && m[1] && m[1] !== 'index.html') return decodeURIComponent(m[1]);
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}

export function makeTokenFromString(input){
  // deterministic short token for demo purposes
  const enc = new TextEncoder().encode(String(input).trim().toLowerCase());
  // simple hash
  let h1 = 0x811c9dc5;
  for (const b of enc){
    h1 ^= b;
    h1 = (h1 * 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8,'0') + '-' + Math.abs(String(input).length * 1337).toString(16);
}
