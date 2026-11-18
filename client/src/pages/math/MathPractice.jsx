import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Confetti, ErrorBox, Spinner } from '../../components/ui.jsx';
import { IconArrow, IconCalc, IconCheck, IconRuler, IconX } from '../../components/icons.jsx';
import { BBFooter, BBNavigator, BBOptions, BBQuestionBar, BBShell, useElimination } from '../../components/Bluebook.jsx';
import MathText from './MathText.jsx';
import { Desmos, ReferenceSheet } from './Desmos.jsx';

const L = ['A', 'B', 'C', 'D'];
const LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** A SAT Math practice set: Bluebook screen + Desmos calculator + reference sheet, each answer checked right away. */
export default function MathPractice() {
  const { search } = useLocation();
  const nav = useNavigate();
  const [state, setState] = useState({ data: null, err: null });
  useEffect(() => {
    setState({ data: null, err: null });
    Promise.all([api.get('/math/questions' + search), api.get('/math')]).then(([q, all]) => setState({ data: { ...q, all } })).catch((err) => setState({ err }));
  }, [search]);
  if (state.err) return (
    <div style={{ padding: 40, maxWidth: 520, margin: '0 auto' }}>
      <ErrorBox error={state.err} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn ghost" onClick={() => nav('/math')}>Back to SAT Math</button></div>
    </div>
  );
  if (!state.data) return <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><Spinner label="Picking your questions…" /></div>;
  if (!state.data.questions.length) {
    const mistakes = new URLSearchParams(search).get('status') === 'mistakes';
    return (
      <div style={{ padding: 40, maxWidth: 560, margin: '0 auto', textAlign: 'center', display: 'grid', gap: 14 }}>
        <h2>{mistakes ? 'No mistakes to review here' : 'You have done every question here'}</h2>
        <p className="muted">{mistakes ? 'Everything you answered in this topic is now correct.' : 'Choose “All” on the SAT Math page to practise them again, or pick another topic.'}</p>
        <div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" to="/math">Back to SAT Math</Link></div>
      </div>
    );
  }
  return <Runner key={search} questions={state.data.questions} all={state.data.all} search={search} />;
}

