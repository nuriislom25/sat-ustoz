import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Empty, Field, Gate, Modal, PageHeader, useAsync } from '../../components/ui.jsx';
import { IconCalendar, IconClock, IconLayers, IconPlus, IconUsers } from '../../components/icons.jsx';

/**
 * Groups (teacher): every class at a glance — subject, level, schedule, places, attendance, activity.
 * Open a group to add students who are already on the site, move or copy them to another group,
 * take attendance and see the group's statistics and history. Finished groups go to the archive.
 */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SUBJECT = { english: 'English', math: 'Math', both: 'English + Math' };
export const COLORS = ['#3B82F6', '#22B07D', '#F07A55', '#8E5CF7', '#F5B82E', '#12A39A', '#E2553D', '#2A55E5'];
export const scheduleText = (g) => {
  const d = (g.days || []).map((x) => DAYS[x - 1]).join(' · ');
  const t = g.time_from ? `${g.time_from}${g.time_to ? `–${g.time_to}` : ''}` : '';
  return [d, t].filter(Boolean).join(', ');
};
export const shortDate = (d) => (d ? fmtDate(d + 'T12:00:00', { day: 'numeric', month: 'short' }) : '');

export default function Groups() {
  const st = useAsync(() => api.get('/groups'), []);
  const nav = useNavigate();
  const [view, setView] = useState('active');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  return (
    <div className="page grp-page">
      <PageHeader title="Groups" sub="Your classes: add students who are already on the site, move them between groups, take attendance and watch each group's progress.">
        <button className="btn primary" onClick={() => setForm({})}><IconPlus /> New group</button>
      </PageHeader>
      <Gate state={st}>{(list) => {
        const active = list.filter((g) => !g.archived);
        const archived = list.filter((g) => g.archived);
        const shown = (view === 'active' ? active : archived).filter((g) => !q || `${g.name} ${g.level}`.toLowerCase().includes(q.toLowerCase()));
        const total = active.reduce((s, g) => s + g.students, 0);
        return (
          <>
            <div className="grp-top">
              <div className="grp-kpis">
                <div><b>{active.length}</b><small>active groups</small></div>
                <div><b>{total}</b><small>students in groups</small></div>
                <div><b>{active.reduce((s, g) => s + g.active_week, 0)}</b><small>studied this week</small></div>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <div className="segmented">
                  <button className={view === 'active' ? 'on' : ''} onClick={() => setView('active')}>Active · {active.length}</button>
                  <button className={view === 'archived' ? 'on' : ''} onClick={() => setView('archived')}>Archive · {archived.length}</button>
                </div>
                <input className="grp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a group" />
              </div>
            </div>
            {!shown.length ? (
              <Card><Empty icon={<IconLayers />} title={view === 'active' ? 'No groups yet' : 'The archive is empty'}
                text={view === 'active' ? 'Create a group, then add students who already have an account.' : 'Archive a group when its course ends: its history stays.'}>
                {view === 'active' && <button className="btn primary" onClick={() => setForm({})}>Create a group</button>}
              </Empty></Card>
            ) : (
              <div className="grp-grid">
                {shown.map((g) => {
                  const full = g.capacity && g.students >= g.capacity;
                  return (
                    <Link key={g.id} to={`/groups/${g.id}`} className={`grp-card ${g.archived ? 'off' : ''}`} style={{ '--gc': g.color }}>
                      <div className="grp-card-top">
                        <span className="grp-dot">{g.name.slice(0, 1).toUpperCase()}</span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <h3>{g.name}</h3>
                          <div className="row wrap" style={{ gap: 4 }}>
                            <span className="chip">{SUBJECT[g.subject]}</span>{g.level && <span className="chip">{g.level}</span>}
                          </div>
                        </div>
                      </div>
                      {scheduleText(g) && <div className="grp-line"><IconClock width={15} height={15} /> {scheduleText(g)}</div>}
                      {(g.starts_on || g.ends_on) && <div className="grp-line"><IconCalendar width={15} height={15} /> {shortDate(g.starts_on) || '…'} – {shortDate(g.ends_on) || '…'}</div>}
                      <div className="grp-seats">
                        <div className="row between"><span className="row" style={{ gap: 5 }}><IconUsers width={15} height={15} /> {g.students}{g.capacity ? ` / ${g.capacity}` : ''} students</span>{full ? <span className="chip warn">Full</span> : g.capacity ? <small className="muted">{g.capacity - g.students} free</small> : null}</div>
                        {g.capacity > 0 && <div className="grp-bar"><i style={{ width: `${Math.min(100, (100 * g.students) / g.capacity)}%` }} /></div>}
                      </div>
                      <div className="grp-mini">
                        <div><b>{g.attendance == null ? '—' : `${g.attendance}%`}</b><small>attendance, 30 days</small></div>
                        <div><b>{g.active_week}/{g.students}</b><small>studied this week</small></div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        );
      }}</Gate>
      {form && <GroupForm g={form} onClose={() => setForm(null)} onDone={(id) => { setForm(null); if (id) nav(`/groups/${id}`); else st.reload(); }} />}
    </div>
  );
}

/** Create or edit a group: name, subject, level, schedule, dates, places, Telegram link, note for students, colour. */
export function GroupForm({ g, onClose, onDone }) {
  const toast = useToast();
  const isNew = !g.id;
  const [f, setF] = useState({
    name: g.name || '', subject: g.subject || 'english', level: g.level || '', days: g.days || [], time_from: g.time_from || '', time_to: g.time_to || '',
    starts_on: g.starts_on || '', ends_on: g.ends_on || '', capacity: g.capacity || '', telegram_url: g.telegram_url || '', note: g.note || '', color: g.color || COLORS[0],
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const day = (d) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() });
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) { const r = await api.post('/groups', f); toast('Group created'); onDone(r.id); }
      else { await api.put(`/groups/${g.id}`, f); toast('Saved'); onDone(); }
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={isNew ? 'New group' : `Edit ${g.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Saving…' : isNew ? 'Create group' : 'Save'}</button></>}>
      <div className="stack">
        <div className="grid g2">
          <Field label="Group name"><input autoFocus value={f.name} onChange={set('name')} placeholder="e.g. SAT English · Morning" maxLength={80} /></Field>
          <Field label="Level" hint="optional"><input value={f.level} onChange={set('level')} placeholder="Beginner, 1200+, 1400+…" maxLength={40} /></Field>
        </div>
        <div className="grp-f">
          <b>Subject</b>
          <div className="mh-chips">{Object.entries(SUBJECT).map(([k, v]) => <button type="button" key={k} className={`mh-chip ${f.subject === k ? 'on' : ''}`} onClick={() => setF({ ...f, subject: k })}>{v}</button>)}</div>
        </div>
        <div className="grp-f">
          <b>Lesson days and time</b>
          <div className="mh-chips">{DAYS.map((d, i) => <button type="button" key={d} className={`mh-chip ${f.days.includes(i + 1) ? 'on' : ''}`} onClick={() => day(i + 1)}>{d}</button>)}</div>
          <div className="grid g2" style={{ gap: 8 }}>
            <Field label="From"><input type="time" value={f.time_from} onChange={set('time_from')} /></Field>
            <Field label="To"><input type="time" value={f.time_to} onChange={set('time_to')} /></Field>
          </div>
        </div>
        <div className="grid g3">
          <Field label="Starts"><input type="date" value={f.starts_on} onChange={set('starts_on')} /></Field>
          <Field label="Ends"><input type="date" value={f.ends_on} onChange={set('ends_on')} /></Field>
          <Field label="Places" hint="empty = no limit"><input type="number" min="0" max="500" value={f.capacity} onChange={set('capacity')} placeholder="15" /></Field>
        </div>
        <Field label="Telegram group link" hint="students see it"><input value={f.telegram_url} onChange={set('telegram_url')} placeholder="https://t.me/+AbCdEf… or @group_name" /></Field>
        <Field label="Note for students" hint="optional"><textarea rows={2} value={f.note} onChange={set('note')} maxLength={600} placeholder="Homework is due before each lesson. Bring headphones." /></Field>
        <div className="grp-f">
          <b>Colour</b>
          <div className="row wrap" style={{ gap: 8 }}>{COLORS.map((c) => <button type="button" key={c} aria-label={c} className={`grp-swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}</div>
        </div>
      </div>
    </Modal>
  );
}
