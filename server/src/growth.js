/**
 * Growth: promo codes, "invite a friend" referrals and the "top 3 topics to raise your score" block.
 *
 * Promo codes (teacher → Finance → Promo codes): a percent off a plan bought from the wallet, with an optional
 * limit of uses, an end date and the plans / subject it works for. Each student can use a code once; the use is
 * written in the same transaction as the purchase, so a code can never be used more times than allowed.
 *
 * Referrals: every student has a personal link (?ref=CODE). A friend who opens it and signs up is linked within
 * 7 days of creating the account. When that friend pays for a plan for the first time (real money: the wallet is only
 * filled by the teacher after a receipt), the inviter gets settings.ref_bonus and the friend settings.ref_friend_bonus
 * on their wallets — once per friend (ledger refs ref:<id> / ref-friend:<id>).
 */
import crypto from 'node:crypto';
import { db, getSettings } from './db.js';
import { moveBalance } from './tiers.js';
import { DOMAINS } from './qbank.js';
import { starter } from './math.js';

const int = (v, d, max = 1e7) => (Number.isFinite(+v) && String(v).trim() !== '' ? Math.max(0, Math.min(max, Math.round(+v))) : d);
export const refBonus = (s) => int(s.ref_bonus, 20000);
export const refFriendBonus = (s) => int(s.ref_friend_bonus, 10000);
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);

export async function migrateGrowth() {
  await db.exec(`
CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY, pct INTEGER NOT NULL CHECK (pct BETWEEN 1 AND 90), max_uses INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0,
  plans TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT 'any', expires_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT true,
  note TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS promo_uses (
  id SERIAL PRIMARY KEY, code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, user_id));
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY; ALTER TABLE promo_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code) WHERE ref_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by) WHERE referred_by IS NOT NULL;`);
}

/* ---------- promo codes ---------- */
const planList = (p) => String(p || '').split(',').map((x) => x.trim()).filter(Boolean);
const pubPromo = (p) => ({ code: p.code, pct: p.pct, max_uses: p.max_uses, used: p.used, plans: planList(p.plans), subject: p.subject, expires_at: p.expires_at, active: p.active, note: p.note, created_at: p.created_at });

/** Is this code good for this purchase? Returns the promo row, or throws a message the student can read. */
export async function checkPromo(t, code, userId, { plan, subject }) {
  const c = cleanCode(code);
  if (!c) return null;
  const p = await t.one('SELECT * FROM promo_codes WHERE code = ?', [c]);
  const no = (m) => { throw Object.assign(new Error(m), { status: 400, code: 'promo' }); };
  if (!p || !p.active) no('This promo code does not exist or is turned off');
  if (p.expires_at && new Date(p.expires_at) < new Date()) no('This promo code has expired');
  if (p.max_uses && p.used >= p.max_uses) no('This promo code has been used up');
  const plans = planList(p.plans);
  if (plans.length && !plans.includes(plan)) no('This promo code is not for this plan');
  if (p.subject !== 'any' && p.subject !== subject) no(`This promo code is only for ${p.subject === 'math' ? 'Math' : 'English'}`);
  if (await t.one('SELECT 1 AS x FROM promo_uses WHERE code = ? AND user_id = ?', [c, userId])) no('You have already used this promo code');
  return p;
}
/** Write the use (inside the purchase transaction). Fails when the last use was taken a moment ago. */
export async function usePromo(t, p, userId, { plan, price, discount }) {
  const r = await t.one('UPDATE promo_codes SET used = used + 1 WHERE code = ? AND active AND (max_uses = 0 OR used < max_uses) RETURNING used', [p.code]);
  if (!r) throw Object.assign(new Error('This promo code has just been used up'), { status: 409 });
  await t.run('INSERT INTO promo_uses (code, user_id, plan, price, discount) VALUES (?,?,?,?,?)', [p.code, userId, plan, price, discount]);
}

