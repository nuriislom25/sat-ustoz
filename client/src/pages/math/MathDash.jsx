import { UpgradeNudge } from '../../components/Growth.jsx';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../context.jsx';
import { Avatar, Card, Empty, Gate, Segmented, useAsync } from '../../components/ui.jsx';
import { IconArrow, IconFlame, IconPlay, IconRoad, IconTarget, IconTrophy, IconChart, IconBolt, IconTask } from '../../components/icons.jsx';
import { UsageChip } from '../../usage.jsx';
import MathText from './MathText.jsx';

const DOMAIN_LOOK = { alg: '#0E9F6E', adv: '#7C4DFF', psda: '#E2553D', geo: '#2A7DE1' };

/** The Math home: daily goal, streak, the next roadmap lesson, practice by topic. */
export default function MathDash() {
  const { user } = useAuth();
  const st = useAsync(() => Promise.all([api.get('/math/me'), api.get('/math')]), []);
  const m = user.access?.math || {};
  return (
    <div className="page md-page">
      <Gate state={st}>{([me, all]) => {
        const g = me.goal; const gp = Math.min(100, Math.round((g.done / g.target) * 100));
        const next = me.roadmap.next;
        return (
          <>
            <section className="md-hero">
              <div className="grow">
                <small className="eyebrow">SAT MATH</small>
                <h1>Hi, {user.name.split(' ')[0]}</h1>
                <p>{next ? `Next on your path: ${next.title}.` : 'Practise any SAT Math topic with the Desmos calculator.'}</p>
                <div className="row wrap" style={{ gap: 10 }}>
                  {next && next.status !== 'paid' && <Link className="btn sun lg" to={`/roadmap/lesson/${next.id}`}><IconPlay width={18} height={18} /> Lesson {next.n}</Link>}
                  <Link className="btn mh-ghost lg" to="/math/practice?limit=10&status=new"><IconBolt width={18} height={18} /> Practise 10</Link>
                </div>
                <UsageChip subject="math" className="md-usage" />
              </div>
              <div className="md-goal" style={{ '--p': gp }}>
                <div className="md-goal-ring"><b>{g.done}<small>/{g.target}</small></b></div>
                <small>{g.done >= g.target ? 'Daily goal done' : 'Math questions today'}</small>
                <span className="md-streak"><IconFlame width={15} height={15} /> {me.streak} day{me.streak === 1 ? '' : 's'}</span>
              </div>
            </section>
            <UpgradeNudge user={user} subject="math" answered={me.done} />


            <div className="md-grid">
              <Link to="/roadmap" className="md-tile" style={{ '--mc': '#F28B4E' }}>
                <IconRoad width={22} height={22} /><b>Roadmap</b>
                <small>{me.roadmap.total ? `${me.roadmap.passed} of ${me.roadmap.total} lessons passed` : 'Lessons coming soon'}</small>
                <i className="md-bar"><em style={{ width: `${me.roadmap.total ? (me.roadmap.passed / me.roadmap.total) * 100 : 0}%` }} /></i>
              </Link>
              <Link to="/mistakes" className="md-tile" style={{ '--mc': '#D9425B' }}>
                <IconTarget width={22} height={22} /><b>My mistakes</b><small>{me.mistakes ? `${me.mistakes} to fix` : 'Nothing to fix'}</small>
              </Link>
              <Link to="/analytics" className="md-tile" style={{ '--mc': '#2A55E5' }}>
                <IconChart width={22} height={22} /><b>Results</b><small>{me.done ? `${Math.round((me.first_ok / me.done) * 100)}% right first time` : 'No answers yet'}</small>
              </Link>
              <Link to="/leaderboard" className="md-tile" style={{ '--mc': '#E8A93C' }}>
                <IconTrophy width={22} height={22} /><b>Leaderboard</b><small>Math, this week</small>
              </Link>
            </div>

            <section className="mh-sec">
              <div className="mh-sec-h"><h2>Practise by topic</h2><Link to="/practice" className="muted">All topics <IconArrow width={14} height={14} /></Link></div>
              <div className="md-domains">
                {all.domains.map((dm) => (
                  <Link key={dm.id} to={`/math/practice?limit=10&status=new&domain=${dm.id}`} className="md-domain" style={{ '--mc': DOMAIN_LOOK[dm.id] }}>
                    <b>{dm.name}</b>
                    <small>{dm.done} of {dm.total} done{dm.done ? ` · ${Math.round((dm.correct / dm.done) * 100)}% right` : ''}</small>
                    <i className="md-bar"><em style={{ width: `${dm.total ? (dm.done / dm.total) * 100 : 0}%` }} /></i>
                  </Link>
                ))}
              </div>
            </section>
          </>
        );
      }}</Gate>
    </div>
  );
}

