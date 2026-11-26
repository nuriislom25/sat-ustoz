import { Link } from 'react-router-dom';
import { useAuth } from '../../context.jsx';
import { Spinner } from '../../components/ui.jsx';
import { IconArrow, IconCheck } from '../../components/icons.jsx';
import { useSite } from './site.jsx';
import ScoreCalc from './ScoreCalc.jsx';
import { Trustpilot } from '../../components/Consent.jsx';
import './public.css';

// big counts read better rounded down: 11 716 → "11 700+", 948 → "940+"
const nice = (n) => { n = Number(n || 0); const r = n >= 1000 ? 100 : n >= 100 ? 10 : 1; return `${(Math.floor(n / r) * r).toLocaleString('en-US').replace(/,/g, ' ')}+`; };

/** Home page for visitors: no sign-in wall — a free practice test is one click away. */
export default function Landing() {
  const { site, err } = useSite();
  const { user } = useAuth();
  if (err) return <div className="pub-wrap"><p className="error-box">{err.message}</p></div>;
  if (!site) return <div className="pub-hero" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}><Spinner /></div>;
  const h = site.home;
  const c = site.counts;
  const all = Number(c.english || c.questions || 0) + Number(c.math || 0); // English + Math
  const trial = user ? '/' : '/signup';

  return (
    <>
      {/* ---------- hero ---------- */}
      <section className="pub-hero">
        <div className="doodles" aria-hidden="true">
          <span className="dd d1"><b>{h.stats?.[0]?.value || '+120'}</b><i>{h.stats?.[0]?.label}</i></span>
          <span className="dd d2"><b>{nice(all)}</b><i>SAT questions</i></span>
          <span className="dd d3"><b>{h.stats?.[1]?.value || '27'}</b><i>{h.stats?.[1]?.label}</i></span>
          <span className="dd d4"><b>{h.stats?.[2]?.value || '32 min'}</b><i>{h.stats?.[2]?.label}</i></span>
          <span className="dd d5"><i>Level up</i><svg viewBox="0 0 40 40"><path d="M20 36V6M8 18 20 6l12 12" /></svg></span>
          <svg className="dd d6" viewBox="0 0 220 120"><path d="M4 112 40 70l22 26 34-52 24 30L176 10" /><path d="M160 8h18v18" /><text x="0" y="66">200</text><text x="86" y="36">600</text><text x="170" y="54">800</text></svg>
          {h.badges?.slice(0, 4).map((b, i) => <span key={b} className={`dd tag t${i + 1}`}>{b}</span>)}
        </div>
        <div className="pub-hero-in">
          <h1 className="pub-h1">
            <span className="mark sky">SAT</span> {h.hero_title?.replace(/^SAT\s*/i, '')} <span className="mark sun">{h.hero_accent}</span>
          </h1>
          <p className="pub-sub">{h.hero_sub}</p>
          <div className="pub-cta-row">
            <span className="burst l" aria-hidden="true"><i /><i /><i /></span>
            <Link className="btn pill-cta" to={trial}>{user ? 'Open my dashboard' : h.cta_primary}</Link>
            <span className="burst r" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <Link className="pub-second" to="/practice">{h.cta_secondary} <IconArrow width={16} height={16} /></Link>
          <small className="pub-note">{h.cta_note}</small>
          {/* phones: the floating doodles are hidden, so the key numbers sit here instead */}
          <div className="pub-hero-stats">
            <span><b>{h.stats?.[0]?.value || '+120'}</b><small>{h.stats?.[0]?.label || 'average score lift'}</small></span>
            <span><b>{nice(all)}</b><small>SAT questions</small></span>
            <span><b>{h.stats?.[2]?.value || '32 min'}</b><small>{h.stats?.[2]?.label || 'like the real module'}</small></span>
          </div>
          <Trustpilot variant="hero" />
          <div className="pub-proof">
            <div className="faces" aria-hidden="true">{['M', 'J', 'S', 'D', 'A', 'N'].map((x, i) => <span key={x} style={{ '--i': i }}>{x}</span>)}</div>
            <span>{c.students >= 30 ? <>Loved by <b>{c.students.toLocaleString('en-US')}+</b> students</> : <>Built for students from <b>Uzbekistan</b></>}{c.tests >= 50 ? <> · <b>{c.tests.toLocaleString('en-US')}</b> practice tests taken</> : <> · <b>{nice(all)}</b> SAT questions</>}</span>
          </div>
        </div>
      </section>

      {/* ---------- 3 steps ---------- */}
      <section className="pub-wrap pub-steps">
        {h.steps?.map((s, i) => (
          <div key={i} className="pub-step">
            <small>Step {i + 1}</small>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            {i === 0 && <Link to="/practice" className="pub-mini skill"><span>Words in Context</span><b className="bad">48%</b><span>Transitions</span><b className="good">86%</b><span>Boundaries</span><b className="warn">63%</b></Link>}
            {i === 1 && <Link to={trial} className="pub-mini road"><i className="done" /><i className="done" /><i className="cur" /><i /><i /><em>Lesson 3 · Clauses</em></Link>}
            {i === 2 && <Link to="/practice" className="pub-mini score"><b>640</b><span>R&amp;W estimate</span><em>+90 in 3 weeks</em></Link>}
          </div>
        ))}
      </section>

      {/* ---------- score calculator ---------- */}
      <ScoreCalc />

      {/* ---------- practice teaser ---------- */}
      <section className="pub-wrap">
        <div className="pub-teaser">
          <div>
            <small className="eyebrow">FREE · NO SIGN-UP</small>
            <h2>Today’s practice test is ready</h2>
            <p>{site.practice.test_size} questions, {site.practice.minutes} minutes, like a real Reading &amp; Writing module. Score estimate and explanations at the end.</p>
            <div className="row wrap" style={{ marginTop: 18 }}>
              <Link className="btn sun lg" to="/practice">Start the test <IconArrow /></Link>
              <Link className="btn on-dark lg" to="/practice?levels=hard">Hard mode</Link>
            </div>
          </div>
          <div className="pub-teaser-q" aria-hidden="true">
            <span className="chip">Boundaries · Easy</span>
            <p>The museum opened in ______ it has welcomed more than two million visitors.</p>
            <ol><li>1998, since then,</li><li>1998, since then</li><li>1998 since then,</li><li className="ok">1998. Since then,</li></ol>
          </div>
        </div>
      </section>

      {/* ---------- free for everyone ---------- */}
      <FreeForAll c={c} all={all} trial={trial} signedIn={!!user} />

      {/* ---------- final CTA ---------- */}
      <section className="pub-final">
        <h2>{h.final_title}</h2>
        <p>{h.final_sub}</p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Link className="btn pill-cta" to="/practice">Let’s get that score</Link>
          {!user && <Link className="btn on-dark lg" to="/signup">{h.cta_primary}</Link>}
        </div>
      </section>
    </>
  );
}

/** SAT Ustoz is free for everyone: what is open, in one card (no plans, prices or wallet). */
function FreeForAll({ c, all, trial, signedIn }) {
  const open = [
    'Every roadmap lesson and video',
    `The whole Question Bank: ${nice(all)} SAT questions`,
    'Full mocks in the Bluebook format, as many as you like',
    'Quizzes, Word Vault and Word Arena',
    'Score reports and your mistakes to review',
    'Questions to the teacher and consultations on request',
  ];
  return (
    <section className="pub-wrap" id="free">
      <div className="pub-free">
        <div className="pub-free-h">
          <h2 className="pub-h2">Free for everyone</h2>
          <p>Everything on SAT Ustoz is open to every student. No plans, no payments and no daily limits.</p>
          <Link className="btn pill-cta" to={trial}>{signedIn ? 'Open my dashboard' : 'Create a free account'}</Link>
        </div>
        <ul className="pub-free-list">{open.map((x) => <li key={x}><IconCheck /> {x}</li>)}</ul>
      </div>
    </section>
  );
}
