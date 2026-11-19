/**
 * Groups: classes the teacher runs (English, Math or both).
 *
 * - A student can be in several groups at once (group_members). A row is closed (left_at) instead of deleted, so
 *   the history stays: a student who moves keeps the tasks the old group was given while they were in it, and gets
 *   the open tasks of the new group.
 * - users.group_id is kept as the student's main (latest) group for older screens.
 * - Every add / move / copy / remove is written to group_moves (who, when, from where to where).
 * - Attendance: one mark per student per lesson day (present, late, absent, excused).
 * - Archive hides a finished group without deleting its history.
 * Students see their groups (schedule, level, dates, Telegram link, note) and a weekly ranking among groupmates.
 */
import { db } from './db.js';

const SUBJECTS = ['english', 'math', 'both'];
const MARKS = ['present', 'late', 'absent', 'excused'];
const COLORS = ['#3B82F6', '#22B07D', '#F07A55', '#8E5CF7', '#F5B82E', '#12A39A', '#E2553D', '#2A55E5'];

export async function migrateGroups() {
  await db.exec(`
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'english';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS days TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS time_from TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS time_to TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS starts_on DATE;
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS ends_on DATE;
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS telegram_url TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), left_at TIMESTAMPTZ);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_current ON group_members(group_id, user_id) WHERE left_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_gm_user ON group_members(user_id);
  CREATE TABLE IF NOT EXISTS group_moves (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL, from_group INTEGER REFERENCES groups(id) ON DELETE SET NULL, to_group INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    from_name TEXT NOT NULL DEFAULT '', to_name TEXT NOT NULL DEFAULT '', by_id INTEGER, by_name TEXT NOT NULL DEFAULT '', at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_gmoves_user ON group_moves(user_id);
  CREATE TABLE IF NOT EXISTS group_attendance (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id, day));
  ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
  ALTER TABLE group_moves ENABLE ROW LEVEL SECURITY;
  ALTER TABLE group_attendance ENABLE ROW LEVEL SECURITY;`);
  await backfillMembers();
}

/** Students placed in a group the old way (users.group_id) become members. Cheap and safe to repeat. */
export async function backfillMembers() {
  await db.run(`INSERT INTO group_members (group_id, user_id, joined_at)
    SELECT u.group_id, u.id, u.created_at FROM users u
    WHERE u.group_id IS NOT NULL AND u.role = 'student' AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id = u.id)`);
}

/** The student's current group ids. */
export const groupIdsOf = async (userId) => (await db.all('SELECT group_id FROM group_members WHERE user_id = ? AND left_at IS NULL', [userId])).map((r) => r.group_id);

/** users.group_id = the group joined last (or none), for screens that show one group. */
async function syncMain(t, userId) {
  await t.run(`UPDATE users SET group_id = (SELECT group_id FROM group_members WHERE user_id = ? AND left_at IS NULL ORDER BY joined_at DESC, id DESC LIMIT 1) WHERE id = ?`, [userId, userId]);
}

/** Join / leave helpers used by the routes and by the Students page. Return true when something changed. */
async function join(t, gid, uid) {
  const r = await t.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT (group_id, user_id) WHERE left_at IS NULL DO NOTHING RETURNING id', [gid, uid]);
  return !!r?.id;
}
async function leave(t, gid, uid) {
  const r = await t.run('UPDATE group_members SET left_at = now() WHERE group_id = ? AND user_id = ? AND left_at IS NULL RETURNING id', [gid, uid]);
  return !!r?.id;
}
async function logMove(t, by, uid, action, from, to) {
  await t.run('INSERT INTO group_moves (user_id, action, from_group, to_group, from_name, to_name, by_id, by_name) VALUES (?,?,?,?,?,?,?,?)',
    [uid, action, from?.id || null, to?.id || null, from?.name || '', to?.name || '', by?.id || null, by?.name || '']);
}

/** Set a student's groups to exactly `ids` (Students page / student card). */
export async function setStudentGroups(by, uid, ids) {
  const want = new Set((ids || []).map(Number).filter(Boolean));
  const groups = new Map((await db.all('SELECT id, name FROM groups')).map((g) => [g.id, g]));
  await db.tx(async (t) => {
    const have = new Set((await t.all('SELECT group_id FROM group_members WHERE user_id = ? AND left_at IS NULL', [uid])).map((r) => r.group_id));
    for (const g of have) if (!want.has(g) && await leave(t, g, uid)) await logMove(t, by, uid, 'remove', groups.get(g), null);
    for (const g of want) if (groups.has(g) && !have.has(g) && await join(t, g, uid)) await logMove(t, by, uid, 'add', null, groups.get(g));
    await syncMain(t, uid);
  });
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const cleanDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const cleanTime = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '');
const dateStr = (d) => (d ? String(d).slice(0, 10) : null);
/** Tashkent "today" as YYYY-MM-DD. */
const today = () => new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 10);

