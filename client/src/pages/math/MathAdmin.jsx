import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Confirm, Field, Gate, Modal, PageHeader, Segmented, useAsync } from '../../components/ui.jsx';
import { IconDownload, IconEye, IconEyeOff, IconPlus, IconSearch, IconTrash, IconUpload } from '../../components/icons.jsx';
import MathText from './MathText.jsx';
import { PictureBar, usePictureField } from '../../components/QuestionPictures.jsx';
import MathRoadAdmin from './MathRoadAdmin.jsx';

const L = ['A', 'B', 'C', 'D'];
const LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Teacher: the SAT Math question list — add, edit, hide. Formulas are written between $ signs. */
export default function MathAdmin({ only = null }) {
  const st = useAsync(() => api.get('/math/admin'), []);
  const toast = useToast();
  const [dom, setDom] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [tab, setTab] = useState(only || 'roadmap');
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const importFile = async (f) => {
    setImporting(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api.upload('/math/admin/import', fd);
      setReport(r); st.reload();
    } catch (e) { toast(e.message, 'bad'); }
    setImporting(false);
  };
  const toggle = async (x) => { try { await api.put(`/math/admin/${x.id}`, { active: !x.active }); st.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="page math-page">
      <PageHeader title={only === 'roadmap' ? 'Math Roadmap' : only === 'questions' ? 'Math Question Bank' : 'SAT Math'} sub={tab === 'roadmap' ? 'The Math roadmap: video lessons in order, each with a practice and a pass mark.' : 'Questions students practise in the Math section, with the Desmos calculator. Write formulas between $ signs, e.g. $x^2 + 3x$ or $\\frac{3}{4}$.'}>
        {tab === 'questions' && <>
          <button className="btn ghost" onClick={() => api.download('/math/admin/template.xlsx', 'sat-math-questions-template.xlsx').catch((e) => toast(e.message, 'bad'))}><IconDownload width={16} height={16} /> Template</button>
          <label className={`btn soft ${importing ? 'disabled' : ''}`}>
            <IconUpload width={16} height={16} /> {importing ? 'Importing…' : 'Import Excel'}
            <input type="file" hidden accept=".xlsx,.xls,.csv" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
          </label>
          <button className="btn primary" onClick={() => setEdit({})}><IconPlus width={16} height={16} /> New question</button>
        </>}
      </PageHeader>
      {!only && <Segmented value={tab} onChange={setTab} options={[{ value: 'roadmap', label: 'Roadmap lessons' }, { value: 'questions', label: 'Questions' }]} />}
      {tab === 'roadmap' ? <MathRoadAdmin /> : <Gate state={st}>{(d) => <List d={d} {...{ dom, setDom, q, setQ, setEdit, setDel, toggle }} />}</Gate>}
      {edit && st.data && <Editor x={edit} domains={st.data.domains} onClose={() => setEdit(null)} onDone={() => { setEdit(null); st.reload(); }} />}
      {report && (
        <Modal title="Import finished" onClose={() => setReport(null)} footer={<button className="btn primary" onClick={() => setReport(null)}>OK</button>}>
          <p><b>{report.added}</b> question{report.added === 1 ? '' : 's'} added to the Math Question Bank{report.duplicates ? `, ${report.duplicates} already there (skipped)` : ''}.</p>
          {report.problem_count > 0 && (
            <>
              <p className="muted">{report.problem_count} row{report.problem_count === 1 ? ' was' : 's were'} not added:</p>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>{report.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
        </Modal>
      )}
      {del && <Confirm title="Delete this question?" text={del.source === 'starter' ? 'This is a built-in question: it will be hidden from students.' : 'Students’ answers to it are removed too.'} confirmLabel="Delete"
        onClose={() => setDel(null)} onConfirm={async () => { try { await api.del(`/math/admin/${del.id}`); setDel(null); st.reload(); } catch (e) { toast(e.message, 'bad'); } }} />}
    </div>
  );
}

function List({ d, dom, setDom, q, setQ, setEdit, setDel, toggle }) {
  const rows = useMemo(() => d.questions.filter((x) => (!dom || x.domain === dom) && (!q || `${x.prompt} ${x.id}`.toLowerCase().includes(q.toLowerCase()))), [d, dom, q]);
  const skill = (x) => d.domains.find((y) => y.id === x.domain)?.skills.find((s) => s.id === x.skill)?.name || x.skill;
  return (
    <>
      <div className="row wrap ma-filters" style={{ gap: 8 }}>
        <div className="mh-chips">
          <button className={`mh-chip ${!dom ? 'on' : ''}`} onClick={() => setDom('')}>All · {d.questions.length}</button>
          {d.domains.map((x) => <button key={x.id} className={`mh-chip ${dom === x.id ? 'on' : ''}`} onClick={() => setDom(x.id)}>{x.name} · {d.questions.filter((y) => y.domain === x.id).length}</button>)}
        </div>
        <label className="fin-search grow"><IconSearch width={16} height={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a question" /></label>
      </div>
      <div className="ma-list">
        {rows.map((x) => (
          <Card key={x.id} className={`ma-row ${x.active ? '' : 'off'}`}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="chip domain">{skill(x)}</span><span className={`chip lvl-${x.difficulty}`}>{LEVEL[x.difficulty]}</span>
                <span className="chip">{x.kind === 'spr' ? 'Typed answer' : 'Multiple choice'}</span>
                {!x.active && <span className="chip warn">Hidden</span>}
                <small className="muted">{x.answered ? `${x.answered} answered · ${Math.round((x.first_ok / x.answered) * 100)}% right first time` : 'Not answered yet'}</small>
              </div>
              <MathText as="div" className="ma-prompt">{x.prompt}</MathText>
              <small className="muted">Answer: {x.kind === 'spr' ? x.answer.join(' or ') : x.answer}</small>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost sm" onClick={() => setEdit(x)}>Edit</button>
              <button className="icon-sm" aria-label={x.active ? 'Hide from students' : 'Show to students'} onClick={() => toggle(x)}>{x.active ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}</button>
              <button className="icon-sm danger" aria-label="Delete" onClick={() => setDel(x)}><IconTrash width={15} height={15} /></button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Editor({ x, domains, onClose, onDone }) {
  const toast = useToast();
  const isNew = !x.id;
  const [f, setF] = useState({
    domain: x.domain || 'alg', skill: x.skill || domains[0].skills[0].id, difficulty: x.difficulty || 'medium', kind: x.kind || 'mcq',
    prompt: x.prompt || '', options: x.options?.length === 4 ? [...x.options] : ['', '', '', ''], answer: x.kind === 'mcq' ? x.answer : 'A',
    answers: x.kind === 'spr' ? x.answer.join('; ') : '', explanation: x.explanation || '', tip: x.tip || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pic = usePictureField(() => f.prompt, (v) => setF((o) => ({ ...o, prompt: v })));
  const skills = domains.find((d) => d.id === f.domain)?.skills || [];
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) await api.post('/math/admin', f); else await api.put(`/math/admin/${x.id}`, f);
      toast('Saved'); onDone();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={isNew ? 'New math question' : 'Edit math question'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="stack">
        <div className="grid g3">
          <Field label="Domain"><select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value, skill: domains.find((d) => d.id === e.target.value).skills[0].id })}>{domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Skill"><select value={f.skill} onChange={set('skill')}>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Level"><select value={f.difficulty} onChange={set('difficulty')}>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <div className="mh-chips">
          <button type="button" className={`mh-chip ${f.kind === 'mcq' ? 'on' : ''}`} onClick={() => setF({ ...f, kind: 'mcq' })}>Multiple choice</button>
          <button type="button" className={`mh-chip ${f.kind === 'spr' ? 'on' : ''}`} onClick={() => setF({ ...f, kind: 'spr' })}>Typed answer</button>
        </div>
        <Field label="Question" hint="formulas between $ … $"><textarea ref={pic.ref} onPaste={pic.onPaste} onDrop={pic.onDrop} rows={3} value={f.prompt} onChange={set('prompt')} placeholder="If $3x + 7 = 22$, what is the value of $x$?" /></Field>
        <PictureBar field={pic} text={f.prompt} onChange={(v) => setF((o) => ({ ...o, prompt: v }))} />
        {f.prompt && <div className="ma-preview"><small>Preview</small><MathText as="div">{f.prompt}</MathText></div>}
        {f.kind === 'mcq' ? (
          <div className="ma-opts">
            {f.options.map((o, i) => (
              <label key={i} className={`ma-opt ${f.answer === L[i] ? 'on' : ''}`}>
                <input type="radio" name="ans" checked={f.answer === L[i]} onChange={() => setF({ ...f, answer: L[i] })} aria-label={`${L[i]} is right`} />
                <b>{L[i]}</b>
                <input value={o} onChange={(e) => { const n = [...f.options]; n[i] = e.target.value; setF({ ...f, options: n }); }} placeholder={`Choice ${L[i]}`} />
                {o && /\$/.test(o) && <MathText className="ma-opt-prev">{o}</MathText>}
              </label>
            ))}
            <small className="muted">Tick the right answer.</small>
          </div>
        ) : (
          <Field label="Right answer" hint="several forms: separate with ;"><input value={f.answers} onChange={set('answers')} placeholder="2/5; 0.4; .4" /></Field>
        )}
        <Field label="Explanation" hint="shown after the answer"><textarea rows={3} value={f.explanation} onChange={set('explanation')} /></Field>
        <Field label="Desmos tip" hint="optional"><input value={f.tip} onChange={set('tip')} placeholder="Graph both lines and tap the intersection." /></Field>
      </div>
    </Modal>
  );
}
