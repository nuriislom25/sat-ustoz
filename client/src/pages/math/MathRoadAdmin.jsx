import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Confirm, Field, Gate, Modal, useAsync } from '../../components/ui.jsx';
import { IconDown, IconEdit, IconEye, IconEyeOff, IconPlay, IconPlus, IconSearch, IconTrash, IconUp } from '../../components/icons.jsx';
import VideoUpload from '../../components/VideoUpload.jsx';
import MathText from './MathText.jsx';

/** Teacher: the Math roadmap — units of video lessons, each with a practice from the Math questions and a pass mark. */
export default function MathRoadAdmin() {
  const st = useAsync(() => Promise.all([api.get('/math/roadmap/admin'), api.get('/math/admin')]), []);
  const toast = useToast();
  const [unit, setUnit] = useState(null);   // {id?, title}
  const [lesson, setLesson] = useState(null);
  const [del, setDel] = useState(null);     // {kind, x}
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); st.reload(); } catch (e) { toast(e.message, 'bad'); } };
  const move = (list, i, d, key) => {
    const ids = list.map((x) => x.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => api.post('/math/roadmap/order', { [key]: ids }));
  };
  return (
    <Gate state={st}>{([r, bank]) => (
      <div className="stack">
        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <p className="muted grow" style={{ margin: 0 }}>Students go lesson by lesson: watch the video, solve the practice, reach the pass mark and the next lesson opens. Students without a Math plan get the first lessons free (Settings).</p>
          <button className="btn primary" onClick={() => setUnit({ title: '' })}><IconPlus width={16} height={16} /> New unit</button>
        </div>
        {!r.units.length && <Card><p className="muted">No units yet. Create the first unit (for example “Linear equations”), then add its lessons.</p></Card>}
        {r.units.map((u, ui) => (
          <Card key={u.id} className="mra-unit">
            <div className="mra-unit-h">
              <span className="chip">Unit {ui + 1}</span>
              <h3 className="grow">{u.title}</h3>
              <button className="icon-btn" aria-label="Move up" disabled={!ui} onClick={() => move(r.units, ui, -1, 'units')}><IconUp width={16} height={16} /></button>
              <button className="icon-btn" aria-label="Move down" disabled={ui === r.units.length - 1} onClick={() => move(r.units, ui, 1, 'units')}><IconDown width={16} height={16} /></button>
              <button className="icon-btn" aria-label="Rename unit" onClick={() => setUnit(u)}><IconEdit width={16} height={16} /></button>
              <button className="icon-btn" aria-label="Delete unit" onClick={() => setDel({ kind: 'unit', x: u })}><IconTrash width={16} height={16} /></button>
            </div>
            <div className="mra-lessons">
              {u.lessons.map((l, li) => (
                <div key={l.id} className={`mra-lesson ${l.published ? '' : 'off'}`}>
                  <span className="mra-n">{li + 1}</span>
                  <div className="grow">
                    <b>{l.title}</b>
                    <small className="muted">{l.video ? 'Video' : 'No video'} · {l.question_ids.length} questions · pass {l.pass_pct}% · {l.passed} passed{l.published ? '' : ' · hidden'}</small>
                  </div>
                  <button className="icon-btn" aria-label="Move up" disabled={!li} onClick={() => move(u.lessons, li, -1, 'lessons')}><IconUp width={16} height={16} /></button>
                  <button className="icon-btn" aria-label="Move down" disabled={li === u.lessons.length - 1} onClick={() => move(u.lessons, li, 1, 'lessons')}><IconDown width={16} height={16} /></button>
                  <button className="icon-btn" aria-label={l.published ? 'Hide' : 'Show'} onClick={() => run(() => api.put(`/math/roadmap/lessons/${l.id}`, { published: !l.published }))}>{l.published ? <IconEye width={16} height={16} /> : <IconEyeOff width={16} height={16} />}</button>
                  <button className="icon-btn" aria-label="Edit lesson" onClick={() => setLesson(l)}><IconEdit width={16} height={16} /></button>
                  <button className="icon-btn" aria-label="Delete lesson" onClick={() => setDel({ kind: 'lesson', x: l })}><IconTrash width={16} height={16} /></button>
                </div>
              ))}
              <button className="btn soft sm" style={{ justifySelf: 'start' }} onClick={() => setLesson({ unit_id: u.id, title: '', video: '', notes: '', question_ids: [], pass_pct: 70, published: true })}><IconPlus width={15} height={15} /> Add a lesson</button>
            </div>
          </Card>
        ))}
        {unit && <UnitModal x={unit} onClose={() => setUnit(null)} onDone={() => { setUnit(null); st.reload(); }} />}
        {lesson && <LessonModal x={lesson} units={r.units} bank={bank} onClose={() => setLesson(null)} onDone={() => { setLesson(null); st.reload(); }} />}
        {del && <Confirm title={del.kind === 'unit' ? `Delete the unit “${del.x.title}”?` : `Delete the lesson “${del.x.title}”?`}
          text={del.kind === 'unit' ? 'Its lessons and the students’ progress in them are removed too.' : 'Students’ progress in this lesson is removed too. Hiding keeps it.'} confirmLabel="Delete"
          onClose={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); run(() => api.del(`/math/roadmap/${d.kind === 'unit' ? 'units' : 'lessons'}/${d.x.id}`), 'Deleted'); }} />}
      </div>
    )}</Gate>
  );
}

