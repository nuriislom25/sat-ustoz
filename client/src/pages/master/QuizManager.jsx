import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Confirm, Empty, Field, Gate, Modal, PageHeader, pctTone, useAsync } from '../../components/ui.jsx';
import { IconChart, IconChevron, IconDownload, IconEdit, IconEye, IconFolder, IconFolderPlus, IconLayers, IconMove, IconPlus, IconQuiz, IconSearch, IconTask, IconTrash } from '../../components/icons.jsx';
import { AssignModal as TaskAssign } from '../student/Assignments.jsx';
import { folderTools } from '../../folders.js';

/**
 * Quizzes (teacher) with folders: folders inside folders, each quiz in one folder.
 * Drag a quiz (or a folder) onto a folder to move it; drag a quiz onto another quiz to change the order.
 * A folder can be opened to groups or assigned with a deadline in one step (all quizzes inside, sub-folders too).
 * Phones have no drag: "Move to…" does the same.
 */
export const FOLDER_COLORS = ['#3B82F6', '#22B07D', '#F07A55', '#8E5CF7', '#F5B82E', '#12A39A', '#E2553D', '#64748B'];

export default function QuizManager() {
  const st = useAsync(() => Promise.all([api.get('/quizzes'), api.get('/groups'), api.get('/quiz-folders')]), []);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const cur = Number(params.get('folder')) || null;
  const open = (id) => { const n = new URLSearchParams(params); if (id) n.set('folder', id); else n.delete('folder'); setParams(n); };
  const [assign, setAssign] = useState(null);
  const [stats, setStats] = useState(null);
  const [give, setGive] = useState(null);
  const [del, setDel] = useState(null);
  const [folderForm, setFolderForm] = useState(null);
  const [folderDel, setFolderDel] = useState(null);
  const [folderAccess, setFolderAccess] = useState(null);
  const [folderGive, setFolderGive] = useState(null);
  const [moving, setMoving] = useState(null); // { quizIds, folderIds }
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [drag, setDrag] = useState(null); // { type: 'quiz'|'folder', ids }
  const [over, setOver] = useState(null);

  const moveTo = async (folderId, what) => {
    try {
      await api.post('/quiz-folders/move', { folder_id: folderId, quiz_ids: what.quizIds || [], folder_ids: what.folderIds || [] });
      setSel(new Set()); st.reload();
      const n = (what.quizIds?.length || 0) + (what.folderIds?.length || 0);
      toast(`${n === 1 ? 'Moved' : `${n} moved`} to ${folderId ? st.data[2].find((f) => f.id === folderId)?.name : 'All quizzes'}`);
    } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <div className="page qf-page">
      <PageHeader title="Quizzes" sub="Keep quizzes in folders. Open a folder to groups or assign it with a deadline in one step.">
        <button className="btn ghost" onClick={() => api.download('/template.xlsx', 'questions-template.xlsx').catch((e) => toast(e.message, 'err'))}><IconDownload /> Excel template</button>
        <button className="btn ghost" onClick={() => setFolderForm({ parent_id: cur })}><IconFolderPlus /> New folder</button>
        <Link className="btn primary" to={`/quizzes/new${cur ? `?folder=${cur}` : ''}`}><IconPlus /> New quiz</Link>
      </PageHeader>
      <Gate state={st}>{([quizzes, groups, folders]) => {
        const T = folderTools(folders);
        const curF = cur ? T.by.get(cur) : null;
        const countIn = (id) => quizzes.filter((x) => T.under(id).includes(x.folder_id)).length;
        const searching = q.trim().length > 0;
        const match = (x) => (!section || x.section === section) && (!searching || x.title.toLowerCase().includes(q.trim().toLowerCase()));
        const list = searching ? quizzes.filter(match) : quizzes.filter((x) => (x.folder_id || null) === cur && match(x));
        const subs = searching ? [] : T.kids(cur);
        const dropProps = (fid) => ({
          onDragOver: (e) => { if (!drag) return; if (drag.type === 'folder' && fid && drag.ids.some((d) => T.under(d).includes(fid))) return; e.preventDefault(); setOver(`f${fid ?? 'root'}`); },
          onDragLeave: () => setOver((o) => (o === `f${fid ?? 'root'}` ? null : o)),
          onDrop: (e) => { e.preventDefault(); setOver(null); const d = drag; setDrag(null); if (d) moveTo(fid, d.type === 'quiz' ? { quizIds: d.ids } : { folderIds: d.ids }); },
        });
        const reorder = async (targetId) => {
          const ids = list.map((x) => x.id).filter((id) => !drag.ids.includes(id));
          const at = ids.indexOf(targetId);
          ids.splice(at < 0 ? ids.length : at, 0, ...drag.ids);
          setDrag(null); setOver(null);
          try { await api.post('/quiz-folders/order', { quiz_ids: ids }); st.reload(); } catch (e) { toast(e.message, 'bad'); }
        };
        return (
          <div className="qf">
            <aside className="qf-tree" aria-label="Folders">
              <button className={`qf-node ${!cur ? 'on' : ''} ${over === 'froot' ? 'drop' : ''}`} onClick={() => open(null)} {...dropProps(null)}>
                <IconLayers width={17} height={17} /><span>All quizzes</span><small>{quizzes.length}</small>
              </button>
              <Tree T={T} pid={null} cur={cur} open={open} countIn={countIn} dropProps={dropProps} over={over} depth={0} setDrag={setDrag} />
              <button className="qf-add" onClick={() => setFolderForm({ parent_id: null })}><IconFolderPlus width={16} height={16} /> New folder</button>
            </aside>

            <section className="qf-main">
              <div className="qf-bar">
                <nav className="qf-crumbs" aria-label="Folder path">
                  <button onClick={() => open(null)} {...dropProps(null)} className={over === 'froot' ? 'drop' : ''}>All quizzes</button>
                  {cur && T.path(cur).map((f) => (
                    <span key={f.id} className="row" style={{ gap: 4 }}><IconChevron width={14} height={14} className="qf-sep" /><button onClick={() => open(f.id)} {...dropProps(f.id)} className={over === `f${f.id}` ? 'drop' : ''}>{f.name}</button></span>
                  ))}
                </nav>
                <div className="row wrap" style={{ gap: 6 }}>
                  <label className="fin-search qf-search"><IconSearch width={16} height={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all quizzes" /></label>
                  <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section"><option value="">R&amp;W and Math</option><option value="english">R&amp;W</option><option value="math">Math</option></select>
                </div>
              </div>

              {curF && !searching && (
                <Card className="qf-head" style={{ '--fc': curF.color }}>
                  <span className="qf-fico"><IconFolder width={22} height={22} /></span>
                  <div className="grow" style={{ minWidth: 0 }}><h2>{curF.name}</h2><small className="muted">{countIn(cur)} {countIn(cur) === 1 ? 'quiz' : 'quizzes'}{T.kids(cur).length ? ` · ${T.kids(cur).length} ${T.kids(cur).length === 1 ? 'folder' : 'folders'}` : ''}</small></div>
                  <div className="row wrap qf-head-acts">
                    <button className="btn soft sm" disabled={!countIn(cur)} onClick={() => setFolderGive(curF)}><IconTask width={16} height={16} /> Assign folder</button>
                    <button className="btn ghost sm" disabled={!countIn(cur)} onClick={() => setFolderAccess(curF)}><IconLayers width={16} height={16} /> Open to groups</button>
                    <button className="btn ghost sm" onClick={() => setFolderForm(curF)}><IconEdit width={16} height={16} /> Edit</button>
                    <button className="btn ghost sm" onClick={() => setMoving({ folderIds: [curF.id], title: curF.name })}><IconMove width={16} height={16} /> Move</button>
                    <button className="icon-btn danger" aria-label="Delete folder" onClick={() => setFolderDel(curF)}><IconTrash width={17} height={17} /></button>
                  </div>
                </Card>
              )}

              {subs.length > 0 && (
                <div className="qf-folders">
                  {subs.map((f) => (
                    <button key={f.id} className={`qf-folder ${over === `f${f.id}` ? 'drop' : ''}`} style={{ '--fc': f.color }} onClick={() => open(f.id)}
                      draggable onDragStart={() => setDrag({ type: 'folder', ids: [f.id] })} onDragEnd={() => { setDrag(null); setOver(null); }} {...dropProps(f.id)}>
                      <span className="qf-fico"><IconFolder width={22} height={22} /></span>
                      <span className="grow" style={{ minWidth: 0 }}><b>{f.name}</b><small>{countIn(f.id)} {countIn(f.id) === 1 ? 'quiz' : 'quizzes'}{T.kids(f.id).length ? ` · ${T.kids(f.id).length} inside` : ''}</small></span>
                    </button>
                  ))}
                </div>
              )}

              {sel.size > 0 && (
                <div className="grp-selbar" role="toolbar">
                  <b>{sel.size} selected</b>
                  <button className="btn sm" onClick={() => setMoving({ quizIds: [...sel], title: `${sel.size} quizzes` })}><IconMove width={15} height={15} /> Move to…</button>
                  <button className="as-link" onClick={() => setSel(new Set())}>Clear</button>
                </div>
              )}

              {!list.length && !subs.length ? (
                <Card><Empty icon={searching ? <IconSearch /> : <IconQuiz />} title={searching ? 'Nothing found' : quizzes.length ? 'This folder is empty' : 'No quizzes yet'}
                  text={searching ? 'Try another word.' : quizzes.length ? 'Make a quiz here, or drag quizzes onto this folder.' : 'Upload an Excel or PDF file to create your first quiz.'}>
                  {!searching && <Link className="btn primary" to={`/quizzes/new${cur ? `?folder=${cur}` : ''}`}>Create quiz</Link>}
                </Empty></Card>
              ) : (
                <div className="stack">
                  {list.map((x) => (
                    <Card key={x.id} className={`hover quiz-row qf-quiz ${sel.has(x.id) ? 'on' : ''} ${over === `q${x.id}` ? 'drop-before' : ''}`}
                      draggable onDragStart={() => setDrag({ type: 'quiz', ids: sel.has(x.id) ? [...sel] : [x.id] })} onDragEnd={() => { setDrag(null); setOver(null); }}
                      onDragOver={(e) => { if (drag?.type === 'quiz' && !searching && !drag.ids.includes(x.id)) { e.preventDefault(); setOver(`q${x.id}`); } }}
                      onDrop={(e) => { if (drag?.type === 'quiz' && !searching) { e.preventDefault(); reorder(x.id); } }}>
                      <label className="qf-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(x.id)} onChange={() => { const n = new Set(sel); n.has(x.id) ? n.delete(x.id) : n.add(x.id); setSel(n); }} aria-label={`Select ${x.title}`} /></label>
                      <div className="quiz-ico"><IconQuiz /></div>
                      <div className="stack sm" style={{ minWidth: 0 }}>
                        <h3><Link className="qf-title" to={`/quizzes/${x.id}/view`} draggable={false}>{x.title}</Link></h3>
                        {searching && x.folder_id && <small className="muted qf-path"><IconFolder width={13} height={13} /> {T.path(x.folder_id).map((f) => f.name).join(' / ')}</small>}
                        <div className="quiz-meta">
                          <span className="chip">{x.questions} questions</span>
                          <span className="chip">{x.duration_min ? `${x.duration_min} min` : 'Untimed'}</span>
                          <span className="chip">{x.section === 'math' ? 'Math' : 'R&W'}</span>
                          {x.kind !== 'practice' && <span className="chip primary">{x.kind === 'diagnostic' ? 'Readiness check' : 'Mock test'}</span>}
                          <span className="chip">{x.attempts} attempts</span>
                          <span className="muted" style={{ fontSize: '.78rem' }}>{fmtDate(x.created_at)}</span>
                        </div>
                        <div className="tag-list">
                          {x.is_public || x.kind === 'diagnostic' ? <span className="chip good">All students</span> : null}
                          {x.roadmap && <span className="chip primary">In roadmap</span>}
                          {x.groups.map((g) => <span key={g.id} className="chip primary">{g.name}</span>)}
                          {!x.is_public && x.kind !== 'diagnostic' && !x.roadmap && !x.groups.length && <span className="chip warn">Not visible to anyone</span>}
                        </div>
                      </div>
                      <div className="row wrap qf-acts">
                        <Link className="btn ghost sm" to={`/quizzes/${x.id}/view`} draggable={false}><IconEye width={16} height={16} /> Questions</Link>
                        <button className="btn soft sm" onClick={() => setGive(x)}><IconTask width={16} height={16} /> Assign to…</button>
                        <button className="btn ghost sm" onClick={() => setAssign(x)} title="Who sees it on the Quizzes page"><IconLayers width={16} height={16} /> Visibility</button>
                        <button className="icon-btn" title="Move to a folder" aria-label="Move to a folder" onClick={() => setMoving({ quizIds: [x.id], title: x.title })}><IconMove width={18} height={18} /></button>
                        <button className="icon-btn" title="Statistics" aria-label="Statistics" onClick={() => setStats(x)}><IconChart width={18} height={18} /></button>
                        <Link className="icon-btn" to={`/quizzes/${x.id}/edit`} aria-label="Edit"><IconEdit width={18} height={18} /></Link>
                        <button className="icon-btn danger" onClick={() => setDel(x)} aria-label="Delete"><IconTrash width={18} height={18} /></button>
                      </div>
                    </Card>
                  ))}
                  {!searching && list.length > 1 && <small className="muted qf-hint">Drag a quiz onto a folder to move it, or onto another quiz to change the order.</small>}
                </div>
              )}
            </section>

            {assign && <VisibilityModal quiz={assign} groups={groups} onClose={() => setAssign(null)} onSaved={() => { setAssign(null); toast('Saved'); st.reload(); }} />}
            {give && <TaskAssign quizzes={[]} quizId={give.id} onClose={() => setGive(null)} onDone={() => setGive(null)} />}
            {folderGive && <TaskAssign quizzes={[]} quizIds={quizzes.filter((x) => T.under(folderGive.id).includes(x.folder_id)).map((x) => x.id)} label={folderGive.name}
              onClose={() => setFolderGive(null)} onDone={() => setFolderGive(null)} />}
            {folderAccess && <FolderAccess folder={folderAccess} count={countIn(folderAccess.id)} groups={groups} onClose={() => setFolderAccess(null)} onDone={() => { setFolderAccess(null); st.reload(); }} />}
            {stats && <StatsModal quiz={stats} onClose={() => setStats(null)} />}
            {folderForm && <FolderForm f={folderForm} parent={folderForm.parent_id ? T.by.get(folderForm.parent_id) : null} onClose={() => setFolderForm(null)}
              onDone={(id) => { setFolderForm(null); st.reload(); if (id) open(id); }} />}
            {moving && <MoveModal what={moving} T={T} folders={folders} onClose={() => setMoving(null)} onMove={(fid) => { const w = moving; setMoving(null); moveTo(fid, w); }} />}
            {folderDel && <Confirm title={`Delete the folder “${folderDel.name}”?`} text="No quiz is deleted: everything inside moves up one level." confirmLabel="Delete folder"
              onClose={() => setFolderDel(null)} onConfirm={async () => { const p = folderDel.parent_id; await api.del(`/quiz-folders/${folderDel.id}`); setFolderDel(null); toast('Folder deleted'); open(p); st.reload(); }} />}
            {del && <Confirm title="Delete quiz" text={`“${del.title}” and all results that belong to it will be deleted.`} onClose={() => setDel(null)} onConfirm={async () => { await api.del('/quizzes/' + del.id); setDel(null); toast('Deleted'); st.reload(); }} />}
          </div>
        );
      }}</Gate>
    </div>
  );
}

function Tree({ T, pid, cur, open, countIn, dropProps, over, depth, setDrag }) {
  const kids = T.kids(pid);
  if (!kids.length) return null;
  const openPath = cur ? T.path(cur).map((f) => f.id) : [];
  return (
    <ul className="qf-list" style={{ '--d': depth }}>
      {kids.map((f) => (
        <li key={f.id}>
          <button className={`qf-node ${cur === f.id ? 'on' : ''} ${over === `f${f.id}` ? 'drop' : ''}`} style={{ '--fc': f.color }} onClick={() => open(f.id)}
            draggable onDragStart={() => setDrag({ type: 'folder', ids: [f.id] })} onDragEnd={() => setDrag(null)} {...dropProps(f.id)}>
            <IconFolder width={17} height={17} className="qf-ficon" /><span>{f.name}</span><small>{countIn(f.id)}</small>
          </button>
          {(openPath.includes(f.id) || depth < 1) && <Tree {...{ T, pid: f.id, cur, open, countIn, dropProps, over, depth: depth + 1, setDrag }} />}
        </li>
      ))}
    </ul>
  );
}

function FolderForm({ f, parent, onClose, onDone }) {
  const toast = useToast();
  const isNew = !f.id;
  const [name, setName] = useState(f.name || '');
  const [color, setColor] = useState(f.color || FOLDER_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) { const r = await api.post('/quiz-folders', { name, color, parent_id: f.parent_id || null }); toast('Folder created'); onDone(r.id); }
      else { await api.put(`/quiz-folders/${f.id}`, { name, color }); toast('Saved'); onDone(); }
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal title={isNew ? (parent ? `New folder in “${parent.name}”` : 'New folder') : 'Edit folder'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{isNew ? 'Create' : 'Save'}</button></>}>
      <div className="stack">
        <Field label="Folder name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. PreSAT · Reading" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }} /></Field>
        <div className="grp-f"><b>Colour</b><div className="row wrap" style={{ gap: 8 }}>{FOLDER_COLORS.map((c) => <button type="button" key={c} aria-label={c} className={`grp-swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}</div></div>
      </div>
    </Modal>
  );
}

/** Pick where to move: any folder (not into itself), or the top level. */
function MoveModal({ what, T, folders, onClose, onMove }) {
  const blocked = new Set((what.folderIds || []).flatMap((id) => T.under(id)));
  const rows = [];
  const walk = (pid, d) => T.kids(pid).forEach((f) => { rows.push({ f, d }); walk(f.id, d + 1); });
  walk(null, 0);
  return (
    <Modal title={`Move “${what.title}”`} onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>Cancel</button>}>
      <div className="qf-move">
        <button className="qf-move-row" onClick={() => onMove(null)}><IconLayers width={18} height={18} /> All quizzes (top level)</button>
        {rows.map(({ f, d }) => (
          <button key={f.id} className="qf-move-row" disabled={blocked.has(f.id)} style={{ paddingLeft: 12 + d * 20, '--fc': f.color }} onClick={() => onMove(f.id)}>
            <IconFolder width={18} height={18} className="qf-ficon" /> {f.name}
          </button>
        ))}
        {!folders.length && <p className="muted">No folders yet. Create one with “New folder”.</p>}
      </div>
    </Modal>
  );
}

/** Open every quiz in a folder (and its sub-folders) to groups or to all students. */
function FolderAccess({ folder, count, groups, onClose, onDone }) {
  const toast = useToast();
  const [sel, setSel] = useState(new Set());
  const [pub, setPub] = useState(null); // null = keep, true / false
  const [mode, setMode] = useState('add');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.post(`/quiz-folders/${folder.id}/access`, { group_ids: [...sel], is_public: pub, mode }); toast(`Updated ${r.quizzes} ${r.quizzes === 1 ? 'quiz' : 'quizzes'}`); onDone(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const active = groups.filter((g) => !g.archived);
  return (
    <Modal title={`Open “${folder.name}” · ${count} ${count === 1 ? 'quiz' : 'quizzes'}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (!sel.size && pub === null && mode === 'add')} onClick={save}>Save</button></>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Applies to every quiz in this folder and its sub-folders.</p>
        <div className="grp-f"><b>All students</b>
          <div className="mh-chips">{[[null, 'Keep as it is'], [true, 'Open to everyone'], [false, 'Not for everyone']].map(([v, l]) => <button type="button" key={String(v)} className={`mh-chip ${pub === v ? 'on' : ''}`} onClick={() => setPub(v)}>{l}</button>)}</div>
        </div>
        <div className="grp-f"><b>Groups</b>
          {!active.length ? <p className="muted">No groups yet — create one in Groups.</p> : <div className="mh-chips">{active.map((g) => <button type="button" key={g.id} className={`mh-chip ${sel.has(g.id) ? 'on' : ''}`} onClick={() => { const n = new Set(sel); n.has(g.id) ? n.delete(g.id) : n.add(g.id); setSel(n); }}>{g.name} · {g.students}</button>)}</div>}
        </div>
        <div className="grp-f"><b>Groups each quiz already has</b>
          <div className="mh-chips">
            <button type="button" className={`mh-chip ${mode === 'add' ? 'on' : ''}`} onClick={() => setMode('add')}>Keep them, add these</button>
            <button type="button" className={`mh-chip ${mode === 'set' ? 'on' : ''}`} onClick={() => setMode('set')}>Replace with only these</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function VisibilityModal({ quiz, groups, onClose, onSaved }) {
  const [sel, setSel] = useState(new Set(quiz.groups.map((g) => g.id)));
  const [pub, setPub] = useState(!!quiz.is_public);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal title={`“${quiz.title}” — who can see it?`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { await api.put(`/quizzes/${quiz.id}/groups`, { group_ids: [...sel], is_public: pub }); onSaved(); }}>Save</button></>}>
      <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} style={{ width: 18, height: 18 }} /> <span><b>All students</b> <small className="muted">— everyone who signed up</small></span></label>
      <div className="muted" style={{ fontSize: '.82rem', fontWeight: 600 }}>Or only these groups</div>
      {groups.length === 0 ? <p className="muted">No groups yet — create one in Groups.</p> : (
        <div className="tag-list">{groups.filter((g) => !g.archived || sel.has(g.id)).map((g) => <button key={g.id} className={`chip chip-btn ${sel.has(g.id) ? 'on' : ''}`} onClick={() => toggle(g.id)}>{sel.has(g.id) ? '✓ ' : ''}{g.name} · {g.students}</button>)}</div>
      )}
    </Modal>
  );
}

function StatsModal({ quiz, onClose }) {
  const st = useAsync(() => api.get(`/quizzes/${quiz.id}/stats`), [quiz.id]);
  return (
    <Modal title={`${quiz.title} — statistics`} onClose={onClose} wide>
      <Gate state={st}>{(d) => (
        <div className="grid g2">
          <div className="stack sm"><h3>Students (best result)</h3>
            {d.students.length === 0 ? <p className="muted">No attempts yet.</p> : d.students.map((s) => <Link key={s.student_id} to={`/students/${s.student_id}`} className="row between" onClick={onClose} style={{ color: 'inherit' }}><span>{s.name}</span><span className={`chip ${pctTone(s.best)}`}>{s.best}% · {s.tries}x</span></Link>)}
          </div>
          <div className="stack sm"><h3>Hardest questions</h3>
            {d.hardest.length === 0 ? <p className="muted">No data yet.</p> : d.hardest.map((h) => <div key={h.id} className="row between"><span>#{h.position + 1} · {h.topic}</span><span className={`chip ${pctTone(h.pct)}`}>{h.pct}% correct</span></div>)}
          </div>
        </div>
      )}</Gate>
    </Modal>
  );
}
