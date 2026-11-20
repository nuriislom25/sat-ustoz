import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Gate, PageHeader, useAsync } from '../../components/ui.jsx';
import { IconBack, IconEdit, IconEye, IconEyeOff, IconPrint } from '../../components/icons.jsx';
import { Passage } from '../../components/Passage.jsx';
import { rich } from '../../components/Rich.jsx';
import MathText from '../math/MathText.jsx';

const L = ['A', 'B', 'C', 'D'];

/** Teacher: read every question of a quiz — passage, choices, the right answer, explanation and tip. */
export default function QuizPreview() {
  const { id } = useParams();
  const st = useAsync(() => api.get(`/quizzes/${id}`), [id]);
  const [show, setShow] = useState(true);
  return (
    <div className="page qp-page">
      <Gate state={st}>{(q) => {
        const math = q.section === 'math';
        const T = (t, block) => (math ? <MathText as={block ? 'div' : 'span'}>{t}</MathText> : rich(t));
        return (
          <>
            <PageHeader title={q.title} sub={`${q.questions.length} questions · ${q.duration_min ? `${q.duration_min} min` : 'untimed'} · ${math ? 'Math' : 'Reading & Writing'}`}>
              <Link className="btn ghost" to="/quizzes"><IconBack width={16} height={16} /> Quizzes</Link>
              <button className="btn ghost" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />} {show ? 'Hide answers' : 'Show answers'}</button>
              <button className="btn ghost" onClick={() => window.print()}><IconPrint width={16} height={16} /> Print</button>
              <Link className="btn primary" to={`/quizzes/${q.id}/edit`}><IconEdit width={16} height={16} /> Edit</Link>
            </PageHeader>
            <nav className="qp-jump" aria-label="Jump to a question">
              {q.questions.map((x, i) => <a key={x.id} href={`#qp-${i + 1}`}>{i + 1}</a>)}
            </nav>
            {!q.questions.length && <Card><p className="muted">This quiz has no questions yet.</p></Card>}
            <div className="qp-list">
              {q.questions.map((x, i) => {
                const opts = [x.opt_a, x.opt_b, x.opt_c, x.opt_d];
                const right = L.indexOf(String(x.correct || '').toUpperCase());
                return (
                  <Card key={x.id} className="qp-q" id={`qp-${i + 1}`}>
                    <div className="qp-head"><span className="q-num">{i + 1}</span>{x.topic && x.topic !== 'General' && <span className="chip domain">{x.topic}</span>}{show && right >= 0 && <span className="chip good">Answer {L[right]}</span>}</div>
                    {x.passage && (math ? <MathText as="div" className="qp-passage">{x.passage}</MathText> : <Passage text={x.passage} />)}
                    <div className="qp-prompt">{T(x.prompt, true)}</div>
                    <ol className="qp-opts">
                      {opts.map((o, k) => (o ? (
                        <li key={k} className={show && k === right ? 'ok' : ''}><b>{L[k]}</b><span>{T(o)}</span></li>
                      ) : null))}
                    </ol>
                    {show && (x.explanation || x.tip) && (
                      <div className="qp-expl">
                        {x.explanation && <div><b>Explanation</b>{T(x.explanation, true)}</div>}
                        {x.tip && <div className="tip"><b>Ustoz tip:</b> {T(x.tip)}</div>}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        );
      }}</Gate>
    </div>
  );
}
