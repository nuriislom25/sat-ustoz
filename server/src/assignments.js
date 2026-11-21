/**
 * Assignments: tasks that follow the roadmap, plus tasks the teacher gives to a student or a group.
 *
 * - Roadmap quizzes are NOT on the Quizzes page. Each quiz in a roadmap step becomes an assignment for the
 *   student once that step is unlocked; future steps show their assignments greyed out with a lock.
 * - The teacher can "Assign to…" any quiz (one student, several, or a group), optionally with a due date,
 *   a number of attempts and a pass mark — e.g. a retake outside the roadmap.
 * - Shape (general, so other task types can plug in later):
 *   { key, source: 'roadmap' | 'teacher', type: 'quiz', title, step, quiz_id, status, best, tries, due_at, attempts_allowed, pass_pct, locked }
 */
import { db } from './db.js';
import { notifyUser } from './tgbot.js';

export async function migrateAssignments() {
  await db.exec(`CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY, type TEXT NOT NULL DEFAULT 'quiz', quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    due_at TIMESTAMPTZ, attempts_allowed INTEGER NOT NULL DEFAULT 0, pass_pct INTEGER NOT NULL DEFAULT 70, note TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_assign_user ON assignments(user_id);
  CREATE INDEX IF NOT EXISTS idx_assign_group ON assignments(group_id);
  ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS close_at_due BOOLEAN NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS assignment_grants (assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, extra INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (assignment_id, user_id));
  ALTER TABLE assignment_grants ENABLE ROW LEVEL SECURITY;`);
}

/** The student's results per quiz: best %, tries, open attempt. */
async function quizResults(userId, quizIds, since = null) {
  if (!quizIds.length) return new Map();
  const rows = await db.all(`SELECT quiz_id, COUNT(finished_at) AS tries,
      MAX(CASE WHEN finished_at IS NOT NULL AND total > 0 THEN ROUND(100.0 * score / total) END) AS best,
      MAX(CASE WHEN finished_at IS NULL THEN id END) AS open_id,
      MAX(finished_at) AS last_at
    FROM attempts WHERE user_id = ? AND quiz_id = ANY(?::int[]) ${since ? 'AND started_at >= ?' : ''} GROUP BY quiz_id`, since ? [userId, quizIds, since] : [userId, quizIds]);
  return new Map(rows.map((r) => [r.quiz_id, { tries: Number(r.tries), best: r.best == null ? null : Number(r.best), open_id: r.open_id, last_at: r.last_at }]));
}

/** closed = the deadline passed and the teacher closes the task at the deadline */
function statusOf(r, pass, allowed, closed = false) {
  if (r?.open_id && !closed) return 'in_progress';
  if (r && r.best != null && r.best >= pass) return 'passed';
  if (closed) return 'closed';
  if (!r) return 'new';
  if (r.tries > 0) return allowed && r.tries >= allowed ? 'failed' : 'retake';
  return 'new';
}
const isClosed = (a) => !!(a.close_at_due && a.due_at && new Date(a.due_at) < new Date());
/** Extra tries the teacher gave one student on one assignment. */
const grantsFor = async (userId, ids) => (ids.length ? new Map((await db.all('SELECT assignment_id, extra FROM assignment_grants WHERE user_id = ? AND assignment_id = ANY(?::int[])', [userId, ids])).map((r) => [r.assignment_id, r.extra])) : new Map());

/** Teacher assignments that apply to this user (directly or through the group). */
const teacherRows = (user) => db.all(`SELECT a.*, q.title, q.duration_min, (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS questions
  FROM assignments a JOIN quizzes q ON q.id = a.quiz_id WHERE a.user_id = ? OR (a.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = a.group_id AND gm.user_id = ?
    -- a student who left the group keeps the tasks given while they were in it; a new member gets the group's tasks too
    AND (gm.left_at IS NULL OR a.created_at < gm.left_at))) ORDER BY a.created_at DESC`, [user.id, user.id]);

