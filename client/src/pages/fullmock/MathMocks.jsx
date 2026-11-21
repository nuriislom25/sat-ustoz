import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../../api.js';
import { useAuth, useToast } from '../../context.jsx';
import { Card, Confetti, Confirm, ErrorBox, Gate, Modal, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';
import { BBExam } from '../../components/Bluebook.jsx';
import MathText from '../math/MathText.jsx';
import { Desmos, ReferenceSheet } from '../math/Desmos.jsx';
import { fmtMoney } from '../student/Subscribe.jsx';
import { ShareScore, firstName, today } from '../../components/Growth.jsx';
import { IconArrow, IconCalc, IconClock, IconCrown, IconDoc, IconLock, IconRuler } from '../../components/icons.jsx';

/** SAT Math full mocks: one built from the Question Bank for each student, plus the teacher's uploaded tests. */
export default function MathMocks() {
  const st = useAsync(() => api.get('/math-mocks'), []);
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(0);
  const [buy, setBuy] = useState(null);
  const start = async (m, pay = false) => {
    setBusy(m.id);
    try { const a = await api.post(`/math-mocks/${m.id}/start`, { pay }); nav(`/math-mock/${a.id}`); }
    catch (e) { if (e.data?.code === 'full_mock_limit') setBuy(m); else toast(e.message, 'bad'); st.reload(); } finally { setBusy(0); }
  };
  return (
    <div className="page">
      <PageHeader title="Math Full Mocks" sub="Two Math modules of 22 questions, 35 minutes each, with Desmos. Module 1 decides whether Module 2 is harder or easier, like the real SAT." />
      <Gate state={st}>{({ quota: q, mocks, bank_ready: ready }) => (
        <>
          <div className={`fm-quota ${q.left ? '' : 'out'}`}>
            <div>
              <small>{q.math_plan ? 'Math plan' : 'Free Math'} · this week</small>
              <b>{q.unlimited ? 'Unlimited' : `${q.left} of ${q.limit} left`}</b>
              <span>{q.unlimited ? 'Your plan has no weekly limit.' : q.left ? 'A mock counts when you start it.' : `New mocks open ${fmtDate(q.resets_at)} (Monday). Extra mock: ${fmtMoney(q.extra_price, 'UZS')} from your wallet.`}</span>
            </div>
            {!q.unlimited && <div className="fm-dots" aria-hidden="true">{Array.from({ length: Math.min(q.limit, 7) }, (_, i) => <i key={i} className={i < q.used ? 'used' : ''} />)}</div>}
            {!q.math_plan && <Link className="btn sun" to="/subscribe?subject=math"><IconCrown width={16} height={16} /> More mocks with a Math plan</Link>}
          </div>
          <div className="fm-list stagger">
            {mocks.map((m) => {
              const open = m.attempts.find((a) => a.stage !== 'done');
              const done = m.attempts.filter((a) => a.stage === 'done');
              const best = done.reduce((b, a) => Math.max(b, a.score || 0), 0);
              const off = m.mode === 'bank' && !ready;
              return (
                <Card key={m.id} className="fm-card">
                  <div className="fm-card-top">
                    <span className="fm-ic"><IconDoc width={22} height={22} weight="duotone" /></span>
                    <div className="grow">
                      <h3>{m.title}</h3>
                      <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                        <span className="chip"><IconClock width={13} height={13} /> 2 × {m.minutes} min</span>
                        <span className="chip">Math · Desmos</span>
                        {m.mode === 'bank' && <span className="chip">New questions every time</span>}
                      </div>
                      {m.note && <p className="muted" style={{ marginTop: 8 }}>{m.note}</p>}
                    </div>
                    {best > 0 && <div className="fm-best"><b>{best}</b><small>best</small></div>}
                  </div>
                  {done.length > 0 && <div className="fm-tries">{done.slice(0, 3).map((a) => <Link key={a.id} to={`/math-mock/${a.id}`}><span>{fmtDate(a.finished_at)}</span><b>{a.score}</b><IconArrow width={14} height={14} /></Link>)}</div>}
                  <div className="row" style={{ marginTop: 12 }}>
                    {off ? <button className="btn ghost" disabled>Coming soon: the bank is being filled</button>
                      : open ? <button className="btn primary" onClick={() => nav(`/math-mock/${open.id}`)}>Continue <IconArrow width={16} height={16} /></button>
                        : q.left > 0 ? <button className="btn primary" disabled={busy === m.id} onClick={() => start(m)}>{done.length ? 'Take again' : 'Start mock'} <IconArrow width={16} height={16} /></button>
                          : <button className="btn soft" disabled={busy === m.id} onClick={() => setBuy(m)}><IconLock width={16} height={16} /> One more · {fmtMoney(q.extra_price, 'UZS')}</button>}
                  </div>
                </Card>
              );
            })}
          </div>
          {buy && (q.balance >= q.extra_price
            ? <Confirm danger={false} title="Take one extra Math mock?" confirmLabel={`Pay ${fmtMoney(q.extra_price, 'UZS')}`} onClose={() => setBuy(null)} onConfirm={() => { const m = buy; setBuy(null); start(m, true); }}
              text={`${fmtMoney(q.extra_price, 'UZS')} will be taken from your wallet (${fmtMoney(q.balance, 'UZS')}). With a Math plan, full mocks are included every week.`} />
            : <Confirm danger={false} title="Not enough in your wallet" confirmLabel="See Math plans" onClose={() => setBuy(null)} onConfirm={() => nav('/subscribe?subject=math')}
              text={`An extra mock costs ${fmtMoney(q.extra_price, 'UZS')}; your wallet has ${fmtMoney(q.balance, 'UZS')}. A Math plan includes full mocks every week.`} />)}
        </>
      )}</Gate>
    </div>
  );
}

/** Takes one Math mock (Module 1 → Module 2 → result) in the Bluebook layout. */
export function MathMockTaker() {
  const { aid } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get(`/math-mocks/attempt/${aid}`).then(setA).catch(setErr); }, [aid]);
  if (err) return <div className="page"><ErrorBox error={err} /></div>;
  if (!a) return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><Spinner /></div>;
  if (a.stage === 'done') return <MathMockResult a={a} />;
  return <Module key={`${a.id}-${a.stage}`} a={a} onNext={setA} />;
}

