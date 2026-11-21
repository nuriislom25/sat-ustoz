// The session is an HttpOnly cookie set by the server (scripts can't read it). The browser only keeps a "signed in"
// flag. A token saved by an older version of the app is moved into the cookie once and then removed.
const TOKEN_KEY = 'token';
const FLAG = 'signed-in';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
/** The old saved token (only until it is moved into the cookie). */
export const legacyToken = () => ls.get(TOKEN_KEY);
/** Truthy while this browser has a session (the cookie itself is invisible to scripts). */
export const getToken = () => ls.get(FLAG) || ls.get(TOKEN_KEY);
export const setToken = (t) => {
  if (t) { ls.set(FLAG, '1'); ls.set(TOKEN_KEY, null); return; }
  const had = getToken();
  ls.set(FLAG, null); ls.set(TOKEN_KEY, null);
  if (had) fetch('/api/auth/logout', { method: 'POST', headers: { 'X-SU': '1' }, credentials: 'same-origin' }).catch(() => {});
};
/** Headers for a fetch() to our API outside api.* (downloads, files). */
export const authHeaders = (extra = {}) => { const t = legacyToken(); return { 'X-SU': '1', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra }; };
/** Move an older saved token into the session cookie (once, on start). */
export async function upgradeSession() {
  const t = legacyToken();
  if (!t) return;
  try { const r = await fetch('/api/me/session-cookie', { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'X-SU': '1' }, credentials: 'same-origin' }); if (r.ok) setToken('cookie'); } catch { /* try again next time */ }
}

async function request(method, url, body, isForm) {
  const headers = authHeaders();
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('/api' + url, { method, headers, credentials: 'same-origin', body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch {
    throw Object.assign(new Error("Network error. Check your internet connection."), { offline: true });
  }
  if (res.status === 401 && !url.startsWith('/auth/')) {
    ls.set(FLAG, null); ls.set(TOKEN_KEY, null);
    window.dispatchEvent(new Event('auth:logout'));
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  // the free daily limit was reached (any test, any page): the app shows one wall for it
  if (res.status === 402 && data?.code === 'daily_limit') window.dispatchEvent(new CustomEvent('limit:daily', { detail: data }));
  if (!res.ok) throw Object.assign(new Error(data?.error ? data.error : "Something went wrong"), { status: res.status, data });
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  del: (u) => request('DELETE', u),
  upload: (u, form) => request('POST', u, form, true),
  async download(u, filename) {
    const res = await fetch('/api' + u, { headers: authHeaders(), credentials: 'same-origin' });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

export const fmtDate = (iso, opts) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
};
export const fmtDuration = (s) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
};
export const daysUntil = (iso) => (iso ? Math.ceil((new Date(iso + 'T00:00:00') - new Date()) / 86400e3) : null);
