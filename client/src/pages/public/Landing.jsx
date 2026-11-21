import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfig } from '../../config.js';
import { useAuth } from '../../context.jsx';
import { Spinner } from '../../components/ui.jsx';
import { IconArrow, IconCheck } from '../../components/icons.jsx';
import { useSite } from './site.jsx';
import ScoreCalc from './ScoreCalc.jsx';
import { Trustpilot } from '../../components/Consent.jsx';
import { tierPerks } from '../student/Subscribe.jsx';
import './public.css';

const money = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');

/** Home page for visitors: no sign-in wall — a free practice test is one click away. */
export default function Landing() {
  const { site, err } = useSite();
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  useEffect(() => { getConfig().then(setCfg); }, []);
  if (err) return <div className="pub-wrap"><p className="error-box">{err.message}</p></div>;
  if (!site) return <div className="pub-hero" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}><Spinner /></div>;
  const h = site.home;
  const c = site.counts;
  const trial = user ? '/' : '/signup';

  return (
    <>
      {/* ---------- hero ---------- */}
      <section className="pub-hero lp-hero">
        <div className="doodles" aria-hidden="true">
          <span className="dd d1"><b>{h.stats?.[1]?.value || '27'}</b><i>{h.stats?.[1]?.label || 'questions per practice test'}</i></span>
          <span className="dd d5"><i>Level up</i><svg viewBox="0 0 40 40"><path d="M20 36V6M8 18 20 6l12 12" /></svg></span>
          <svg className="dd d6" viewBox="0 0 220 120"><path d="M4 112 40 70l22 26 34-52 24 30L176 10" /><path d="M160 8h18v18" /><text x="0" y="66">200</text><text x="86" y="36">600</text><text x="170" y="54">800</text></svg>
          {h.badges?.slice(0, 3).map((b, i) => <span key={b} className={`dd tag t${i + 1}`}>{b}</span>)}
        </div>
        <div className="lp-hero-in">
          <div className="lp-hero-copy">
            <h1 className="pub-h1">
              <span className="mark sky">SAT</span> {h.hero_title?.replace(/^SAT\s*/i, '')} <span className="mark sun">{h.hero_accent}</span>
            </h1>
            <p className="pub-sub">{h.hero_sub}</p>
            <div className="lp-cta">
              <span className="lp-cta-main"><span className="burst l" aria-hidden="true"><i /><i /><i /></span><Link className="btn pill-cta" to={trial}>{user ? 'Open my dashboard' : h.cta_primary}</Link></span>
              <Link className="lp-second" to="/practice">{h.cta_secondary} <IconArrow width={16} height={16} /></Link>
            </div>
            <small className="pub-note">{h.cta_note}</small>
            <dl className="lp-facts">
              <div><dt>{h.stats?.[0]?.value || '+120'}</dt><dd>{h.stats?.[0]?.label || 'average score lift'}</dd></div>
              <div><dt>{c.questions}+</dt><dd>practice questions</dd></div>
              <div><dt>{h.stats?.[2]?.value || '32 min'}</dt><dd>{h.stats?.[2]?.label || 'like the real module'}</dd></div>
            </dl>
            <Trustpilot variant="hero" />
            <p className="lp-proof">{c.students >= 30 ? <>Used by <b>{c.students.toLocaleString('en-US')}+</b> students in Uzbekistan</> : <>Made in Tashkent for students in <b>Uzbekistan</b></>}{c.tests >= 50 ? <>, <b>{c.tests.toLocaleString('en-US')}</b> practice tests taken</> : null}</p>
          </div>
          <SampleReport />
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

      {/* ---------- pricing ---------- */}
      <Pricing cfg={cfg} trial={trial} />

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

/** What a student sees after the free test: an illustration of the real result page (sample numbers). */
function SampleReport() {
  const rows = [['Transitions', 42], ['Words in Context', 71], ['Boundaries', 88]];
  return (
    <figure className="lp-report" aria-label="Sample result after a free practice test">
      <div className="lp-r-head">
        <span>Reading &amp; Writing</span>
        <small>Sample result</small>
      </div>
      <div className="lp-r-score"><b>640</b><span>likely 610–670</span></div>
      <div className="lp-r-scale" aria-hidden="true"><i style={{ left: '73%' }} /><span>200</span><span>800</span></div>
      <ul className="lp-r-skills">
        {rows.map(([n, v]) => <li key={n}><span>{n}</span><i><em className={v >= 80 ? 'good' : v >= 60 ? 'warn' : 'bad'} style={{ width: `${v}%` }} /></i><b>{v}%</b></li>)}
      </ul>
      <div className="lp-r-next"><b>Fix first: Transitions</b><span>about +30 points with 10 questions a day</span></div>
    </figure>
  );
}

const PP_COLORS = ['#22B07D', '#3B82F6', '#F07A55', '#F5B82E', '#8E5CF7'];

/** Plans: free + 4 paid plans. On phones the cards are a swipeable slider with dots. */
function Pricing({ cfg, trial }) {
  const [at, setAt] = useState(0);
  const [hold, setHold] = useState(false);
  const rail = useRef(null);
  const count = (cfg?.tiers?.length || 0) + 1;
  // auto-play: one card every 3.5 s, back to the start at the end; pauses while the visitor hovers or touches
  useEffect(() => {
    // phones: no auto-play (it moves the cards under the visitor's thumb)
    if (!cfg?.tiers || hold || window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 760px)').matches) return undefined;
    const t = setInterval(() => {
      const el = rail.current; if (!el) return;
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      if (end) el.scrollTo({ left: 0, behavior: 'smooth' });
      else { const c = el.children[Math.min(count - 1, at + 1)]; if (c) el.scrollTo({ left: c.offsetLeft - el.offsetLeft, behavior: 'smooth' }); }
    }, 3500);
    return () => clearInterval(t);
  }, [cfg, hold, at, count]);
  if (!cfg?.tiers) return null;
  const cur = cfg.prices?.currency || 'UZS';
  const cards = [
    { id: 'free', name: 'Free', price: 0, perks: [[true, `${cfg.free.q_day} questions a day across all tests`], [true, 'Free practice tests'], [true, `${cfg.free.fm_week} full mock a week`], [true, 'First roadmap lessons, then one a week']] },
    ...cfg.tiers.map((t) => ({ ...t, perks: tierPerks(t).filter(([on]) => on) })),
  ];
  const onScroll = () => {
    const el = rail.current; if (!el) return;
    const w = el.firstElementChild?.getBoundingClientRect().width || 1;
    setAt(Math.min(count - 1, Math.round(el.scrollLeft / (w + 16))));
  };
  const go = (i) => { const el = rail.current; const c = el?.children[i]; if (c) el.scrollTo({ left: c.offsetLeft - el.offsetLeft, behavior: 'smooth' }); };
  return (
    <section className="pub-wrap" id="pricing">
      <h2 className="pub-h2">Simple pricing</h2>
      <div className="pp-wrap" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onTouchStart={() => setHold(true)} onTouchEnd={() => setTimeout(() => setHold(false), 4000)}>
      <button className="pp-arrow l" aria-label="Previous plan" onClick={() => go(Math.max(0, at - 1))}>‹</button>
      <div className="pub-prices tiers5" ref={rail} onScroll={onScroll}>
        {cards.map((t, i) => (
          <div key={t.id} className={`pub-price pp-c ${i === 3 ? 'hot' : ''}`} style={{ '--tc': PP_COLORS[i % PP_COLORS.length], '--tilt': `${i % 2 ? 3 : -3}deg` }}>
            {i === 3 && <span className="ribbon">Most popular</span>}
            <small className="pp-tag">{i === 0 ? 'Start' : `Plan ${i}`}</small>
            <h3 className="pp-name">{t.name}</h3>
            <b>{t.price ? money(t.price) : '0'}</b><span>{t.price ? `${cur} / ${t.live ? '12 live lessons' : 'month'}` : 'forever'}</span>
            <ul>{t.perks.map(([, x]) => <li key={x}><IconCheck /> {x}</li>)}</ul>
            <Link className={`btn ${i === 3 ? 'sun' : 'ghost'} lg block`} to={i === 0 ? '/practice' : trial}>{i === 0 ? 'Take a free test' : 'Choose'}</Link>
          </div>
        ))}
      </div>
      <button className="pp-arrow r" aria-label="Next plan" onClick={() => go(Math.min(count - 1, at + 1))}>›</button>
      </div>
      <div className="pp-dots" aria-hidden="true">{cards.map((c, i) => <button key={c.id} className={at === i ? 'on' : ''} onClick={() => go(i)} tabIndex={-1} />)}</div>
      <p className="muted center pp-note">Swipe to see every plan · extra full mock {money(cfg.fm_extra_price)} {cur} from your wallet</p>
    </section>
  );
}