function Module({ a, onNext }) {
  const nav = useNavigate();
  const toast = useToast();
  const qs = a.questions;
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState(a.answers || {});
  const [mark, setMark] = useState({});
  const [left, setLeft] = useState(a.remaining);
  const [calc, setCalc] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);
  const q = qs[cur];
  const has = (x) => ans[x.id] != null && ans[x.id] !== '';
  // answers are saved as the student goes (a reload or a lost connection keeps them)
  useEffect(() => { const t = setTimeout(() => api.put(`/math-mocks/attempt/${a.id}`, { answers: ans }).catch(() => {}), 600); return () => clearTimeout(t); }, [ans, a.id]);
  useEffect(() => { const t = setInterval(() => setLeft((s) => s - 1), 1000); return () => clearInterval(t); }, []);
  const finish = async () => {
    if (sent.current) return; sent.current = true; setBusy(true);
    try { const r = await api.post(`/math-mocks/attempt/${a.id}/next`, { answers: ans }); window.scrollTo(0, 0); onNext(r); }
    catch (e) { sent.current = false; toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  useEffect(() => { if (left <= 0) finish(); });
  const spr = q?.kind === 'spr';
  const last = cur === qs.length - 1;
  const answered = qs.filter(has).length;
  if (!q) return <div className="page"><ErrorBox error={{ message: 'This module has no questions.' }} /></div>;
  return (
    <>
      <BBExam title={`${a.mock.title} · ${a.module_label}`} seconds={Math.max(0, left)} onExit={() => nav('/full-mocks')} exitLabel="Save & exit"
        directions={<><p>Solve each problem and choose the best answer, or type your answer when there are no choices. Desmos and the reference sheet are in the top bar.</p><p>Typed answers: a whole number, a decimal or a fraction like 3/4. Answers are saved as you go.</p></>}
        tools={<>
          <button className={`bb-tool ${calc ? 'on' : ''}`} onClick={() => setCalc(true)}><IconCalc width={20} height={20} /><span>Calculator</span></button>
          <button className="bb-tool" onClick={() => setSheet(true)}><IconRuler width={20} height={20} /><span>Reference</span></button>
        </>}
        qid={q.id} n={cur + 1} total={qs.length}
        before={<div className="bb-meta"><span>{q.domain}</span>{spr && <span>Type your answer</span>}</div>}
        prompt={<MathText as="div">{q.prompt}</MathText>}
        options={spr ? null : q.options.map((o) => <MathText key={o}>{o}</MathText>)}
        input={spr ? <label className="pw-spr"><span>Your answer</span><input inputMode="decimal" autoComplete="off" value={ans[q.id] || ''} placeholder="12, -3.5 or 3/4" onChange={(e) => setAns((x) => ({ ...x, [q.id]: e.target.value.slice(0, 12) }))} /></label> : null}
        choice={spr ? null : ans[q.id] ?? null} onChoose={(i) => setAns((x) => ({ ...x, [q.id]: i }))}
        marked={mark[q.id]} onMark={() => setMark((m) => ({ ...m, [q.id]: !m[q.id] }))}
        items={qs.map((x) => ({ answered: has(x), marked: mark[x.id] }))} onGo={setCur}
        onBack={() => setCur(cur - 1)} onNext={() => (!last ? setCur(cur + 1) : setConfirm(true))}
        nextLabel={!last ? 'Next' : a.stage === 'm1' ? 'Finish Module 1' : 'Finish'} />
      {calc && <Modal wide title="Desmos graphing calculator" onClose={() => setCalc(false)}><Desmos className="tall" /></Modal>}
      {sheet && <ReferenceSheet onClose={() => setSheet(false)} />}
      {confirm && <Confirm danger={false} title={a.stage === 'm1' ? 'Finish Module 1?' : 'Finish the test?'} confirmLabel={busy ? 'One moment…' : a.stage === 'm1' ? 'Go to Module 2' : 'Finish and see score'}
        text={`${answered < qs.length ? `${qs.length - answered} question(s) are not answered and count as wrong.` : 'All questions are answered.'}${a.stage === 'm1' ? ' You cannot come back to Module 1.' : ''}`}
        onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); finish(); }} />}
    </>
  );
}