function UnitModal({ x, onClose, onDone }) {
  const toast = useToast();
  const [title, setTitle] = useState(x.title || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { if (x.id) await api.put(`/math/roadmap/units/${x.id}`, { title }); else await api.post('/math/roadmap/units', { title }); onDone(); } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  return (
    <Modal title={x.id ? 'Rename the unit' : 'New unit'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <Field label="Unit name"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Linear equations" onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
    </Modal>
  );
}

function LessonModal({ x, units, bank, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ ...x });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [dom, setDom] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const byId = useMemo(() => new Map(bank.questions.map((y) => [y.id, y])), [bank]);
  const found = useMemo(() => bank.questions.filter((y) => y.active && !f.question_ids.includes(y.id) && (!dom || y.domain === dom)
    && (!q || `${y.prompt} ${y.skill}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 30), [bank, f.question_ids, q, dom]);
  const save = async () => {
    setBusy(true);
    const body = { unit_id: Number(f.unit_id), title: f.title, video: f.video, notes: f.notes, question_ids: f.question_ids, pass_pct: Number(f.pass_pct), published: !!f.published };
    try { if (x.id) await api.put(`/math/roadmap/lessons/${x.id}`, body); else await api.post('/math/roadmap/lessons', body); toast('Lesson saved'); onDone(); } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  const qs = f.question_ids.map((id) => byId.get(id)).filter(Boolean);
  return (
    <Modal wide title={x.id ? 'Edit the lesson' : 'New lesson'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save lesson</button></>}>
      <div className="form-grid">
        <Field label="Title"><input value={f.title} onChange={set('title')} placeholder="Slope and intercepts" /></Field>
        <Field label="Unit"><select value={f.unit_id} onChange={set('unit_id')}>{units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}</select></Field>
      </div>
      <Field label="Video" hint="upload an MP4 (Bunny Stream) or paste a YouTube, Vimeo or Google Drive link">
        <input value={f.video} onChange={set('video')} placeholder="https://… or upload below" />
      </Field>
      <VideoUpload title={f.title || 'Math lesson'} onDone={(url) => setF((v) => ({ ...v, video: url }))} />
      {f.video && <small className="muted"><IconPlay width={13} height={13} /> {f.video.startsWith('bunny:') ? 'Uploaded video' : f.video}</small>}
      <Field label="Notes" hint="optional, shown under the video; formulas between $ signs"><textarea rows={4} value={f.notes} onChange={set('notes')} /></Field>
      <div className="form-grid">
        <Field label="Pass mark, %" hint="students need this score to open the next lesson"><input type="number" min="10" max="100" value={f.pass_pct} onChange={set('pass_pct')} /></Field>
        <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!f.published} onChange={set('published')} style={{ width: 18, height: 18 }} /> Visible to students</label>
      </div>
      <h3 className="mra-h">Practice questions · {qs.length}</h3>
      <div className="mra-picked">
        {qs.map((y, i) => (
          <div key={y.id} className="mra-q on">
            <span className="mra-n">{i + 1}</span><MathText as="div" className="grow mra-qt">{y.prompt}</MathText>
            <button className="icon-btn" aria-label="Remove" onClick={() => setF({ ...f, question_ids: f.question_ids.filter((z) => z !== y.id) })}><IconTrash width={15} height={15} /></button>
          </div>
        ))}
        {!qs.length && <p className="muted">Pick questions from the Math list below.</p>}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="mh-chips">
          <button className={`mh-chip ${!dom ? 'on' : ''}`} onClick={() => setDom('')}>All</button>
          {bank.domains.map((d) => <button key={d.id} className={`mh-chip ${dom === d.id ? 'on' : ''}`} onClick={() => setDom(d.id)}>{d.name}</button>)}
        </div>
        <label className="fin-search grow"><IconSearch width={16} height={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a question" /></label>
      </div>
      <div className="mra-pick">
        {found.map((y) => (
          <button key={y.id} type="button" className="mra-q" onClick={() => setF({ ...f, question_ids: [...f.question_ids, y.id] })}>
            <IconPlus width={15} height={15} /><MathText className="grow mra-qt">{y.prompt}</MathText><small className="muted">{y.difficulty}</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}
