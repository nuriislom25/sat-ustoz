import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../../api.js';
import { useAuth, useToast } from '../../context.jsx';
import { Card, Confirm, Empty, Field, Gate, Modal, PageHeader, Segmented, useAsync } from '../../components/ui.jsx';
import { IconArrow, IconCheck, IconClock, IconLock, IconPlus, IconRoad, IconSearch, IconTask, IconTrash, IconUsers } from '../../components/icons.jsx';
const HomeworkStats = lazy(() => import('../master/HomeworkStats.jsx'));

const STATUS = {
  new: ['New', 'primary'], in_progress: ['In progress', 'warn'], retake: ['Retake available', 'warn'],
  passed: ['Passed', 'good'], failed: ['No tries left', 'bad'], locked: ['Locked', ''], waiting: ['Retake opens soon', 'warn'], closed: ['Deadline passed', 'bad'],
};

/** "in 2 days", "in 5 hours", "2 days ago" */
export function dueText(d) {
  const ms = new Date(d).getTime() - Date.now();
  const a = Math.abs(ms); const h = Math.round(a / 36e5); const days = Math.round(a / 864e5);
  const span = a < 36e5 ? `${Math.max(1, Math.round(a / 6e4))} min` : h < 36 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${days} days`;
  return ms >= 0 ? `in ${span}` : `${span} ago`;
}
const fmtDue = (d) => fmtDate(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** retakes ↔ attempts_allowed: 0 = unlimited, 1 = one try, 2 = one retake … */
const retakeLabel = (allowed) => (!allowed ? 'Unlimited retakes' : allowed === 1 ? 'One try, no retakes' : `${allowed - 1} ${allowed === 2 ? 'retake' : 'retakes'}`);

export default function Assignments() {
  const { user } = useAuth();
  return user.role === 'master' ? <TeacherAssignments /> : <StudentAssignments />;
}

/** Student: what to do now, what is done, what opens next on the roadmap. */
function StudentAssignments() {
  const st = useAsync(() => api.get('/assignments'), []);
  return (
    <div className="page">
      <PageHeader title="Assignments" sub="Quizzes from your roadmap open step by step; your teacher can add more." />
      <Gate state={st}>{({ items }) => <AssignmentList items={items} />}</Gate>
    </div>
  );
}

export function AssignmentList({ items, teacherView }) {
  const todo = items.filter((a) => ['new', 'in_progress', 'retake', 'waiting'].includes(a.status))
    .sort((a, b) => (a.due_at ? new Date(a.due_at) : 9e15) - (b.due_at ? new Date(b.due_at) : 9e15));
  const done = items.filter((a) => ['passed', 'failed', 'closed'].includes(a.status));
  const later = items.filter((a) => a.status === 'locked');
  if (!items.length) return <Card><Empty icon={<IconTask />} title="No assignments yet" text="Quizzes appear here when you reach their roadmap step, or when your teacher assigns one." /></Card>;
  return (
    <div className="as-wrap">
      {todo.length > 0 && <section><h2 className="as-h">To do <span className="badge-n">{todo.length}</span></h2><div className="as-list">{todo.map((a) => <AssignmentCard key={a.key} a={a} teacherView={teacherView} />)}</div></section>}
      {done.length > 0 && <section><h2 className="as-h">Done</h2><div className="as-list">{done.map((a) => <AssignmentCard key={a.key} a={a} teacherView={teacherView} />)}</div></section>}
      {later.length > 0 && <section><h2 className="as-h">Coming next</h2><div className="as-list">{later.map((a) => <AssignmentCard key={a.key} a={a} teacherView={teacherView} />)}</div></section>}
    </div>
  );
}

function AssignmentCard({ a, teacherView }) {
  const [label, tone] = STATUS[a.status] || [a.status, ''];
  const btn = a.status === 'in_progress' ? 'Continue' : a.status === 'retake' ? 'Retake' : a.status === 'passed' ? 'Try again' : 'Start';
  return (
    <article className={`as-card ${a.status} ${a.overdue ? 'overdue' : ''}`}>
      <span className="as-ic">{a.locked ? <IconLock width={20} height={20} /> : a.status === 'passed' ? <IconCheck width={20} height={20} /> : a.source === 'roadmap' ? <IconRoad width={20} height={20} /> : <IconTask width={20} height={20} />}</span>
      <div className="grow">
        <small className="as-src">{a.step ? `Roadmap · step ${a.step.index} · ${a.step.title}` : a.source === 'group' ? 'From your teacher · your group' : 'From your teacher'}</small>
        <h3>{a.title}</h3>
        <div className="as-meta">
          <span className={`chip ${tone}`}>{label}</span>
          {a.type === 'exam' && <span>Random SAT module</span>}
          {a.questions > 0 && <span>{a.questions} questions{a.minutes ? ` · ${a.minutes} min` : ''}</span>}
          <span>Pass {a.pass_pct}%</span>
          {a.best != null && <span>Best <b>{a.best}%</b>{a.tries ? ` · ${a.tries} ${a.tries === 1 ? 'try' : 'tries'}` : ''}{a.attempts_allowed ? ` of ${a.attempts_allowed}` : ''}</span>}
          {a.attempts_allowed > 0 && a.status !== 'passed' && a.tries_left != null && <span className={a.tries_left <= 1 ? 'warn-text' : ''}>{a.tries_left} {a.tries_left === 1 ? 'try' : 'tries'} left</span>}
        </div>
        {a.due_at && a.status !== 'passed' && (
          <div className={`as-due ${a.overdue ? 'over' : new Date(a.due_at) - Date.now() < 864e5 ? 'soon' : ''}`}>
            <IconClock width={14} height={14} />
            <span>{a.overdue ? (a.close_at_due ? 'Closed ' : 'Overdue · was due ') : 'Due '}<b>{fmtDue(a.due_at)}</b> · {dueText(a.due_at)}</span>
          </div>
        )}
        {a.note && <p className="muted as-note">{a.note}</p>}
        {a.locked && <p className="muted as-note">{a.lock_reason}</p>}
        {a.status === 'closed' && !teacherView && <p className="muted as-note">The deadline has passed. Ask your teacher if you need more time.</p>}
        {a.status === 'failed' && !teacherView && <p className="muted as-note">You used every try. Ask your teacher for one more.</p>}
        {a.status === 'waiting' && <p className="muted as-note">Not passed yet — the retake opens {fmtDate(a.retake.opens_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Review your mistakes first.</p>}
      </div>
      {teacherView && a.retake && <span className="chip">{a.retake.used ? 'Retake used' : 'No retake yet'}</span>}
      {!teacherView && !a.locked && !['failed', 'waiting', 'closed'].includes(a.status) && <Link className={`btn ${a.status === 'passed' ? 'ghost' : 'primary'} sm`} to={a.type === 'exam' ? `/exam/${a.item_id}` : `/quiz/${a.quiz_id}`}>{btn} <IconArrow width={15} height={15} /></Link>}
    </article>
  );
}

/** Teacher: everything assigned outside the roadmap, with who passed. */
function TeacherAssignments() {
  const st = useAsync(() => Promise.all([api.get('/master/assignments'), api.get('/quizzes')]), []);
  const toast = useToast();
  const [assign, setAssign] = useState(false);
  const [del, setDel] = useState(null);
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(() => (new URLSearchParams(location.search).get('view') === 'stats' ? 'stats' : 'list'));
  const grant = async (a, s) => { try { await api.post(`/assignments/${a.id}/grant`, { user_id: s.id, extra: 1 }); toast(`${s.name} has one more try`); st.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="page">
      <PageHeader title="Assignments" sub="Roadmap quizzes open for each student as they reach the step. Here you give extra quizzes to a student or a group — retakes, homework, deadlines.">
        <button className="btn primary" onClick={() => setAssign(true)}><IconPlus width={16} height={16} /> Assign a quiz</button>
      </PageHeader>
      <div className="as-tabs"><Segmented value={view} onChange={setView} options={[{ value: 'list', label: 'Tasks' }, { value: 'stats', label: 'Homework statistics' }]} /></div>
      {view === 'stats' && <Suspense fallback={null}><HomeworkStats /></Suspense>}
      {view === 'list' && <Gate state={st}>{([rows, quizzes]) => (
        <>
          {!rows.length ? <Card><Empty icon={<IconTask />} title="Nothing assigned yet" text="Press “Assign a quiz” to give a quiz to one student or a whole group." /></Card> : (
            <div className="as-list">
              {rows.map((a) => (
                <article key={a.id} className="as-card t">
                  <span className="as-ic">{a.group_id ? <IconUsers width={20} height={20} /> : <IconTask width={20} height={20} />}</span>
                  <div className="grow">
                    <small className="as-src">{a.group_id ? `Group · ${a.group_name}` : `Student · ${a.user_name}`} · given {fmtDate(a.created_at, { day: 'numeric', month: 'short' })}</small>
                    <h3>{a.title}</h3>
                    <div className="as-meta">
                      <span className="chip good">{a.passed} of {a.total} passed</span>
                      <span>{a.started} started</span>
                      <span>Pass {a.pass_pct}%</span>
                      <span>{retakeLabel(a.attempts_allowed)}</span>
                    </div>
                    <div className={`as-due ${a.due_at && new Date(a.due_at) < new Date() ? 'over' : ''}`}>
                      <IconClock width={14} height={14} />
                      {a.due_at ? <span>Deadline <b>{fmtDue(a.due_at)}</b> · {dueText(a.due_at)}{a.close_at_due ? ' · closes at the deadline' : ''}</span> : <span>No deadline</span>}
                      <button className="as-link" onClick={() => setEdit(a)}>Change</button>
                    </div>
                    {open === a.id && (
                      <div className="as-people">
                        {a.students.map((s) => (
                          <div key={s.id} className={`as-person ${s.status}`}>
                            <Link to={`/students/${s.id}`}><b>{s.name}</b></Link>
                            <span>{STATUS[s.status]?.[0] || s.status}{s.best != null ? ` · ${s.best}%` : ''}{s.allowed ? ` · ${s.tries}/${s.allowed} tries` : s.tries ? ` · ${s.tries} tries` : ''}</span>
                            {s.status === 'failed' && <button className="as-link" onClick={() => grant(a, s)}>+1 try</button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="row as-acts" style={{ gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => setEdit(a)}>Edit</button>
                    <button className="btn ghost sm" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Students'}</button>
                    <button className="icon-sm danger" aria-label="Remove assignment" onClick={() => setDel(a)}><IconTrash width={15} height={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {edit && <EditAssignment a={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); st.reload(); }} />}
          {assign && <AssignModal quizzes={quizzes} onClose={() => setAssign(false)} onDone={() => { setAssign(false); st.reload(); }} />}
          {del && <Confirm title="Remove this assignment?" text={`Students keep their results, but “${del.title}” leaves their Assignments.`} confirmLabel="Remove" onClose={() => setDel(null)}
            onConfirm={async () => { try { await api.del(`/assignments/${del.id}`); toast('Removed'); setDel(null); st.reload(); } catch (e) { toast(e.message, 'bad'); } }} />}
        </>
      )}</Gate>}
      {view === 'stats' && assign && <Gate state={st}>{([, quizzes]) => <AssignModal quizzes={quizzes} onClose={() => setAssign(false)} onDone={() => { setAssign(false); st.reload(); }} />}</Gate>}
    </div>
  );
}

/** "Assign to…": one quiz → students and/or a group, optional due date, attempts and pass mark. */
export function AssignModal({ quizzes, quizId, quizIds, label, studentId, onClose, onDone }) {
  const toast = useToast();
  const st = useAsync(() => Promise.all([api.get('/students'), api.get('/groups')]), []);
  const [f, setF] = useState({ quiz_id: quizId || '', mode: studentId ? 'students' : 'group', group_id: '', due_at: '', due_time: '23:59', attempts_allowed: '0', close_at_due: false, pass_pct: 70, note: '' });
  const [picked, setPicked] = useState(() => new Set(studentId ? [studentId] : []));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/assignments', { quiz_id: f.quiz_id, quiz_ids: quizIds, label, group_id: f.mode === 'group' ? f.group_id : null, user_ids: f.mode === 'students' ? [...picked] : [],
        due_at: toDue(f), close_at_due: f.close_at_due, attempts_allowed: f.attempts_allowed, pass_pct: f.pass_pct, note: f.note });
      toast(quizIds ? `${quizIds.length} quizzes assigned` : 'Assigned'); onDone();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const ready = (quizIds?.length || f.quiz_id) && (f.mode === 'group' ? f.group_id : picked.size);
  return (
    <Modal wide title={quizIds ? `Assign “${label}” · ${quizIds.length} ${quizIds.length === 1 ? 'quiz' : 'quizzes'}` : 'Assign a quiz'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ready || busy} onClick={save}>Assign</button></>}>
      <Gate state={st}>{([students, groups]) => (
        <AssignForm {...{ f, set, setF, quizzes, students, groups: groups.filter((g) => !g.archived), picked, setPicked, q, setQ, quizId: quizId || (quizIds ? 'many' : null) }} />
      )}</Gate>
    </Modal>
  );
}

function AssignForm({ f, set, setF, quizzes, students, groups, picked, setPicked, q, setQ, quizId }) {
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return students.filter((s) => !k || `${s.name} ${s.email || ''} ${s.login || ''}`.toLowerCase().includes(k)).slice(0, 80);
  }, [q, students]);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="stack">
      {!quizId && (
        <Field label="Quiz">
          <select value={f.quiz_id} onChange={set('quiz_id')}>
            <option value="">Choose a quiz…</option>
            {quizzes.map((x) => <option key={x.id} value={x.id}>{x.title}{x.roadmap ? ' (in roadmap)' : ''}</option>)}
          </select>
        </Field>
      )}
      <Segmented value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: 'group', label: 'A group' }, { value: 'students', label: `Students${picked.size ? ` (${picked.size})` : ''}` }]} />
      {f.mode === 'group' ? (
        <Field label="Group">
          <select value={f.group_id} onChange={set('group_id')}>
            <option value="">Choose a group…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.students ?? ''} students</option>)}
          </select>
        </Field>
      ) : (
        <div className="as-pick">
          <label className="fin-search"><IconSearch width={16} height={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student" /></label>
          <div className="as-pick-list">
            {list.map((s) => (
              <label key={s.id} className={`as-pick-row ${picked.has(s.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                <span><b>{s.name}</b><small>{s.group_name || s.email || s.login}</small></span>
              </label>
            ))}
          </div>
        </div>
      )}
      <RulesFields f={f} set={set} setF={setF} />
      <small className="muted">Students who linked the Telegram bot get a message.</small>
    </div>
  );
}

