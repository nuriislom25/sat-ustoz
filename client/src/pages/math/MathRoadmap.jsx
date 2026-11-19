import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, useToast } from '../../context.jsx';
import { Card, Confetti, Gate, Modal, useAsync } from '../../components/ui.jsx';
import { IconArrow, IconBack, IconCalc, IconCheck, IconLock, IconPlay, IconRoad, IconRuler, IconX } from '../../components/icons.jsx';
import { VideoPlayer } from '../student/Roadmap.jsx';
import { BuyMath } from '../../subject.jsx';
import MathText from './MathText.jsx';
import { Desmos, ReferenceSheet } from './Desmos.jsx';

const L = ['A', 'B', 'C', 'D'];

/** The Math roadmap: units of short video lessons; pass a lesson's practice to open the next one. */
export default function MathRoadmap() {
  const st = useAsync(() => api.get('/math/roadmap'), []);
  return (
    <div className="page mr-page">
      <Gate state={st}>{(d) => {
        const pct = d.total ? Math.round((d.passed / d.total) * 100) : 0;
        return (
          <>
            <section className="mr-hero">
              <div className="grow">
                <small className="eyebrow">SAT MATH ROADMAP</small>
                <h1>Your Math path</h1>
                <p>Watch a short video, then solve its practice. Reach the pass mark and the next lesson opens.</p>
                {d.next && <Link className="btn sun lg" to={`/roadmap/lesson/${d.next.id}`}>{d.passed ? 'Continue' : 'Start'}: {d.next.title} <IconArrow /></Link>}
              </div>
              <div className="mr-ring" style={{ '--p': pct }}><b>{d.passed}/{d.total}</b><small>lessons passed</small></div>
            </section>
            {!d.paid && d.total > 0 && (
              <BuyMath title={`The first ${d.free_lessons} ${d.free_lessons === 1 ? 'lesson is' : 'lessons are'} free`} text="Every other video lesson, its practice and unlimited Math questions come with a Math plan (Pro or higher)." />
            )}
            {!d.total && (
              <Card className="soon-card inline">
                <span className="soon-ic"><IconRoad width={28} height={28} /></span>
                <h2>The Math lessons are on their way</h2>
                <p>Your teacher is recording them. Meanwhile, practise any topic with the Desmos calculator.</p>
                <Link className="btn primary" to="/practice">Practise Math <IconArrow width={16} height={16} /></Link>
              </Card>
            )}
            {d.units.map((u, ui) => (
              <section key={u.id} className="mr-unit">
                <div className="mr-unit-h"><span>Unit {ui + 1}</span><h2>{u.title}</h2><small className="muted">{u.lessons.filter((l) => l.status === 'passed').length} of {u.lessons.length} passed</small></div>
                <ol className="mr-path">
                  {u.lessons.map((l) => {
                    const open = l.status === 'open' || l.status === 'passed';
                    const body = (
                      <>
                        <span className={`mr-dot ${l.status}`}>{l.status === 'passed' ? <IconCheck width={18} height={18} /> : open ? <IconPlay width={16} height={16} /> : <IconLock width={16} height={16} />}</span>
                        <span className="grow">
                          <small>Lesson {l.n}{l.free ? ' · free' : ''}</small>
                          <b>{l.title}</b>
                          <em>{l.has_video ? 'Video' : 'Practice'} · {l.questions} questions · pass {l.pass_pct}%{l.best != null ? ` · best ${l.best}%` : ''}</em>
                        </span>
                        {l.status === 'paid' && <span className="chip sun">Math plan</span>}
                        {l.status === 'locked' && <span className="chip">Pass the one before</span>}
                        {open && <IconArrow width={18} height={18} />}
                      </>
                    );
                    return <li key={l.id}>{l.status === 'paid' ? <Link to="/subscribe?subject=math" className="mr-lesson paid">{body}</Link> : open ? <Link to={`/roadmap/lesson/${l.id}`} className={`mr-lesson ${l.status}`}>{body}</Link> : <div className="mr-lesson locked" aria-disabled="true">{body}</div>}</li>;
                  })}
                </ol>
              </section>
            ))}
          </>
        );
      }}</Gate>
    </div>
  );
}

/** One Math lesson: the video and notes, then the practice graded all at once. */
export function MathRoadLesson() {
  const { id } = useParams();
  const st = useAsync(() => api.get(`/math/roadmap/lessons/${id}`), [id]);
  return (
    <div className="page mr-page">
      <Link className="btn ghost sm" to="/roadmap" style={{ justifySelf: 'start' }}><IconBack width={16} height={16} /> Math roadmap</Link>
      <Gate state={st} error={(e) => (e.status === 402 ? <BuyMath title="This lesson comes with a Math plan" text="Get a Math plan (Pro or higher) to open every video lesson and its practice." /> : null)}>{(d) => <LessonBody key={d.id} d={d} />}</Gate>
    </div>
  );
}