function MathMockResult({ a }) {
  const { user } = useAuth();
  const r = a.result;
  const [open, setOpen] = useState(null);
  const all = a.review.flatMap((m) => m.questions.map((q, i) => ({ ...q, n: i + 1, label: m.label })));
  const total = r.m1_total + r.m2_total;
  const weak = [...(a.domains || [])].sort((x, y) => x.pct - y.pct).filter((d) => d.pct < 80).slice(0, 2);
  return (
    <div className="page math-page mm-result">
      {r.score >= 700 && <Confetti />}
      <section className="mr-hero ok">
        <div>
          <small className="tq-eyebrow">MATH FULL MOCK · {fmtDate(a.finished_at)}</small>
          <h1>{a.mock.title}</h1>
          <p>{r.m1 + r.m2} of {total} correct. Estimated Math score {r.score} (likely {r.low}–{r.high}).{r.route ? ` Module 1 sent you to the ${r.route === 'hard' ? 'harder' : 'easier'} Module 2${r.route === 'easy' ? ', which caps the section near 630' : ''}.` : ''}</p>
          <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
            <Link className="btn sun lg" to="/full-mocks">Math Full Mocks <IconArrow /></Link>
            <Link className="btn on-dark lg" to="/question-bank">Practise weak topics</Link>
            <ShareScore className="btn on-dark lg" card={{ score: r.score, low: r.low, high: r.high, label: 'My SAT Math mock score', correct: r.m1 + r.m2, total, name: firstName(user?.name), date: today(), skills: (a.domains || []).slice(0, 3).map((d) => ({ name: d.domain, pct: d.pct })) }} />
          </div>
        </div>
        <div className="mr-side"><div className="mr-acc"><b>{r.score}</b><span>Math score</span></div><small className="mr-pct">{r.low}–{r.high}</small></div>
      </section>
      <div className="mm-domains">
        {(a.domains || []).map((d) => <Card key={d.domain}><small className="muted">{d.domain}</small><b>{d.correct}/{d.total}</b><i className="focus3-bar"><em style={{ width: `${Math.max(4, d.pct)}%`, background: d.pct >= 80 ? 'var(--mint)' : d.pct >= 55 ? 'var(--sun)' : 'var(--coral)' }} /></i></Card>)}
      </div>
      {weak.length > 0 && <p className="muted" style={{ margin: '10px 0 18px' }}>Fix first: <b style={{ color: 'var(--ink)' }}>{weak.map((d) => d.domain).join(' and ')}</b>. Practise them in the Math Question Bank.</p>}
      <Card>
        <h2 style={{ marginBottom: 10 }}>Every question</h2>
        <div className="pt-nums review">{all.map((q, i) => <button key={`${q.id}-${i}`} className={`${q.correct ? 'right' : q.choice == null ? 'skip' : 'wrong'} ${open === i ? 'cur' : ''}`} onClick={() => setOpen(open === i ? null : i)}>{i + 1}</button>)}</div>
        {open != null && (() => {
          const q = all[open];
          return (
            <div className="mm-review">
              <small className="muted">{q.label} · question {q.n} · {q.domain}</small>
              <MathText as="div">{q.prompt}</MathText>
              {q.kind === 'spr'
                ? <p>Your answer: <b>{q.choice ?? '—'}</b> · Accepted: <b>{(q.answer || []).join(', ')}</b></p>
                : <ol className="mm-opts">{q.options.map((o, k) => <li key={k} className={k === q.answer ? 'ok' : k === q.choice ? 'bad' : ''}><MathText>{o}</MathText></li>)}</ol>}
              {q.explanation && <div className="mm-expl"><b>Explanation</b><MathText as="div">{q.explanation}</MathText></div>}
            </div>
          );
        })()}
      </Card>
    </div>
  );
}
