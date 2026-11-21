/**
 * The free practice test (the first thing a visitor tries; no sign-up needed).
 *
 * Subjects: Reading & Writing (Question Bank) or Math (Math questions, Desmos on the client).
 * Modes:
 *  - quick : 5 mixed questions, a first taste
 *  - topic : the student picks question types, levels and the number of questions
 *  - sat   : one module built like the real test — domain shares and order of the Digital SAT, mixed levels, real timing
 *  - full  : two adaptive modules like Bluebook — Module 2 is harder or easier depending on Module 1
 * Guests see the score, the skills and the right answers; explanations open after signing up (the session is then
 * attached to the new account).
 */
import crypto from 'node:crypto';
import { db } from './db.js';
import { DOMAINS } from './qbank.js';
import { satScore, ROUTE_CUT } from './scoring.js';
import { getBlock, pubQ, poolIds, ipKey, quota, pubQuota } from './site.js';
import { starter, sprCorrect } from './math.js';

/**
 * Which part of the free bank a visitor sees is decided by the server (network + account + week), not by a value the
 * browser sends: changing that value used to show a new part of the bank each time, so the whole bank with its answers
 * could be copied from the free test.
 */
const seedOf = (req) => crypto.createHash('sha256').update(`${ipKey(req)}:${req.headers.authorization || /su_sess=/.test(req.headers.cookie || '') ? 'u' : 'g'}:${Math.floor(Date.now() / (7 * 86400e3))}`).digest('hex').slice(0, 24);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const LEVELS = ['easy', 'medium', 'hard'];
const SIZES = [5, 10, 15, 20, 27];
// the share of each domain in one Digital SAT module, in the order the questions come
const EN_BLUEPRINT = [['Craft and Structure', 0.28], ['Information and Ideas', 0.26], ['Standard English Conventions', 0.26], ['Expression of Ideas', 0.2]];
const MATH_BLUEPRINT = [['alg', 0.35], ['adv', 0.35], ['psda', 0.15], ['geo', 0.15]];
const SUBJ = {
  english: { module: 27, secs: 32 * 60, blueprint: EN_BLUEPRINT },
  math: { module: 22, secs: 35 * 60, blueprint: MATH_BLUEPRINT },
};
// level mix: a mixed first module; Module 2 leans harder or easier
const MIX = { mixed: { easy: 1, medium: 1, hard: 1 }, hard: { easy: 0.15, medium: 0.4, hard: 0.45 }, easy: { easy: 0.45, medium: 0.45, hard: 0.1 } };

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const domainOf = (subject, q) => (subject === 'math' ? q.domain : q.domain);
const orderBy = (bp) => new Map(bp.map(([d], i) => [d, i]));
const LV = { easy: 0, medium: 1, hard: 2 };

/** Build a module like the real test: domain shares, a level mix, then SAT order (domain by domain, easier first). */
function compose(rows, size, subject, mix = MIX.mixed) {
  const bp = SUBJ[subject].blueprint;
  const pool = shuffle([...rows]);
  const used = new Set(); const out = [];
  let left = size;
  bp.forEach(([dom, share], i) => {
    const want = i === bp.length - 1 ? left : Math.round(size * share);
    left -= want;
    const cand = pool.filter((q) => domainOf(subject, q) === dom);
    const tot = LEVELS.reduce((t, l) => t + mix[l], 0);
    let got = 0;
    // weighted levels, then whatever is left in the domain
    for (const l of LEVELS) {
      const n = Math.round((want * mix[l]) / tot);
      for (const q of cand.filter((x) => x.difficulty === l && !used.has(x.id)).slice(0, n)) { if (got < want) { used.add(q.id); out.push(q); got++; } }
    }
    for (const q of cand) { if (got >= want) break; if (!used.has(q.id)) { used.add(q.id); out.push(q); got++; } }
  });
  for (const q of pool) { if (out.length >= size) break; if (!used.has(q.id)) { used.add(q.id); out.push(q); } }
  const ord = orderBy(bp);
  return out.sort((a, b) => ((ord.get(domainOf(subject, a)) ?? 9) - (ord.get(domainOf(subject, b)) ?? 9)) || (LV[a.difficulty] - LV[b.difficulty]));
}

