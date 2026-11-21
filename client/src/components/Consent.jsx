import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfig } from '../config.js';

/**
 * Cookies: the sign-in cookie is always on (the site can't keep you signed in without it). With "Accept all" the site
 * also remembers this browser for the visitor count and shows the Trustpilot widget (Trustpilot sets its own cookies).
 * The choice is kept in this browser; "Cookie settings" in the footer opens it again.
 */
const KEY = 'consent-v1';
export function readConsent() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export const analyticsAllowed = () => !!readConsent()?.analytics;
function save(analytics) {
  try { localStorage.setItem(KEY, JSON.stringify({ analytics, at: new Date().toISOString() })); } catch { /* storage blocked */ }
  if (!analytics) { try { localStorage.removeItem('vid'); } catch { /* ignore */ } }
  window.dispatchEvent(new Event('consent:change'));
}
export const openCookieSettings = () => window.dispatchEvent(new Event('consent:open'));

export function useConsent() {
  const [c, setC] = useState(readConsent);
  useEffect(() => { const f = () => setC(readConsent()); window.addEventListener('consent:change', f); return () => window.removeEventListener('consent:change', f); }, []);
  return c;
}

export default function CookieBanner() {
  const [open, setOpen] = useState(() => !readConsent() && !navigator.webdriver);
  useEffect(() => { const f = () => setOpen(true); window.addEventListener('consent:open', f); return () => window.removeEventListener('consent:open', f); }, []);
  if (!open) return null;
  const pick = (a) => { save(a); setOpen(false); };
  return (
    <section className="ck" role="dialog" aria-label="Cookies" aria-live="polite">
      <p><b>Cookies on SAT Ustoz.</b> One cookie keeps you signed in. With your OK we also count visits and show reviews from Trustpilot. <Link to="/cookies">Cookie policy</Link></p>
      <div className="ck-btns">
        <button className="btn ghost sm" onClick={() => pick(false)}>Only necessary</button>
        <button className="btn primary sm" onClick={() => pick(true)}>Accept all</button>
      </div>
    </section>
  );
}

/* ---------------- Trustpilot ---------------- */
const TP_SCRIPT = 'https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js';
const MICRO_COMBO = '5419b6ffb0d04a076446a9af';
function loadTp() {
  if (window.Trustpilot) return Promise.resolve();
  if (!loadTp.p) loadTp.p = new Promise((ok, no) => { const s = document.createElement('script'); s.src = TP_SCRIPT; s.async = true; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  return loadTp.p;
}

/** Reviews on Trustpilot: the live widget after "Accept all", otherwise a plain link to the review page. */
export function Trustpilot({ variant = 'strip' }) {
  const consent = useConsent();
  const [tp, setTp] = useState(null);
  const ref = useRef(null);
  useEffect(() => { getConfig().then((c) => setTp(c?.trustpilot || null)); }, []);
  const live = !!(consent?.analytics && tp?.bu);
  useEffect(() => {
    if (!live || !ref.current) return;
    loadTp().then(() => window.Trustpilot?.loadFromElement(ref.current, true)).catch(() => {});
  }, [live]);
  if (!tp?.url && !tp?.bu) return null;
  const url = tp.url || 'https://www.trustpilot.com';
  const dark = document.documentElement.dataset.theme === 'dark';
  return (
    <div className={`tp tp-${variant}`}>
      {live ? (
        <div ref={ref} className="trustpilot-widget" data-locale="en-US" data-template-id={tp.template || MICRO_COMBO} data-businessunit-id={tp.bu}
          data-style-height="24px" data-style-width="100%" data-theme={dark ? 'dark' : 'light'}>
          <a href={url} target="_blank" rel="noopener noreferrer">Trustpilot</a>
        </div>
      ) : (
        <a className="tp-link" href={url} target="_blank" rel="noopener noreferrer">
          <TpStar /> <span>See what students say on <b>Trustpilot</b></span>
        </a>
      )}
      {variant === 'strip' && <a className="tp-write" href={url.replace(/\/?$/, '')} target="_blank" rel="noopener noreferrer">Write a review</a>}
    </div>
  );
}
const TpStar = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#00B67A" d="M12 1.5 14.9 9h7.9l-6.4 4.7 2.4 7.8L12 16.6l-6.8 4.9 2.4-7.8L1.2 9h7.9z" /></svg>;

/** /cookies — what the site keeps in the browser, in plain words. */
export function CookiePolicy() {
  const c = useConsent();
  return (
    <div className="pub-wrap ck-page">
      <h1 className="pub-h2" style={{ textAlign: 'left' }}>Cookie policy</h1>
      <p>SAT Ustoz (ustozsat.uz) keeps a few small things in your browser. Here is each one and why.</p>
      <h2>Always on</h2>
      <ul>
        <li><b>su_sess</b> (cookie): keeps you signed in. Only our server can read it. It ends when you log out, after 30 days (14 days for teacher accounts), or when you press “Sign out everywhere”.</li>
        <li><b>signed-in, theme, consent-v1</b> (browser storage): remember that you are signed in, light or dark mode, and your cookie choice.</li>
        <li>Progress you save inside a test (answers, timer) so a reload does not lose it.</li>
      </ul>
      <h2>Only with “Accept all”</h2>
      <ul>
        <li><b>vid</b> (browser storage): a random number so one visitor counts once a day in our visitor statistics. It does not contain your name or contact details.</li>
        <li><b>Trustpilot</b>: the review widget is loaded from trustpilot.com, which may set its own cookies. See Trustpilot’s privacy policy.</li>
      </ul>
      <p>We do not use advertising cookies and we do not sell data.</p>
      <p>Your choice now: <b>{c ? (c.analytics ? 'Accept all' : 'Only necessary') : 'not chosen yet'}</b>. <button className="btn soft sm" onClick={openCookieSettings}>Change</button></p>
    </div>
  );
}