function Runner({ questions, all, search }) {
  const nav = useNavigate();
  const toast = useToast();
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState({});     // id → 'A'..'D' or typed text
  const [rv, setRv] = useState({});       // id → server result once the solution is shown
  const [wrong, setWrong] = useState({}); // id → wrong tries so far
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [calc, setCalc] = useState(false);
  const [calcMounted, setCalcMounted] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [nav2, setNav2] = useState(false);
  const [marked, setMarked] = useState({});
  const [secs, setSecs] = useState(0);
  const el = useElimination();
  const scroller = useRef(null);
  useEffect(() => { const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [cur]);
  const skillName = (q) => all.domains.find((d) => d.id === q.domain)?.skills.find((s) => s.id === q.skill)?.name || q.skill;

  const q = questions[cur];
  const mine = sel[q.id];
  const r = rv[q.id];
  const tried = wrong[q.id] || [];
  const last = cur === questions.length - 1;
  const go = (i) => { setCur(Math.max(0, Math.min(questions.length - 1, i))); setNav2(false); };
  const next = () => (last ? setDone(true) : go(cur + 1));
  const openCalc = () => { setCalcMounted(true); setCalc((c) => !c); };

  const check = async () => {
    if (!mine || r || busy || (q.kind === 'spr' && mine === tried[tried.length - 1])) return;
    setBusy(true);
    try {
      const body = q.kind === 'spr' ? { value: mine, attempt: tried.length + 1 } : { choice: mine, attempt: tried.length + 1 };
      const res = await api.post(`/math/questions/${encodeURIComponent(q.id)}/check`, body);
      if (!res.done) { setWrong((s) => ({ ...s, [q.id]: [...tried, mine] })); setSel((s) => ({ ...s, [q.id]: q.kind === 'spr' ? mine : undefined })); return; }
      setRv((s) => ({ ...s, [q.id]: { ...res, hit: res.correct, first: tried.length === 0 && res.correct, tried } }));
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  useEffect(() => {
    const f = (e) => {
      if (e.target.closest('input, textarea, select, iframe, [role=dialog]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (q.kind === 'mcq' && !r && L.includes(k) && !tried.includes(k)) setSel((s) => ({ ...s, [q.id]: k }));
      else if (e.key === 'Enter') { e.preventDefault(); if (r) next(); else check(); }
      else if (e.key === 'ArrowRight') go(cur + 1);
      else if (e.key === 'ArrowLeft') go(cur - 1);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });

  if (done) return <Summary questions={questions} rv={rv} search={search} skillName={skillName} />;
  const checked = Object.keys(rv).length;
  const key = r ? (q.kind === 'spr' ? r.answer.join('  or  ') : r.answer) : null;

  return (
    <BBShell title="SAT Math practice" directions={DIRECTIONS} seconds={secs} countdown={false} onExit={() => (checked ? setDone(true) : nav('/math'))}
      tools={(
        <>
          <button className={`bb-tool ${calc ? 'on' : ''}`} onClick={openCalc} aria-pressed={calc}><IconCalc width={20} height={20} /><span>Calculator</span></button>
          <button className="bb-tool" onClick={() => setSheet(true)}><IconRuler width={20} height={20} /><span>Reference</span></button>
        </>
      )}
      footer={(
        <BBFooter cur={cur} total={questions.length} onOpenNav={() => setNav2(true)}>
          {cur > 0 && <button className="bb-btn ghost" onClick={() => go(cur - 1)}>Back</button>}
          {r ? <button className="bb-btn" onClick={next}>{last ? 'See results' : 'Next'}</button>
            : <button className="bb-btn" disabled={!mine || busy || (q.kind === 'spr' && mine === tried[tried.length - 1])} onClick={check}>{busy ? 'Checking…' : 'Check'}</button>}
        </BBFooter>
      )}>
      <div className={`mp ${calc ? 'calc-on' : ''}`}>
        <aside className="mp-calc" aria-hidden={!calc} aria-label="Desmos calculator">
          <div className="mp-calc-bar"><b><IconCalc width={18} height={18} /> Desmos</b><button onClick={() => setCalc(false)} aria-label="Close the calculator"><IconX width={18} height={18} /><span>Close</span></button></div>
          {calcMounted && <Desmos />}
        </aside>
        <div className="mp-q" ref={scroller}>
          <div className="mp-q-in" key={q.id}>
            <BBQuestionBar n={cur + 1} marked={marked[q.id]} onMark={() => setMarked((m) => ({ ...m, [q.id]: !m[q.id] }))}
              elim={el.elim} onElim={q.kind === 'mcq' && !r ? el.toggleElim : null} />
            <div className="bb-meta"><span>{skillName(q)}</span><span className={`chip lvl-${q.difficulty}`}>{LEVEL[q.difficulty]}</span>{q.kind === 'spr' && <span>Type your answer</span>}</div>
            <MathText as="div" className="bb-prompt mp-prompt">{q.prompt}</MathText>
            {q.kind === 'mcq' ? (
              <BBOptions options={q.options.map((o, i) => ({ key: L[i], text: <MathText>{o}</MathText> }))} choice={mine || null}
                eliminated={el.eliminated(q.id)} elim={el.elim} onChoose={(k) => !r && !tried.includes(k) && setSel((s) => ({ ...s, [q.id]: k }))}
                onEliminate={(k) => el.toggle(q.id, k)} reveal={r ? { correct: r.answer } : null} tried={tried} />
            ) : (
              <SprInput value={mine || ''} onChange={(v) => setSel((s) => ({ ...s, [q.id]: v }))} disabled={!!r} state={r ? (r.hit ? 'right' : 'wrong') : tried.length && mine === tried[tried.length - 1] ? 'wrong' : ''} onEnter={check} />
            )}
            {!r && tried.length > 0 && (
              <div className="bb-feedback no bb-retry" role="status">
                <h3>{q.kind === 'spr' ? `${tried[tried.length - 1]} is not right. Try again.` : 'Not this one. Try again.'}</h3>
                <p>{3 - tried.length === 1 ? '1 try left before the solution is shown.' : `${3 - tried.length} tries left before the solution is shown.`}{!calc && ' Check your work with the calculator.'}</p>
              </div>
            )}
            {r && (
              <div className={`bb-feedback ${r.hit ? 'ok' : 'no'}`} role="status">
                <h3>{r.hit ? (r.attempt > 1 ? `Correct on try ${r.attempt}` : 'Correct') : <>Not quite. The answer is <MathText>{q.kind === 'spr' ? key : `${key}`}</MathText>.</>}</h3>
                {r.explanation && <MathText as="p">{r.explanation}</MathText>}
                {r.tip && <div className="tip"><b>Desmos:</b> {r.tip}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
      {nav2 && <BBNavigator title="SAT Math practice" cur={cur} onGo={go} onClose={() => setNav2(false)}
        items={questions.map((x) => ({ answered: !!sel[x.id] || !!rv[x.id], marked: marked[x.id], state: rv[x.id] ? (rv[x.id].hit ? 'right' : 'wrong') : '' }))} />}
      {sheet && <ReferenceSheet onClose={() => setSheet(false)} />}
    </BBShell>
  );
}

/** Student-produced response: a typed number, fraction or decimal, with a live preview like Bluebook. */
function SprInput({ value, onChange, disabled, state, onEnter }) {
  const ok = /^-?(\d+(\.\d*)?|\.\d+)(\/-?\d+(\.\d+)?)?$/.test(value.trim());
  const preview = value.includes('/') ? `$\\dfrac{${value.split('/')[0]}}{${value.split('/')[1] || '\\ '}}$` : value;
  return (
    <div className={`mp-spr ${state}`}>
      <label className="mp-spr-box">
        <span className="sr-only">Your answer</span>
        <input inputMode="decimal" autoComplete="off" value={value} disabled={disabled} maxLength={8} placeholder="Your answer"
          onChange={(e) => onChange(e.target.value.replace(/[^0-9./-]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
      </label>
      <div className="mp-spr-side">
        <small>Answer preview</small>
        <div className="mp-spr-prev">{value ? (ok ? <MathText>{preview}</MathText> : <span className="muted">Use numbers, . / and −</span>) : <span className="muted">—</span>}</div>
      </div>
      <p className="mp-spr-help">Type a whole number, a decimal (0.75) or a fraction (3/4). For a negative answer, start with a minus sign.</p>
    </div>
  );
}

const DIRECTIONS = (
  <>
    <p>The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions: open Desmos with the Calculator button. The Reference button shows the formula sheet.</p>
    <p>For multiple-choice questions, solve each problem and choose the correct answer from the choices provided. Each multiple-choice question has a single correct answer.</p>
    <p>For student-produced response questions, type your answer. If you find more than one correct answer, enter only one. A fraction like 3/4 and a decimal like 0.75 are both fine; do not enter symbols such as a percent sign or a dollar sign.</p>
    <p>In this practice set each answer is checked right away. A wrong answer can be tried again (up to 3 times); then the solution is shown. Your first answer is the one that counts.</p>
  </>
);

function Summary({ questions, rv, search, skillName }) {
  const nav = useNavigate();
  const answered = questions.filter((q) => rv[q.id]);
  const right = answered.filter((q) => rv[q.id].first).length;
  const pct = answered.length ? Math.round((right / answered.length) * 100) : 0;
  const p = new URLSearchParams(search);
  const then = p.get('then');
  const again = (status) => { const n = new URLSearchParams(search); n.delete('ids'); n.delete('then'); if (then) n.set('skill', then); n.set('status', status); n.set('limit', '10'); nav('/math/practice?' + n.toString()); };
  return (
    <div className="page math-page" style={{ maxWidth: 820, margin: '0 auto' }}>
      {pct >= 80 && answered.length >= 5 && <Confetti />}
      <section className="mh-hero mh-sum">
        <div className="mh-hero-copy">
          <small className="eyebrow">SAT MATH · PRACTICE SET</small>
          <h1>{pct >= 80 ? 'Strong set — keep going.' : pct >= 50 ? 'Good work — look at the misses.' : 'Every mistake here is a lesson.'}</h1>
          <p>{answered.length < questions.length ? `You checked ${answered.length} of ${questions.length} questions.` : `You checked ${questions.length === 1 ? 'the question' : `all ${questions.length} questions`}.`} {right} right on the first try.</p>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn sun lg" onClick={() => again('new')}>{then ? 'More on this topic' : 'New questions'} <IconArrow /></button>
            {right < answered.length && !then && <button className="btn mh-ghost lg" onClick={() => again('mistakes')}>Practise my mistakes</button>}
            <Link className="btn mh-ghost lg" to="/math">SAT Math</Link>
          </div>
        </div>
        <div className="mh-stats"><div><b>{right}/{answered.length}</b><small>{pct}% first try</small></div></div>
      </section>
      <div className="qb-review">
        {questions.map((q, i) => {
          const res = rv[q.id];
          return (
            <Card key={q.id} className={`rq ${!res ? 'skip' : res.first ? 'right' : 'wrong'}`}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="q-num">{i + 1}</span><span className="chip domain">{skillName(q)}</span><span className={`chip lvl-${q.difficulty}`}>{LEVEL[q.difficulty]}</span>
                {!res && <span className="chip warn">Not checked</span>}
                {res && (res.first ? <span className="chip good"><IconCheck width={13} height={13} /> First try</span> : null)}
              </div>
              <MathText as="div" className="mp-sum-q">{q.prompt}</MathText>
              {res && (
                <>
                  {q.kind === 'mcq'
                    ? <ul className="qb-opts-review">{q.options.map((o, k) => <li key={k} className={L[k] === res.answer ? 'ok' : ''}><b>{L[k]})</b> <MathText>{o}</MathText>{L[k] === res.answer ? ' · correct' : ''}</li>)}</ul>
                    : <p><b>Answer:</b> {res.answer.join(' or ')}</p>}
                  {res.explanation && <MathText as="p" className="muted">{res.explanation}</MathText>}
                </>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