const mathPub = (q, names = mathNamesOf()) => ({ id: q.id, domain: q.domain, skill_id: q.skill, skill: names.get(q.skill) || q.skill, difficulty: q.difficulty, kind: q.kind, prompt: q.prompt, options: parse(q.options, []) });

async function rowsFor(subject, seed, cfg) {
  if (subject === 'math') {
    const total = Number((await db.one('SELECT COUNT(*) AS n FROM math_questions WHERE active')).n);
    const size = Math.max(Math.min(total, 60), Math.ceil((total * Math.min(100, Math.max(10, cfg.pool_percent))) / 100));
    return db.all('SELECT * FROM math_questions WHERE active ORDER BY md5(id || ?) LIMIT ?', [seed, size]);
  }
  const { ids } = await poolIds(seed, cfg);
  return ids.length ? db.all('SELECT * FROM qbank_questions WHERE active AND NOT premium AND reserved_for IS NULL AND id = ANY(?::text[])', [ids]) : [];
}

/** Grade one session's answers; with `explain` the explanations are included. */
async function review(s, explain, mathNames) {
  const ids = parse(s.question_ids, []);
  const given = parse(s.answers, {});
  if (s.subject === 'math') {
    const qs = ids.length ? await db.all('SELECT * FROM math_questions WHERE id = ANY(?::text[])', [ids]) : [];
    const by = new Map(qs.map((q) => [q.id, q]));
    return ids.map((id) => by.get(id)).filter(Boolean).map((q) => {
      const g = given[q.id];
      const key = q.kind === 'spr' ? parse(q.answer, []) : q.answer;
      const correct = q.kind === 'spr' ? (g != null && String(g).trim() !== '' && sprCorrect(String(g).trim().slice(0, 20), key)) : Number.isInteger(g) && 'ABCD'[g] === q.answer;
      return { ...mathPub(q, mathNames), domain: mathNames.get(q.domain) || q.domain, choice: g ?? null, answer: q.kind === 'spr' ? key : 'ABCD'.indexOf(q.answer),
        correct, module: s.module, ...(explain ? { explanation: q.explanation, tip: q.tip } : {}) };
    });
  }
  const qs = ids.length ? await db.all('SELECT * FROM qbank_questions WHERE id = ANY(?::text[])', [ids]) : [];
  const by = new Map(qs.map((q) => [q.id, q]));
  return ids.map((id) => by.get(id)).filter(Boolean).map((q) => {
    const c = Number.isInteger(given[q.id]) && given[q.id] >= 0 && given[q.id] < 5 ? given[q.id] : null;
    return { ...pubQ(q), choice: c, answer: q.answer, correct: c === q.answer, module: s.module, ...(explain ? { explanation: q.explanation, tip: q.tip } : {}) };
  });
}

const mathNamesOf = () => {
  const m = new Map();
  for (const d of starter().domains) { m.set(d.id, d.name); for (const k of d.skills) m.set(k.id, k.name); }
  return m;
};

/** The whole result of a finished test (both modules for an adaptive test). */
async function resultOf(s, explain) {
  const names = s.subject === 'math' ? mathNamesOf() : null;
  const parent = s.parent_id ? await db.one('SELECT * FROM practice_sessions WHERE id = ?', [s.parent_id]) : null;
  const list = [...(parent ? await review(parent, explain, names) : []), ...(await review(s, explain, names))];
  const score = list.filter((r) => r.correct).length;
  const sat = satScore(list.map((r) => ({ correct: r.correct, difficulty: r.difficulty, kind: r.kind, module: parent ? r.module : undefined })), s.subject);
  const skills = {};
  for (const r of list) { const k = (skills[r.skill] ||= { skill: r.skill, domain: r.domain, n: 0, ok: 0 }); k.n++; k.ok += r.correct ? 1 : 0; }
  return {
    id: s.id, subject: s.subject, mode: s.mode, route: s.route || null, score, total: list.length, percent: list.length ? Math.round((score / list.length) * 100) : 0,
    estimate: sat?.score ?? 200, sat, skills: Object.values(skills), review: list, explained: explain,
  };
}

