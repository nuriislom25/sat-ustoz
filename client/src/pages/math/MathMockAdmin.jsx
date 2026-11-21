import { useState } from 'react';
import { api, fmtDate } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Confirm, Field, Gate, Modal, PageHeader, useAsync } from '../../components/ui.jsx';
import { IconDownload, IconPlus, IconTrash, IconUpload } from '../../components/icons.jsx';

/** Teacher: SAT Math full mocks — the automatic one from the Math Question Bank, and full tests uploaded from Excel. */
export default function MathMockAdmin() {
  const st = useAsync(() => api.get('/math-mocks/admin'), []);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [res, setRes] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    try { await api.post('/math-mocks/admin', { title }); setTitle(''); st.reload(); toast('Mock created: now upload its questions'); } catch (er) { toast(er.message, 'bad'); }
  };
  const save = async (m, patch) => { try { await api.put(`/math-mocks/admin/${m.id}`, patch); st.reload(); } catch (er) { toast(er.message, 'bad'); } };
  const upload = async (m, file, replace) => {
    const fd = new FormData(); fd.append('file', file); fd.append('replace', String(replace));
    try { const r = await api.upload(`/math-mocks/admin/${m.id}/import`, fd); toast(`${r.added} questions added${r.problem_count ? ` · ${r.problem_count} rows skipped` : ''}`); if (r.problem_count) setRes(r); st.reload(); }
    catch (er) { toast(er.message, 'bad'); }
  };
  return (
    <div className="page">
      <PageHeader title="Math Full Mocks" sub="Full SAT Math sections: Module 1, then a harder or easier Module 2 (22 questions, 35 minutes each), with Desmos.">
        <button className="btn ghost" onClick={() => api.download('/math-mocks/admin/template.xlsx', 'math-full-mock-template.xlsx').catch((e) => toast(e.message, 'bad'))}><IconDownload /> Excel template</button>
      </PageHeader>
      <Gate state={st}>{(d) => (
        <div className="stack">
          <form className="row wrap" style={{ gap: 8 }} onSubmit={add}>
            <input className="grow" style={{ minWidth: 220 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New mock title, e.g. Practice Test 4 (Math)" required />
            <button className="btn primary"><IconPlus /> New Math mock</button>
          </form>
          {d.mocks.map((m) => (
            <Card key={m.id} className="stack sm">
              <div className="row between wrap" style={{ gap: 8 }}>
                <div>
                  <h3>{m.title}</h3>
                  <small className="muted">
                    {m.mode === 'bank' ? `Built for each student from the Math Question Bank (${d.bank_questions} questions${d.bank_questions < d.bank_needed ? `, needs ${d.bank_needed}` : ''})` : ['1', '2', '2h', '2e'].filter((k) => m.modules[k]).map((k) => `${{ 1: 'Module 1', 2: 'Module 2', '2h': 'Module 2 harder', '2e': 'Module 2 easier' }[k]}: ${m.modules[k]}`).join(' · ') || 'No questions yet'}
                    {m.taken ? ` · taken ${m.taken} times, average ${m.avg}` : ''}
                  </small>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <label className="chk"><input type="checkbox" checked={m.published} disabled={!m.ready} onChange={(e) => save(m, { published: e.target.checked })} /> Students see it</label>
                  {m.taken > 0 && <button className="btn ghost sm" onClick={() => api.get(`/math-mocks/admin/${m.id}/results`).then((rows) => setRes({ title: m.title, rows }))}>Results</button>}
                  {m.mode !== 'bank' && <button className="btn ghost sm" onClick={() => setEdit(m)}>Edit</button>}
                  {m.mode !== 'bank' && <button className="btn ghost sm" aria-label="Delete mock" onClick={() => setDel(m)}><IconTrash width={15} height={15} /></button>}
                </div>
              </div>
              {m.mode !== 'bank' && (
                <div className="row wrap" style={{ gap: 8 }}>
                  <label className="btn soft sm"><IconUpload width={15} height={15} /> Add questions from Excel<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(m, f, false); }} /></label>
                  {Object.keys(m.modules).length > 0 && <label className="btn ghost sm">Replace all questions<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(m, f, true); }} /></label>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}</Gate>
      {edit && <EditMock m={edit} onClose={() => setEdit(null)} onSave={async (p) => { await save(edit, p); setEdit(null); }} />}
      {del && <Confirm title={`Delete “${del.title}”?`} text="Its questions and the students' results for it are deleted too." onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/math-mocks/admin/${del.id}`); setDel(null); st.reload(); }} />}
      {res && (
        <Modal title={res.rows ? `Results: ${res.title}` : 'Rows that were skipped'} onClose={() => setRes(null)}>
          {res.rows ? (
            <div className="table-wrap"><table className="t"><thead><tr><th>Student</th><th>Score</th><th>Correct</th><th>Module 2</th><th>Date</th></tr></thead>
              <tbody>{res.rows.map((r) => <tr key={r.id}><td>{r.name}</td><td><b>{r.score}</b></td><td>{r.m1_correct + r.m2_correct}/{r.m1_total + r.m2_total}</td><td>{r.route || '—'}</td><td className="nowrap">{fmtDate(r.finished_at)}</td></tr>)}</tbody></table></div>
          ) : <ul>{res.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </Modal>
      )}
    </div>
  );
}

function EditMock({ m, onClose, onSave }) {
  const [f, setF] = useState({ title: m.title, note: m.note, minutes: m.minutes, hard: '', easy: '', single: '' });
  const txt = (t) => Object.entries(t || {}).map(([k, v]) => `${k} ${v}`).join('\n');
  const [conv] = useState({ hard: txt(m.conversion.hard), easy: txt(m.conversion.easy), single: txt(m.conversion.single) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Edit Math mock" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave({ title: f.title, note: f.note, minutes: Number(f.minutes), conversion: { hard: f.hard || conv.hard, easy: f.easy || conv.easy, single: f.single || conv.single } })}>Save</button></>}>
      <Field label="Title"><input value={f.title} onChange={set('title')} /></Field>
      <Field label="Note for students"><input value={f.note} onChange={set('note')} /></Field>
      <Field label="Minutes per module"><input type="number" min="5" max="120" value={f.minutes} onChange={set('minutes')} /></Field>
      <small className="muted">Conversion tables (optional): one line per raw score, e.g. “40 720”. Raw = Module 1 + Module 2 correct. Without a table the score is estimated.</small>
      {['hard', 'easy', 'single'].map((k) => <Field key={k} label={k === 'single' ? 'One Module 2 for everyone' : `After the ${k === 'hard' ? 'harder' : 'easier'} Module 2`}><textarea rows={3} defaultValue={conv[k]} onChange={set(k)} placeholder={'44 800\n43 790'} /></Field>)}
    </Modal>
  );
}
