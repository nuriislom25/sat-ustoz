/**
 * Subjects and the Math roadmap.
 *
 * Subject switch: every student works in English or Math mode (users.subject); the whole student side follows it.
 * Math is paid separately (users.math_sub_until / math_sub_plan, see tiers.js).
 *
 * Math roadmap (self-paced video lessons): units → lessons. A lesson = a video (Bunny Stream or a link), short notes,
 * then a practice of Math questions; scoring at least the pass mark opens the next lesson.
 * Without a Math plan the first lessons (settings.math_free_lessons) are open as a free trial; the rest needs a Math
 * plan with the roadmap (Pro and higher). The teacher builds units and lessons; the topic order comes later.
 */
import { db, getSettings } from './db.js';
import { tierOf, asSubject } from './tiers.js';
import { subActive } from './auth.js';
import { playUrl, isBunny } from './video.js';
import { pub as pubQ, sprCorrect } from './math.js';

export async function migrateSubjects() {
  await db.exec(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'english';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS math_sub_until TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS math_sub_plan TEXT NOT NULL DEFAULT '';
  CREATE TABLE IF NOT EXISTS math_units (id SERIAL PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS math_lessons (
    id SERIAL PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES math_units(id) ON DELETE CASCADE, title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0, video TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', question_ids TEXT NOT NULL DEFAULT '[]',
    pass_pct INTEGER NOT NULL DEFAULT 70, published BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS math_lesson_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id INTEGER NOT NULL REFERENCES math_lessons(id) ON DELETE CASCADE,
    watched BOOLEAN NOT NULL DEFAULT false, best_pct INTEGER, tries INTEGER NOT NULL DEFAULT 0, passed_at TIMESTAMPTZ, last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lesson_id));
  CREATE TABLE IF NOT EXISTS math_daily (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day DATE NOT NULL, answered INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day));
  ALTER TABLE math_daily ENABLE ROW LEVEL SECURITY;
  ALTER TABLE math_units ENABLE ROW LEVEL SECURITY;
  ALTER TABLE math_lessons ENABLE ROW LEVEL SECURITY;
  ALTER TABLE math_lesson_progress ENABLE ROW LEVEL SECURITY;`);
}

const TODAY = "(now() AT TIME ZONE 'Asia/Tashkent')::date";
/** One Math answer for the daily goal, streak, results and the Math leaderboard (first try only). */
export async function logMath(userId, right, n = 1) {
  await db.run(`INSERT INTO math_daily (user_id, day, answered, correct) VALUES (?, ${TODAY}, ?, ?)
    ON CONFLICT (user_id, day) DO UPDATE SET answered = math_daily.answered + EXCLUDED.answered, correct = math_daily.correct + EXCLUDED.correct`,
  [userId, n, right]).catch(() => {});
}
const GOAL = 10;

const nid = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : 0);
const ids = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(String).slice(0, 40) : []; } catch { return []; } };

/** The roadmap in order with this student's status: passed / open / locked (previous not passed) / paid (needs a Math plan). */
async function roadmapOf(user) {
  const s = await getSettings();
  const units = await db.all('SELECT * FROM math_units ORDER BY position, id');
  const lessons = await db.all('SELECT * FROM math_lessons WHERE published ORDER BY position, id');
  const prog = user ? new Map((await db.all('SELECT * FROM math_lesson_progress WHERE user_id = ?', [user.id])).map((p) => [p.lesson_id, p])) : new Map();
  const open = user?.role === 'master' || s.require_subscription !== 'true';
  const paid = open || (subActive(asSubject(user, 'math')) && tierOf(user, s, 'math').roadmap);
  const free = Math.max(0, Number(s.math_free_lessons ?? 2));
  let n = 0; let prevPassed = true;
  const out = units.map((u) => ({ id: u.id, title: u.title, lessons: [] }));
  for (const u of out) {
    for (const l of lessons.filter((x) => x.unit_id === u.id)) {
      n += 1;
      const p = prog.get(l.id);
      const status = p?.passed_at ? 'passed' : !paid && n > free ? 'paid' : !prevPassed && user?.role !== 'master' ? 'locked' : 'open';
      u.lessons.push({ id: l.id, n, title: l.title, has_video: !!l.video, questions: ids(l.question_ids).length, pass_pct: l.pass_pct,
        status, free: !paid && n <= free, best: p?.best_pct ?? null, watched: !!p?.watched });
      prevPassed = !!p?.passed_at || user?.role === 'master';
    }
  }
  return { units: out.filter((u) => u.lessons.length || user?.role === 'master'), total: n, paid, free_lessons: paid ? null : free };
}

export function registerSubjects(app, { h, bad, requireStudent, requireMaster }) {
  // the English / Math switch
  app.put('/api/me/subject', h(async (req, res) => {
    const subject = req.body?.subject === 'math' ? 'math' : 'english';
    await db.run('UPDATE users SET subject = ? WHERE id = ?', [subject, req.user.id]);
    res.json({ subject });
  }));

  app.get('/api/math/roadmap', requireStudent, h(async (req, res) => {
    const r = await roadmapOf(req.user);
    const all = r.units.flatMap((u) => u.lessons);
    res.json({ ...r, passed: all.filter((l) => l.status === 'passed').length, next: all.find((l) => l.status === 'open') || null });
  }));

  // one lesson: video (signed), notes, questions without answers
  app.get('/api/math/roadmap/lessons/:id', requireStudent, h(async (req, res) => {
    const l = await db.one('SELECT * FROM math_lessons WHERE id = ?', [nid(req.params.id)]);
    if (!l || (!l.published && req.user.role !== 'master')) return bad(res, 'Lesson not found', 404);
    const r = await roadmapOf(req.user);
    const all = r.units.flatMap((u) => u.lessons.map((x) => ({ ...x, unit: u.title })));
    const me = all.find((x) => x.id === l.id) || { status: 'open', n: 0 };
    if (me.status === 'paid') return bad(res, 'This lesson comes with a Math plan (Pro or higher)', 402, { code: 'math_plan' });
    if (me.status === 'locked') return bad(res, 'Pass the previous lesson first', 403, { code: 'locked' });
    const qs = ids(l.question_ids);
    const rows = qs.length ? await db.all('SELECT * FROM math_questions WHERE id = ANY(?::text[]) AND active', [qs]) : [];
    const by = new Map(rows.map((q) => [q.id, q]));
    const s = await getSettings();
    const i = all.findIndex((x) => x.id === l.id);
    res.json({
      id: l.id, n: me.n, unit: me.unit, title: l.title, notes: l.notes, pass_pct: l.pass_pct, status: me.status, best: me.best, watched: me.watched,
      video: l.video ? (isBunny(l.video) ? playUrl(l.video, s) : l.video) : '',
      questions: qs.map((id) => by.get(id)).filter(Boolean).map(pubQ),
      prev: all[i - 1] ? { id: all[i - 1].id, title: all[i - 1].title } : null,
      next: all[i + 1] ? { id: all[i + 1].id, title: all[i + 1].title, status: all[i + 1].status } : null,
    });
  }));

  app.post('/api/math/roadmap/lessons/:id/watched', requireStudent, h(async (req, res) => {
    await db.run(`INSERT INTO math_lesson_progress (user_id, lesson_id, watched) VALUES (?, ?, true)
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET watched = true, last_at = now()`, [req.user.id, nid(req.params.id)]);
    res.json({ ok: true });
  }));

  // the lesson practice: all answers at once, graded here; passing opens the next lesson
  app.post('/api/math/roadmap/lessons/:id/submit', requireStudent, h(async (req, res) => {
    const l = await db.one('SELECT * FROM math_lessons WHERE id = ? AND published', [nid(req.params.id)]);
    if (!l) return bad(res, 'Lesson not found', 404);
    const r = await roadmapOf(req.user);
    const me = r.units.flatMap((u) => u.lessons).find((x) => x.id === l.id);
    if (!me || me.status === 'paid' || me.status === 'locked') return bad(res, 'This lesson is not open yet', 403);
    const qs = ids(l.question_ids);
    const rows = qs.length ? await db.all('SELECT * FROM math_questions WHERE id = ANY(?::text[]) AND active', [qs]) : [];
    if (!rows.length) return bad(res, 'This lesson has no questions yet');
    const given = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const review = rows.map((q) => {
      const g = String(given[q.id] ?? '').trim().slice(0, 20);
      const correct = q.kind === 'spr' ? sprCorrect(g, JSON.parse(q.answer || '[]')) : g === q.answer;
      return { id: q.id, given: g, correct, answer: q.kind === 'spr' ? JSON.parse(q.answer || '[]') : q.answer, explanation: q.explanation, tip: q.tip };
    });
    const right = review.filter((x) => x.correct).length;
    const pct = Math.round((100 * right) / rows.length);
    const passed = pct >= l.pass_pct;
    await db.run(`INSERT INTO math_lesson_progress (user_id, lesson_id, best_pct, tries, passed_at) VALUES (?, ?, ?, 1, ${passed ? 'now()' : 'NULL'})
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET best_pct = GREATEST(COALESCE(math_lesson_progress.best_pct, 0), EXCLUDED.best_pct),
        tries = math_lesson_progress.tries + 1, passed_at = COALESCE(math_lesson_progress.passed_at, EXCLUDED.passed_at), last_at = now()`,
    [req.user.id, l.id, pct]);
    // the answers also count as Math practice (mistakes, statistics)
    for (const x of review) {
      await db.run(`INSERT INTO math_answers (user_id, question_id, given, correct, first_correct, tries) VALUES (?,?,?,?,?,1)
        ON CONFLICT (user_id, question_id) DO UPDATE SET given = EXCLUDED.given, correct = EXCLUDED.correct, tries = math_answers.tries + 1, answered_at = now()`,
      [req.user.id, x.id, x.given, x.correct, x.correct]).catch(() => {});
    }
    await logMath(req.user.id, right, rows.length);
    res.json({ right, total: rows.length, pct, passed, pass_pct: l.pass_pct, review });
  }));

  // Math side of the dashboard: daily goal, streak, mistakes, roadmap progress
  app.get('/api/math/me', requireStudent, h(async (req, res) => {
    const days = await db.all(`SELECT day::text AS day, answered, correct FROM math_daily WHERE user_id = ? AND day > ${TODAY} - 60 ORDER BY day DESC`, [req.user.id]);
    const today = (await db.one(`SELECT ${TODAY}::text AS d`)).d;
    let streak = 0; const set = new Set(days.filter((d) => d.answered > 0).map((d) => d.day));
    const back = (n) => { const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };
    for (let i = set.has(today) ? 0 : 1; set.has(back(i)); i++) streak += 1;
    const t = days.find((d) => d.day === today);
    const tot = await db.one(`SELECT COUNT(*) AS done, SUM(CASE WHEN first_correct THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END) AS wrong
      FROM math_answers WHERE user_id = ?`, [req.user.id]);
    const r = await roadmapOf(req.user);
    const all = r.units.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u.title })));
    res.json({
      goal: { target: GOAL, done: t?.answered || 0 }, streak,
      done: Number(tot?.done || 0), first_ok: Number(tot?.ok || 0), mistakes: Number(tot?.wrong || 0),
      roadmap: { total: all.length, passed: all.filter((l) => l.status === 'passed').length, next: all.find((l) => l.status === 'open' || l.status === 'paid') || null, paid: r.paid },
      week: Array.from({ length: 14 }, (_, i) => { const d = back(13 - i); const x = days.find((y) => y.day === d); return { day: d, answered: x?.answered || 0, correct: x?.correct || 0 }; }),
    });
  }));

  // Math mistakes: questions whose last answer was wrong, newest first
  app.get('/api/math/mistakes', requireStudent, h(async (req, res) => {
    const rows = await db.all(`SELECT q.*, a.given, a.tries, a.answered_at FROM math_answers a JOIN math_questions q ON q.id = a.question_id
      WHERE a.user_id = ? AND NOT a.correct AND q.active ORDER BY a.answered_at DESC LIMIT 200`, [req.user.id]);
    res.json({ items: rows.map((q) => ({ ...pubQ(q), given: q.given, tries: q.tries, at: q.answered_at })) });
  }));

  // Math leaderboard: right first-try answers this week / month / all time
  app.get('/api/math/leaderboard', requireStudent, h(async (req, res) => {
    const period = ['week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'week';
    const since = period === 'week' ? `${TODAY} - 6` : period === 'month' ? `${TODAY} - 29` : "'2000-01-01'::date";
    const rows = await db.all(`SELECT u.id, u.name, u.avatar_url, SUM(d.correct) AS correct, SUM(d.answered) AS answered
      FROM math_daily d JOIN users u ON u.id = d.user_id WHERE u.role = 'student' AND d.day >= ${since}
      GROUP BY u.id, u.name, u.avatar_url HAVING SUM(d.answered) > 0 ORDER BY SUM(d.correct) DESC, SUM(d.answered) ASC LIMIT 50`);
    const list = rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, avatar_url: r.avatar_url, correct: Number(r.correct), answered: Number(r.answered), me: r.id === req.user.id }));
    res.json({ period, list, me: list.find((x) => x.me) || null });
  }));

  // ---------- teacher: units and lessons ----------
  app.get('/api/math/roadmap/admin', requireMaster, h(async (req, res) => {
    const units = await db.all('SELECT * FROM math_units ORDER BY position, id');
    const lessons = await db.all(`SELECT l.*, (SELECT COUNT(*) FROM math_lesson_progress p WHERE p.lesson_id = l.id AND p.passed_at IS NOT NULL) AS passed
      FROM math_lessons l ORDER BY l.position, l.id`);
    res.json({ units: units.map((u) => ({ ...u, lessons: lessons.filter((l) => l.unit_id === u.id).map((l) => ({ ...l, question_ids: ids(l.question_ids), passed: Number(l.passed) })) })) });
  }));
  app.post('/api/math/roadmap/units', requireMaster, h(async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    if (!title) return bad(res, 'Write the unit name');
    const pos = (await db.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM math_units')).p;
    res.json(await db.one('INSERT INTO math_units (title, position) VALUES (?, ?) RETURNING id', [title, pos]));
  }));
  app.put('/api/math/roadmap/units/:id', requireMaster, h(async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    if (!title) return bad(res, 'Write the unit name');
    await db.run('UPDATE math_units SET title = ? WHERE id = ?', [title, nid(req.params.id)]);
    res.json({ ok: true });
  }));
  app.delete('/api/math/roadmap/units/:id', requireMaster, h(async (req, res) => {
    await db.run('DELETE FROM math_units WHERE id = ?', [nid(req.params.id)]);
    res.json({ ok: true });
  }));
  const lessonFields = async (b, old = {}) => {
    const title = 'title' in b ? String(b.title || '').trim().slice(0, 160) : old.title;
    if (!title) throw Object.assign(new Error('Write the lesson title'), { status: 400 });
    const unit = 'unit_id' in b ? Number(b.unit_id) : old.unit_id;
    if (!unit || !(await db.one('SELECT id FROM math_units WHERE id = ?', [unit]))) throw Object.assign(new Error('Choose a unit'), { status: 400 });
    const video = 'video' in b ? String(b.video || '').trim().slice(0, 500) : old.video || '';
    if (video && !isBunny(video) && !/^https:\/\//.test(video)) throw Object.assign(new Error('The video should be an uploaded video or an https:// link'), { status: 400 });
    const q = 'question_ids' in b ? [...new Set((Array.isArray(b.question_ids) ? b.question_ids : []).map(String))].slice(0, 40) : ids(old.question_ids);
    return { title, unit, video, notes: 'notes' in b ? String(b.notes || '').slice(0, 8000) : old.notes || '', question_ids: JSON.stringify(q),
      pass_pct: 'pass_pct' in b ? Math.max(10, Math.min(100, Math.round(+b.pass_pct || 70))) : old.pass_pct ?? 70,
      published: 'published' in b ? !!b.published : old.published ?? true };
  };
  app.post('/api/math/roadmap/lessons', requireMaster, h(async (req, res) => {
    const f = await lessonFields(req.body || {});
    const pos = (await db.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM math_lessons WHERE unit_id = ?', [f.unit])).p;
    res.json(await db.one('INSERT INTO math_lessons (unit_id, title, video, notes, question_ids, pass_pct, published, position) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      [f.unit, f.title, f.video, f.notes, f.question_ids, f.pass_pct, f.published, pos]));
  }));
  app.put('/api/math/roadmap/lessons/:id', requireMaster, h(async (req, res) => {
    const old = await db.one('SELECT * FROM math_lessons WHERE id = ?', [nid(req.params.id)]);
    if (!old) return bad(res, 'Lesson not found', 404);
    const f = await lessonFields(req.body || {}, old);
    await db.run('UPDATE math_lessons SET unit_id = ?, title = ?, video = ?, notes = ?, question_ids = ?, pass_pct = ?, published = ? WHERE id = ?',
      [f.unit, f.title, f.video, f.notes, f.question_ids, f.pass_pct, f.published, old.id]);
    res.json({ ok: true });
  }));
  app.delete('/api/math/roadmap/lessons/:id', requireMaster, h(async (req, res) => {
    await db.run('DELETE FROM math_lessons WHERE id = ?', [nid(req.params.id)]);
    res.json({ ok: true });
  }));
  // order: units [ids] and / or lessons of one unit [ids]
  app.post('/api/math/roadmap/order', requireMaster, h(async (req, res) => {
    const u = (Array.isArray(req.body?.units) ? req.body.units : []).map(Number).filter(Boolean);
    const l = (Array.isArray(req.body?.lessons) ? req.body.lessons : []).map(Number).filter(Boolean);
    await db.tx(async (t) => {
      for (let i = 0; i < u.length; i++) await t.run('UPDATE math_units SET position = ? WHERE id = ?', [i + 1, u[i]]);
      for (let i = 0; i < l.length; i++) await t.run('UPDATE math_lessons SET position = ? WHERE id = ?', [i + 1, l[i]]);
    });
    res.json({ ok: true });
  }));
}