export function registerPractice(app, { h, bad, who }) {
  // what can be practised on this visit, plus a few honest numbers for trust
  app.get('/api/public/practice', h(async (req, res) => {
    const cfg = await getBlock('practice');
    const seed = seedOf(req);
    const { ids, total } = await poolIds(seed, cfg);
    const rows = ids.length ? await db.all('SELECT skill_id, difficulty, COUNT(*) AS n FROM qbank_questions WHERE id = ANY(?::text[]) GROUP BY skill_id, difficulty', [ids]) : [];
    const domains = DOMAINS.map((d) => ({
      domain: d.domain,
      skills: d.skills.map(([id, name]) => {
        const per = Object.fromEntries(LEVELS.map((l) => [l, Number(rows.find((r) => r.skill_id === id && r.difficulty === l)?.n || 0)]));
        return { id, name, per, n: per.easy + per.medium + per.hard };
      }),
    })).sort((a, b) => (orderBy(EN_BLUEPRINT).get(a.domain) ?? 9) - (orderBy(EN_BLUEPRINT).get(b.domain) ?? 9));
    const mrows = await db.all('SELECT domain, skill, difficulty, COUNT(*) AS n FROM math_questions WHERE active GROUP BY domain, skill, difficulty');
    const math = starter().domains.map((d) => ({
      id: d.id, domain: d.name,
      skills: d.skills.map((k) => {
        const per = Object.fromEntries(LEVELS.map((l) => [l, Number(mrows.find((r) => r.skill === k.id && r.difficulty === l)?.n || 0)]));
        return { id: k.id, name: k.name, per, n: per.easy + per.medium + per.hard };
      }).filter((k) => k.n),
    }));
    const u = who(req);
    const recent = u ? await db.all(`SELECT id, score, total, estimate, subject, finished_at FROM practice_sessions WHERE user_id = ? AND finished_at IS NOT NULL
      AND id NOT IN (SELECT parent_id FROM practice_sessions WHERE parent_id IS NOT NULL) ORDER BY finished_at DESC LIMIT 5`, [u.id]).catch(() => []) : [];
    const st = await db.one(`SELECT (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
      (SELECT COUNT(*) FROM practice_sessions WHERE finished_at IS NOT NULL) AS tests,
      (SELECT COUNT(*) FROM qbank_questions WHERE active) AS en, (SELECT COUNT(*) FROM math_questions WHERE active) AS mt`);
    res.json({
      seed, visible: ids.length, total, percent: cfg.pool_percent, test_size: cfg.test_size, minutes: cfg.minutes, domains, math, recent,
      quota: pubQuota(await quota(req, u, cfg)), signed_in: !!u, sizes: SIZES,
      modules: { english: { size: SUBJ.english.module, minutes: SUBJ.english.secs / 60 }, math: { size: SUBJ.math.module, minutes: SUBJ.math.secs / 60 } },
      stats: { students: Number(st.students), tests: Number(st.tests), english: Number(st.en), math: Number(st.mt) },
    });
  }));

  // start a test
  app.post('/api/public/practice/start', h(async (req, res) => {
    const cfg = await getBlock('practice');
    const b = req.body || {};
    const subject = b.subject === 'math' ? 'math' : 'english';
    const mode = ['quick', 'topic', 'sat', 'full'].includes(b.mode) ? b.mode : 'topic';
    const seed = seedOf(req);
    const u = who(req);
    const q = await quota(req, u, cfg);
    const S = SUBJ[subject];
    let size = mode === 'quick' ? 5 : mode === 'topic' ? (SIZES.includes(Number(b.size)) ? Number(b.size) : 10) : S.module;
    const need = mode === 'full' ? size * 2 : size;
    if (!q.unlimited && q.left < need) {
      if (mode === 'sat' || mode === 'full' || q.left < 3) {
        return bad(res, q.left < 3 ? 'You have used today’s free questions. The limit resets 24 hours after your first test — or get unlimited practice with a subscription.'
          : `This test has ${need} questions and you have ${q.left} free questions left today. Choose a shorter test, or come back after the limit resets.`, 429, { code: 'daily_limit', quota: pubQuota(q) });
      }
      size = q.left;
    }
    let rows = await rowsFor(subject, seed, cfg);
    if (mode === 'topic') {
      const skills = (Array.isArray(b.skills) ? b.skills : []).map(String).slice(0, 30);
      const levels = (Array.isArray(b.levels) ? b.levels : []).filter((l) => LEVELS.includes(l));
      rows = rows.filter((x) => (!skills.length || skills.includes(subject === 'math' ? x.skill : x.skill_id)) && (!levels.length || levels.includes(x.difficulty)));
      const ord = orderBy(S.blueprint);
      rows = shuffle(rows).slice(0, size).sort((a, c) => (ord.get(a.domain) ?? 9) - (ord.get(c.domain) ?? 9));
    } else rows = compose(rows, size, subject);
    if (rows.length < 3) return bad(res, 'Not enough questions for these choices today — pick more question types or levels.');
    const id = crypto.randomBytes(9).toString('base64url');
    await db.run('INSERT INTO practice_sessions (id, user_id, question_ids, filters, total, ip, subject, mode, module) VALUES (?,?,?,?,?,?,?,?,1)',
      [id, u?.id || null, JSON.stringify(rows.map((r) => r.id)), JSON.stringify({ skills: b.skills || [], levels: b.levels || [], size }), rows.length, ipKey(req), subject, mode]);
    res.json({
      id, subject, mode, module: 1, modules: mode === 'full' ? 2 : 1,
      minutes: Math.max(4, Math.round((S.secs * rows.length) / S.module / 60)),
      questions: subject === 'math' ? (() => { const n = mathNamesOf(); return rows.map((x) => mathPub(x, n)); })() : rows.map(pubQ),
      quota: q.unlimited ? pubQuota(q) : pubQuota({ ...q, used: q.used + rows.length, left: q.left - rows.length }),
    });
  }));

  const cleanAnswers = (s, raw) => {
    const ids = new Set(parse(s.question_ids, []));
    const out = {};
    for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (!ids.has(k)) continue;
      if (Number.isInteger(v) && v >= 0 && v < 5) out[k] = v;
      else if (s.subject === 'math' && typeof v === 'number' && Number.isFinite(v)) out[k] = String(v).slice(0, 20); // a typed answer sent as a number (12, -3, 0.5)
      else if (s.subject === 'math' && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 20);
    }
    return out;
  };
  const finish = async (s, raw, u) => {
    if (s.finished_at) return;
    const answers = cleanAnswers(s, raw);
    const list = await review({ ...s, answers: JSON.stringify(answers) }, false, s.subject === 'math' ? mathNamesOf() : null);
    const score = list.filter((r) => r.correct).length;
    const sat = satScore(list.map((r) => ({ correct: r.correct, difficulty: r.difficulty, kind: r.kind })), s.subject);
    await db.run('UPDATE practice_sessions SET answers = ?, score = ?, estimate = ?, finished_at = now(), user_id = COALESCE(user_id, ?) WHERE id = ? AND finished_at IS NULL',
      [JSON.stringify(answers), score, sat?.score ?? null, u?.id || null, s.id]);
    return { score, total: list.length };
  };

  // adaptive test: finish Module 1, get Module 2 (harder or easier)
  app.post('/api/public/practice/:id/next', h(async (req, res) => {
    const s = await db.one('SELECT * FROM practice_sessions WHERE id = ?', [req.params.id]);
    if (!s || s.mode !== 'full' || s.module !== 1) return bad(res, 'Test not found', 404);
    const existing = await db.one('SELECT * FROM practice_sessions WHERE parent_id = ?', [s.id]);
    const u = who(req);
    if (!existing) await finish(s, req.body?.answers, u);
    const done = await db.one('SELECT * FROM practice_sessions WHERE id = ?', [s.id]);
    let m2 = existing;
    if (!m2) {
      const route = (done.score || 0) / Math.max(1, done.total) >= ROUTE_CUT ? 'hard' : 'easy';
      const S = SUBJ[s.subject];
      const taken = new Set(parse(s.question_ids, []));
      const cfg = await getBlock('practice');
      let rows = (await rowsFor(s.subject, seedOf(req), cfg)).filter((x) => !taken.has(x.id));
      if (rows.length < S.module && s.subject === 'english') {
        // the visit's pool can run short: top up from the whole free bank
        rows = rows.concat((await db.all('SELECT * FROM qbank_questions WHERE active AND NOT premium AND reserved_for IS NULL')).filter((x) => !taken.has(x.id) && !rows.some((r) => r.id === x.id)));
      }
      rows = compose(rows, S.module, s.subject, MIX[route]);
      const id = crypto.randomBytes(9).toString('base64url');
      await db.run('INSERT INTO practice_sessions (id, user_id, question_ids, filters, total, ip, subject, mode, module, parent_id, route) VALUES (?,?,?,?,?,?,?,?,2,?,?)',
        [id, u?.id || s.user_id || null, JSON.stringify(rows.map((r) => r.id)), s.filters, rows.length, ipKey(req), s.subject, 'full', s.id, route]);
      m2 = await db.one('SELECT * FROM practice_sessions WHERE id = ?', [id]);
    }
    const ids = parse(m2.question_ids, []);
    const qs = s.subject === 'math' ? await db.all('SELECT * FROM math_questions WHERE id = ANY(?::text[])', [ids]) : await db.all('SELECT * FROM qbank_questions WHERE id = ANY(?::text[])', [ids]);
    const by = new Map(qs.map((q) => [q.id, q]));
    const S = SUBJ[s.subject];
    res.json({ id: m2.id, subject: s.subject, mode: 'full', module: 2, modules: 2, route: m2.route, minutes: Math.round(S.secs / 60),
      questions: ids.map((x) => by.get(x)).filter(Boolean).map((x) => (s.subject === 'math' ? mathPub(x) : pubQ(x))) });
  }));

  // finish: score, estimate, skills, review (explanations for signed-in students)
  app.post('/api/public/practice/:id/submit', h(async (req, res) => {
    const s = await db.one('SELECT * FROM practice_sessions WHERE id = ?', [req.params.id]);
    if (!s) return bad(res, 'Test not found', 404);
    const u = who(req);
    await finish(s, req.body?.answers, u);
    const out = await resultOf(await db.one('SELECT * FROM practice_sessions WHERE id = ?', [s.id]), !!u);
    // an adaptive test keeps the estimate of both modules on Module 2 (what "Your last tests" shows)
    if (s.parent_id) await db.run('UPDATE practice_sessions SET estimate = ? WHERE id = ?', [out.estimate, s.id]);
    res.json(out);
  }));

  // an earlier result (after signing up the guest's test is attached to the new account and the explanations open)
  app.get('/api/public/practice/:id/result', h(async (req, res) => {
    const s = await db.one('SELECT * FROM practice_sessions WHERE id = ? AND finished_at IS NOT NULL', [req.params.id]);
    if (!s) return bad(res, 'Result not found', 404);
    const u = who(req);
    if (u) {
      if (s.user_id && s.user_id !== u.id) return bad(res, 'This result belongs to another account', 403);
      await db.run('UPDATE practice_sessions SET user_id = ? WHERE (id = ? OR id = ?) AND user_id IS NULL', [u.id, s.id, s.parent_id || s.id]);
    }
    res.json(await resultOf(s, !!u));
  }));
}
