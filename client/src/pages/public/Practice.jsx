import ReportMistake from '../../components/ReportMistake.jsx';
import PracticeTabs from '../../components/PracticeTabs.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ShareScore, firstName, today } from '../../components/Growth.jsx';
import { useAuth, useToast } from '../../context.jsx';
import { Confetti, Modal, Spinner } from '../../components/ui.jsx';
import { IconArrow, IconBolt, IconBook, IconCalc, IconCheck, IconClock, IconDoc, IconLayers, IconLock, IconMath, IconRuler, IconTarget, Logo } from '../../components/icons.jsx';
import { Passage } from '../../components/Passage.jsx';
import { rich } from '../../components/Rich.jsx';
import { BBExam } from '../../components/Bluebook.jsx';
import MathText from '../math/MathText.jsx';
import { Desmos, ReferenceSheet } from '../math/Desmos.jsx';
import { newSeed } from './site.jsx';

const L = ['A', 'B', 'C', 'D'];
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const LEVEL = Object.fromEntries(LEVELS);
export const CLAIM = 'pt-claim';
const SUBJECT_NAME = { english: 'Reading & Writing', math: 'Math' };

/** What each question type asks, in plain words (the SAT names mean little to a newcomer). */
const SKILL_HINT = {
  'central-ideas': 'What is the text mainly saying?',
  inferences: 'Finish the text with the most logical conclusion',
  'command-of-evidence': 'Pick the quote or data that proves a claim',
  'words-in-context': 'Choose the word that fits the sentence',
  'text-structure': 'Why did the author write this part?',
  'cross-text': 'How would one author answer the other?',
  'rhetorical-synthesis': 'Use a student’s notes to reach a goal',
  transitions: 'Pick the linking word: however, therefore…',
  boundaries: 'Punctuation: commas, semicolons, colons',
  'form-structure-sense': 'Grammar: verbs, pronouns, agreement',
};
const DOMAIN_HINT = {
  'Craft and Structure': 'Vocabulary and how texts are built',
  'Information and Ideas': 'Reading for meaning and evidence',
  'Standard English Conventions': 'Grammar and punctuation',
  'Expression of Ideas': 'Writing clearly: transitions and notes',
};

export default function Practice() {
  const { id: resultId } = useParams();
  if (resultId) return <ResultLoader id={resultId} />;
  return <PracticeHub />;
}

const EN_MODES = (mod) => [
  { id: 'quick', icon: IconBolt, c: '#E2553D', title: 'Quick check', tag: 'Start here', text: '5 mixed questions to see the format', n: 5 },
  { id: 'sat', icon: IconDoc, c: '#2A55E5', title: 'One SAT module', text: `Built like the real test: the same mix and order of questions, ${mod.minutes} minutes`, n: mod.size },
  { id: 'full', icon: IconLayers, c: '#8E5CF7', title: 'Full adaptive section', text: 'Two modules like Bluebook: Module 2 gets harder or easier from your Module 1', n: mod.size * 2 },
  { id: 'topic', icon: IconTarget, c: '#0E9F6E', title: 'Choose topics', text: 'Pick question types, level and how many questions', n: '5–27' },
];
const MATH_MODES = (mod) => EN_MODES(mod).map((m) => (m.id === 'sat' ? { ...m, title: 'One SAT Math module', text: `Built like the real test: algebra to geometry, ${mod.minutes} minutes, Desmos` } : m));