/** Every assignment for one student. `roadmapFor` comes from index.js (step locking lives there). */
export async function assignmentsFor(user, roadmapFor) {
  const { steps } = await roadmapFor(user);
  const out = [];
  steps.forEach((s, i) => {
    for (const it of s.items || []) {
      if (it.kind === 'random') {
        out.push({ key: `e${it.id}`, source: 'roadmap', type: 'exam', item_id: it.id, title: it.title, quiz_id: null,
          step: { id: s.id, title: s.title, index: i + 1 }, pass_pct: it.exam?.pass_pct ?? 80, attempts_allowed: 0, due_at: null,
          minutes: it.exam?.minutes, questions: it.exam?.count, best: it.best ?? null, tries: it.tries || 0,
          locked: s.status === 'locked', lock_reason: s.status === 'locked' ? `Finish “${steps[i - 1]?.title || 'the previous step'}” to unlock` : null });
        continue;
      }
      if (it.kind !== 'quiz' || !it.quiz_id) continue;
      const cur = it.current_quiz_id || it.quiz_id;
      out.push({ key: `r${it.id}`, source: 'roadmap', type: 'quiz', title: it.title || it.quiz_title, quiz_id: cur,
        retake: it.retake_quiz_id ? { on: cur === it.retake_quiz_id, used: !!it.retake_used, opens_at: it.retake_opens_at || null, passed: !!it.done } : null,
        step: { id: s.id, title: s.title, index: i + 1 }, pass_pct: s.pass_pct, attempts_allowed: 0, due_at: null,
        minutes: it.quiz_minutes, questions: Number(it.quiz_questions || 0),
        locked: s.status === 'locked', lock_reason: s.status === 'locked' ? `Finish “${steps[i - 1]?.title || 'the previous step'}” to unlock` : null });
    }
  });
  const trows = await teacherRows(user);
  const grants = await grantsFor(user.id, trows.map((a) => a.id));
  for (const a of trows) {
    const extra = grants.get(a.id) || 0;
    out.push({ key: `t${a.id}`, id: a.id, source: a.group_id ? 'group' : 'teacher', type: a.type, title: a.title, quiz_id: a.quiz_id, step: null,
      pass_pct: a.pass_pct, attempts_allowed: a.attempts_allowed ? a.attempts_allowed + extra : 0, due_at: a.due_at, close_at_due: !!a.close_at_due,
      note: a.note, minutes: a.duration_min, questions: Number(a.questions || 0), locked: false, since: a.created_at });
  }
  const res = await quizResults(user.id, [...new Set(out.filter((a) => !a.since).map((a) => a.quiz_id).filter(Boolean))]);
  const openExams = new Set((await db.all("SELECT item_id FROM qbank_mocks WHERE user_id = ? AND item_id IS NOT NULL AND finished_at IS NULL AND started_at > now() - (COALESCE(minutes, 32) || ' minutes')::interval", [user.id])).map((r) => r.item_id));
  for (const a of out) {
    if (a.type === 'exam') {
      a.open_attempt = openExams.has(a.item_id) || null;
      a.status = a.locked ? 'locked' : a.open_attempt ? 'in_progress' : a.best != null && a.best >= a.pass_pct ? 'passed' : a.tries ? 'retake' : 'new';
      continue;
    }
    // a teacher task counts only the tries made after it was given
    const r = a.since ? (await quizResults(user.id, [a.quiz_id], a.since)).get(a.quiz_id) : res.get(a.quiz_id);
    a.best = r?.best ?? null; a.tries = r?.tries || 0; a.open_attempt = r?.open_id || null;
    a.status = a.locked ? 'locked' : statusOf(r, a.pass_pct, a.attempts_allowed, a.since ? isClosed(a) : false);
    if (a.attempts_allowed) a.tries_left = Math.max(0, a.attempts_allowed - a.tries);
    delete a.since;
    if (a.retake && !a.locked) {
      // Exam A / B pair: passing either completes it; the next one opens after the waiting time
      if (a.retake.passed) a.status = 'passed';
      else if (a.retake.opens_at) a.status = 'waiting';
      else if (a.retake.on || a.retake.used) a.status = r?.open_id ? 'in_progress' : 'retake';
      if (a.retake.on) a.title = `${a.title} · retake`;
    }
    a.overdue = !!(a.due_at && new Date(a.due_at) < new Date() && a.status !== 'passed');
  }
  return out;
}

/** Can this user open this roadmap / assigned quiz right now? */
export async function assignedQuizOpen(user, quizId, roadmapFor) {
  const list = await assignmentsFor(user, roadmapFor);
  return list.some((a) => a.quiz_id === Number(quizId) && !a.locked && !['failed', 'waiting', 'closed'].includes(a.status));
}