/** Tashkent time (UTC+5): date + time fields → ISO, and back. */
const toDue = (f) => (f.due_at ? new Date(`${f.due_at}T${f.due_time || '23:59'}:00+05:00`).toISOString() : null);
const fromDue = (iso) => {
  if (!iso) return { due_at: '', due_time: '23:59' };
  const t = new Date(new Date(iso).getTime() + 5 * 36e5).toISOString();
  return { due_at: t.slice(0, 10), due_time: t.slice(11, 16) };
};

/** Deadline, retakes, pass mark, note — the same fields when giving a task and when changing it. */
function RulesFields({ f, set, setF }) {
  const quick = (days) => { const d = new Date(Date.now() + 5 * 36e5 + days * 864e5).toISOString().slice(0, 10); setF({ ...f, due_at: d, due_time: f.due_time || '23:59' }); };
  return (
    <>
      <div className="as-rules">
        <div className="as-rule">
          <b>Deadline</b>
          <div className="row wrap" style={{ gap: 6 }}>
            {[['Tomorrow', 1], ['In 3 days', 3], ['In a week', 7]].map(([l, d]) => <button type="button" key={l} className="chip chip-btn" onClick={() => quick(d)}>{l}</button>)}
            {f.due_at && <button type="button" className="chip chip-btn" onClick={() => setF({ ...f, due_at: '', close_at_due: false })}>No deadline</button>}
          </div>
          <div className="grid g2" style={{ gap: 8 }}>
            <Field label="Date"><input type="date" value={f.due_at} onChange={set('due_at')} /></Field>
            <Field label="Time (Tashkent)"><input type="time" value={f.due_time} onChange={set('due_time')} disabled={!f.due_at} /></Field>
          </div>
          {f.due_at && (
            <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={!!f.close_at_due} onChange={(e) => setF({ ...f, close_at_due: e.target.checked })} />
              <span><b>Close at the deadline</b><br /><small className="muted">After it, students can no longer start the quiz. Otherwise it stays open and shows as overdue.</small></span>
            </label>
          )}
        </div>
        <div className="as-rule">
          <b>Retakes</b>
          <div className="as-retakes">
            {[['1', 'No retake', 'one try'], ['2', '1 retake', '2 tries'], ['3', '2 retakes', '3 tries'], ['4', '3 retakes', '4 tries'], ['0', 'Unlimited', 'any number']].map(([v, l, h]) => (
              <button type="button" key={v} className={`as-retake ${String(f.attempts_allowed || '0') === v ? 'on' : ''}`} onClick={() => setF({ ...f, attempts_allowed: v })}><b>{l}</b><small>{h}</small></button>
            ))}
          </div>
          <small className="muted">Tries count from the day you give the task. Passing ends it.</small>
        </div>
      </div>
      <div className="grid g2">
        <Field label="Pass mark, %" hint="usually 70"><input type="number" min="10" max="100" value={f.pass_pct} onChange={set('pass_pct')} /></Field>
        <Field label="Note for students" hint="optional"><input value={f.note} onChange={set('note')} maxLength={300} placeholder="Retake after our lesson on Tuesday" /></Field>
      </div>
    </>
  );
}

function EditAssignment({ a, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ ...fromDue(a.due_at), attempts_allowed: String(a.attempts_allowed || 0), close_at_due: !!a.close_at_due, pass_pct: a.pass_pct, note: a.note || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { await api.put(`/assignments/${a.id}`, { due_at: toDue(f), close_at_due: f.close_at_due, attempts_allowed: f.attempts_allowed, pass_pct: f.pass_pct, note: f.note }); toast('Saved'); onDone(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Change · ${a.title}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="stack">
        <small className="muted">{a.group_id ? `Group · ${a.group_name}` : `Student · ${a.user_name}`}. Changes apply right away.</small>
        <RulesFields f={f} set={set} setF={setF} />
      </div>
    </Modal>
  );
}
