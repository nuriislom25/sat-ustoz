import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Avatar, Card, Confirm, Empty, Gate, Modal, useAsync } from '../../components/ui.jsx';
import { IconArchive, IconCalendar, IconChevron, IconClock, IconCopy, IconEdit, IconHistory, IconMove, IconSearch, IconTelegram, IconTrash, IconUserPlus, IconUsers } from '../../components/icons.jsx';
import { GroupForm, SUBJECT, scheduleText, shortDate } from './Groups.jsx';

const TABS = [['students', 'Students'], ['attendance', 'Attendance'], ['stats', 'Statistics'], ['history', 'History']];
const MARK = { present: ['Present', 'P'], late: ['Late', 'L'], absent: ['Absent', 'A'], excused: ['Excused', 'E'] };
const ago = (d) => {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};
const todayT = () => new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 10);

/** One group: students (add / move / copy / remove), attendance, statistics, history. */
export default function GroupDetail() {
  const { id } = useParams();
  const st = useAsync(() => Promise.all([api.get(`/groups/${id}`), api.get('/groups')]), [id]);
  const [tab, setTab] = useState('students');
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  return (
    <div className="page grp-page">
      <Gate state={st}>{([d, all]) => {
        const g = d.group;
        const others = all.filter((x) => x.id !== g.id && !x.archived);
        const archive = async () => { try { await api.put(`/groups/${g.id}`, { archived: !g.archived }); toast(g.archived ? 'Back in active groups' : 'Moved to the archive'); st.reload(); } catch (e) { toast(e.message, 'bad'); } };
        return (
          <>
            <Link to="/groups" className="mlx-back"><IconChevron width={16} height={16} /> Groups</Link>
            <section className="grp-hero" style={{ '--gc': g.color }}>
              <div className="grp-hero-main">
                <span className="grp-dot lg">{g.name.slice(0, 1).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <h1>{g.name}</h1>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="chip">{SUBJECT[g.subject]}</span>{g.level && <span className="chip">{g.level}</span>}{g.archived && <span className="chip warn">Archived</span>}
                  </div>
                </div>
              </div>
              <div className="grp-hero-facts">
                {scheduleText(g) && <span><IconClock width={16} height={16} /> {scheduleText(g)}</span>}
                {(g.starts_on || g.ends_on) && <span><IconCalendar width={16} height={16} /> {shortDate(g.starts_on) || '…'} – {shortDate(g.ends_on) || '…'}</span>}
                <span><IconUsers width={16} height={16} /> {d.members.length}{g.capacity ? ` / ${g.capacity} places` : ' students'}</span>
                {g.telegram_url && <a href={g.telegram_url} target="_blank" rel="noreferrer"><IconTelegram width={16} height={16} /> Telegram group</a>}
              </div>
              <div className="row wrap grp-hero-acts">
                <button className="btn ghost sm" onClick={() => setEdit(true)}><IconEdit width={15} height={15} /> Edit</button>
                <button className="btn ghost sm" onClick={archive}><IconArchive width={15} height={15} /> {g.archived ? 'Restore' : 'Archive'}</button>
                <button className="btn ghost sm danger-text" onClick={() => setDel(true)}><IconTrash width={15} height={15} /> Delete</button>
              </div>
            </section>
            <div className="grp-tabs" role="tablist">
              {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'students' ? ` · ${d.members.length}` : ''}</button>)}
            </div>
            {tab === 'students' && <Members g={g} members={d.members} others={others} reload={st.reload} />}
            {tab === 'attendance' && <Attendance g={g} />}
            {tab === 'stats' && <Stats d={d} />}
            {tab === 'history' && <History rows={d.history} gid={g.id} />}
            {edit && <GroupForm g={g} onClose={() => setEdit(false)} onDone={() => { setEdit(false); st.reload(); }} />}
            {del && <Confirm title={`Delete ${g.name}?`} text="The students stay on the site; they only leave this group. Attendance of this group is deleted. To keep everything, archive the group instead."
              confirmLabel="Delete group" onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/groups/${g.id}`); toast('Group deleted'); nav('/groups'); }} />}
          </>
        );
      }}</Gate>
    </div>
  );
}

function Members({ g, members, others, reload }) {
  const toast = useToast();
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(null); // 'move' | 'copy'
  const [removing, setRemoving] = useState(false);
  const shown = members.filter((m) => !q || `${m.name} ${m.login} ${m.phone || ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const allOn = shown.length > 0 && shown.every((m) => sel.has(m.id));
  const remove = async () => {
    try { const r = await api.post(`/groups/${g.id}/remove`, { user_ids: [...sel] }); toast(`${r.removed} removed from ${g.name}`); setSel(new Set()); setRemoving(false); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <>
      <div className="grp-bar-tools">
        <label className="fin-search grow"><IconSearch width={16} height={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student" /></label>
        <button className="btn primary" onClick={() => setAdding(true)}><IconUserPlus width={18} height={18} /> Add students</button>
      </div>
      {sel.size > 0 && (
        <div className="grp-selbar" role="toolbar">
          <b>{sel.size} selected</b>
          <button className="btn sm" onClick={() => setMoving('move')}><IconMove width={15} height={15} /> Move to…</button>
          <button className="btn sm ghost" onClick={() => setMoving('copy')}><IconCopy width={15} height={15} /> Also add to…</button>
          <button className="btn sm ghost danger-text" onClick={() => setRemoving(true)}><IconTrash width={15} height={15} /> Remove</button>
          <button className="as-link" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      {!members.length ? (
        <Card><Empty icon={<IconUsers />} title="No students yet" text="Add students who already have an account on the site.">
          <button className="btn primary" onClick={() => setAdding(true)}><IconUserPlus /> Add students</button>
        </Empty></Card>
      ) : (
        <Card className="grp-table-card">
          <div className="grp-table">
            <div className="grp-tr head">
              <label className="grp-check"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map((m) => m.id)))} aria-label="Select all" /></label>
              <span>Student</span><span>R&amp;W</span><span>Math</span><span>Attendance</span><span>This week</span><span>Last seen</span>
            </div>
            {shown.map((m) => (
              <div key={m.id} className={`grp-tr ${sel.has(m.id) ? 'on' : ''}`}>
                <label className="grp-check"><input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} /></label>
                <Link to={`/students/${m.id}`} className="grp-who">
                  <Avatar name={m.name} src={m.avatar_url} size={34} />
                  <span style={{ minWidth: 0 }}><b>{m.name}</b><small>{m.other_groups ? `Also in ${m.other_groups}` : m.phone || `@${m.login}`}</small></span>
                </Link>
                <span data-l="R&W">{m.english ?? '—'}</span>
                <span data-l="Math">{m.math ?? '—'}</span>
                <span data-l="Attendance" className={m.attendance != null && m.attendance < 70 ? 'bad-text' : ''}>{m.attendance == null ? '—' : `${m.attendance}%`}{m.lessons ? <small> · {m.lessons}</small> : null}</span>
                <span data-l="This week">{m.week_min ? `${m.week_min} min` : <span className="muted">—</span>}</span>
                <span data-l="Last seen" className={!m.last_day || Date.now() - new Date(m.last_day) > 7 * 864e5 ? 'warn-text' : ''}>{ago(m.last_day)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {adding && <AddStudents g={g} memberIds={new Set(members.map((m) => m.id))} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {moving && <MoveTo g={g} mode={moving} ids={[...sel]} others={others} onClose={() => setMoving(null)} onDone={() => { setMoving(null); setSel(new Set()); reload(); }} />}
      {removing && <Confirm title={`Remove ${sel.size} from ${g.name}?`} text="They stay on the site and keep their results and the tasks this group was given while they were in it." confirmLabel="Remove" onClose={() => setRemoving(false)} onConfirm={remove} />}
    </>
  );
}

/** Pick students who already have an account: search, see their groups, tick several, add. Warns when the group is full. */
function AddStudents({ g, memberIds, onClose, onDone }) {
  const toast = useToast();
  const st = useAsync(() => Promise.all([api.get('/groups-students'), api.get('/groups')]), []);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all'); // all | none (in no group)
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(null);
  const add = async (force = false) => {
    setBusy(true);
    try { const r = await api.post(`/groups/${g.id}/members`, { user_ids: [...sel], force }); toast(`${r.added} added to ${g.name}`); onDone(); }
    catch (e) { if (e.data?.code === 'over_capacity' || e.status === 409) setOver(e.message); else toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Add students to ${g.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!sel.size || busy} onClick={() => add(false)}>{busy ? 'Adding…' : `Add ${sel.size || ''}`}</button></>}>
      <Gate state={st}>{([list, groups]) => {
        const gname = new Map(groups.map((x) => [x.id, x.name]));
        const rows = list.filter((s) => !memberIds.has(s.id) && (only === 'all' || !s.group_ids.length)
          && (!q || `${s.name} ${s.login} ${s.email || ''} ${s.phone || ''}`.toLowerCase().includes(q.toLowerCase())));
        return (
          <div className="stack">
            <div className="row wrap" style={{ gap: 8 }}>
              <label className="fin-search grow"><IconSearch width={16} height={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, login, phone or email" /></label>
              <div className="segmented"><button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>Everyone</button><button className={only === 'none' ? 'on' : ''} onClick={() => setOnly('none')}>In no group</button></div>
            </div>
            {g.capacity > 0 && <small className="muted">{g.name}: {memberIds.size} of {g.capacity} places taken.</small>}
            <div className="grp-pick">
              {!rows.length && <p className="muted center">{q ? 'Nobody matches this search.' : 'Every student is already in this group.'}</p>}
              {rows.slice(0, 300).map((s) => (
                <label key={s.id} className={`grp-pick-row ${sel.has(s.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={sel.has(s.id)} onChange={() => { const n = new Set(sel); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setSel(n); }} />
                  <Avatar name={s.name} src={s.avatar_url} size={32} />
                  <span className="grow" style={{ minWidth: 0 }}><b>{s.name}</b><small>{s.phone || s.email || `@${s.login}`} · last seen {ago(s.last_day)}</small></span>
                  <span className="row wrap" style={{ gap: 4, justifyContent: 'flex-end' }}>{s.group_ids.length ? s.group_ids.map((id) => <span key={id} className="chip">{gname.get(id)}</span>) : <span className="chip good">No group</span>}</span>
                </label>
              ))}
            </div>
          </div>
        );
      }}</Gate>
      {over && <Confirm title="The group is full" text={`${over} Add anyway?`} confirmLabel="Add anyway" onClose={() => setOver(null)} onConfirm={() => { setOver(null); add(true); }} />}
    </Modal>
  );
}

/** Move (leave this group, join the other) or copy (stay here too). Old tasks and results stay with the student. */
function MoveTo({ g, mode, ids, others, onClose, onDone }) {
  const toast = useToast();
  const [to, setTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(null);
  const go = async (force = false) => {
    setBusy(true);
    try { const r = await api.post(`/groups/${g.id}/move`, { user_ids: ids, to: to.id, mode, force }); toast(mode === 'move' ? `${r.moved} moved to ${to.name}` : `${r.moved} also added to ${to.name}`); onDone(); }
    catch (e) { if (e.status === 409 || e.data?.code === 'over_capacity') setOver(e.message); else toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={mode === 'move' ? `Move ${ids.length} to another group` : `Also add ${ids.length} to another group`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!to || busy} onClick={() => go(false)}>{busy ? 'Saving…' : mode === 'move' ? `Move to ${to?.name || '…'}` : `Add to ${to?.name || '…'}`}</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>{mode === 'move'
        ? `They leave ${g.name}. Tasks given while they were in it stay with them; they also get the open tasks of the new group.`
        : `They stay in ${g.name} and join one more group.`}</p>
      {!others.length ? <p className="muted">There is no other active group yet.</p> : (
        <div className="grp-dest">
          {others.map((o) => {
            const full = o.capacity && o.students + ids.length > o.capacity;
            return (
              <button key={o.id} className={`grp-dest-row ${to?.id === o.id ? 'on' : ''}`} style={{ '--gc': o.color }} onClick={() => setTo(o)}>
                <span className="grp-dot">{o.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}><b>{o.name}</b><small>{[SUBJECT[o.subject], o.level, scheduleText(o)].filter(Boolean).join(' · ')}</small></span>
                <small className={full ? 'warn-text' : 'muted'}>{o.students}{o.capacity ? `/${o.capacity}` : ''}</small>
              </button>
            );
          })}
        </div>
      )}
      {over && <Confirm title="Not enough places" text={`${over} Continue anyway?`} confirmLabel="Continue" onClose={() => setOver(null)} onConfirm={() => { setOver(null); go(true); }} />}
    </Modal>
  );
}

/** Attendance: pick the lesson date, tap a mark for each student (or "All present"), save. Grid of the last lessons below. */
function Attendance({ g }) {
  const toast = useToast();
  const [day, setDay] = useState(todayT());
  const st = useAsync(() => api.get(`/groups/${g.id}/attendance?day=${day}`), [day]);
  const [marks, setMarks] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) { setMarks(Object.fromEntries(Object.entries(st.data.marks).map(([k, v]) => [k, v.status]))); setDirty(false); } }, [st.data]);
  const set = (uid, v) => { setMarks((m) => ({ ...m, [uid]: m[uid] === v ? '' : v })); setDirty(true); };
  const save = async () => {
    setBusy(true);
    try { const r = await api.put(`/groups/${g.id}/attendance`, { day, marks }); toast(`Saved · ${r.saved} marked`); st.reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const lessonDay = (g.days || []).includes(((new Date(day + 'T12:00:00').getDay() + 6) % 7) + 1);
  return (
    <Gate state={st}>{(d) => (
      <>
        <Card className="grp-att">
          <div className="grp-att-top">
            <label className="grp-date"><IconCalendar width={16} height={16} /><input type="date" value={day} max={todayT()} onChange={(e) => setDay(e.target.value)} /></label>
            <small className="muted">{fmtDate(day + 'T12:00:00', { weekday: 'long', day: 'numeric', month: 'long' })}{g.days?.length ? (lessonDay ? ' · lesson day' : ' · not a usual lesson day') : ''}</small>
            <div className="grow" />
            <button className="btn ghost sm" onClick={() => { setMarks(Object.fromEntries(d.members.map((m) => [m.id, 'present']))); setDirty(true); }}>All present</button>
            <button className="btn primary sm" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
          {!d.members.length ? <p className="muted">Add students to the group first.</p> : (
            <div className="grp-att-list">
              {d.members.map((m) => (
                <div key={m.id} className="grp-att-row">
                  <span className="grp-who"><Avatar name={m.name} src={m.avatar_url} size={30} /><b>{m.name}</b></span>
                  <div className="grp-marks" role="radiogroup" aria-label={`${m.name} attendance`}>
                    {Object.entries(MARK).map(([k, [l]]) => <button key={k} role="radio" aria-checked={marks[m.id] === k} className={`mk ${k} ${marks[m.id] === k ? 'on' : ''}`} onClick={() => set(m.id, k)}>{l}</button>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        {d.days.length > 0 && (
          <Card className="grp-grid-card">
            <h3 style={{ margin: '0 0 10px' }}>Last {d.days.length} {d.days.length === 1 ? 'lesson' : 'lessons'}</h3>
            <div className="grp-attgrid" style={{ gridTemplateColumns: `minmax(130px, 1fr) repeat(${d.days.length}, 34px)` }}>
              <span />{d.days.map((x) => <button key={x} className={`grp-attday ${x === day ? 'on' : ''}`} onClick={() => setDay(x)} title={x}>{shortDate(x).replace(' ', '\n')}</button>)}
              {d.members.map((m) => (
                <Row key={m.id} m={m} days={d.days} grid={d.grid} />
              ))}
            </div>
            <div className="grp-legend">{Object.entries(MARK).map(([k, [l, s]]) => <span key={k}><i className={`mk-dot ${k}`}>{s}</i> {l}</span>)}</div>
          </Card>
        )}
      </>
    )}</Gate>
  );
}
function Row({ m, days, grid }) {
  const by = useMemo(() => new Map(grid.filter((x) => x.user_id === m.id).map((x) => [x.day, x.status])), [grid, m.id]);
  return (
    <>
      <span className="grp-attname">{m.name}</span>
      {days.map((x) => { const s = by.get(x); return <i key={x} className={`mk-dot ${s || 'none'}`} title={s ? MARK[s][0] : 'Not marked'}>{s ? MARK[s][1] : '·'}</i>; })}
    </>
  );
}

function Stats({ d }) {
  const s = d.stats;
  const n = d.members.length;
  const tiles = [
    [s.english ?? '—', 'average R&W estimate'], [s.math ?? '—', 'average Math estimate'], [s.accuracy == null ? '—' : `${s.accuracy}%`, 'average accuracy'],
    [s.attendance == null ? '—' : `${s.attendance}%`, 'average attendance'], [`${s.active_week}/${n}`, 'studied this week'], [s.week_min ? `${s.week_min} min` : '—', 'study time per student, 7 days'],
  ];
  const idle = d.members.filter((m) => !m.last_day || Date.now() - new Date(m.last_day) > 7 * 864e5);
  return (
    <div className="stack">
      <div className="grp-stats">{tiles.map(([v, l]) => <Card key={l} className="grp-stat"><b>{v}</b><small>{l}</small></Card>)}</div>
      <div className="grid g2">
        <Card>
          <h3 style={{ marginTop: 0 }}>Weakest skills</h3>
          {!s.weak.length ? <p className="muted">Not enough answers yet (the last 60 days are counted).</p> : (
            <ul className="grp-weak">{s.weak.map((w) => <li key={w.skill}><span>{w.skill}</span><div className="grp-bar"><i style={{ width: `${w.pct}%`, background: w.pct < 50 ? 'var(--bad)' : w.pct < 70 ? 'var(--warn)' : 'var(--good)' }} /></div><b>{w.pct}%</b></li>)}</ul>
          )}
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>Group tasks</h3>
          {!d.tasks.length ? <p className="muted">No assignments for this group yet. <Link to="/assignments">Assign a quiz</Link></p> : (
            <ul className="grp-weak">{d.tasks.map((t) => <li key={t.id}><span>{t.title}{t.due_at ? <small className="muted"> · due {fmtDate(t.due_at, { day: 'numeric', month: 'short' })}</small> : null}</span><div className="grp-bar"><i style={{ width: `${t.of ? (100 * t.passed) / t.of : 0}%` }} /></div><b>{t.passed}/{t.of}</b></li>)}</ul>
          )}
        </Card>
      </div>
      {idle.length > 0 && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Not active for a week · {idle.length}</h3>
          <div className="row wrap" style={{ gap: 6 }}>{idle.map((m) => <Link key={m.id} to={`/students/${m.id}`} className="chip">{m.name} · {ago(m.last_day)}</Link>)}</div>
        </Card>
      )}
    </div>
  );
}

function History({ rows, gid }) {
  if (!rows.length) return <Card><Empty icon={<IconHistory />} title="No changes yet" text="Every add, move and removal shows here." /></Card>;
  const text = (r) => {
    if (r.action === 'add') return <>joined <b>{r.to_name}</b></>;
    if (r.action === 'copy') return <>was also added to <b>{r.to_name}</b></>;
    if (r.action === 'remove') return <>left <b>{r.from_name}</b></>;
    return <>moved from <b>{r.from_name}</b> to <b>{r.to_name}</b></>;
  };
  return (
    <Card>
      <ul className="grp-hist">
        {rows.map((r) => (
          <li key={r.id} className={r.to_group === gid ? 'in' : 'out'}>
            <span className="muted">{fmtDate(r.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <span><b>{r.student}</b> {text(r)}{r.by_name ? <small className="muted"> · by {r.by_name}</small> : null}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