function LessonBody({ d }) {
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(d.video || d.notes ? 'learn' : 'practice');
  const [sel, setSel] = useState({});
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [calc, setCalc] = useState(false);
  const [sheet, setSheet] = useState(false);
  const toPractice = () => { api.post(`/math/roadmap/lessons/${d.id}/watched`).catch(() => {}); setStep('practice'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const submit = async () => {
    const missing = d.questions.filter((q) => !String(sel[q.id] ?? '').trim()).length;
    if (missing) return toast(`Answer every question first (${missing} left)`, 'err');
    setBusy(true);
    try { setRes(await api.post(`/math/roadmap/lessons/${d.id}/submit`, { answers: sel })); window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const review = res ? Object.fromEntries(res.review.map((r) => [r.id, r])) : {};
  return (
    <>
      <header className="mr-lhead">
        <small className="eyebrow">{d.unit} · LESSON {d.n}</small>
        <h1>{d.title}</h1>
        <div className="mr-steps">
          <button className={step === 'learn' ? 'on' : ''} onClick={() => setStep('learn')} disabled={!d.video && !d.notes}><span>1</span> Watch</button>
          <i />
          <button className={step === 'practice' ? 'on' : ''} onClick={toPractice}><span>2</span> Practice · pass {d.pass_pct}%</button>
        </div>
      </header>

      {step === 'learn' && (
        <Card className="mr-learn">
          {d.video && <VideoPlayer url={d.video} />}
          {d.notes && <MathText as="div" className="mr-notes">{d.notes}</MathText>}
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn primary lg" onClick={toPractice}>I watched it, start the practice <IconArrow /></button>
          </div>
        </Card>
      )}

      {step === 'practice' && (
        <>
          {res && (
            <Card className={`mr-result ${res.passed ? 'ok' : 'no'}`}>
              {res.passed && <Confetti />}
              <div className="mr-score"><b>{res.pct}%</b><small>{res.right} of {res.total} right</small></div>
              <div className="grow">
                <h2>{res.passed ? 'Lesson passed' : `Not yet: ${res.pass_pct}% is needed`}</h2>
                <p className="muted">{res.passed ? (d.next ? 'The next lesson is open now.' : 'You finished the last lesson here.') : 'Read the solutions below, then try again.'}</p>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                {res.passed && d.next && <button className="btn sun" onClick={() => nav(`/roadmap/lesson/${d.next.id}`)}>Next: {d.next.title} <IconArrow width={16} height={16} /></button>}
                {!res.passed && <button className="btn primary" onClick={() => { setRes(null); setSel({}); }}>Try again</button>}
                <Link className="btn ghost" to="/roadmap">Roadmap</Link>
              </div>
            </Card>
          )}
          <div className="mr-tools">
            <button className="btn soft sm" onClick={() => setCalc(true)}><IconCalc width={16} height={16} /> Desmos</button>
            <button className="btn soft sm" onClick={() => setSheet(true)}><IconRuler width={16} height={16} /> Formulas</button>
          </div>
          {!d.questions.length && <Card><p className="muted">This lesson has no practice questions yet.</p></Card>}
          <div className="mr-qs">
            {d.questions.map((q, i) => {
              const r = review[q.id];
              return (
                <Card key={q.id} className={`mr-q ${r ? (r.correct ? 'ok' : 'no') : ''}`}>
                  <div className="mr-q-n">{i + 1}{r && (r.correct ? <IconCheck width={15} height={15} /> : <IconX width={15} height={15} />)}</div>
                  <div className="grow mr-q-body">
                    <MathText as="div" className="mr-prompt">{q.prompt}</MathText>
                    {q.kind === 'spr' ? (
                      <input className="mr-spr" inputMode="decimal" placeholder="Your answer" value={sel[q.id] || ''} disabled={!!res} onChange={(e) => setSel({ ...sel, [q.id]: e.target.value })} aria-label={`Answer to question ${i + 1}`} />
                    ) : (
                      <div className="mr-opts">
                        {q.options.map((o, k) => {
                          const letter = L[k];
                          const cls = r ? (letter === r.answer ? 'right' : sel[q.id] === letter ? 'wrong' : '') : sel[q.id] === letter ? 'on' : '';
                          return <button key={letter} type="button" className={`mr-opt ${cls}`} disabled={!!res} onClick={() => setSel({ ...sel, [q.id]: letter })}><span className="mr-opt-l">{letter}</span><MathText>{o}</MathText></button>;
                        })}
                      </div>
                    )}
                    {r && (
                      <div className="mr-sol">
                        {!r.correct && <b>Right answer: {Array.isArray(r.answer) ? r.answer.join(' or ') : r.answer}</b>}
                        {r.explanation && <MathText as="div">{r.explanation}</MathText>}
                        {r.tip && <p className="muted"><b>Tip:</b> {r.tip}</p>}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          {!res && d.questions.length > 0 && <div className="mr-submit"><button className="btn primary lg" disabled={busy} onClick={submit}>{busy ? 'Checking…' : 'Check my answers'}</button></div>}
        </>
      )}
      {calc && <Modal wide title="Desmos graphing calculator" onClose={() => setCalc(false)}><Desmos className="tall" /></Modal>}
      {sheet && <ReferenceSheet onClose={() => setSheet(false)} />}
    </>
  );
}