/** A new try is blocked when every teacher task for this quiz is out of tries or closed at its deadline (null = allowed). */
export async function assignmentBlock(user, quizId, roadmapFor) {
  const mine = (await assignmentsFor(user, roadmapFor)).filter((a) => a.quiz_id === Number(quizId) && a.source !== 'roadmap');
  if (!mine.length || mine.some((a) => !['failed', 'closed'].includes(a.status))) return null;
  return mine.some((a) => a.status === 'closed') ? 'The deadline for this assignment has passed. Ask your teacher for more time.' : 'You have used all tries for this assignment. Ask your teacher for another try.';
}

export function registerAssignments(app, { h, bad, requireMaster, requireStudent, roadmapFor }) {
  app.get('/api/assignments', requireStudent, h(async (req, res) => {
    const items = await assignmentsFor(req.user, roadmapFor);
    res.json({ items, open: items.filter((a) => ['new', 'in_progress', 'retake'].includes(a.status)).length });
  }));

  // teacher: one student's assignments (same view as the student's)
  app.get('/api/students/:id/assignments', requireMaster, h(async (req, res) => {
    const u = await db.one("SELECT * FROM users WHERE id = ? AND role = 'student'", [Number(req.params.id)]);
    if (!u) return bad(res, 'Not found', 404);
    res.json({ items: await assignmentsFor(u, roadmapFor) });
  }));

  // teacher: every assignment given outside the roadmap, with progress
  app.get('/api/master/assignments', requireMaster, h(async (req, res) => {
    const rows = await db.all(`SELECT a.*, q.title, u.name AS user_name, g.name AS group_name FROM assignments a
      JOIN quizzes q ON q.id = a.quiz_id LEFT JOIN users u ON u.id = a.user_id LEFT JOIN groups g ON g.id = a.group_id
      ORDER BY a.created_at DESC LIMIT 300`);
    const out = [];
    for (const a of rows) {
      const students = a.user_id ? [{ id: a.user_id, name: a.user_name }] : await db.all(`SELECT DISTINCT u.id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ? AND u.role = 'student' AND (gm.left_at IS NULL OR gm.left_at > ?) ORDER BY u.name`, [a.group_id, a.created_at]);
      let passed = 0; let started = 0;
      const per = [];
      const g = new Map((await db.all('SELECT user_id, extra FROM assignment_grants WHERE assignment_id = ?', [a.id])).map((x) => [x.user_id, x.extra]));
      for (const s of students) {
        const r = (await quizResults(s.id, [a.quiz_id], a.created_at)).get(a.quiz_id);
        const extra = g.get(s.id) || 0;
        const allowed = a.attempts_allowed ? a.attempts_allowed + extra : 0;
        const st = statusOf(r, a.pass_pct, allowed, isClosed(a));
        if (st === 'passed') passed++; if (st !== 'new') started++;
        per.push({ id: s.id, name: s.name, status: st, best: r?.best ?? null, tries: r?.tries || 0, allowed, extra });
      }
      out.push({ ...a, students: per, total: students.length, passed, started });
    }
    res.json(out);
  }));

  // teacher: homework statistics — how the students of a group (or everyone) are doing their teacher tasks.
  // Same rules as the student's view: only tries made after the task was given count; grants add tries.
  // ?group=<id> (or empty = every student) & days=7|30|90|0 (0 = all time, by the day the task was given)
  app.get('/api/master/homework-stats', requireMaster, h(async (req, res) => {
    const gid = Number(req.query.group) || null;
    const days = [7, 14, 30, 90, 0].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const groups = await db.all('SELECT id, name, subject, archived FROM groups ORDER BY archived, name');
    if (gid && !groups.some((g) => g.id === gid)) return bad(res, 'Group not found', 404);
    const since = days ? new Date(Date.now() - days * 864e5) : null;
    const params = [];
    let where = 'WHERE 1=1';
    if (since) { where += ' AND a.created_at >= ?'; params.push(since); }
    // a group's view: tasks given to the group + tasks given one by one to its current students
    let memberCut = '';
    if (gid) {
      where += ' AND (a.group_id = ? OR a.user_id IN (SELECT user_id FROM group_members WHERE group_id = ? AND left_at IS NULL))';
      params.push(gid, gid);
      memberCut = 'AND s.uid IN (SELECT user_id FROM group_members WHERE group_id = ? AND left_at IS NULL)';
    }
    const rows = await db.all(`WITH pairs AS (
        SELECT a.id AS aid, a.quiz_id, a.created_at, a.due_at, a.pass_pct, a.attempts_allowed, a.close_at_due, a.group_id, s.uid
        FROM assignments a
        CROSS JOIN LATERAL (
          SELECT a.user_id AS uid WHERE a.user_id IS NOT NULL
          UNION SELECT gm.user_id FROM group_members gm WHERE a.group_id IS NOT NULL AND gm.group_id = a.group_id AND (gm.left_at IS NULL OR gm.left_at > a.created_at)
        ) s
        JOIN users u ON u.id = s.uid AND u.role = 'student'
        ${where} ${memberCut}
      )
      SELECT p.aid, p.uid, p.quiz_id, p.created_at, p.due_at, p.pass_pct, p.attempts_allowed, p.close_at_due,
        COUNT(t.finished_at) AS tries,
        MAX(CASE WHEN t.finished_at IS NOT NULL AND t.total > 0 THEN ROUND(100.0 * t.score / t.total) END) AS best,
        MAX(CASE WHEN t.finished_at IS NULL THEN t.id END) AS open_id,
        MIN(t.started_at) AS first_at, MAX(t.finished_at) AS last_at,
        MIN(CASE WHEN t.finished_at IS NOT NULL AND t.total > 0 AND ROUND(100.0 * t.score / t.total) >= p.pass_pct THEN t.finished_at END) AS passed_at,
        COALESCE(SUM(CASE WHEN t.finished_at IS NOT NULL THEN LEAST(EXTRACT(EPOCH FROM (t.finished_at - t.started_at)), 4 * 3600) END), 0) AS secs
      FROM pairs p LEFT JOIN attempts t ON t.user_id = p.uid AND t.quiz_id = p.quiz_id AND t.started_at >= p.created_at
      GROUP BY p.aid, p.uid, p.quiz_id, p.created_at, p.due_at, p.pass_pct, p.attempts_allowed, p.close_at_due`, gid ? [...params, gid] : params);

    const aids = [...new Set(rows.map((r) => r.aid))];
    const uids = [...new Set(rows.map((r) => r.uid))];
    const grants = new Map((aids.length ? await db.all('SELECT assignment_id, user_id, extra FROM assignment_grants WHERE assignment_id = ANY(?::int[])', [aids]) : []).map((g) => [`${g.assignment_id}:${g.user_id}`, g.extra]));
    const meta = new Map((aids.length ? await db.all(`SELECT a.id, a.group_id, a.user_id, a.due_at, a.created_at, a.pass_pct, q.title, g.name AS group_name, u.name AS user_name FROM assignments a
      JOIN quizzes q ON q.id = a.quiz_id LEFT JOIN groups g ON g.id = a.group_id LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ANY(?::int[])`, [aids]) : []).map((a) => [a.id, a]));
    // a group's students are listed even when they have no tasks yet; otherwise, everyone with a task
    const people = gid
      ? await db.all(`SELECT u.id, u.name, gm.joined_at FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? AND gm.left_at IS NULL AND u.role = 'student' ORDER BY u.name`, [gid])
      : (uids.length ? await db.all("SELECT id, name FROM users WHERE id = ANY(?::int[]) AND role = 'student' ORDER BY name", [uids]) : []);

    const now = Date.now();
    const blank = () => ({ total: 0, passed: 0, on_time: 0, late: 0, in_progress: 0, tried: 0, not_started: 0, overdue: 0, failed: 0, best_sum: 0, best_n: 0, tries: 0, secs: 0, last_at: null });
    const S = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, joined_at: p.joined_at || null, ...blank() }]));
    const A = new Map();
    const all = blank();
    for (const r of rows) {
      const extra = grants.get(`${r.aid}:${r.uid}`) || 0;
      const allowed = r.attempts_allowed ? r.attempts_allowed + extra : 0;
      const res0 = { tries: Number(r.tries), best: r.best == null ? null : Number(r.best), open_id: r.open_id };
      const status = statusOf(Number(r.tries) || r.open_id ? res0 : null, r.pass_pct, allowed, isClosed(r));
      const due = r.due_at ? new Date(r.due_at).getTime() : null;
      const passedAt = r.passed_at ? new Date(r.passed_at).getTime() : null;
      const add = (o) => {
        o.total++;
        if (status === 'passed') { o.passed++; if (due && passedAt && passedAt > due) o.late++; else o.on_time++; }
        else if (status === 'in_progress') o.in_progress++;
        else if (status === 'new') o.not_started++;
        else if (status === 'failed') o.failed++;
        else o.tried++; // retake / closed after trying
        if (status !== 'passed' && due && due < now) o.overdue++;
        if (res0.best != null) { o.best_sum += res0.best; o.best_n++; }
        o.tries += res0.tries; o.secs += Number(r.secs) || 0;
        if (r.last_at && (!o.last_at || new Date(r.last_at) > new Date(o.last_at))) o.last_at = r.last_at;
      };
      add(all);
      if (!S.has(r.uid)) continue; // a student who has since left the group: counted in the task, not listed
      add(S.get(r.uid));
      if (!A.has(r.aid)) { const m = meta.get(r.aid); A.set(r.aid, { id: r.aid, title: m?.title, group_id: m?.group_id, group_name: m?.group_name, user_id: m?.user_id, user_name: m?.user_name, due_at: m?.due_at, created_at: m?.created_at, pass_pct: m?.pass_pct, ...blank(), missing: [] }); }
      const a = A.get(r.aid); add(a);
      if (status !== 'passed') a.missing.push({ id: r.uid, name: S.get(r.uid).name, status, best: res0.best });
    }
    const fin = (o) => {
      const { best_sum, best_n, secs, ...rest } = o;
      return { ...rest, avg_best: best_n ? Math.round(best_sum / best_n) : null, minutes: Math.round(secs / 60),
        done_pct: o.total ? Math.round((100 * o.passed) / o.total) : null };
    };
    const students = [...S.values()].map(fin).sort((x, y) => (x.done_pct ?? 101) - (y.done_pct ?? 101) || y.overdue - x.overdue || x.name.localeCompare(y.name));
    const tasks = [...A.values()].map(fin).sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
    // the week-by-week share of tasks done on time (by the week the task was due, or given when it has no deadline)
    const weeks = new Map();
    for (const r of rows) {
      if (!S.has(r.uid)) continue;
      const at = new Date(r.due_at || r.created_at);
      if (at.getTime() > now) continue;
      const wk = new Date(at); wk.setUTCHours(0, 0, 0, 0); wk.setUTCDate(wk.getUTCDate() - ((wk.getUTCDay() + 6) % 7));
      const k = wk.toISOString().slice(0, 10);
      if (!weeks.has(k)) weeks.set(k, { week: k, total: 0, done: 0 });
      const w = weeks.get(k); w.total++;
      const ok = r.passed_at && (!r.due_at || new Date(r.passed_at) <= new Date(r.due_at));
      if (ok) w.done++;
    }
    res.json({
      groups: groups.map((g) => ({ id: g.id, name: g.name, subject: g.subject, archived: !!g.archived })),
      group: gid, days, summary: { ...fin(all), assignments: aids.length, students: people.length },
      students, tasks, weeks: [...weeks.values()].sort((x, y) => x.week.localeCompare(y.week)).slice(-12),
    });
  }));

  // one quiz (quiz_id) or several at once (quiz_ids, e.g. a whole folder): one task per quiz, one message per student
  app.post('/api/assignments', requireMaster, h(async (req, res) => {
    const b = req.body || {};
    const qids = [...new Set((Array.isArray(b.quiz_ids) ? b.quiz_ids : [b.quiz_id]).map(Number).filter(Boolean))].slice(0, 100);
    const quizzes = qids.length ? await db.all('SELECT id, title FROM quizzes WHERE id = ANY(?::int[]) ORDER BY array_position(?::int[], id)', [qids, qids]) : [];
    if (!quizzes.length) return bad(res, 'Choose a quiz');
    const userIds = (Array.isArray(b.user_ids) ? b.user_ids : []).map(Number).filter(Boolean).slice(0, 500);
    const groupId = b.group_id ? Number(b.group_id) : null;
    if (!userIds.length && !groupId) return bad(res, 'Choose students or a group');
    const due = b.due_at && !Number.isNaN(Date.parse(b.due_at)) ? new Date(b.due_at).toISOString() : null;
    const allowed = Math.max(0, Math.min(20, Math.round(+b.attempts_allowed || 0)));
    const pass = Math.max(10, Math.min(100, Math.round(+b.pass_pct || 70)));
    const note = String(b.note || '').trim().slice(0, 300);
    const closeAt = !!(due && b.close_at_due);
    const made = [];
    await db.tx(async (t) => {
      for (const quiz of quizzes) {
        if (groupId) made.push((await t.one('INSERT INTO assignments (quiz_id, group_id, due_at, attempts_allowed, pass_pct, note, close_at_due, created_by) VALUES (?,?,?,?,?,?,?,?) RETURNING id', [quiz.id, groupId, due, allowed, pass, note, closeAt, req.user.id])).id);
        for (const u of userIds) made.push((await t.one('INSERT INTO assignments (quiz_id, user_id, due_at, attempts_allowed, pass_pct, note, close_at_due, created_by) VALUES (?,?,?,?,?,?,?,?) RETURNING id', [quiz.id, u, due, allowed, pass, note, closeAt, req.user.id])).id);
      }
    });
    // Telegram for students who linked the bot
    const targets = groupId ? (await db.all('SELECT user_id AS id FROM group_members WHERE group_id = ? AND left_at IS NULL', [groupId])).map((r) => r.id) : userIds;
    const when = due ? ` · due ${new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Tashkent' })}` : '';
    const esc = (x) => String(x).replace(/[<>&]/g, '');
    const what = quizzes.length === 1 ? `📝 New assignment: <b>${esc(quizzes[0].title)}</b>`
      : `📝 ${quizzes.length} new assignments${b.label ? ` · <b>${esc(b.label).slice(0, 80)}</b>` : ''}:\n${quizzes.slice(0, 8).map((q) => `• ${esc(q.title)}`).join('\n')}${quizzes.length > 8 ? '\n…' : ''}`;
    for (const id of targets.slice(0, 200)) notifyUser(id, `${what}${when}\nOpen ustozsat.uz → Assignments`);
    res.json({ ids: made });
  }));

  // change the deadline, tries, pass mark or note of a task already given
  app.put('/api/assignments/:id', requireMaster, h(async (req, res) => {
    const a = await db.one('SELECT * FROM assignments WHERE id = ?', [Number(req.params.id)]);
    if (!a) return bad(res, 'Assignment not found', 404);
    const b = req.body || {};
    const due = 'due_at' in b ? (b.due_at && !Number.isNaN(Date.parse(b.due_at)) ? new Date(b.due_at).toISOString() : null) : a.due_at;
    const allowed = 'attempts_allowed' in b ? Math.max(0, Math.min(20, Math.round(+b.attempts_allowed || 0))) : a.attempts_allowed;
    const pass = 'pass_pct' in b ? Math.max(10, Math.min(100, Math.round(+b.pass_pct || 70))) : a.pass_pct;
    const note = 'note' in b ? String(b.note || '').trim().slice(0, 300) : a.note;
    const closeAt = 'close_at_due' in b ? !!(due && b.close_at_due) : !!(due && a.close_at_due);
    await db.run('UPDATE assignments SET due_at = ?, attempts_allowed = ?, pass_pct = ?, note = ?, close_at_due = ? WHERE id = ?', [due, allowed, pass, note, closeAt, a.id]);
    res.json({ ok: true });
  }));

  // one more try for one student (e.g. after a talk), without changing the task for everyone
  app.post('/api/assignments/:id/grant', requireMaster, h(async (req, res) => {
    const a = await db.one('SELECT id FROM assignments WHERE id = ?', [Number(req.params.id)]);
    const uid = Number(req.body?.user_id);
    if (!a || !uid) return bad(res, 'Assignment not found', 404);
    const n = Math.max(-20, Math.min(20, Math.round(+req.body?.extra || 1)));
    await db.run(`INSERT INTO assignment_grants (assignment_id, user_id, extra) VALUES (?, ?, GREATEST(0, ?))
      ON CONFLICT (assignment_id, user_id) DO UPDATE SET extra = GREATEST(0, assignment_grants.extra + ?)`, [a.id, uid, n, n]);
    res.json({ ok: true });
  }));

  app.delete('/api/assignments/:id', requireMaster, h(async (req, res) => {
    await db.run('DELETE FROM assignments WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  }));
}
