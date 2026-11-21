/**
 * SAT Math full mocks: two modules of 22 questions, 35 minutes each, Desmos on the client, multiple choice and typed
 * (student-produced) answers, adaptive Module 2 like the Digital SAT.
 *
 *  - "bank": built for each student from the Math Question Bank (Module 1 mixed; after it, a harder or an easier
 *    Module 2 from the questions left), with the College Board domain shares (Algebra 35%, Advanced Math 35%,
 *    Problem-Solving and Data Analysis 15%, Geometry and Trigonometry 15%).
 *  - "questions": a full test the teacher uploads from Excel (the Math template + a "module" column: 1, 2, 2h, 2e)
 *    with an optional raw → scaled conversion table.
 * Weekly limit: the Math plan's full mocks a week (free Math: 1); more cost the extra full mock price from the wallet.
 */
import { db, getSettings } from './db.js';
import { tierOf, moveBalance } from './tiers.js';
import { satScore, ROUTE_CUT } from './scoring.js';
import { parseConversion } from './fullmock.js';
import { sprCorrect, starter } from './math.js';
import { readMathSheet } from './mathImport.js';
import { subActive } from './auth.js';

const N = 22; const MINUTES = 35;
const MODULES = { 1: 'Module 1', 2: 'Module 2', '2h': 'Module 2 · harder', '2e': 'Module 2 · easier' };
const SHARE = [['alg', 8], ['adv', 8], ['psda', 3], ['geo', 3]];
const MIX = { 1: { easy: 0.33, medium: 0.4, hard: 0.27 }, '2h': { easy: 0.1, medium: 0.4, hard: 0.5 }, '2e': { easy: 0.45, medium: 0.45, hard: 0.1 } };
const WEEK = "date_trunc('week', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'";
const J = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const normModule = (v) => {
  const s = String(v || '').toLowerCase().replace(/\s+/g, '');
  if (/hard|qiyin|2h|upper/.test(s)) return '2h';
  if (/easy|oson|2e|lower/.test(s)) return '2e';
  if (/2/.test(s)) return '2';
  return '1';
};

export async function migrateMathMocks() {
  await db.exec(`
CREATE TABLE IF NOT EXISTS math_mocks (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'questions',
  published BOOLEAN NOT NULL DEFAULT false, minutes INTEGER NOT NULL DEFAULT 35, conversion TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS math_mock_questions (
  id SERIAL PRIMARY KEY, mock_id INTEGER NOT NULL REFERENCES math_mocks(id) ON DELETE CASCADE, module TEXT NOT NULL DEFAULT '1', position INTEGER NOT NULL DEFAULT 0,
  domain TEXT NOT NULL DEFAULT '', skill TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'medium', kind TEXT NOT NULL DEFAULT 'mcq',
  prompt TEXT NOT NULL DEFAULT '', options TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL DEFAULT '', explanation TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_mmq_mock ON math_mock_questions(mock_id, module, position);
CREATE TABLE IF NOT EXISTS math_mock_attempts (
  id SERIAL PRIMARY KEY, mock_id INTEGER NOT NULL REFERENCES math_mocks(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), stage TEXT NOT NULL DEFAULT 'm1', m2 TEXT, stage_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gen TEXT NOT NULL DEFAULT '{}', answers TEXT NOT NULL DEFAULT '{}', m1_correct INTEGER, m2_correct INTEGER, m1_total INTEGER, m2_total INTEGER,
  score INTEGER, low INTEGER, high INTEGER, route TEXT, paid BOOLEAN NOT NULL DEFAULT false, finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_mma_user ON math_mock_attempts(user_id, started_at DESC);
ALTER TABLE math_mocks ENABLE ROW LEVEL SECURITY; ALTER TABLE math_mock_questions ENABLE ROW LEVEL SECURITY; ALTER TABLE math_mock_attempts ENABLE ROW LEVEL SECURITY;`);
}

