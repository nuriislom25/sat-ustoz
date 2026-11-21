import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../../api.js';
import { Card, Empty, Gate, Segmented, useAsync } from '../../components/ui.jsx';
import { IconTask } from '../../components/icons.jsx';

const PERIODS = [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 0, label: 'All time' }];
const PARTS = [
  ['on_time', 'Done on time', 'var(--good)'],
  ['late', 'Done late', 'color-mix(in srgb, var(--good) 45%, var(--surface))'],
  ['in_progress', 'In progress', 'var(--primary)'],
  ['tried', 'Tried, not passed', 'var(--warn)'],
  ['failed', 'No tries left', 'var(--bad)'],
  ['not_started', 'Not started', 'var(--track)'],
];
const STATUS = { new: 'Not started', in_progress: 'In progress', retake: 'Not passed yet', failed: 'No tries left', closed: 'Missed the deadline' };
const ago = (d) => {
  if (!d) return 'No tries yet';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
};
const mins = (m) => (!m ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
const toneOf = (p) => (p == null ? '' : p >= 80 ? 'good' : p >= 50 ? 'warn' : 'bad');

/** One bar split into the parts of a task's life: done on time … not started. */
function Split({ o, big }) {
  if (!o.total) return <div className={`hw-split ${big ? 'big' : ''}`} />;
  return (
    <div className={`hw-split ${big ? 'big' : ''}`} role="img" aria-label={PARTS.filter(([k]) => o[k]).map(([k, l]) => `${l}: ${o[k]}`).join(', ')}>
      {PARTS.map(([k, l, c]) => (o[k] ? <i key={k} title={`${l}: ${o[k]}`} style={{ width: `${(100 * o[k]) / o.total}%`, background: c }} /> : null))}
    </div>
  );
}

/**
 * Teacher: how the students of a group are doing their homework (teacher tasks).
 * `groupId` fixes the group (the group page); without it the teacher picks a group or sees everyone.
 */
export default function HomeworkStats({ groupId }) {
  const [group, setGroup] = useState(groupId || '');
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState('attention');
  const gid = groupId || group;
  const st = useAsync(() => api.get(`/master/homework-stats?days=${days}${gid ? `&group=${gid}` : ''}`), [gid, days]);
  return (
    <div className="stack hw">
      <div className="hw-bar">
        {!groupId && (
          <label className="hw-pick">
            <span className="sr-only">Group</span>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Every student</option>
              {(st.data?.groups || []).filter((g) => !g.archived || String(g.id) === String(group)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <Segmented value={days} onChange={setDays} options={PERIODS} />
      </div>
      <Gate state={st}>{(d) => <Body d={d} sort={sort} setSort={setSort} inGroup={!!gid} />}</Gate>
    </div>
  );
}

function Body({ d, sort, setSort, inGroup }) {
  const s = d.summary;
  const students = useMemo(() => {
    const list = [...d.students];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'score') list.sort((a, b) => (b.avg_best ?? -1) - (a.avg_best ?? -1));
    if (sort === 'done') list.sort((a, b) => (b.done_pct ?? -1) - (a.done_pct ?? -1));
    return list;
  }, [d.students, sort]);
  if (!s.total) {
    return (
      <Card><Empty icon={<IconTask />} title="No homework in this period"
        text={inGroup ? 'Give this group a quiz on the Assignments page, or choose a longer period.' : 'Assign a quiz to a student or a group, or choose a longer period.'}>
        <Link className="btn primary sm" to="/assignments">Assign a quiz</Link>
      </Empty></Card>
    );
  }
  const onTimePct = s.total ? Math.round((100 * s.on_time) / s.total) : 0;
  const tiles = [
    [`${s.done_pct}%`, `done · ${s.passed} of ${s.total} tasks`, toneOf(s.done_pct)],
    [`${onTimePct}%`, 'done on time', toneOf(onTimePct)],
    [s.overdue, 'overdue now', s.overdue ? 'bad' : ''],
    [s.not_started, 'not started yet', s.not_started ? 'warn' : ''],
    [s.avg_best == null ? '—' : `${s.avg_best}%`, 'average best score', toneOf(s.avg_best)],
    [mins(s.minutes), `time on homework · ${s.tries} ${s.tries === 1 ? 'try' : 'tries'}`, ''],
  ];
  const behind = d.students.filter((x) => x.overdue > 0 || (x.total && x.done_pct < 50));
  return (
    <>
      <div className="grp-stats">{tiles.map(([v, l, t]) => <Card key={l} className={`grp-stat hw-tile ${t}`}><b>{v}</b><small>{l}</small></Card>)}</div>

      <div className="grid g2 hw-top">
        <Card>
          <h3 className="hw-h">All tasks · {s.assignments} {s.assignments === 1 ? 'quiz' : 'quizzes'} for {s.students} {s.students === 1 ? 'student' : 'students'}</h3>
          <Split o={s} big />
          <ul className="hw-legend">
            {PARTS.map(([k, l, c]) => <li key={k}><i style={{ background: c }} />{l}<b>{s[k]}</b></li>)}
          </ul>
        </Card>
        <Card>
          <h3 className="hw-h">Done on time, by week</h3>
          {!d.weeks.length ? <p className="muted">No deadlines have passed yet.</p> : (
            <div className="hw-weeks">
              {d.weeks.map((w) => {
                const p = Math.round((100 * w.done) / w.total);
                return (
                  <div key={w.week} className="hw-wk" title={`${w.done} of ${w.total} on time`}>
                    <b>{p}%</b>
                    <span><i className={toneOf(p)} style={{ height: `${Math.max(4, p)}%` }} /></span>
                    <small>{fmtDate(w.week, { day: 'numeric', month: 'short' })}</small>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {behind.length > 0 && (
        <Card className="hw-behind">
          <h3 className="hw-h">Needs a reminder · {behind.length}</h3>
          <div className="row wrap" style={{ gap: 6 }}>
            {behind.map((x) => <Link key={x.id} to={`/students/${x.id}`} className="chip bad">{x.name} · {x.overdue ? `${x.overdue} overdue` : `${x.passed}/${x.total} done`}</Link>)}
          </div>
        </Card>
      )}

      <Card className="hw-card">
        <div className="hw-head">
          <h3 className="hw-h">Students · {students.length}</h3>
          <label className="hw-sort">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="attention">Needs attention first</option>
              <option value="done">Most done first</option>
              <option value="score">Best score first</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        <div className="hw-table" role="table" aria-label="Homework by student">
          <div className="hw-row hw-th" role="row">
            <span role="columnheader">Student</span><span role="columnheader">Done</span><span role="columnheader">On time</span>
            <span role="columnheader">Overdue</span><span role="columnheader">Not started</span><span role="columnheader">Avg score</span>
            <span role="columnheader">Time</span><span role="columnheader">Last try</span>
          </div>
          {students.map((x) => (
            <div key={x.id} className="hw-row" role="row">
              <span role="cell" className="hw-name"><Link to={`/students/${x.id}`}>{x.name}</Link></span>
              <span role="cell" className="hw-done">
                {x.total ? <><Split o={x} /><b>{x.passed}/{x.total}</b></> : <span className="muted">No tasks</span>}
              </span>
              <span role="cell" data-l="On time">{x.total ? x.on_time : '—'}{x.late ? <small className="muted"> +{x.late} late</small> : null}</span>
              <span role="cell" data-l="Overdue" className={x.overdue ? 'bad-text' : ''}>{x.total ? x.overdue : '—'}</span>
              <span role="cell" data-l="Not started" className={x.not_started ? 'warn-text' : ''}>{x.total ? x.not_started : '—'}</span>
              <span role="cell" data-l="Avg score" className={`${toneOf(x.avg_best)}-text`}>{x.avg_best == null ? '—' : `${x.avg_best}%`}</span>
              <span role="cell" data-l="Time">{mins(x.minutes)}</span>
              <span role="cell" data-l="Last try" className="muted">{x.total ? ago(x.last_at) : '—'}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="hw-card">
        <h3 className="hw-h">Tasks · {d.tasks.length}</h3>
        <div className="hw-tasks">{d.tasks.map((t) => <TaskRow key={t.id} t={t} inGroup={inGroup} />)}</div>
      </Card>
    </>
  );
}

function TaskRow({ t, inGroup }) {
  const [open, setOpen] = useState(false);
  const over = t.due_at && new Date(t.due_at) < new Date();
  return (
    <div className="hw-task">
      <div className="hw-task-top">
        <div className="grow">
          <b>{t.title}</b>
          <small className="muted">
            {t.group_id ? (inGroup ? 'Whole group' : t.group_name) : `Only ${t.user_name || 'one student'}`}
            {' · given '}{fmtDate(t.created_at, { day: 'numeric', month: 'short' })}
            {t.due_at ? ` · ${over ? 'was due' : 'due'} ${fmtDate(t.due_at, { day: 'numeric', month: 'short' })}` : ' · no deadline'}
            {t.avg_best != null ? ` · average ${t.avg_best}%` : ''}
          </small>
        </div>
        <b className={`hw-of ${toneOf(t.done_pct)}-text`}>{t.passed}/{t.total}</b>
      </div>
      <Split o={t} />
      {t.missing.length > 0 && (
        <>
          <button className="as-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : `Not done yet · ${t.missing.length}`}</button>
          {open && (
            <div className="row wrap hw-miss">
              {t.missing.map((m) => <Link key={m.id} to={`/students/${m.id}`} className={`chip ${m.status === 'new' || m.status === 'closed' || m.status === 'failed' ? 'bad' : 'warn'}`}>{m.name} · {STATUS[m.status] || m.status}{m.best != null ? ` · ${m.best}%` : ''}</Link>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