/** Math mistakes: every question whose last answer was wrong; practise them again in one set. */
export function MathMistakes() {
  const st = useAsync(() => api.get('/math/mistakes'), []);
  const nav = useNavigate();
  return (
    <div className="page">
      <header className="mr-lhead"><small className="eyebrow">SAT MATH</small><h1>My Math mistakes</h1><p className="muted">Questions you got wrong. Solve them again: a right answer takes them off this list.</p></header>
      <Gate state={st}>{(d) => (d.items.length ? (
        <>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn primary lg" onClick={() => nav(`/math/practice?status=mistakes&limit=${Math.min(20, d.items.length)}`)}><IconTarget width={18} height={18} /> Practise {Math.min(20, d.items.length)} mistakes</button>
          </div>
          <div className="mm-list">
            {d.items.map((q) => (
              <Card key={q.id} className="mm-item">
                <small className="muted">{q.skill?.replace(/-/g, ' ')} · {q.difficulty}</small>
                <MathText as="div" className="mm-prompt">{q.prompt}</MathText>
                <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="chip warn">Your answer: {q.given || '—'}</span>
                  <button className="btn soft sm" onClick={() => nav(`/math/practice?ids=${q.id}&limit=1&status=all`)}>Try again <IconArrow width={14} height={14} /></button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : <Empty title="No Math mistakes" text="Wrong answers in Math practice and roadmap lessons show up here." />)}</Gate>
    </div>
  );
}

/** Math results: accuracy by domain, the last two weeks. */
export function MathResults() {
  const st = useAsync(() => Promise.all([api.get('/math/me'), api.get('/math')]), []);
  return (
    <div className="page">
      <header className="mr-lhead"><small className="eyebrow">SAT MATH</small><h1>Math results</h1></header>
      <Gate state={st}>{([me, all]) => (
        <>
          <div className="md-stats">
            <Card><b>{me.done}</b><small>questions done</small></Card>
            <Card><b>{me.done ? `${Math.round((me.first_ok / me.done) * 100)}%` : '—'}</b><small>right first time</small></Card>
            <Card><b>{me.roadmap.passed}</b><small>lessons passed</small></Card>
            <Card><b>{me.streak}</b><small>day streak</small></Card>
          </div>
          <Card>
            <h3 style={{ marginTop: 0 }}>Last 14 days</h3>
            <div className="mres-cols" role="img" aria-label="Math questions answered each day">
              {me.week.map((w) => {
                const top = Math.max(10, ...me.week.map((x) => x.answered));
                return <div key={w.day} title={`${w.day}: ${w.correct} of ${w.answered} right`}><i style={{ height: `${(w.answered / top) * 100}%` }}><em style={{ height: `${w.answered ? (w.correct / w.answered) * 100 : 0}%` }} /></i><small>{Number(w.day.slice(8))}</small></div>;
              })}
            </div>
            <small className="muted">Bar: questions answered · dark part: right first time</small>
          </Card>
          <Card>
            <h3 style={{ marginTop: 0 }}>By domain</h3>
            <div className="mres-dom">
              {all.domains.map((dm) => {
                const p = dm.done ? Math.round((dm.correct / dm.done) * 100) : null;
                return (
                  <div key={dm.id} className="mres-row" style={{ '--mc': DOMAIN_LOOK[dm.id] }}>
                    <b>{dm.name}</b><small className="muted">{dm.done}/{dm.total}</small>
                    <i className="md-bar"><em style={{ width: `${p || 0}%` }} /></i>
                    <span>{p == null ? '—' : `${p}%`}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}</Gate>
    </div>
  );
}

/** Math leaderboard: right answers in practice and lessons. */
export function MathLeaderboard() {
  const [period, setPeriod] = useState('week');
  const st = useAsync(() => api.get(`/math/leaderboard?period=${period}`), [period]);
  return (
    <div className="page">
      <header className="mr-lhead"><small className="eyebrow">SAT MATH</small><h1>Math leaderboard</h1><p className="muted">One point for every Math question right on the first try.</p></header>
      <Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: 'This week' }, { value: 'month', label: '30 days' }, { value: 'all', label: 'All time' }]} />
      <Gate state={st}>{(d) => (d.list.length ? (
        <Card className="mlb">
          {d.list.map((r) => (
            <div key={r.id} className={`mlb-row ${r.me ? 'me' : ''} ${r.rank <= 3 ? `top${r.rank}` : ''}`}>
              <span className="mlb-rank">{r.rank}</span>
              <Avatar name={r.name} src={r.avatar_url} />
              <b className="grow">{r.name}{r.me ? ' (you)' : ''}</b>
              <span className="mlb-pts">{r.correct}<small> pts</small></span>
            </div>
          ))}
        </Card>
      ) : <Empty title="No Math answers yet" text="Solve Math questions to be the first on the board." />)}</Gate>
    </div>
  );
}