/** The practice test: three short choices, then a test built for them. */
function PracticeHub() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [seed, setSeed] = useState(newSeed);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const preset = params.get('levels') || params.get('domain');
  const [subject, setSubject] = useState(() => (params.get('subject') === 'math' || (!params.get('subject') && user?.subject === 'math') ? 'math' : 'english'));
  const [mode, setMode] = useState(() => (['quick', 'sat', 'full', 'topic'].includes(params.get('mode')) ? params.get('mode') : preset ? 'topic' : null));
  const [size, setSize] = useState(10);
  const [levels, setLevels] = useState(() => (params.get('levels') || '').split(',').filter((l) => LEVEL[l]));
  const [skills, setSkills] = useState([]);
  const [test, setTest] = useState(null);
  const [between, setBetween] = useState(null); // adaptive test: Module 1 done, Module 2 ready
  const [busy, setBusy] = useState(false);
  const stepRef = useRef(null);

  useEffect(() => {
    api.get(`/public/practice?seed=${seed}`).then((m) => {
      setMeta(m);
      const d = params.get('domain');
      if (d) setSkills(m.domains.find((x) => x.domain === d)?.skills.map((s) => s.id) || []);
    }).catch((e) => setErr(e.message));
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const domains = meta ? (subject === 'math' ? meta.math : meta.domains) : [];
  const mod = meta?.modules?.[subject] || { size: 27, minutes: 32 };
  const per = mod.minutes / mod.size;
  const plan = {
    quick: { n: 5, min: Math.max(4, Math.round(5 * per)) },
    sat: { n: mod.size, min: mod.minutes },
    full: { n: mod.size * 2, min: mod.minutes * 2 },
    topic: { n: size, min: Math.max(4, Math.round(size * per)) },
  };
  const available = useMemo(() => {
    let n = 0;
    for (const d of domains) for (const s of d.skills) {
      if (skills.length && !skills.includes(s.id)) continue;
      n += (levels.length ? levels : ['easy', 'medium', 'hard']).reduce((a, l) => a + (s.per[l] || 0), 0);
    }
    return n;
  }, [domains, skills, levels]);

  const q = meta?.quota;
  const blocked = q && !q.unlimited && q.left < 3;
  const need = mode ? plan[mode].n : 0;
  const short = mode && q && !q.unlimited && q.left < need;
  const modes = subject === 'math' ? MATH_MODES(mod) : EN_MODES(mod);

  const pickSubject = (s) => { setSubject(s); setSkills([]); };
  const pickMode = (m) => {
    setMode(m);
    // phones: bring the next step (or the Start button) into view
    setTimeout(() => { if (window.matchMedia('(max-width: 900px)').matches) stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
  };
  const start = async () => {
    setBusy(true);
    try {
      const t = await api.post('/public/practice/start', { seed, subject, mode, size, skills, levels });
      setTest(t); setMeta((m) => (m ? { ...m, quota: t.quota } : m));
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(e.message, 'bad');
      if (e.status === 429) api.get(`/public/practice?seed=${seed}`).then(setMeta).catch(() => {});
    } finally { setBusy(false); }
  };
  const done = (r) => { setTest(null); setBetween(null); nav(`/practice/result/${r.id}`, { state: { result: r } }); };
  const moduleDone = async (answers) => {
    const m2 = await api.post(`/public/practice/${test.id}/next`, { answers, seed });
    setTest(null); setBetween(m2); window.scrollTo({ top: 0 });
  };

  if (test) return <Runner key={test.id} test={test} onDone={done} onModuleDone={test.modules === 2 && test.module === 1 ? moduleDone : null} onQuit={() => setTest(null)} />;
  if (between) return <ModuleBreak m2={between} onGo={() => { setTest(between); setBetween(null); }} />;

  const chosen = modes.find((m) => m.id === mode);
  return (
    <div className="pt-hub pw">
      <PracticeTabs />
      <section className="pw-head">
        <small className="eyebrow">FREE SAT PRACTICE TEST{user ? '' : ' · NO SIGN-UP'}</small>
        <h1>See where you stand today</h1>
        <p>Real Digital SAT question types, a timer like test day and a score estimate at the end. Choose three things and start.</p>
        {meta?.stats && (
          <div className="pw-trust">
            <span><IconCheck width={15} height={15} /> {(meta.stats.english + meta.stats.math).toLocaleString('en-US')} questions in the SAT format</span>
            <span><IconCheck width={15} height={15} /> Scored like the real SAT</span>
            {meta.stats.tests > 20 && <span><IconCheck width={15} height={15} /> {meta.stats.tests.toLocaleString('en-US')} tests taken</span>}
          </div>
        )}
      </section>

      {err && <div className="error-box">{err}</div>}
      {!meta ? <div className="pt-loading"><Spinner label="Getting the questions ready…" /></div> : (
        <div className="pw-grid">
          <div className="pw-steps">
            <section className="pw-step">
              <h2><span>1</span> Which section?</h2>
              <div className="pw-subjects">
                <button className={`pw-subj ${subject === 'english' ? 'on' : ''}`} onClick={() => pickSubject('english')} aria-pressed={subject === 'english'}>
                  <IconBook width={26} height={26} /><b>Reading &amp; Writing</b><small>Short passages, grammar, vocabulary</small>
                </button>
                <button className={`pw-subj math ${subject === 'math' ? 'on' : ''}`} onClick={() => pickSubject('math')} aria-pressed={subject === 'math'}>
                  <IconMath width={26} height={26} /><b>Math</b><small>Algebra to geometry, with Desmos</small>
                </button>
              </div>
            </section>

            <section className="pw-step">
              <h2><span>2</span> What kind of test?</h2>
              <div className="pw-modes">
                {modes.map((m) => (
                  <button key={m.id} className={`pw-mode ${mode === m.id ? 'on' : ''}`} onClick={() => pickMode(m.id)} aria-pressed={mode === m.id} style={{ '--c': m.c }}>
                    <span className="pw-mode-ic"><m.icon width={22} height={22} /></span>
                    <span className="grow"><b>{m.title}{m.tag && <em>{m.tag}</em>}</b><small>{m.text}</small></span>
                    <span className="pw-mode-n"><b>{m.n}</b><small>questions</small></span>
                  </button>
                ))}
              </div>
            </section>

            {mode === 'topic' && (
              <section className="pw-step" ref={stepRef}>
                <h2><span>3</span> How many, and which question types?</h2>
                <div className="pw-sizes" role="radiogroup" aria-label="Number of questions">
                  {meta.sizes.map((n) => (
                    <button key={n} role="radio" className={size === n ? 'on' : ''} onClick={() => setSize(n)} aria-checked={size === n}><b>{n}</b><small>{Math.max(4, Math.round(n * per))} min</small></button>
                  ))}
                </div>
                <div className="pw-levels">
                  <b>Level</b>
                  <button className={`chip-btn chip ${!levels.length ? 'on' : ''}`} onClick={() => setLevels([])}>Mixed, like the real test</button>
                  {LEVELS.map(([v, l]) => (
                    <button key={v} className={`chip-btn chip lvl-${v} ${levels.includes(v) ? 'on' : ''}`} aria-pressed={levels.includes(v)} onClick={() => setLevels((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]))}>{l}</button>
                  ))}
                </div>
                <p className="muted pw-note">{skills.length ? `${skills.length} question type${skills.length > 1 ? 's' : ''} chosen.` : 'Nothing chosen = all question types, mixed.'}</p>
                {domains.map((d) => {
                  const ids = d.skills.map((s) => s.id);
                  const all = ids.length && ids.every((id) => skills.includes(id));
                  return (
                    <div key={d.domain} className="pw-domain">
                      <div className="pw-domain-h"><div className="grow"><h3>{d.domain}</h3>{DOMAIN_HINT[d.domain] && <small className="muted">{DOMAIN_HINT[d.domain]}</small>}</div>
                        <button className="linkish" onClick={() => setSkills((s) => (all ? s.filter((x) => !ids.includes(x)) : [...new Set([...s, ...ids])]))}>{all ? 'Clear' : 'Choose all'}</button></div>
                      <div className="pw-types">
                        {d.skills.map((s) => {
                          const on = skills.includes(s.id);
                          return (
                            <button key={s.id} className={`pw-type ${on ? 'on' : ''}`} aria-pressed={on} disabled={!s.n} onClick={() => setSkills((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))}>
                              <span className="tick">{on && <IconCheck width={14} height={14} />}</span>
                              <span className="grow"><b>{s.name}</b>{SKILL_HINT[s.id] && <small>{SKILL_HINT[s.id]}</small>}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </div>

          <aside className="pw-side" ref={mode !== 'topic' ? stepRef : null}>
            {blocked ? <LimitCard q={q} signedIn={meta.signed_in} /> : (
              <div className="pw-start">
                {!chosen ? (
                  <>
                    <b className="pw-start-h">Choose a test type</b>
                    <p>Not sure? Start with the 5-question check. It takes about {plan.quick.min} minutes.</p>
                    <button className="btn sun lg block" onClick={() => pickMode('quick')}>Quick check <IconArrow /></button>
                  </>
                ) : (
                  <>
                    <small className="pw-start-sub">{SUBJECT_NAME[subject]}</small>
                    <b className="pw-start-h">{chosen.title}</b>
                    <ul className="pw-facts">
                      <li><IconDoc width={16} height={16} /> {mode === 'topic' ? Math.min(size, available) : plan[mode].n} questions{mode === 'full' ? ' in 2 modules' : ''}</li>
                      <li><IconClock width={16} height={16} /> {plan[mode].min} minutes, timer on</li>
                      <li><IconTarget width={16} height={16} /> SAT score estimate and your weak spots</li>
                      {subject === 'math' && <li><IconCalc width={16} height={16} /> Desmos calculator and formulas</li>}
                    </ul>
                    {mode === 'topic' && available < 3 && <p className="pw-warn">Not enough questions for these choices today. Choose more types or levels.</p>}
                    {short && <p className="pw-warn">{q.left} free questions left today{mode === 'topic' || mode === 'quick' ? ', so the test is shorter.' : `. This test needs ${need}: choose a shorter one.`}</p>}
                    <button className="btn sun lg block" disabled={busy || (mode === 'topic' && available < 3) || (short && (mode === 'sat' || mode === 'full'))} onClick={start}>{busy ? 'Preparing…' : 'Start the test'} <IconArrow /></button>
                    <small className="pw-start-sub">Mark questions, go back and change answers until you finish.</small>
                  </>
                )}
              </div>
            )}
            {q && <Quota q={q} signedIn={meta.signed_in} />}
            {meta.recent?.length > 0 && (
              <div className="pt-box">
                <h2>Your last tests</h2>
                {meta.recent.map((r) => (
                  <Link key={r.id} to={`/practice/result/${r.id}`} className="pw-recent"><span className="muted">{new Date(r.finished_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {r.subject === 'math' ? 'Math' : 'R&W'}</span><b>{r.estimate || `${r.score}/${r.total}`}</b></Link>
                ))}
              </div>
            )}
            <button className="linkish pw-newset" onClick={() => { setMeta(null); setSeed(newSeed()); }}>Show a different set of questions</button>
          </aside>
        </div>
      )}
    </div>
  );
}

/** Between the two modules of the adaptive test. */
function ModuleBreak({ m2, onGo }) {
  return (
    <div className="pt-hub">
      <div className="pw-break">
        <Logo size={28} />
        <small className="eyebrow">MODULE 1 DONE</small>
        <h1>Module 2 is ready</h1>
        <p>{m2.route === 'hard' ? 'You did well in Module 1, so Module 2 has harder questions: the route to the top scores.' : 'Module 2 has more easy and medium questions, chosen from how Module 1 went. Every right answer counts.'}</p>
        <p className="muted">{m2.questions.length} questions · {m2.minutes} minutes</p>
        <button className="btn sun lg" onClick={onGo}>Start Module 2 <IconArrow /></button>
      </div>
    </div>
  );
}

const untilText = (iso) => {
  if (!iso) return '24 hours';
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'a moment';
  const mins = Math.ceil(ms / 60e3);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** Free daily allowance: guests and free accounts — N questions per 24 hours; subscribers are unlimited. */
function Quota({ q, signedIn }) {
  if (q.unlimited) return <div className="pt-quota pro">Unlimited practice</div>;
  const pct = Math.min(100, Math.round((q.used / Math.max(1, q.limit)) * 100));
  return (
    <div className="pt-quota">
      <div className="row between"><b>Free today</b><span>{q.left} / {q.limit} questions left</span></div>
      <i><em style={{ width: `${100 - pct}%` }} /></i>
      <small className="muted">Resets {q.used ? `in ${untilText(q.resets_at)}` : '24 hours after your first test'}. {signedIn ? <Link to="/subscribe">Unlimited with a subscription →</Link> : <Link to="/signup">Save your progress →</Link>}</small>
    </div>
  );
}
function LimitCard({ q, signedIn }) {
  return (
    <div className="pw-start">
      <IconClock width={34} height={34} />
      <b className="pw-start-h">Today’s free questions are used</b>
      <p>You answered {Math.min(q.used, q.limit)} questions in the last 24 hours — great work! New free questions open in <b>{untilText(q.resets_at)}</b>.</p>
      <Link className="btn sun lg block" to={signedIn ? '/subscribe' : '/signup'}>{signedIn ? 'Get unlimited practice' : 'Create a free account'}</Link>
    </div>
  );
}

/** Exam-style runner: one question at a time, navigator, mark for review, countdown. Answers are checked at the end. */
function Runner({ test, onDone, onModuleDone, onQuit }) {
  const qs = test.questions;
  const math = test.subject === 'math';
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState({});
  const [mark, setMark] = useState({});
  const [left, setLeft] = useState(test.minutes * 60);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [calc, setCalc] = useState(false);
  const [sheet, setSheet] = useState(false);
  const sent = useRef(false);
  const toast = useToast();
  const q = qs[cur];
  const has = (x) => ans[x.id] != null && ans[x.id] !== '';
  const answered = qs.filter(has).length;

  const submit = async () => {
    if (sent.current) return;
    sent.current = true; setBusy(true);
    try {
      if (onModuleDone) await onModuleDone(ans);
      else onDone(await api.post(`/public/practice/${test.id}/submit`, { answers: ans }));
    } catch (e) { sent.current = false; toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (left <= 0) submit(); }); // time is up → finish
  useEffect(() => {
    const f = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
      const i = L.indexOf(e.key.toUpperCase());
      if (i >= 0 && q.kind !== 'spr' && i < (q.options?.length || 4)) setAns((a) => ({ ...a, [q.id]: i }));
      else if (e.key === 'ArrowRight' && cur < qs.length - 1) setCur(cur + 1);
      else if (e.key === 'ArrowLeft' && cur > 0) setCur(cur - 1);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });
  useEffect(() => {
    const f = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, []);

  const label = test.modules === 2 ? ` · Module ${test.module}` : '';
  const last = cur === qs.length - 1;
  const spr = q.kind === 'spr';
  return (
    <>
      <BBExam
        title={`Practice test: ${math ? 'Math' : 'Reading and Writing'}${label}`} seconds={Math.max(0, left)} onExit={onQuit} exitLabel="Leave"
        directions={math
          ? <><p>Solve each problem and choose the best answer, or type your answer when there are no choices. The Desmos calculator and the reference sheet are in the top bar.</p><p>Typed answers: a whole number, a decimal or a fraction like 3/4.</p></>
          : <><p>The questions in this section address a number of important reading and writing skills. Read each passage and question carefully, and then choose the best answer based on the passage(s). Each question has a single best answer.</p><p>Highlight text in the passage, cross out choices with ABC, and use Mark for Review to come back to a question.</p></>}
        tools={math ? (
          <>
            <button className={`bb-tool ${calc ? 'on' : ''}`} onClick={() => setCalc(true)}><IconCalc width={20} height={20} /><span>Calculator</span></button>
            <button className="bb-tool" onClick={() => setSheet(true)}><IconRuler width={20} height={20} /><span>Reference</span></button>
          </>
        ) : null}
        qid={q.id} n={cur + 1} total={qs.length}
        passage={!math && (q.passage || q.table) ? <Passage text={q.passage} table={q.table} /> : null}
        before={<div className="bb-meta"><span>{q.skill}</span>{spr && <span>Type your answer</span>}</div>}
        prompt={math ? <MathText as="div">{q.prompt}</MathText> : rich(q.prompt)}
        options={spr ? null : q.options.map((o) => (math ? <MathText>{o}</MathText> : rich(o)))}
        input={spr ? (
          <label className="pw-spr"><span>Your answer</span>
            <input inputMode="decimal" autoComplete="off" value={ans[q.id] || ''} placeholder="12, -3.5 or 3/4" onChange={(e) => setAns((a) => ({ ...a, [q.id]: e.target.value.slice(0, 12) }))} />
          </label>
        ) : null}
        choice={spr ? null : ans[q.id] ?? null} onChoose={(i) => setAns((a2) => ({ ...a2, [q.id]: i }))}
        marked={mark[q.id]} onMark={() => setMark((m) => ({ ...m, [q.id]: !m[q.id] }))}
        items={qs.map((x) => ({ answered: has(x), marked: mark[x.id] }))} onGo={setCur}
        onBack={() => setCur(cur - 1)} onNext={() => (!last ? setCur(cur + 1) : setConfirm(true))}
        nextLabel={!last ? 'Next' : onModuleDone ? 'Finish Module 1' : 'Finish'}
      />
      {calc && <Modal wide title="Desmos graphing calculator" onClose={() => setCalc(false)}><Desmos className="tall" /></Modal>}
      {sheet && <ReferenceSheet onClose={() => setSheet(false)} />}

      {confirm && (
        <div className="pt-modal" role="dialog" aria-modal="true">
          <div className="pt-modal-card">
            <h2>{onModuleDone ? 'Finish Module 1?' : 'Finish the test?'}</h2>
            <p className="muted">{answered < qs.length ? `${qs.length - answered} question(s) are not answered — they will count as wrong.` : 'All questions are answered.'}{Object.values(mark).some(Boolean) ? ' Some are marked for review.' : ''}{onModuleDone ? ' You cannot come back to Module 1.' : ''}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setConfirm(false)}>Keep working</button>
              <button className="btn sun" disabled={busy} onClick={submit}>{busy ? 'One moment…' : onModuleDone ? 'Go to Module 2' : 'Finish and see score'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** /practice/result/:id — right after the test (passed in the page state) or later from a link. */
function ResultLoader({ id }) {
  const { user } = useAuth();
  const loc = useLocation();
  const [r, setR] = useState(() => (loc.state?.result?.id === id ? loc.state.result : null));
  const [err, setErr] = useState('');
  useEffect(() => {
    // after signing up the result is reloaded: now with explanations, and saved to the account
    if (!r || r.id !== id || (user && !r.explained)) api.get(`/public/practice/${id}/result`).then(setR).catch((e) => setErr(e.message));
    try { if (user && localStorage.getItem(CLAIM) === id) localStorage.removeItem(CLAIM); } catch { /* ignore */ }
  }, [id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="pt-hub"><div className="error-box">{err}</div><Link className="btn primary" to="/practice">New test</Link></div>;
  if (!r || r.id !== id) return <div className="pt-loading"><Spinner label="Scoring…" /></div>;
  return <Result r={r} />;
}

function Result({ r }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const math = r.subject === 'math';
  const [open, setOpen] = useState(() => Math.max(0, r.review.findIndex((x) => !x.correct)));
  const good = r.percent >= 80;
  const idOf = Object.fromEntries(r.review.map((x) => [x.skill, x.skill_id]));
  const weak = r.skills.filter((s) => s.n && s.ok / s.n < 0.8).sort((a, b) => a.ok / a.n - b.ok / b.n).slice(0, 3);
  const save = () => { try { localStorage.setItem(CLAIM, r.id); } catch { /* ignore */ } nav('/signup'); };
  const name = math ? 'Math' : 'Reading & Writing';
  return (
    <div className="pt-hub">
      {good && <Confetti />}
      <section className="hero-card pt-res">
        <div>
          <small className="eyebrow">{name.toUpperCase()} · {r.mode === 'full' ? 'ADAPTIVE TEST' : r.mode === 'sat' ? 'SAT MODULE' : 'PRACTICE TEST'} · RESULT</small>
          <h1>{good ? 'Excellent — that is a 700+ pace!' : r.percent >= 55 ? 'Good base. Now fix the misses.' : 'Every mistake here is a lesson.'}</h1>
          <p>You answered <b>{r.score} of {r.total}</b> correctly ({r.percent}%). Estimated {name} score: <b>{r.estimate}</b>{r.sat ? <> (likely {r.sat.low}–{r.sat.high})</> : null}. Harder questions count more, as on the real SAT.{r.total < 20 ? ' With this few questions the estimate is rough: a full module gives a sharper one.' : ''}</p>
          <div className="row wrap" style={{ marginTop: 18 }}>
            <Link className="btn primary lg" to="/practice">New test <IconArrow /></Link>
            {!user && <button className="btn on-dark lg" onClick={save}>Save my result (free)</button>}
            <ShareScore className="btn on-dark lg" card={{ score: r.estimate, low: r.sat?.low, high: r.sat?.high, label: `My SAT ${name} practice score`, correct: r.score, total: r.total, name: firstName(user?.name), date: today(),
              skills: [...r.skills].sort((a, b) => b.n - a.n).slice(0, 3).map((x) => ({ name: x.skill, pct: Math.round((x.ok / x.n) * 100) })) }} />
          </div>
        </div>
        <div className="pt-score"><b>{r.estimate}</b><span>{math ? 'Math' : 'R&W'} estimate</span><em>{r.sat ? `${r.sat.low}–${r.sat.high}` : '200 ····· 800'}</em></div>
      </section>

      {weak.length > 0 && (
        <div className="pw-plan">
          <div className="grow">
            <small className="eyebrow">YOUR NEXT STEP</small>
            <h2>Fix these first: they cost you the most points</h2>
            <ol>{weak.map((s) => <li key={s.skill}><b>{s.skill}</b> <span className="muted">{s.ok} of {s.n} right{SKILL_HINT[idOf[s.skill]] ? ` · ${SKILL_HINT[idOf[s.skill]]}` : ''}</span></li>)}</ol>
          </div>
          {user ? <Link className="btn sun" to={math ? '/math' : '/question-bank'}>Practise these</Link>
            : <div className="pw-plan-cta"><button className="btn sun" onClick={save}>Get my free study plan</button><small>Free account · your result is saved</small></div>}
        </div>
      )}

      <div className="pt-box">
        <h2>By question type</h2>
        <div className="pt-skillbars">
          {r.skills.map((s) => {
            const p = Math.round((s.ok / s.n) * 100);
            return <div key={s.skill}><span>{s.skill}</span><i><em className={p >= 80 ? 'good' : p >= 50 ? 'warn' : 'bad'} style={{ width: `${Math.max(4, p)}%` }} /></i><b>{s.ok}/{s.n}</b></div>;
          })}
        </div>
      </div>

      <div className="pt-box">
        <h2>Review every question</h2>
        {!r.explained && (
          <div className="pw-lock">
            <span className="pw-lock-ic"><IconLock width={20} height={20} /></span>
            <div className="grow"><b>See why each answer is right</b><small>A step-by-step explanation and an Ustoz tip for every question. Free: create an account and this test is saved to it.</small></div>
            <button className="btn primary" onClick={save}>Show explanations</button>
          </div>
        )}
        <div className="pt-nums review">
          {r.review.map((x, i) => <button key={`${x.id}-${i}`} className={`${x.correct ? 'right' : x.choice == null ? 'skip' : 'wrong'} ${open === i ? 'cur' : ''}`} onClick={() => setOpen(i)}>{i + 1}</button>)}
        </div>
        {r.review[open] && <ReviewItem x={r.review[open]} n={open + 1} math={math} locked={!r.explained} onUnlock={save} />}
      </div>
    </div>
  );
}

function ReviewItem({ x, n, math, locked, onUnlock }) {
  const show = (t) => (math ? <MathText>{t}</MathText> : rich(t));
  const spr = math && x.kind === 'spr';
  return (
    <div className="pt-review">
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="q-num">{n}</span><span className="chip domain">{x.skill}</span><span className={`chip lvl-${x.difficulty}`}>{LEVEL[x.difficulty]}</span>
        <span className={`chip ${x.correct ? 'good' : x.choice == null ? 'warn' : 'bad'}`}>{x.correct ? 'Correct' : x.choice == null ? 'Not answered' : 'Wrong'}</span>
      </div>
      {!math && (x.passage || x.table) && <Passage text={x.passage} table={x.table} />}
      <div style={{ fontWeight: 600 }}>{math ? <MathText as="div">{x.prompt}</MathText> : rich(x.prompt)}</div>
      {spr ? (
        <p>Your answer: <b>{x.choice ?? '—'}</b> · Right answer: <b>{(x.answer || []).join(' or ')}</b></p>
      ) : (
        <ul className="qb-opts-review">
          {x.options.map((o, k) => <li key={k} className={k === x.answer ? 'ok' : k === x.choice ? 'bad' : ''}><b>{L[k]})</b> {show(o)}{k === x.answer ? ' · correct' : k === x.choice ? ' · your answer' : ''}</li>)}
        </ul>
      )}
      {locked ? (
        <button type="button" className="pw-lock-row" onClick={onUnlock}><IconLock width={16} height={16} /> Explanation: free with an account</button>
      ) : (
        <>
          {x.explanation && <div className="muted">{math ? <MathText as="div">{x.explanation}</MathText> : rich(x.explanation)}</div>}
          {x.tip && <div className="tip"><b>Ustoz tip:</b> {show(x.tip)}</div>}
        </>
      )}
      <ReportMistake about={`Practice test question ${x.id} (${x.skill})`} />
    </div>
  );
}