const names = () => { const m = new Map(); for (const d of starter().domains) { m.set(d.id, d.name); for (const k of d.skills) m.set(k.id, k.name); } return m; };
const pubQ = (q, nm, withKey) => ({
  id: String(q.id), domain: nm.get(q.domain) || q.domain, skill: nm.get(q.skill) || q.skill, difficulty: q.difficulty, kind: q.kind, prompt: q.prompt, options: J(q.options, []),
  ...(withKey ? { answer: q.kind === 'spr' ? J(q.answer, []) : 'ABCD'.indexOf(q.answer), explanation: q.explanation } : {}),
});
const right = (q, g) => (g == null || g === '' ? false : q.kind === 'spr' ? sprCorrect(String(g).slice(0, 20), J(q.answer, [])) : Number.isInteger(g) && 'ABCD'[g] === q.answer);

/** Pick n bank questions with the domain shares and a level mix, easier first inside each domain. */
function compose(pool, used, mix) {
  const out = [];
  for (const [dom, n] of SHARE) {
    const cand = shuffle(pool.filter((q) => q.domain === dom && !used.has(q.id)));
    const pick = [];
    for (const [lvl, share] of Object.entries(mix)) for (const q of cand.filter((x) => x.difficulty === lvl).slice(0, Math.round(n * share))) if (pick.length < n) pick.push(q);
    for (const q of cand) { if (pick.length >= n) break; if (!pick.includes(q)) pick.push(q); }
    pick.forEach((q) => used.add(q.id));
    out.push(...pick.sort((a, b) => ['easy', 'medium', 'hard'].indexOf(a.difficulty) - ['easy', 'medium', 'hard'].indexOf(b.difficulty)));
  }
  // a small bank: fill up from any domain
  for (const q of shuffle(pool.filter((x) => !used.has(x.id)))) { if (out.length >= N) break; used.add(q.id); out.push(q); }
  return out.map((q) => q.id);
}

async function setsOf(mock, a) {
  if (mock.mode === 'bank') {
    const gen = J(a?.gen, {});
    const ids = Object.values(gen).flat();
    const rows = ids.length ? await db.all('SELECT * FROM math_questions WHERE id = ANY(?::text[])', [ids]) : [];
    const by = new Map(rows.map((q) => [q.id, q]));
    return Object.fromEntries(Object.entries(gen).map(([m, list]) => [m, list.map((id) => by.get(id)).filter(Boolean)]));
  }
  const out = {};
  for (const q of await db.all('SELECT * FROM math_mock_questions WHERE mock_id = ? ORDER BY module, position, id', [mock.id])) (out[q.module] ||= []).push(q);
  return out;
}
const ready = (s) => !!s['1']?.length && !!(s['2']?.length || (s['2h']?.length && s['2e']?.length));

export async function mathMockQuota(user) {
  const s = await getSettings();
  const paid = subActive({ sub_until: user.math_sub_until });
  const t = tierOf(user, s, 'math');
  const limit = user.role === 'master' ? 999 : !paid && s.require_subscription === 'true' ? 1 : (t.fm_week || 999);
  const used = Number((await db.one(`SELECT COUNT(*) AS n FROM math_mock_attempts WHERE user_id = ? AND started_at >= ${WEEK} AND NOT paid`, [user.id])).n);
  const next = (await db.one(`SELECT (${WEEK}) + interval '7 days' AS t`)).t;
  const bal = await db.one('SELECT balance FROM users WHERE id = ?', [user.id]);
  return { limit, used, left: Math.max(0, limit - used), unlimited: limit === 999, resets_at: next, extra_price: Number(s.fm_extra_price) || 0, balance: Number(bal?.balance || 0), math_plan: paid };
}

