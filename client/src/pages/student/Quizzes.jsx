import { useState } from 'react';
import TakeQuizCard from '../mock/TakeQuiz.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import { folderTools } from '../../folders.js';
import { api, fmtDate } from '../../api.js';
import { useAuth } from '../../context.jsx';
import { Card, Empty, Gate, PageHeader, Segmented, pctTone, useAsync } from '../../components/ui.jsx';
import { IconArrow, IconCheck, IconChevron, IconClock, IconCrown, IconFolder, IconLock, IconQuiz } from '../../components/icons.jsx';
import { UsageChip } from '../../usage.jsx';
import { subjectOf } from '../../subject.jsx';

export function PaywallBanner() { return null; } // SAT Ustoz is free
function OldPaywallBanner() { // eslint-disable-line no-unused-vars
  return (
    <div className="banner">
      <span className="item-ic"><IconCrown /></span>
      <div className="grow"><b>Unlock the full course</b><small>Quizzes, video lessons and mocks need an active subscription.</small></div>
      <Link className="btn primary sm" to="/subscribe">See plans <IconArrow width={16} height={16} /></Link>
    </div>
  );
}

function MathPaywall() { return null; } // SAT Ustoz is free
function OldMathPaywall() { // eslint-disable-line no-unused-vars
  return (
    <div className="banner">
      <span className="item-ic"><IconCrown /></span>
      <div className="grow"><b>Math quizzes come with a Math plan</b><small>The Math plan opens every video lesson, quiz and unlimited practice.</small></div>
      <Link className="btn primary sm" to="/subscribe?subject=math">Buy Math <IconArrow width={16} height={16} /></Link>
    </div>
  );
}

export default function Quizzes() {
  const st = useAsync(() => Promise.all([api.get('/quizzes'), api.get('/quiz-folders').catch(() => [])]), []);
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const cur = Number(params.get('folder')) || null;
  const open = (id) => { const n = new URLSearchParams(params); if (id) n.set('folder', id); else n.delete('folder'); setParams(n); };
  const math = subjectOf(user) === 'math';
  const canPractice = math ? user.access?.math?.can_practice : user.access?.can_practice;
  const locked = (q) => q.kind !== 'diagnostic' && !canPractice;
  const [tab, setTab] = useState('all');
  return (
    <div className="page">
      <PageHeader title={math ? 'Math quizzes' : 'Quizzes'} sub={math ? 'SAT Math quizzes from your teacher.' : 'A quick random SAT module, plus quizzes from your teacher.'}>{!math && <UsageChip />}</PageHeader>
      {user.role === 'student' && !math && <TakeQuizCard />}
      {!canPractice && (math ? <MathPaywall /> : <PaywallBanner />)}
      <Gate state={st}>{([all, allFolders]) => {
        const list = all.filter((q) => (q.section === 'math') === math);
        if (math && !list.length) return <Empty title="No Math quizzes yet" text="When your teacher opens a Math quiz to you, it shows up here. Meanwhile, practise by topic." />;
        // folders: only the ones that hold a quiz open to this student; with a status tab picked, a flat list
        const T = folderTools(allFolders);
        const has = (fid) => list.some((q) => q.folder_id && T.under(fid).includes(q.folder_id));
        const useFolders = tab === 'all' && list.some((q) => q.folder_id);
        const here = useFolders && cur && T.by.get(cur) ? cur : null;
        const subs = useFolders ? T.kids(here).filter((f) => has(f.id)) : [];
        const shown = list.filter((q) => (tab === 'all' || q.status === tab) && (!useFolders || (q.folder_id && T.by.get(q.folder_id) ? q.folder_id : null) === here));
        const inFolder = (fid) => list.filter((q) => q.folder_id && T.under(fid).includes(q.folder_id));
        const c = (s) => list.filter((q) => q.status === s).length;
        if (!list.length) return null; // no teacher quizzes: Take a quiz above is enough
        return (
          <>
            <Segmented value={tab} onChange={setTab} options={[
              { value: 'all', label: "All", count: list.length }, { value: 'new', label: "New", count: c('new') },
              { value: 'in_progress', label: "In progress", count: c('in_progress') }, { value: 'done', label: "Completed", count: c('done') },
            ]} />
            {useFolders && here && (
              <nav className="qf-crumbs sq-crumbs" aria-label="Folder path">
                <button onClick={() => open(null)}>All quizzes</button>
                {T.path(here).map((f) => <span key={f.id} className="row" style={{ gap: 4 }}><IconChevron width={14} height={14} className="qf-sep" /><button onClick={() => open(f.id)}>{f.name}</button></span>)}
              </nav>
            )}
            {subs.length > 0 && (
              <div className="qf-folders">
                {subs.map((f) => {
                  const qs = inFolder(f.id); const done = qs.filter((q) => q.status === 'done').length;
                  return (
                    <button key={f.id} className="qf-folder" style={{ '--fc': f.color }} onClick={() => open(f.id)}>
                      <span className="qf-fico"><IconFolder width={22} height={22} /></span>
                      <span className="grow" style={{ minWidth: 0 }}><b>{f.name}</b><small>{done} of {qs.length} done</small>
                        <span className="qf-prog"><i style={{ width: `${qs.length ? (100 * done) / qs.length : 0}%` }} /></span></span>
                    </button>
                  );
                })}
              </div>
            )}
            {shown.length === 0 ? (subs.length ? null :
              <Card><Empty icon={<IconQuiz />} title="Nothing in this tab" text="Pick another tab above." /></Card>
            ) : (
              <div className="stack stagger">
                {shown.map((q) => (
                  <Card key={q.id} className="hover quiz-row">
                    <div className={`quiz-ico ${q.status}`}>{q.status === 'done' ? <IconCheck /> : q.status === 'in_progress' ? <IconClock /> : <IconQuiz />}</div>
                    <div className="stack sm">
                      <h3>{q.title}</h3>
                      <div className="quiz-meta">
                        <span className="chip">{q.questions} {"questions"}</span>
                        {q.duration_min > 0 && <span className="chip">{q.duration_min} {"min"}</span>}
                        <span className="chip">{q.section === 'math' ? 'Math' : 'Reading & Writing'}</span>
                        {q.kind === 'diagnostic' && <span className="chip primary">Readiness check</span>}
                        {q.kind === 'mock' && <span className="chip primary">Mock test</span>}
                        {q.status === 'done' && <span className={`chip ${pctTone(q.best)}`}>{"Best"} {q.best}% · {q.tries}x</span>}
                        {q.status === 'in_progress' && <span className="chip warn">{"In progress"}</span>}
                      </div>
                      {q.last && <small className="muted">{"Last attempt:"} {fmtDate(q.last.finished_at)} — {q.last.score}/{q.last.total}</small>}
                    </div>
                    <div className="row wrap">
                      {q.last_attempt_id && <Link className="btn ghost sm" to={`/result/${q.last_attempt_id}`}>{"Analysis"}</Link>}
                      {locked(q)
                        ? <Link className="btn soft sm" to="/subscribe"><IconLock width={15} height={15} /> Unlock</Link>
                        : <Link className="btn primary sm" to={`/quiz/${q.id}`}>{q.status === 'in_progress' ? "Resume" : q.status === 'done' ? "Retake" : "Start"} <IconArrow width={16} height={16} /></Link>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        );
      }}</Gate>
    </div>
  );
}
