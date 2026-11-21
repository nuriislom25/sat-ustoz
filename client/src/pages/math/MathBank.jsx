import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../context.jsx';
import { Empty, Gate, PageHeader, Segmented, useAsync } from '../../components/ui.jsx';
import { IconArrow } from '../../components/icons.jsx';
import PracticeTabs from '../../components/PracticeTabs.jsx';
import { UsageChip } from '../../usage.jsx';
import { BuyMath } from '../../subject.jsx';

const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

/** Math Question Bank: the same page as the Reading & Writing one — pick a domain or skill, level and status, practise. */
export default function MathBank() {
  const st = useAsync(() => api.get('/math'), []);
  return (
    <div className="page">
      <PracticeTabs />
      <Gate state={st}>{(d) => <Bank d={d} />}</Gate>
    </div>
  );
}

function Bank({ d }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [scope, setScope] = useState({ kind: 'all' }); // all | domain | skill
  const [levels, setLevels] = useState(() => new Set(LEVELS.map(([l]) => l)));
  const [status, setStatus] = useState('new');
  const [count, setCount] = useState('10');
  const domains = d.domains.filter((x) => x.total > 0);
  const allSkills = domains.flatMap((x) => x.skills.map((s) => ({ ...s, domain: x.id })));
  const inScope = scope.kind === 'all' ? allSkills : scope.kind === 'domain' ? allSkills.filter((s) => s.domain === scope.id) : allSkills.filter((s) => s.id === scope.id);
  // "not done yet" / "my mistakes" narrow what is left; the server picks the questions
  const left = (s) => (status === 'new' ? Math.max(0, s.total - s.done) : status === 'mistakes' ? Math.max(0, s.done - s.correct) : s.total);
  const share = (s) => (s.total ? [...levels].reduce((m, l) => m + (s.per?.[l] || 0), 0) / s.total : 0);
  const available = Math.round(inScope.reduce((n, s) => n + left(s) * share(s), 0));
  const scopeLabel = scope.kind === 'all' ? 'All SAT Math' : scope.kind === 'domain' ? domains.find((x) => x.id === scope.id)?.name : allSkills.find((s) => s.id === scope.id)?.name;
  const toggleLevel = (l) => setLevels((s) => { const n = new Set(s); n.has(l) ? n.size > 1 && n.delete(l) : n.add(l); return n; });
  const start = () => {
    const q = new URLSearchParams({ difficulty: [...levels].join(','), status, limit: count });
    if (scope.kind === 'domain') q.set('domain', scope.id);
    if (scope.kind === 'skill') q.set('skill', scope.id);
    nav(`/math/practice?${q.toString()}`);
  };
  const isOn = (k, id) => scope.kind === k && (k === 'all' || scope.id === id);
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const f = () => setPhone(mq.matches);
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, []);
  const startBtn = <button className="btn primary lg block" disabled={!available} onClick={start}>Start {Math.max(1, Math.min(available, Number(count)))} questions <IconArrow /></button>;
  const math = user.access?.math || {};

  if (!domains.length) return <Empty title="The Math Question Bank is being filled" text="Your teacher is adding SAT Math questions. Check back soon." />;
  return (
    <>
      <PageHeader title="Math Question Bank" sub="Choose a skill, set the level and practise with the Desmos calculator. Every answer comes with an explanation.">
        <span className="qb-done"><b>{d.done}</b> of {d.total} done{d.done > 0 && <> · {Math.round((d.correct / d.done) * 100)}% right</>}</span>
        <UsageChip subject="math" />
      </PageHeader>

      {!math.sub_active && <BuyMath title="Free Math trial" text={`${math.tier?.q_day || 10} questions a day are free. A Math plan removes the limit.`} />}

      <div className="qb-layout">
        <div className="qb-list">
          <button type="button" className={`qb-row qb-row-all ${isOn('all') ? 'on' : ''}`} onClick={() => setScope({ kind: 'all' })} aria-pressed={isOn('all')}>
            <i className="qb-radio" /><span className="nm">All skills, mixed</span><span className="ct">{d.total}</span>
          </button>
          {domains.map((dm, k) => (
            <section key={dm.id} className={`qb-group c${k % 4}`}>
              <button type="button" className={`qb-row qb-ghead ${isOn('domain', dm.id) ? 'on' : ''}`} onClick={() => setScope({ kind: 'domain', id: dm.id })} aria-pressed={isOn('domain', dm.id)}>
                <i className="qb-radio" /><span className="nm">{dm.name}</span><span className="ct">{dm.total}</span>
              </button>
              {dm.skills.map((s) => (
                <button type="button" key={s.id} className={`qb-row ${isOn('skill', s.id) ? 'on' : ''}`} onClick={() => setScope({ kind: 'skill', id: s.id })} aria-pressed={isOn('skill', s.id)}>
                  <i className="qb-radio" /><span className="nm">{s.name}</span><span className="ct">{s.done}/{s.total}</span>
                </button>
              ))}
            </section>
          ))}
        </div>

        <aside className="card qb-panel">
          <h2>{scopeLabel}</h2>
          <div className="qb-field">
            <b>Level</b>
            <div className="qb-levels">
              {LEVELS.map(([l, name]) => (
                <button key={l} type="button" className={`qb-level ${levels.has(l) ? 'on' : ''}`} onClick={() => toggleLevel(l)} aria-pressed={levels.has(l)}>{name}</button>
              ))}
            </div>
          </div>
          <div className="qb-field">
            <b>Which questions</b>
            <Segmented value={status} onChange={setStatus} options={[{ value: 'new', label: 'Not done yet' }, { value: 'mistakes', label: 'My mistakes' }, { value: 'all', label: 'All' }]} />
          </div>
          <div className="qb-field">
            <b>How many</b>
            <Segmented value={count} onChange={setCount} options={[{ value: '5', label: '5' }, { value: '10', label: '10' }, { value: '20', label: '20' }]} />
          </div>
          {!available && <p className="qb-empty">No questions here yet. Try another level or “All”.</p>}
          {phone ? createPortal(<div className="qb-go">{startBtn}</div>, document.body) : <div className="qb-go">{startBtn}</div>}
        </aside>
      </div>
    </>
  );
}