export function registerMathMocks(app, { h, bad, requireMaster, requireStudent, upload }) {
  const bankMock = async () => {
    let m = await db.one("SELECT * FROM math_mocks WHERE mode = 'bank' ORDER BY id LIMIT 1");
    if (!m) m = await db.one("INSERT INTO math_mocks (title, note, mode, published, position) VALUES ('SAT Math full mock', 'Built for you from the Math Question Bank', 'bank', true, -1) RETURNING *");
    return m;
  };
  const state = async (a, mock) => {
    const sets = await setsOf(mock, a);
    const nm = names();
    const mod = a.stage === 'm1' ? '1' : a.stage === 'm2' ? a.m2 : null;
    const remaining = Math.max(0, Math.round((new Date(a.stage_started_at).getTime() + mock.minutes * 60e3 - Date.now()) / 1000));
    const out = { id: a.id, mock: { id: mock.id, title: mock.title, mode: mock.mode, minutes: mock.minutes }, subject: 'math', stage: a.stage, module: mod, module_label: mod ? MODULES[mod] : null,
      remaining, answers: J(a.answers, {}), route: a.route, started_at: a.started_at, finished_at: a.finished_at, questions: mod ? (sets[mod] || []).map((q) => pubQ(q, nm, false)) : [] };
    if (a.stage === 'done') {
      const ans = J(a.answers, {});
      out.result = { score: a.score, low: a.low, high: a.high, route: a.route, m1: a.m1_correct, m2: a.m2_correct, m1_total: a.m1_total, m2_total: a.m2_total };
      out.review = [['1', sets['1'] || []], [a.m2, sets[a.m2] || []]].map(([m, qs]) => ({ module: m, label: MODULES[m],
        questions: qs.map((q) => ({ ...pubQ(q, nm, true), choice: ans[String(q.id)] ?? null, correct: right(q, ans[String(q.id)]) })) }));
      const dom = {};
      for (const q of out.review.flatMap((r) => r.questions)) { const d = (dom[q.domain] ||= { domain: q.domain, correct: 0, total: 0 }); d.total++; d.correct += q.correct ? 1 : 0; }
      out.domains = Object.values(dom).map((d) => ({ ...d, pct: Math.round((d.correct / d.total) * 100) }));
    }
    return out;
  };
  async function advance(a, mock, answers) {
    const sets = await setsOf(mock, a);
    if (a.stage === 'm1') {
      const m1 = sets['1'] || [];
      const ok = m1.filter((q) => right(q, answers[String(q.id)])).length;
      const harder = m1.length && ok / m1.length >= ROUTE_CUT;
      let m2 = '2';
      if (mock.mode === 'bank') {
        m2 = harder ? '2h' : '2e';
        const gen = J(a.gen, {});
        const pool = await db.all('SELECT id, domain, difficulty FROM math_questions WHERE active');
        gen[m2] = compose(pool, new Set(gen['1'] || []), MIX[m2]);
        await db.run('UPDATE math_mock_attempts SET gen = ? WHERE id = ?', [JSON.stringify(gen), a.id]);
      } else if (sets['2h']?.length && sets['2e']?.length) m2 = harder ? '2h' : '2e';
      await db.run("UPDATE math_mock_attempts SET stage = 'm2', m2 = ?, route = ?, stage_started_at = now(), answers = ?, m1_correct = ? WHERE id = ?",
        [m2, m2 === '2' ? null : m2 === '2h' ? 'hard' : 'easy', JSON.stringify(answers), ok, a.id]);
    } else if (a.stage === 'm2') {
      const m1 = sets['1'] || []; const m2 = sets[a.m2] || [];
      const items = [...m1.map((q) => ({ q, module: 1 })), ...m2.map((q) => ({ q, module: 2 }))].map(({ q, module }) => ({ correct: right(q, answers[String(q.id)]), difficulty: q.difficulty, kind: q.kind, module: a.m2 === '2' ? undefined : module }));
      let sat = satScore(items);
      const c1 = m1.filter((q) => right(q, answers[String(q.id)])).length; const c2 = m2.filter((q) => right(q, answers[String(q.id)])).length;
      const table = J(mock.conversion, {})[a.route || 'single'];
      if (table && Object.keys(table).length) {
        const rows = Object.entries(table).map(([k, v]) => [Number(k), Number(v)]).sort((x, y) => x[0] - y[0]);
        let hit = rows[0]; for (const r of rows) if (r[0] <= c1 + c2) hit = r;
        sat = { score: hit[1], low: Math.max(200, hit[1] - 20), high: Math.min(800, hit[1] + 20) };
      }
      await db.run("UPDATE math_mock_attempts SET stage = 'done', answers = ?, m1_correct = ?, m2_correct = ?, m1_total = ?, m2_total = ?, score = ?, low = ?, high = ?, finished_at = now() WHERE id = ?",
        [JSON.stringify(answers), c1, c2, m1.length, m2.length, sat?.score ?? 200, sat?.low ?? 200, sat?.high ?? 200, a.id]);
      if (mock.mode === 'bank') {
        // answers from the bank join the student's Math history (mistakes, focus topics), first answer only
        for (const q of [...m1, ...m2]) {
          const g = answers[String(q.id)]; if (g == null || g === '') continue;
          const ok = right(q, g);
          await db.run('INSERT INTO math_answers (user_id, question_id, given, correct, first_correct) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', [a.user_id, q.id, String(g).slice(0, 20), ok, ok]).catch(() => {});
        }
      }
    }
    return db.one('SELECT * FROM math_mock_attempts WHERE id = ?', [a.id]);
  }
  const expired = async (a, mock) => {
    if (a.stage !== 'done' && Date.now() > new Date(a.stage_started_at).getTime() + mock.minutes * 60e3 + 30e3) a = await advance(a, mock, J(a.answers, {}));
    return a;
  };
  const keep = async (a, mock, body) => {
    const sets = await setsOf(mock, a);
    const mod = a.stage === 'm1' ? '1' : a.m2;
    const ids = new Set((sets[mod] || []).map((q) => String(q.id)));
    const ans = J(a.answers, {});
    for (const [k, v] of Object.entries(body?.answers || {})) {
      if (!ids.has(String(k))) continue;
      if (Number.isInteger(v) && v >= 0 && v <= 3) ans[k] = v;
      else if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) ans[k] = String(v).trim().slice(0, 12);
      else delete ans[k];
    }
    return ans;
  };
  const mine = async (req) => {
    const a = await db.one('SELECT * FROM math_mock_attempts WHERE id = ? AND user_id = ?', [Number(req.params.aid), req.user.id]);
    return a ? { a, mock: await db.one('SELECT * FROM math_mocks WHERE id = ?', [a.mock_id]) } : null;
  };

  // ---------- student ----------
  app.get('/api/math-mocks', h(async (req, res) => {
    const bank = await bankMock();
    const mocks = await db.all("SELECT id, title, note, mode, minutes FROM math_mocks WHERE published ORDER BY (mode = 'bank') DESC, position, id DESC");
    const tries = await db.all('SELECT id, mock_id, stage, score, low, high, m1_correct, m2_correct, m1_total, m2_total, finished_at FROM math_mock_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 60', [req.user.id]);
    const count = await db.one('SELECT COUNT(*) AS n FROM math_questions WHERE active');
    res.json({ quota: await mathMockQuota(req.user), bank_ready: Number(count.n) >= 2 * N, bank_id: bank.id,
      mocks: mocks.map((m) => ({ ...m, attempts: tries.filter((t) => t.mock_id === m.id) })) });
  }));
  app.post('/api/math-mocks/:id/start', requireStudent, h(async (req, res) => {
    const mock = await db.one('SELECT * FROM math_mocks WHERE id = ? AND published', [Number(req.params.id)]);
    if (!mock) return bad(res, 'Mock not found', 404);
    const open = await db.one("SELECT * FROM math_mock_attempts WHERE user_id = ? AND mock_id = ? AND stage <> 'done' ORDER BY id DESC LIMIT 1", [req.user.id, mock.id]);
    if (open) return res.json(await state(await expired(open, mock), mock));
    let gen = {};
    if (mock.mode === 'bank') {
      const pool = await db.all('SELECT id, domain, difficulty FROM math_questions WHERE active');
      if (pool.length < 2 * N) return bad(res, 'The Math Question Bank needs at least 44 questions for a full mock');
      gen = { 1: compose(pool, new Set(), MIX[1]) };
    } else if (!ready(await setsOf(mock))) return bad(res, 'This mock is not ready yet');
    const q = await mathMockQuota(req.user);
    let paid = false;
    if (q.left <= 0) {
      if (!req.body?.pay || !q.extra_price) return bad(res, `You have used ${q.limit} of ${q.limit} Math full mocks this week. Take one more for ${q.extra_price.toLocaleString('en-US').replace(/,/g, ' ')} so'm from your wallet, get a Math plan, or wait until Monday.`, 402, { code: 'full_mock_limit', quota: q });
      paid = true;
    }
    const id = await db.tx(async (t) => {
      const r = await t.one('INSERT INTO math_mock_attempts (mock_id, user_id, gen, paid) VALUES (?,?,?,?) RETURNING id', [mock.id, req.user.id, JSON.stringify(gen), paid]);
      if (paid && (await moveBalance(t, req.user.id, -q.extra_price, 'full_mock', { note: `Math · ${mock.title}`, ref: `mm:${r.id}` })) == null) throw Object.assign(new Error('Not enough money in your wallet. Top it up first.'), { status: 402 });
      return r.id;
    }).catch((e) => { if (e.status === 402) return { err: e.message }; throw e; });
    if (id?.err) return bad(res, id.err, 402, { code: 'balance_low', quota: q });
    res.json(await state(await db.one('SELECT * FROM math_mock_attempts WHERE id = ?', [id]), mock));
  }));
  app.get('/api/math-mocks/attempt/:aid', h(async (req, res) => {
    const x = await mine(req); if (!x) return bad(res, 'Not found', 404);
    res.json(await state(await expired(x.a, x.mock), x.mock));
  }));
  app.put('/api/math-mocks/attempt/:aid', h(async (req, res) => {
    const x = await mine(req); if (!x) return bad(res, 'Not found', 404);
    if (x.a.stage === 'done') return res.json({ ok: true });
    await db.run('UPDATE math_mock_attempts SET answers = ? WHERE id = ?', [JSON.stringify(await keep(x.a, x.mock, req.body)), x.a.id]);
    res.json({ ok: true });
  }));
  app.post('/api/math-mocks/attempt/:aid/next', h(async (req, res) => {
    const x = await mine(req); if (!x) return bad(res, 'Not found', 404);
    if (x.a.stage === 'done') return res.json(await state(x.a, x.mock));
    res.json(await state(await advance(x.a, x.mock, await keep(x.a, x.mock, req.body)), x.mock));
  }));

  // ---------- teacher ----------
  app.get('/api/math-mocks/admin', requireMaster, h(async (req, res) => {
    await bankMock();
    const rows = await db.all('SELECT * FROM math_mocks ORDER BY (mode = \'bank\') DESC, position, id DESC');
    const out = [];
    for (const m of rows) {
      const counts = await db.all('SELECT module, COUNT(*) AS n FROM math_mock_questions WHERE mock_id = ? GROUP BY module', [m.id]);
      const st = await db.one("SELECT COUNT(*) AS n, AVG(score) AS avg FROM math_mock_attempts WHERE mock_id = ? AND stage = 'done'", [m.id]);
      const modules = Object.fromEntries(counts.map((c) => [c.module, Number(c.n)]));
      out.push({ ...m, conversion: J(m.conversion, {}), modules, ready: m.mode === 'bank' || (!!modules['1'] && !!(modules['2'] || (modules['2h'] && modules['2e']))), taken: Number(st.n), avg: st.avg == null ? null : Math.round(st.avg / 10) * 10 });
    }
    const bank = Number((await db.one('SELECT COUNT(*) AS n FROM math_questions WHERE active')).n);
    res.json({ mocks: out, bank_questions: bank, bank_needed: 2 * N });
  }));
  app.post('/api/math-mocks/admin', requireMaster, h(async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    if (!title) return bad(res, 'Write a title');
    const m = await db.one('INSERT INTO math_mocks (title, note) VALUES (?, ?) RETURNING id', [title, String(req.body?.note || '').slice(0, 300)]);
    res.json({ id: m.id });
  }));
  app.put('/api/math-mocks/admin/:id', requireMaster, h(async (req, res) => {
    const m = await db.one('SELECT * FROM math_mocks WHERE id = ?', [Number(req.params.id)]);
    if (!m) return bad(res, 'Not found', 404);
    const b = req.body || {};
    const conv = J(m.conversion, {});
    if (b.conversion) for (const k of ['hard', 'easy', 'single']) if (b.conversion[k] != null) { const t = typeof b.conversion[k] === 'string' ? parseConversion(b.conversion[k]) : b.conversion[k]; conv[k] = t; }
    if (b.published && m.mode !== 'bank') {
      const sets = await setsOf(m);
      if (!ready(sets)) return bad(res, 'Add Module 1 and Module 2 (or both harder and easier Module 2) before publishing');
    }
    await db.run('UPDATE math_mocks SET title = ?, note = ?, minutes = ?, published = ?, conversion = ? WHERE id = ?', [
      String(b.title ?? m.title).slice(0, 120) || m.title, String(b.note ?? m.note).slice(0, 300), Math.max(5, Math.min(120, Number(b.minutes ?? m.minutes) || MINUTES)),
      'published' in b ? !!b.published : m.published, JSON.stringify(conv), m.id]);
    res.json({ ok: true });
  }));
  app.delete('/api/math-mocks/admin/:id', requireMaster, h(async (req, res) => {
    await db.run("DELETE FROM math_mocks WHERE id = ? AND mode <> 'bank'", [Number(req.params.id)]);
    res.json({ ok: true });
  }));
  // questions from Excel: the Math Question Bank template + a "module" column (1, 2, 2h = harder, 2e = easier)
  app.post('/api/math-mocks/admin/:id/import', requireMaster, upload.single('file'), h(async (req, res) => {
    const m = await db.one("SELECT * FROM math_mocks WHERE id = ? AND mode = 'questions'", [Number(req.params.id)]);
    if (!m) return bad(res, 'Not found', 404);
    if (!req.file?.buffer?.length) return bad(res, 'Choose an Excel or CSV file');
    let r;
    try { r = readMathSheet(req.file.buffer, { withModule: true }); } catch { return bad(res, 'The file could not be read. Use the template (Excel or CSV).'); }
    if (!r.ok.length) return bad(res, r.problems.length ? `Nothing was added: ${r.problems.slice(0, 3).join('; ')}` : 'The file has no questions');
    const replace = req.body?.replace === 'true' || req.body?.replace === true;
    const { xlsxImages, storeImages, isZip } = await import('./xlsxImages.js');
    const pics = isZip(req.file.buffer) ? xlsxImages(req.file.buffer) : new Map();
    for (const q of r.ok) if (pics.has(q.row)) { const img = await storeImages(pics.get(q.row), req.user.id); if (img) q.prompt = `${q.prompt}\n\n${img}`; }
    await db.tx(async (t) => {
      if (replace) await t.run('DELETE FROM math_mock_questions WHERE mock_id = ?', [m.id]);
      const pos = {};
      for (const q of r.ok) {
        const mod = normModule(q.module);
        pos[mod] = (pos[mod] ?? Number((await t.one('SELECT COALESCE(MAX(position), 0) AS p FROM math_mock_questions WHERE mock_id = ? AND module = ?', [m.id, mod])).p)) + 1;
        await t.run('INSERT INTO math_mock_questions (mock_id, module, position, domain, skill, difficulty, kind, prompt, options, answer, explanation) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [m.id, mod, pos[mod], q.domain, q.skill, q.difficulty, q.kind, q.prompt, q.options, q.answer, q.explanation]);
      }
    });
    const counts = await db.all('SELECT module, COUNT(*) AS n FROM math_mock_questions WHERE mock_id = ? GROUP BY module', [m.id]);
    res.json({ added: r.ok.length, problems: r.problems.slice(0, 30), problem_count: r.problems.length, modules: Object.fromEntries(counts.map((c) => [c.module, Number(c.n)])) });
  }));
  app.get('/api/math-mocks/admin/template.xlsx', requireMaster, h(async (req, res) => {
    const { mathTemplate } = await import('./mathImport.js');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="math-full-mock-template.xlsx"');
    res.send(mathTemplate({ withModule: true }));
  }));
  app.get('/api/math-mocks/admin/:id/results', requireMaster, h(async (req, res) => {
    res.json(await db.all(`SELECT a.id, a.score, a.m1_correct, a.m2_correct, a.m1_total, a.m2_total, a.route, a.finished_at, u.id AS user_id, u.name
      FROM math_mock_attempts a JOIN users u ON u.id = a.user_id WHERE a.mock_id = ? AND a.stage = 'done' ORDER BY a.finished_at DESC LIMIT 200`, [Number(req.params.id)]));
  }));
}
