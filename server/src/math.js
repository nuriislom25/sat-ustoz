/**
 * SAT Math: its own section, separate from Reading & Writing.
 *
 * - Questions by the four College Board domains (Algebra, Advanced Math, Problem-Solving and Data Analysis,
 *   Geometry and Trigonometry). Two kinds: multiple choice (A–D) and student-produced response (typed answer).
 * - Starter questions and worked examples ("Start here") come from math/starter.json and are synced on start;
 *   the teacher can add, edit and hide questions. An edited starter question is never overwritten by the sync.
 * - Practice works like the Question Bank: a wrong pick can be tried again (3 tries), then the answer is shown.
 *   Every check counts toward the free daily limit (key "mt:<id>").
 * - The Desmos calculator lives in the browser (an embedded www.desmos.com/calculator), nothing here.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { meterAnswers, limitError } from './tiers.js';
import { logMath } from './mathroad.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STARTER_FILE = path.join(here, 'math', 'starter.json');
export const starter = () => JSON.parse(fs.readFileSync(STARTER_FILE, 'utf8'));
const LEVELS = ['easy', 'medium', 'hard'];

export async function migrateMath() {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS math_questions (
    id TEXT PRIMARY KEY, domain TEXT NOT NULL, skill TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT 'medium',
    kind TEXT NOT NULL DEFAULT 'mcq', prompt TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL DEFAULT '',
    explanation TEXT NOT NULL DEFAULT '', tip TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'teacher',
    edited BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true, position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS math_answers (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_id TEXT NOT NULL REFERENCES math_questions(id) ON DELETE CASCADE,
    given TEXT NOT NULL DEFAULT '', correct BOOLEAN NOT NULL DEFAULT false, first_correct BOOLEAN NOT NULL DEFAULT false,
    tries INTEGER NOT NULL DEFAULT 1, answered_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, question_id));
  CREATE INDEX IF NOT EXISTS idx_math_answers_user ON math_answers(user_id);
  ALTER TABLE math_questions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE math_answers ENABLE ROW LEVEL SECURITY;`);
}

/** Starter content → database (only when the file changed; teacher-edited questions are kept). */
export async function syncMath() {
  const raw = fs.readFileSync(STARTER_FILE, 'utf8');
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const done = await db.one("SELECT value FROM settings WHERE key = '_math_hash'").catch(() => null);
  if (done?.value === hash) return;
  const { questions } = JSON.parse(raw);
  let i = 0;
  for (const q of questions) {
    const answer = q.kind === 'spr' ? JSON.stringify(q.answers) : q.answer;
    await db.run(`INSERT INTO math_questions (id, domain, skill, difficulty, kind, prompt, options, answer, explanation, tip, source, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,'starter',?)
      ON CONFLICT (id) DO UPDATE SET domain = EXCLUDED.domain, skill = EXCLUDED.skill, difficulty = EXCLUDED.difficulty, kind = EXCLUDED.kind,
        prompt = EXCLUDED.prompt, options = EXCLUDED.options, answer = EXCLUDED.answer, explanation = EXCLUDED.explanation, tip = EXCLUDED.tip, position = EXCLUDED.position
      WHERE NOT math_questions.edited`,
    [q.id, q.domain, q.skill, q.difficulty, q.kind, q.prompt, JSON.stringify(q.options || []), answer, q.explanation || '', q.tip || '', i++]);
  }
  await db.run("INSERT INTO settings (key, value) VALUES ('_math_hash', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [hash]);
}

/** What a student may see before answering (no key). */
export const pub = (q) => ({ id: q.id, domain: q.domain, skill: q.skill, difficulty: q.difficulty, kind: q.kind, prompt: q.prompt, options: JSON.parse(q.options || '[]') });
const full = (q) => ({ ...pub(q), answer: q.kind === 'spr' ? JSON.parse(q.answer || '[]') : q.answer, explanation: q.explanation, tip: q.tip, source: q.source, active: q.active, edited: q.edited });

/** Typed answers: "3/4", ".75", "0.75", "-2", "1,000" all compare by value; the SAT accepts any equivalent form. */
export const toNum = (s) => {
  const t = String(s).trim().replace(/\s+/g, '').replace(/,/g, '').replace(/^\+/, '');
  if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
  const m = t.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  return null;
};
export function sprCorrect(given, accepted) {
  const g = String(given || '').trim();
  if (!g) return false;
  const gv = toNum(g);
  return accepted.some((a) => {
    const av = toNum(a);
    if (gv != null && av != null) return Math.abs(gv - av) < 1e-4 || (Math.abs(av) > 0 && Math.abs(gv - av) / Math.abs(av) < 1e-3 && g.replace('-', '').length >= 5);
    return g.toLowerCase().replace(/\s+/g, '') === String(a).toLowerCase().replace(/\s+/g, '');
  });
}

export function registerMath(app, { h, bad, requireStudent, requireMaster, upload }) {
  // teacher: many questions at once from Excel / CSV, and the example file
  app.post('/api/math/admin/import', requireMaster, upload.single('file'), h(async (req, res) => {
    if (!req.file?.buffer?.length) return bad(res, 'Choose an Excel or CSV file');
    const { importMath } = await import('./mathImport.js');
    let r;
    try { r = await importMath(req.file.buffer, req.user.id); } catch { return bad(res, 'The file could not be read. Use the template (Excel or CSV).'); }
    if (!r.added && !r.duplicates) return bad(res, r.problems.length ? `Nothing was added: ${r.problems.slice(0, 3).join('; ')}` : 'The file has no questions');
    res.json(r);
  }));
  app.get('/api/math/admin/template.xlsx', requireMaster, h(async (req, res) => {
    const { mathTemplate } = await import('./mathImport.js');
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="sat-math-questions-template.xlsx"' });
    res.send(mathTemplate());
  }));

  const cleanQ = (b, old = {}) => {
    const domain = ['alg', 'adv', 'psda', 'geo'].includes(b.domain) ? b.domain : old.domain;
    const sk = starter().domains.find((d) => d.id === domain)?.skills || [];
    const skill = sk.some((s) => s.id === b.skill) ? b.skill : sk[0]?.id;
    const kind = b.kind === 'spr' ? 'spr' : 'mcq';
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!domain || !skill) throw Object.assign(new Error('Choose a domain and a skill'), { status: 400 });
    if (!prompt) throw Object.assign(new Error('Write the question'), { status: 400 });
    let options = []; let answer;
    if (kind === 'mcq') {
      options = (Array.isArray(b.options) ? b.options : []).map((o) => String(o || '').trim().slice(0, 600)).slice(0, 4);
      if (options.length !== 4 || options.some((o) => !o)) throw Object.assign(new Error('Write all four answer choices'), { status: 400 });
      answer = ['A', 'B', 'C', 'D'].includes(b.answer) ? b.answer : null;
      if (!answer) throw Object.assign(new Error('Mark the right answer'), { status: 400 });
    } else {
      const acc = (Array.isArray(b.answers) ? b.answers : String(b.answers || '').split(/[;|]/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
      if (!acc.length) throw Object.assign(new Error('Write the right answer (several forms can be separated with ;)'), { status: 400 });
      answer = JSON.stringify(acc);
    }
    return { domain, skill, kind, prompt, options: JSON.stringify(options), answer, difficulty: LEVELS.includes(b.difficulty) ? b.difficulty : 'medium',
      explanation: String(b.explanation || '').trim().slice(0, 4000), tip: String(b.tip || '').trim().slice(0, 1000) };
  };

  // overview: domains and skills with counts and the student's progress, plus the worked examples
  app.get('/api/math', requireStudent, h(async (req, res) => {
    const s = starter();
    const rows = await db.all(`SELECT q.domain, q.skill, q.difficulty, COUNT(*) AS n,
        SUM(CASE WHEN a.question_id IS NOT NULL THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN a.first_correct THEN 1 ELSE 0 END) AS ok
      FROM math_questions q LEFT JOIN math_answers a ON a.question_id = q.id AND a.user_id = ?
      WHERE q.active GROUP BY q.domain, q.skill, q.difficulty`, [req.user.id]);
    const by = (d, sk) => rows.filter((r) => r.domain === d && (!sk || r.skill === sk));
    const sum = (rs, k) => rs.reduce((t, r) => t + Number(r[k] || 0), 0);
    const domains = s.domains.map((d) => ({
      ...d, total: sum(by(d.id), 'n'), done: sum(by(d.id), 'done'), correct: sum(by(d.id), 'ok'),
      skills: d.skills.map((k) => ({ ...k, total: sum(by(d.id, k.id), 'n'), done: sum(by(d.id, k.id), 'done'), correct: sum(by(d.id, k.id), 'ok'),
        per: Object.fromEntries(LEVELS.map((l) => [l, sum(by(d.id, k.id).filter((r) => r.difficulty === l), 'n')])) })).filter((k) => k.total > 0),
    }));
    res.json({ domains, lessons: s.lessons.map(({ steps, ...l }) => ({ ...l, steps: steps.length })), total: sum(rows, 'n'), done: sum(rows, 'done'), correct: sum(rows, 'ok') });
  }));

  app.get('/api/math/lessons/:id', requireStudent, h(async (req, res) => {
    const l = starter().lessons.find((x) => x.id === req.params.id);
    if (!l) return bad(res, 'Example not found', 404);
    res.json(l);
  }));

  // a practice set: by domain / skill / level / status, random order (not answered first)
  app.get('/api/math/questions', requireStudent, h(async (req, res) => {
    const levels = String(req.query.difficulty || '').split(',').filter((l) => LEVELS.includes(l));
    const skills = String(req.query.skill || '').split(',').filter(Boolean).slice(0, 30);
    const domain = String(req.query.domain || '');
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 30);
    const status = ['new', 'mistakes'].includes(req.query.status) ? req.query.status : 'all';
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
    const where = ['q.active']; const args = [req.user.id];
    if (ids.length) { where.push('q.id = ANY(?::text[])'); args.push(ids); }
    if (levels.length) { where.push('q.difficulty = ANY(?::text[])'); args.push(levels); }
    if (skills.length) { where.push('q.skill = ANY(?::text[])'); args.push(skills); }
    if (domain) { where.push('q.domain = ?'); args.push(domain); }
    if (status === 'new') where.push('a.question_id IS NULL');
    if (status === 'mistakes') where.push('a.question_id IS NOT NULL AND NOT a.correct');
    const rows = await db.all(`SELECT q.* FROM math_questions q LEFT JOIN math_answers a ON a.question_id = q.id AND a.user_id = ?
      WHERE ${where.join(' AND ')} ORDER BY ${ids.length ? 'array_position(?::text[], q.id)' : '(a.question_id IS NOT NULL), random()'} LIMIT ?`,
    ids.length ? [...args, ids, limit] : [...args, limit]);
    res.json({ questions: rows.map(pub) });
  }));

  // check one answer; up to 3 tries, then the key and the explanation are shown
  app.post('/api/math/questions/:id/check', requireStudent, h(async (req, res) => {
    const q = await db.one('SELECT * FROM math_questions WHERE id = ? AND active', [req.params.id]);
    if (!q) return bad(res, 'Question not found', 404);
    const meter = await meterAnswers(req.user, [`mt:${q.id}`]);
    if (meter.refused) throw limitError(meter.cap, 'math');
    let given; let correct;
    if (q.kind === 'spr') {
      given = String(req.body?.value ?? '').trim().slice(0, 20);
      if (!given) return bad(res, 'Type your answer first');
      if (toNum(given) == null && !/^[\w./-]+$/.test(given)) return bad(res, 'Use numbers, a decimal point, a minus sign or a fraction like 3/4');
      correct = sprCorrect(given, JSON.parse(q.answer || '[]'));
    } else {
      given = String(req.body?.choice || '');
      if (!['A', 'B', 'C', 'D'].includes(given)) return bad(res, 'Choose an answer first');
      correct = given === q.answer;
    }
    const attempt = Math.max(1, Math.min(3, Number(req.body?.attempt) || 1));
    if (attempt === 1) {
      await logMath(req.user.id, correct ? 1 : 0);
      await db.run(`INSERT INTO math_answers (user_id, question_id, given, correct, first_correct, tries, answered_at) VALUES (?,?,?,?,?,1,now())
        ON CONFLICT (user_id, question_id) DO UPDATE SET given = EXCLUDED.given, correct = EXCLUDED.correct, tries = math_answers.tries + 1, answered_at = now()`,
      [req.user.id, q.id, given, correct, correct]);
    } else await db.run('UPDATE math_answers SET given = ?, correct = ?, tries = tries + 1, answered_at = now() WHERE user_id = ? AND question_id = ?', [given, correct, req.user.id, q.id]);
    if (!correct && attempt < 3) return res.json({ correct: false, done: false, left: 3 - attempt });
    const key = q.kind === 'spr' ? JSON.parse(q.answer || '[]') : q.answer;
    res.json({ correct, done: true, attempt, answer: key, explanation: q.explanation, tip: q.tip });
  }));

  // ---------- teacher ----------
  app.get('/api/math/admin', requireMaster, h(async (req, res) => {
    const rows = await db.all(`SELECT q.*, (SELECT COUNT(*) FROM math_answers a WHERE a.question_id = q.id) AS answered,
      (SELECT COUNT(*) FROM math_answers a WHERE a.question_id = q.id AND a.first_correct) AS first_ok FROM math_questions q ORDER BY q.domain, q.position, q.created_at`);
    res.json({ domains: starter().domains, questions: rows.map((q) => ({ ...full(q), answered: Number(q.answered), first_ok: Number(q.first_ok) })) });
  }));
  app.post('/api/math/admin', requireMaster, h(async (req, res) => {
    const c = cleanQ(req.body || {});
    const id = `t-${crypto.randomBytes(5).toString('hex')}`;
    const pos = (await db.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM math_questions')).p;
    await db.run(`INSERT INTO math_questions (id, domain, skill, difficulty, kind, prompt, options, answer, explanation, tip, source, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,'teacher',?)`, [id, c.domain, c.skill, c.difficulty, c.kind, c.prompt, c.options, c.answer, c.explanation, c.tip, pos]);
    res.json({ id });
  }));
  app.put('/api/math/admin/:id', requireMaster, h(async (req, res) => {
    const old = await db.one('SELECT * FROM math_questions WHERE id = ?', [req.params.id]);
    if (!old) return bad(res, 'Question not found', 404);
    if ('active' in (req.body || {}) && Object.keys(req.body).length === 1) {
      await db.run('UPDATE math_questions SET active = ? WHERE id = ?', [!!req.body.active, old.id]);
      return res.json({ ok: true });
    }
    const c = cleanQ(req.body || {}, old);
    await db.run(`UPDATE math_questions SET domain = ?, skill = ?, difficulty = ?, kind = ?, prompt = ?, options = ?, answer = ?, explanation = ?, tip = ?, edited = true WHERE id = ?`,
      [c.domain, c.skill, c.difficulty, c.kind, c.prompt, c.options, c.answer, c.explanation, c.tip, old.id]);
    res.json({ ok: true });
  }));
  app.delete('/api/math/admin/:id', requireMaster, h(async (req, res) => {
    const q = await db.one('SELECT source FROM math_questions WHERE id = ?', [req.params.id]);
    if (!q) return bad(res, 'Question not found', 404);
    // starter questions come back with the next content update, so they are hidden instead of deleted
    if (q.source === 'starter') await db.run('UPDATE math_questions SET active = false, edited = true WHERE id = ?', [req.params.id]);
    else await db.run('DELETE FROM math_questions WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  }));
}