/* ---------- referrals ---------- */
const newRef = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 7; i++) s += A[crypto.randomInt(A.length)]; return s; };
export async function refCodeOf(userId) {
  const u = await db.one('SELECT ref_code FROM users WHERE id = ?', [userId]);
  if (u?.ref_code) return u.ref_code;
  for (let i = 0; i < 6; i++) {
    try { await db.run('UPDATE users SET ref_code = ? WHERE id = ? AND ref_code IS NULL', [newRef(), userId]); } catch { /* taken: try again */ }
    const r = await db.one('SELECT ref_code FROM users WHERE id = ?', [userId]);
    if (r?.ref_code) return r.ref_code;
  }
  return '';
}

/** After the friend's first paid plan (called inside the purchase transaction). */
export async function rewardReferral(t, userId, paid) {
  if (!(paid > 0)) return;
  const u = await t.one('SELECT id, name, referred_by FROM users WHERE id = ?', [userId]);
  if (!u?.referred_by) return;
  const s = await getSettings();
  const a = refBonus(s); const b = refFriendBonus(s);
  if (a) await moveBalance(t, u.referred_by, a, 'referral', { note: `Friend ${String(u.name || '').split(' ')[0]} joined with your link`, ref: `ref:${u.id}` });
  if (b) await moveBalance(t, u.id, b, 'referral', { note: 'Welcome bonus: you joined with a friend\'s link', ref: `ref-friend:${u.id}` });
  import('./tgbot.js').then((m) => m.notifyUser(u.referred_by, `🎁 Do'stingiz SAT Ustoz obunasini oldi — hamyoningizga <b>${a.toLocaleString('en-US').replace(/,/g, ' ')} so'm</b> qo'shildi. Rahmat!`)).catch(() => {});
}

/* ---------- top 3 topics to raise the score ---------- */
// the share of each domain on the real test, and how many questions a section has (2 modules)
const EN_SHARE = { 'Craft and Structure': 0.28, 'Information and Ideas': 0.26, 'Standard English Conventions': 0.26, 'Expression of Ideas': 0.2 };
const MATH_SHARE = { alg: 0.35, adv: 0.35, psda: 0.15, geo: 0.15 };
const POINTS_PER_Q = { english: 600 / 54, math: 600 / 44 };

export async function focusTopics(userId) {
  const en = await db.all(`SELECT q.skill_id AS id, COUNT(*) AS n, SUM(CASE WHEN a.first_correct THEN 1 ELSE 0 END) AS ok
    FROM qbank_answers a JOIN qbank_questions q ON q.id = a.question_id WHERE a.user_id = ? GROUP BY q.skill_id`, [userId]);
  const mt = await db.all(`SELECT q.skill AS id, q.domain, COUNT(*) AS n, SUM(CASE WHEN a.first_correct THEN 1 ELSE 0 END) AS ok
    FROM math_answers a JOIN math_questions q ON q.id = a.question_id WHERE a.user_id = ? GROUP BY q.skill, q.domain`, [userId]).catch(() => []);
  const out = [];
  for (const d of DOMAINS) {
    for (const [id, name] of d.skills) {
      const r = en.find((x) => x.id === id);
      if (!r || Number(r.n) < 3) continue;
      const acc = Number(r.ok) / Number(r.n);
      const qs = 54 * (EN_SHARE[d.domain] || 0.25) / d.skills.length;
      out.push({ subject: 'english', id, name, domain: d.domain, answered: Number(r.n), correct: Number(r.ok), pct: Math.round(acc * 100), gain: Math.round(qs * Math.max(0, 0.9 - acc) * POINTS_PER_Q.english), to: `/question-bank/practice?skill=${id}&status=all&limit=10&difficulty=easy,medium,hard` });
    }
  }
  for (const d of starter().domains) {
    for (const k of d.skills) {
      const r = mt.find((x) => x.id === k.id);
      if (!r || Number(r.n) < 3) continue;
      const acc = Number(r.ok) / Number(r.n);
      const qs = 44 * (MATH_SHARE[d.id] || 0.25) / d.skills.length;
      out.push({ subject: 'math', id: k.id, name: k.name, domain: d.name, answered: Number(r.n), correct: Number(r.ok), pct: Math.round(acc * 100), gain: Math.round(qs * Math.max(0, 0.9 - acc) * POINTS_PER_Q.math), to: `/math/practice?skill=${k.id}&status=all&limit=10&difficulty=easy,medium,hard` });
    }
  }
  return out.filter((x) => x.gain > 0 && x.pct < 85).sort((a, b) => b.gain - a.gain).slice(0, 3);
}

