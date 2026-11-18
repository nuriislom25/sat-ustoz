import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Gate, useAsync } from '../../components/ui.jsx';
import { IconArrow, IconCalc, IconChevron } from '../../components/icons.jsx';
import MathText from './MathText.jsx';
import { Desmos } from './Desmos.jsx';

/** A worked example: the problem, then one step at a time, the answer, the Desmos way, and "try one yourself". */
export default function MathLesson() {
  const { id } = useParams();
  const st = useAsync(() => Promise.all([api.get(`/math/lessons/${id}`), api.get('/math')]), [id]);
  return (
    <div className="page math-page mlx">
      <Gate state={st}>{([l, all]) => <Lesson key={l.id} l={l} all={all} />}</Gate>
    </div>
  );
}

function Lesson({ l, all }) {
  const [shown, setShown] = useState(1);
  const [calc, setCalc] = useState(false);
  const done = shown >= l.steps.length;
  const i = all.lessons.findIndex((x) => x.id === l.id);
  const next = all.lessons[i + 1];
  const dname = all.domains.find((d) => d.id === l.domain)?.name;
  return (
    <>
      <Link to="/math" className="mlx-back"><IconChevron width={16} height={16} /> SAT Math</Link>
      <header className="mlx-head">
        <small className="eyebrow">{dname} · worked example {i + 1} of {all.lessons.length}</small>
        <h1>{l.title}</h1>
      </header>
      <section className="mlx-problem">
        <small>Problem</small>
        <MathText as="div" className="mlx-big">{l.problem}</MathText>
      </section>
      <ol className="mlx-steps">
        {l.steps.slice(0, shown).map((s, k) => (
          <li key={k} className="mlx-step"><span className="mlx-n">{k + 1}</span><MathText as="div">{s}</MathText></li>
        ))}
      </ol>
      {!done ? (
        <button className="btn primary lg mlx-next" onClick={() => setShown((n) => n + 1)}>Next step <IconArrow /></button>
      ) : (
        <>
          <section className="mlx-answer"><small>Answer</small><MathText as="div" className="mlx-big">{l.answer}</MathText></section>
          {l.desmos && (
            <section className="mlx-desmos">
              <div className="row between wrap" style={{ gap: 8 }}>
                <b><IconCalc width={18} height={18} /> The Desmos way</b>
                <button className="btn ghost sm" onClick={() => setCalc((c) => !c)}>{calc ? 'Hide calculator' : 'Open calculator'}</button>
              </div>
              <p>{l.desmos}</p>
              {calc && <Desmos />}
            </section>
          )}
          <div className="mlx-actions">
            <Link className="btn sun lg" to={`/math/practice?ids=${l.tryit}&status=all&then=${l.skill}`}>Try one yourself <IconArrow /></Link>
            {next ? <Link className="btn ghost lg" to={`/math/learn/${next.id}`}>Next example: {next.title}</Link> : <Link className="btn ghost lg" to="/math">Back to SAT Math</Link>}
          </div>
        </>
      )}
      <div className="mlx-dots" aria-hidden="true">{l.steps.map((_, k) => <i key={k} className={k < shown ? 'on' : ''} />)}</div>
    </>
  );
}