function fields(b, old = {}) {
  const has = (k) => k in b;
  const name = has('name') ? String(b.name || '').trim().slice(0, 80) : old.name;
  if (!name) throw Object.assign(new Error('Write the group name'), { status: 400 });
  const days = has('days') ? [...new Set((Array.isArray(b.days) ? b.days : String(b.days || '').split(',')).map(Number).filter((d) => d >= 1 && d <= 7))].sort().join(',') : old.days || '';
  const starts = has('starts_on') ? cleanDate(b.starts_on) : dateStr(old.starts_on);
  const ends = has('ends_on') ? cleanDate(b.ends_on) : dateStr(old.ends_on);
  if (starts && ends && ends < starts) throw Object.assign(new Error('The end date is before the start date'), { status: 400 });
  let tg = has('telegram_url') ? String(b.telegram_url || '').trim().slice(0, 200) : old.telegram_url || '';
  if (tg && /^@?[\w]{4,}$/.test(tg)) tg = `https://t.me/${tg.replace(/^@/, '')}`;
  if (tg && !/^https:\/\/(t\.me|telegram\.me)\//i.test(tg)) throw Object.assign(new Error('The Telegram link should start with https://t.me/'), { status: 400 });
  return {
    name, days, starts_on: starts, ends_on: ends, telegram_url: tg,
    subject: has('subject') ? (SUBJECTS.includes(b.subject) ? b.subject : 'english') : old.subject || 'english',
    level: has('level') ? String(b.level || '').trim().slice(0, 40) : old.level || '',
    time_from: has('time_from') ? cleanTime(b.time_from) : old.time_from || '',
    time_to: has('time_to') ? cleanTime(b.time_to) : old.time_to || '',
    capacity: has('capacity') ? Math.max(0, Math.min(500, Math.round(+b.capacity || 0))) : old.capacity || 0,
    note: has('note') ? String(b.note || '').trim().slice(0, 600) : old.note || '',
    color: has('color') ? (/^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '') : old.color || '',
    archived: has('archived') ? !!b.archived : !!old.archived,
  };
}
const pub = (g) => ({ ...g, starts_on: dateStr(g.starts_on), ends_on: dateStr(g.ends_on), days: g.days ? g.days.split(',').map(Number) : [], color: g.color || COLORS[g.id % COLORS.length] });

export function registerGroups(app, { h, bad, requireMaster, requireStudent, userAnalytics, boardRows, weekStart }) {
  const getGroup = async (id) => db.one('SELECT g.*, g.starts_on::text AS starts_on, g.ends_on::text AS ends_on FROM groups g WHERE g.id = ?', [Number(id)]);

  // ---------- list ----------
  app.get('/api/groups', requireMaster, h(async (req, res) => {
    const rows = await db.all(`SELECT g.*, g.starts_on::text AS starts_on, g.ends_on::text AS ends_on,
        (SELECT COUNT(*) FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = g.id AND gm.left_at IS NULL AND u.role = 'student') AS students,
        (SELECT COUNT(*) FROM quiz_groups qg WHERE qg.group_id = g.id) AS quizzes,
        (SELECT COUNT(DISTINCT gm.user_id) FROM group_members gm JOIN user_activity x ON x.user_id = gm.user_id
          WHERE gm.group_id = g.id AND gm.left_at IS NULL AND x.day > CURRENT_DATE - 7) AS active_week,
        (SELECT COUNT(*) FROM group_attendance a WHERE a.group_id = g.id AND a.day > CURRENT_DATE - 30 AND a.status IN ('present', 'late')) AS att_ok,
        (SELECT COUNT(*) FROM group_attendance a WHERE a.group_id = g.id AND a.day > CURRENT_DATE - 30) AS att_all,
        (SELECT MAX(day)::text FROM group_attendance a WHERE a.group_id = g.id) AS last_lesson
      FROM groups g ORDER BY g.archived, g.name`);
    res.json(rows.map((g) => ({ ...pub(g), students: Number(g.students), quizzes: Number(g.quizzes), active_week: Number(g.active_week),
      att_ok: undefined, att_all: undefined, attendance: pct(Number(g.att_ok), Number(g.att_all)), last_lesson: dateStr(g.last_lesson) })));
  }));

  app.post('/api/groups', requireMaster, h(async (req, res) => {
    const f = fields(req.body || {});
    if (await db.one('SELECT 1 AS x FROM groups WHERE name = ?', [f.name])) return bad(res, 'A group with this name already exists');
    const r = await db.one(`INSERT INTO groups (name, subject, level, days, time_from, time_to, starts_on, ends_on, capacity, telegram_url, note, color, archived)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, [f.name, f.subject, f.level, f.days, f.time_from, f.time_to, f.starts_on, f.ends_on, f.capacity, f.telegram_url, f.note, f.color, f.archived]);
    res.json({ id: r.id, name: f.name });
  }));

  app.put('/api/groups/:id', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const f = fields(req.body || {}, g);
    if (await db.one('SELECT 1 AS x FROM groups WHERE name = ? AND id <> ?', [f.name, g.id])) return bad(res, 'A group with this name already exists');
    await db.run(`UPDATE groups SET name = ?, subject = ?, level = ?, days = ?, time_from = ?, time_to = ?, starts_on = ?, ends_on = ?, capacity = ?,
      telegram_url = ?, note = ?, color = ?, archived = ? WHERE id = ?`,
    [f.name, f.subject, f.level, f.days, f.time_from, f.time_to, f.starts_on, f.ends_on, f.capacity, f.telegram_url, f.note, f.color, f.archived, g.id]);
    res.json({ ok: true });
  }));

  // deleting keeps the students (they just leave the group); archive is the usual way to put a group away
  app.delete('/api/groups/:id', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const uids = (await db.all('SELECT user_id FROM group_members WHERE group_id = ? AND left_at IS NULL', [g.id])).map((r) => r.user_id);
    await db.tx(async (t) => {
      for (const u of uids) await logMove(t, req.user, u, 'remove', g, null);
      await t.run('DELETE FROM groups WHERE id = ?', [g.id]);
      for (const u of uids) await syncMain(t, u);
    });
    res.json({ ok: true });
  }));

  // ---------- one group: members, stats, recent changes ----------
  app.get('/api/groups/:id', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const members = await db.all(`SELECT u.id, u.name, u.login, u.email, u.phone, u.avatar_url, u.sub_until, gm.joined_at,
        (SELECT MAX(day) FROM user_activity x WHERE x.user_id = u.id) AS last_day,
        (SELECT COALESCE(SUM(seconds), 0) FROM user_activity x WHERE x.user_id = u.id AND x.day > CURRENT_DATE - 7) AS week_seconds,
        (SELECT COUNT(*) FROM group_attendance a WHERE a.group_id = gm.group_id AND a.user_id = u.id AND a.status IN ('present', 'late')) AS att_ok,
        (SELECT COUNT(*) FROM group_attendance a WHERE a.group_id = gm.group_id AND a.user_id = u.id) AS att_all,
        (SELECT string_agg(g2.name, ', ' ORDER BY g2.name) FROM group_members m2 JOIN groups g2 ON g2.id = m2.group_id
          WHERE m2.user_id = u.id AND m2.left_at IS NULL AND m2.group_id <> gm.group_id) AS other_groups
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ? AND gm.left_at IS NULL AND u.role = 'student' ORDER BY u.name`, [g.id]);
    const out = [];
    for (const m of members) {
      const a = await userAnalytics(m.id).catch(() => null);
      out.push({ ...m, att_ok: undefined, att_all: undefined, attendance: pct(Number(m.att_ok), Number(m.att_all)), lessons: Number(m.att_all),
        week_min: Math.round(Number(m.week_seconds || 0) / 60), week_seconds: undefined,
        english: a?.estimates?.english ?? null, math: a?.estimates?.math ?? null, accuracy: a?.totals?.accuracy ?? null });
    }
    const avg = (k) => { const v = out.map((x) => x[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
    const ids = out.map((m) => m.id);
    // weakest skills: Question Bank first answers + quiz answers of the members in the last 60 days
    const weak = ids.length ? await db.all(`SELECT skill, SUM(ok) AS ok, SUM(n) AS n FROM (
        SELECT q.skill AS skill, CASE WHEN a.first_correct THEN 1 ELSE 0 END AS ok, 1 AS n
          FROM qbank_answers a JOIN qbank_questions q ON q.id = a.question_id WHERE a.user_id = ANY(?::int[]) AND a.answered_at > now() - interval '60 days'
        UNION ALL SELECT q.topic, an.is_correct, 1 FROM answers an JOIN attempts t ON t.id = an.attempt_id JOIN questions q ON q.id = an.question_id
          WHERE t.user_id = ANY(?::int[]) AND t.finished_at > now() - interval '60 days' AND q.topic <> 'General'
      ) x GROUP BY skill HAVING SUM(n) >= 5 ORDER BY SUM(ok)::float / SUM(n) LIMIT 6`, [ids, ids]) : [];
    const asg = await db.all(`SELECT a.id, q.title, a.due_at, a.pass_pct, a.created_at FROM assignments a JOIN quizzes q ON q.id = a.quiz_id
      WHERE a.group_id = ? ORDER BY a.created_at DESC LIMIT 8`, [g.id]);
    const tasks = [];
    for (const a of asg) {
      const done = ids.length ? await db.one(`SELECT COUNT(DISTINCT t.user_id) AS n FROM attempts t JOIN assignments x ON x.quiz_id = t.quiz_id
        WHERE x.id = ? AND t.user_id = ANY(?::int[]) AND t.finished_at IS NOT NULL AND t.started_at >= x.created_at
          AND t.total > 0 AND 100.0 * t.score / t.total >= x.pass_pct`, [a.id, ids]) : { n: 0 };
      tasks.push({ ...a, passed: Number(done.n), of: ids.length });
    }
    const history = await db.all(`SELECT m.id, m.action, m.from_name, m.to_name, m.from_group, m.to_group, m.by_name, m.at, u.name AS student
      FROM group_moves m JOIN users u ON u.id = m.user_id WHERE m.from_group = ? OR m.to_group = ? ORDER BY m.at DESC LIMIT 60`, [g.id, g.id]);
    res.json({
      group: pub(g), members: out, history, tasks,
      stats: { english: avg('english'), math: avg('math'), accuracy: avg('accuracy'), attendance: avg('attendance'), week_min: avg('week_min'),
        active_week: out.filter((m) => m.week_min > 0).length, weak: weak.map((w) => ({ skill: w.skill, pct: pct(Number(w.ok), Number(w.n)), n: Number(w.n) })) },
    });
  }));

  // ---------- members: add existing students, move / copy to another group, remove ----------
  const pickIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Boolean))].slice(0, 500);
  const students = async (ids) => (ids.length ? db.all("SELECT id, name FROM users WHERE role = 'student' AND id = ANY(?::int[])", [ids]) : []);
  const roomLeft = async (g) => (g.capacity ? g.capacity - Number((await db.one('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND left_at IS NULL', [g.id])).n) : Infinity);

  app.post('/api/groups/:id/members', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const list = await students(pickIds(req.body?.user_ids));
    if (!list.length) return bad(res, 'Choose students to add');
    const room = await roomLeft(g);
    if (list.length > room && !req.body?.force) return bad(res, `This group has ${Math.max(0, room)} free ${room === 1 ? 'place' : 'places'} of ${g.capacity}.`, 409, { code: 'over_capacity', room: Math.max(0, room) });
    let added = 0;
    await db.tx(async (t) => {
      for (const s of list) if (await join(t, g.id, s.id)) { added++; await logMove(t, req.user, s.id, 'add', null, g); await syncMain(t, s.id); }
    });
    res.json({ added });
  }));

  app.post('/api/groups/:id/move', requireMaster, h(async (req, res) => {
    const from = await getGroup(req.params.id);
    const to = await getGroup(req.body?.to);
    if (!from || !to) return bad(res, 'Group not found', 404);
    if (from.id === to.id) return bad(res, 'Choose another group');
    const copy = req.body?.mode === 'copy';
    const list = await students(pickIds(req.body?.user_ids));
    if (!list.length) return bad(res, 'Choose students first');
    const room = await roomLeft(to);
    if (list.length > room && !req.body?.force) return bad(res, `${to.name} has ${Math.max(0, room)} free ${room === 1 ? 'place' : 'places'} of ${to.capacity}.`, 409, { code: 'over_capacity', room: Math.max(0, room) });
    let moved = 0;
    await db.tx(async (t) => {
      for (const s of list) {
        const joined = await join(t, to.id, s.id);
        const left = copy ? false : await leave(t, from.id, s.id);
        if (joined || left) { moved++; await logMove(t, req.user, s.id, copy ? 'copy' : 'move', copy ? null : from, to); }
        await syncMain(t, s.id);
      }
    });
    res.json({ moved });
  }));

  app.post('/api/groups/:id/remove', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const list = await students(pickIds(req.body?.user_ids));
    let removed = 0;
    await db.tx(async (t) => {
      for (const s of list) if (await leave(t, g.id, s.id)) { removed++; await logMove(t, req.user, s.id, 'remove', g, null); await syncMain(t, s.id); }
    });
    res.json({ removed });
  }));

  // all students for the "Add students" picker, with the groups each one is in
  app.get('/api/groups-students', requireMaster, h(async (req, res) => {
    const rows = await db.all(`SELECT u.id, u.name, u.login, u.email, u.phone, u.avatar_url, u.created_at,
        ARRAY(SELECT gm.group_id FROM group_members gm WHERE gm.user_id = u.id AND gm.left_at IS NULL) AS group_ids,
        (SELECT MAX(day) FROM user_activity x WHERE x.user_id = u.id) AS last_day
      FROM users u WHERE u.role = 'student' AND NOT COALESCE(u.disabled, false) ORDER BY u.name`);
    res.json(rows.map((r) => ({ ...r, group_ids: (r.group_ids || []).map(Number) })));
  }));

  // ---------- attendance ----------
  app.get('/api/groups/:id/attendance', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const day = cleanDate(req.query.day) || today();
    const members = await db.all(`SELECT u.id, u.name, u.avatar_url FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ? AND gm.left_at IS NULL AND u.role = 'student' ORDER BY u.name`, [g.id]);
    const marks = await db.all('SELECT user_id, status, note FROM group_attendance WHERE group_id = ? AND day = ?', [g.id, day]);
    // last 12 lesson days with marks, for the grid
    const days = (await db.all('SELECT DISTINCT day::text AS day FROM group_attendance WHERE group_id = ? ORDER BY day DESC LIMIT 12', [g.id])).map((r) => dateStr(r.day)).reverse();
    const grid = days.length ? await db.all('SELECT user_id, day::text AS day, status FROM group_attendance WHERE group_id = ? AND day = ANY(?::date[])', [g.id, days]) : [];
    res.json({ day, members, marks: Object.fromEntries(marks.map((m) => [m.user_id, { status: m.status, note: m.note }])),
      days, grid: grid.map((x) => ({ user_id: x.user_id, day: dateStr(x.day), status: x.status })) });
  }));

  app.put('/api/groups/:id/attendance', requireMaster, h(async (req, res) => {
    const g = await getGroup(req.params.id);
    if (!g) return bad(res, 'Group not found', 404);
    const day = cleanDate(req.body?.day);
    if (!day) return bad(res, 'Choose the lesson date');
    if (day > today()) return bad(res, 'This date is in the future');
    const marks = req.body?.marks && typeof req.body.marks === 'object' ? req.body.marks : {};
    const members = new Set((await db.all('SELECT user_id FROM group_members WHERE group_id = ? AND left_at IS NULL', [g.id])).map((r) => r.user_id));
    let n = 0;
    await db.tx(async (t) => {
      for (const [uid, v] of Object.entries(marks)) {
        const id = Number(uid); const st = typeof v === 'string' ? v : v?.status;
        if (!members.has(id)) continue;
        if (!st) { await t.run('DELETE FROM group_attendance WHERE group_id = ? AND user_id = ? AND day = ?', [g.id, id, day]); continue; }
        if (!MARKS.includes(st)) continue;
        await t.run(`INSERT INTO group_attendance (group_id, user_id, day, status, note) VALUES (?,?,?,?,?)
          ON CONFLICT (group_id, user_id, day) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, marked_at = now()`,
        [g.id, id, day, st, String(v?.note || '').slice(0, 200)]);
        n++;
      }
    });
    res.json({ saved: n });
  }));

  // ---------- student: my groups ----------
  app.get('/api/my-groups', requireStudent, h(async (req, res) => {
    const gs = await db.all(`SELECT g.*, g.starts_on::text AS starts_on, g.ends_on::text AS ends_on FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ? AND gm.left_at IS NULL AND NOT g.archived ORDER BY gm.joined_at`, [req.user.id]);
    const out = [];
    for (const g of gs) {
      const ids = (await db.all(`SELECT gm.user_id FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ? AND gm.left_at IS NULL AND u.role = 'student'`, [g.id])).map((r) => r.user_id);
      const board = await boardRows(weekStart, "now() + interval '1 minute'", req.user.id, ids);
      const me = board.find((x) => x.me) || null;
      const att = await db.one(`SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS missed FROM group_attendance WHERE group_id = ? AND user_id = ?`, [g.id, req.user.id]);
      const { capacity, telegram_url: tg, archived, ...rest } = pub(g);
      out.push({ ...rest, telegram_url: tg, classmates: ids.length, board: board.slice(0, 10), me, ranked: board.filter((x) => x.points > 0).length,
        attendance: { lessons: Number(att.n || 0), present: Number(att.ok || 0), missed: Number(att.missed || 0), pct: pct(Number(att.ok || 0), Number(att.n || 0)) } });
    }
    res.json({ groups: out });
  }));
}
