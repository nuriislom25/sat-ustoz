import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../context.jsx';
import { Card, Gate, Modal, useAsync } from '../../components/ui.jsx';
import { IconArrow, IconCalc, IconCheck, IconClock, IconRuler } from '../../components/icons.jsx';
import { Desmos, ReferenceSheet } from './Desmos.jsx';
import MathAdmin from './MathAdmin.jsx';
import PracticeTabs from '../../components/PracticeTabs.jsx';

const DOMAIN_LOOK = { alg: ['#0E9F6E', 'x + y'], adv: ['#7C4DFF', 'x²'], psda: ['#E2553D', '%'], geo: ['#2A7DE1', '△'] };
const LEVELS = [['', 'All levels'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

export default function MathHome() {
  const { user } = useAuth();
  return user.role === 'master' ? <MathAdmin /> : <StudentMath />;
}

/** Student: worked examples to start with, then practice by domain and skill, with Desmos one tap away. */
function StudentMath() {
  const st = useAsync(() => api.get('/math'), []);
  const nav = useNavigate();
  const [level, setLevel] = useState('');
  const [which, setWhich] = useState('new');
  const [calc, setCalc] = useState(false);
  const [sheet, setSheet] = useState(false);
  const go = (p) => {
    const q = new URLSearchParams({ limit: '10', status: which, ...p });
    if (level) q.set('difficulty', level);
    nav(`/math/practice?${q}`);
  };
  return (
    <div className="page math-page">
      <PracticeTabs />
      <Gate state={st}>{(d) => {
        const pct = d.done ? Math.round((d.correct / d.done) * 100) : null;
        return (
          <>
            <section className="mh-hero">
              <div className="mh-hero-copy">
                <small className="eyebrow">SAT MATH</small>
                <h1>Math, one clear step at a time</h1>
                <p>Start with the worked examples, then practise every SAT Math topic. The Desmos calculator you get on test day is always one tap away.</p>
                <div className="row wrap" style={{ gap: 10 }}>
                  <button className="btn sun lg" onClick={() => go({})}>Practise 10 questions <IconArrow /></button>
                  <button className="btn mh-ghost lg" onClick={() => setCalc(true)}><IconCalc /> Desmos</button>
                  <button className="btn mh-ghost lg" onClick={() => setSheet(true)}><IconRuler /> Formulas</button>
                </div>
              </div>
              <div className="mh-stats">
                <div><b>{d.done}</b><small>of {d.total} done</small></div>
                <div><b>{pct == null ? '—' : `${pct}%`}</b><small>right first time</small></div>
                <div className="mh-graph" aria-hidden="true"><svg viewBox="0 0 120 80"><path d="M6 70 Q 40 70 60 40 T 114 8" /><line x1="6" y1="74" x2="114" y2="74" /><line x1="10" y1="6" x2="10" y2="78" /></svg></div>
              </div>
            </section>

            <section className="mh-sec">
              <div className="mh-sec-h"><h2>Start here</h2><p className="muted">Worked examples: read each step, then try one on your own.</p></div>
              <div className="mh-lessons">
                {d.lessons.map((l, i) => {
                  const [c, sym] = DOMAIN_LOOK[l.domain] || [];
                  return (
                    <Link key={l.id} to={`/math/learn/${l.id}`} className="mh-lesson" style={{ '--mc': c }}>
                      <span className="mh-lesson-n">{sym}</span>
                      <span className="grow"><small>{d.domains.find((x) => x.id === l.domain)?.name} · example {i + 1}</small><b>{l.title}</b></span>
                      <span className="mh-lesson-t"><IconClock width={14} height={14} /> {l.minutes} min</span>
                    </Link>
                  );
                })}
              </div>
            </section>

            <section className="mh-sec">
              <div className="mh-sec-h"><h2>Practise by topic</h2><p className="muted">Tap a topic to start 10 questions. A wrong answer can be tried again; then you see the solution.</p></div>
              <Card className="mh-filters">
                <div className="mh-filter"><b>Level</b><div className="mh-chips">{LEVELS.map(([v, l]) => <button key={v} className={`mh-chip ${level === v ? 'on' : ''}`} onClick={() => setLevel(v)}>{l}</button>)}</div></div>
                <div className="mh-filter"><b>Questions</b><div className="mh-chips">{[['new', 'Not done yet'], ['mistakes', 'My mistakes'], ['all', 'All']].map(([v, l]) => <button key={v} className={`mh-chip ${which === v ? 'on' : ''}`} onClick={() => setWhich(v)}>{l}</button>)}</div></div>
              </Card>
              <div className="mh-domains">
                {d.domains.map((dm) => {
                  const [c, sym] = DOMAIN_LOOK[dm.id] || [];
                  const p = dm.total ? Math.round((dm.done / dm.total) * 100) : 0;
                  return (
                    <Card key={dm.id} className="mh-domain" style={{ '--mc': c }}>
                      <div className="mh-domain-top">
                        <span className="mh-sym">{sym}</span>
                        <div className="grow"><h3>{dm.name}</h3><small className="muted">{dm.done} of {dm.total} done{dm.done ? ` · ${Math.round((dm.correct / dm.done) * 100)}% right` : ''}</small></div>
                        <button className="btn sm mh-go" onClick={() => go({ domain: dm.id })}>Practise <IconArrow width={15} height={15} /></button>
                      </div>
                      <div className="mh-bar"><i style={{ width: `${p}%` }} /></div>
                      <div className="mh-skills">
                        {dm.skills.map((s) => (
                          <button key={s.id} className="mh-skill" onClick={() => go({ skill: s.id })}>
                            <span>{s.name}</span>
                            <small>{s.done === s.total && s.total ? <IconCheck width={14} height={14} /> : `${s.done}/${s.total}`}</small>
                          </button>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
            {calc && (
              <Modal wide title="Desmos graphing calculator" onClose={() => setCalc(false)}>
                <Desmos className="tall" />
              </Modal>
            )}
            {sheet && <ReferenceSheet onClose={() => setSheet(false)} />}
          </>
        );
      }}</Gate>
    </div>
  );
}