export function registerGrowth(app, { h, bad, requireMaster, requireStudent }) {
  // ---- teacher: promo codes ----
  app.get('/api/promos', requireMaster, h(async (req, res) => {
    const rows = await db.all('SELECT * FROM promo_codes ORDER BY active DESC, created_at DESC LIMIT 200');
    const sums = await db.all('SELECT code, COUNT(*) AS n, COALESCE(SUM(price), 0) AS paid, COALESCE(SUM(discount), 0) AS off FROM promo_uses GROUP BY code');
    const by = new Map(sums.map((x) => [x.code, x]));
    res.json({ promos: rows.map((p) => ({ ...pubPromo(p), revenue: Number(by.get(p.code)?.paid || 0), discount_total: Number(by.get(p.code)?.off || 0) })) });
  }));
  app.post('/api/promos', requireMaster, h(async (req, res) => {
    const b = req.body || {};
    const code = cleanCode(b.code) || newRef();
    if (code.length < 3) return bad(res, 'The code needs at least 3 letters or digits');
    const pct = int(b.pct, 0, 90);
    if (pct < 1) return bad(res, 'The discount is 1–90%');
    if (await db.one('SELECT 1 AS x FROM promo_codes WHERE code = ?', [code])) return bad(res, 'This code already exists', 409);
    const exp = b.expires_at ? new Date(b.expires_at) : null;
    const plans = (Array.isArray(b.plans) ? b.plans : []).filter((x) => ['t1', 't2', 't3'].includes(x)).join(',');
    const subject = ['english', 'math'].includes(b.subject) ? b.subject : 'any';
    await db.run('INSERT INTO promo_codes (code, pct, max_uses, plans, subject, expires_at, note, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [code, pct, int(b.max_uses, 0, 100000), plans, subject, exp && !Number.isNaN(exp.getTime()) ? exp.toISOString() : null, String(b.note || '').slice(0, 120), req.user.id]);
    const { audit } = await import('./security.js');
    await audit(req, 'promo_created', code, `${pct}%`);
    res.json(pubPromo(await db.one('SELECT * FROM promo_codes WHERE code = ?', [code])));
  }));
  app.put('/api/promos/:code', requireMaster, h(async (req, res) => {
    const p = await db.one('SELECT * FROM promo_codes WHERE code = ?', [cleanCode(req.params.code)]);
    if (!p) return bad(res, 'Not found', 404);
    const b = req.body || {};
    await db.run('UPDATE promo_codes SET active = ?, max_uses = ?, note = ? WHERE code = ?',
      ['active' in b ? !!b.active : p.active, 'max_uses' in b ? int(b.max_uses, p.max_uses, 100000) : p.max_uses, 'note' in b ? String(b.note || '').slice(0, 120) : p.note, p.code]);
    res.json(pubPromo(await db.one('SELECT * FROM promo_codes WHERE code = ?', [p.code])));
  }));

  // ---- student: preview a code before paying ----
  app.post('/api/promo/check', requireStudent, h(async (req, res) => {
    const { readTiers, bundlePct, subjectOf, asSubject } = await import('./tiers.js');
    const { subActive } = await import('./auth.js');
    const s = await getSettings();
    const tier = readTiers(s).find((t) => t.id === req.body?.plan);
    if (!tier || tier.live) return bad(res, 'Choose a plan');
    const which = req.body?.subject === 'both' ? ['english', 'math'] : [subjectOf(req.body?.subject)];
    const months = [1, 3, 6, 12].includes(Number(req.body?.months)) ? Number(req.body.months) : 1;
    let p;
    try { p = await checkPromo(db, req.body?.code, req.user.id, { plan: tier.id, subject: which.length === 2 ? 'any' : which[0] }); } catch (e) { return bad(res, e.message); }
    if (!p) return bad(res, 'Enter a promo code');
    const u = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const other = which.length === 1 && subActive(asSubject(u, which[0] === 'math' ? 'english' : 'math'));
    const bundle = which.length === 2 || other ? bundlePct(s) : 0;
    const base = which.reduce((sum, w) => sum + (w === 'math' ? tier.math_price || tier.price : tier.price), 0) * months;
    const before = Math.round((base * (100 - bundle)) / 100);
    const price = Math.round((before * (100 - p.pct)) / 100);
    res.json({ code: p.code, pct: p.pct, before, price, saved: before - price });
  }));

  // ---- student: my invite link ----
  app.get('/api/me/referral', requireStudent, h(async (req, res) => {
    const s = await getSettings();
    const code = await refCodeOf(req.user.id);
    const friends = await db.all('SELECT id, name, created_at FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    const paid = new Set((await db.all("SELECT ref FROM balance_ledger WHERE user_id = ? AND reason = 'referral' AND ref LIKE 'ref:%'", [req.user.id])).map((r) => Number(r.ref.slice(4))));
    const earned = Number((await db.one("SELECT COALESCE(SUM(amount), 0) AS s FROM balance_ledger WHERE user_id = ? AND reason = 'referral' AND ref LIKE 'ref:%'", [req.user.id])).s);
    const site = process.env.SITE_URL || 'https://www.ustozsat.uz';
    res.json({ code, link: `${site}/?ref=${code}`, bonus: refBonus(s), friend_bonus: refFriendBonus(s), earned,
      friends: friends.map((f) => ({ name: String(f.name || '').split(' ')[0], joined: f.created_at, rewarded: paid.has(f.id) })) });
  }));
  // a new student links the friend who invited them (any sign-up method: the link is kept in the browser until then)
  app.post('/api/me/referral/claim', requireStudent, h(async (req, res) => {
    const code = cleanCode(req.body?.code);
    const me = await db.one('SELECT id, created_at, referred_by FROM users WHERE id = ?', [req.user.id]);
    if (!code || me.referred_by) return res.json({ ok: false });
    if (Date.now() - new Date(me.created_at).getTime() > 7 * 86400e3) return res.json({ ok: false, reason: 'old_account' });
    if (await db.one("SELECT 1 AS x FROM payments WHERE user_id = ? AND amount > 0 LIMIT 1", [me.id])) return res.json({ ok: false, reason: 'already_paid' });
    const inviter = await db.one("SELECT id FROM users WHERE ref_code = ? AND role = 'student'", [code]);
    if (!inviter || inviter.id === me.id) return res.json({ ok: false });
    await db.run('UPDATE users SET referred_by = ?, referred_at = now() WHERE id = ? AND referred_by IS NULL', [inviter.id, me.id]);
    res.json({ ok: true });
  }));
  app.get('/api/referrals', requireMaster, h(async (req, res) => {
    const rows = await db.all(`SELECT f.id, f.name, f.created_at, i.id AS inviter_id, i.name AS inviter,
        EXISTS (SELECT 1 FROM balance_ledger l WHERE l.ref = 'ref:' || f.id) AS rewarded
      FROM users f JOIN users i ON i.id = f.referred_by ORDER BY f.created_at DESC LIMIT 200`);
    res.json({ rows });
  }));

  // ---- student: the three topics that would raise the score most ----
  app.get('/api/me/focus', requireStudent, h(async (req, res) => res.json({ topics: await focusTopics(req.user.id) })));
}
