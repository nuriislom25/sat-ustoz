import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth, useToast } from './context.jsx';
import { IconBook, IconMath, IconLock, IconCrown, IconArrow } from './components/icons.jsx';
import { Link } from 'react-router-dom';

/** The subject a student is working in: 'english' or 'math'. Teachers always see everything. */
export const subjectOf = (user) => (user?.role === 'student' && user.subject === 'math' ? 'math' : 'english');
export const useSubject = () => subjectOf(useAuth().user);
/** Teacher panel: which subject's content the teacher is managing (kept on the account like a student's). */
export const panelSubject = (user) => (user?.subject === 'math' ? 'math' : 'english');
const current = (user) => (user?.role === 'master' ? panelSubject(user) : subjectOf(user));

// pages that exist only in one subject: switching sends the student to the matching place
const ENGLISH_ONLY = ['/vocab', '/game', '/live', '/saved', '/lesson', '/placement'];
const MATH_ONLY = ['/math'];

/** Switch the whole platform between English and Math (saved on the account, so it stays on every device). */
export function useSwitchSubject() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const go = async (subject) => {
    if (busy || current(user) === subject) return;
    setBusy(true);
    try {
      await api.put('/me/subject', { subject });
      await refresh();
      const p = loc.pathname;
      if (user.role === 'master') { const p0 = loc.pathname; if (/^\/(vocab|game|quality|math)(\/|$)/.test(p0) || /^\/(quizzes|roadmap)\/./.test(p0)) nav('/'); setBusy(false); return; }
      const away = (subject === 'math' ? ENGLISH_ONLY : MATH_ONLY).some((x) => p === x || p.startsWith(`${x}/`)) || /^\/roadmap\/lesson/.test(p) || /^\/(quiz|result|mock)\//.test(p);
      if (away) nav('/');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return [go, busy];
}

export function SubjectSwitch({ compact = false }) {
  const { user } = useAuth();
  const [go, busy] = useSwitchSubject();
  if (user?.role !== 'student' && user?.role !== 'master') return null;
  const s = current(user);
  return (
    <div className={`subj ${compact ? 'compact' : ''} ${s}`} role="radiogroup" aria-label="Subject" aria-busy={busy}>
      <span className="subj-thumb" aria-hidden="true" />
      <button type="button" role="radio" aria-checked={s === 'english'} className={s === 'english' ? 'on' : ''} onClick={() => go('english')}><IconBook width={15} height={15} /> English</button>
      <button type="button" role="radio" aria-checked={s === 'math'} className={s === 'math' ? 'on' : ''} onClick={() => go('math')}><IconMath width={15} height={15} /> Math</button>
    </div>
  );
}

/** A section that has no Math content yet. */
export function ComingSoon({ title, text, icon: Icon = IconMath }) {
  const [go] = useSwitchSubject();
  return (
    <div className="page">
      <div className="soon-card">
        <span className="soon-ic"><Icon width={30} height={30} /></span>
        <small className="eyebrow">SAT MATH · COMING SOON</small>
        <h1>{title}</h1>
        <p>{text}</p>
        <div className="row wrap" style={{ gap: 10, justifyContent: 'center' }}>
          <Link className="btn primary" to="/practice">Practise Math now <IconArrow width={16} height={16} /></Link>
          <button className="btn ghost" onClick={() => go('english')}>Switch to English</button>
        </div>
      </div>
    </div>
  );
}

/** Shown where a Math plan is needed. */
export function BuyMath() { return null; } // SAT Ustoz is free: nothing to buy
function OldBuyMath({ title = 'This comes with a Math plan', text = 'Get a Math plan to open every video lesson and unlimited Math practice.' }) { // eslint-disable-line no-unused-vars
  return (
    <div className="buy-math">
      <span className="bm-ic"><IconLock width={22} height={22} /></span>
      <div className="grow"><b>{title}</b><p>{text}</p></div>
      <Link className="btn sun" to="/subscribe?subject=math"><IconCrown width={17} height={17} /> Buy Math</Link>
    </div>
  );
}

/** /math in English mode: switches to Math and opens Math practice (or the Math page that was asked for). */
export function ToMath() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const to = loc.pathname === '/math' ? '/practice' : loc.pathname + loc.search;
    api.put('/me/subject', { subject: 'math' }).then(refresh).then(() => nav(to, { replace: true })).catch(() => nav('/', { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
