/**
 * Security regression tests: starts the API on a throw-away local database and attacks it.
 * Run:  npm run test:security --prefix server
 *
 * Checks: every protected endpoint refuses guests (401) and every teacher endpoint refuses students (403);
 * forged / tampered tokens are refused; a student cannot make himself a teacher; IDs of other people's data give 404;
 * spoofed X-Forwarded-For cannot dodge the sign-in limiter; default passwords do not work on the public host;
 * sign-in errors do not reveal which accounts exist; no password hashes or keys come back in API responses.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const PORT = 4300 + Math.floor(Math.random() * 500);
const B = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ustoz-sec-'));
let failed = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const env = { ...process.env, PORT: String(PORT), DATA_DIR: DATA };
delete env.DATABASE_URL; delete env.POSTGRES_URL; delete env.VERCEL; delete env.NODE_ENV; delete env.JWT_SECRET;
const srv = spawn(process.execPath, ['--no-warnings', path.join(SRC, 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
const stop = (code) => { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(code); };

const req = (method, p, { token, body, headers = {} } = {}) => new Promise((resolve) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request(`${B}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* not json */ } resolve({ status: res.statusCode, text: t, json: j }); });
  });
  r.on('error', () => resolve({ status: 0, text: '', json: null }));
  if (data) r.write(data); r.end();
});
const login = async (l, p, headers) => (await req('POST', '/api/auth/login', { body: { login: l, password: p }, headers })).json?.token;

// ---- wait for the server
for (let i = 0; i < 120; i++) { if ((await req('GET', '/api/config')).status === 200) break; await new Promise((r) => setTimeout(r, 500)); }
if ((await req('GET', '/api/config')).status !== 200) { console.error('server did not start\n', log.slice(-2000)); stop(1); }

const S = await login('shukurullo', 'student123');
const M = await login('master', 'master123');
ok(!!S && !!M, 'local demo accounts sign in on localhost');

// ---- route map from the source
const routes = [];
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
  for (const line of fs.readFileSync(path.join(SRC, f), 'utf8').split('\n')) {
    const m = line.match(/app\.(get|post|put|delete|patch)\(\s*'(\/api\/[^']+)'(.*)/);
    if (m) routes.push({ f, method: m[1].toUpperCase(), path: m[2], master: /requireMaster/.test(m[3]) });
  }
}
const fill = (p) => p.replace(/:(\w+)/g, (_, k) => (k === 'code' ? '123456' : '1'));
const PUBLIC = /^\/api\/(public|game|auth|config|avatars|visit|telegram\/webhook|cron|chat|plans|sat-dates|template)(\/|$)/;

// ---- 1. guests are refused everywhere that is not public
const anonOpen = [];
for (const r of routes.filter((x) => !PUBLIC.test(x.path))) { const { status } = await req(r.method, fill(r.path), { body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} }); if (status > 0 && status < 400) anonOpen.push(`${status} ${r.method} ${r.path}`); }
ok(!anonOpen.length, `guests refused on ${routes.filter((x) => !PUBLIC.test(x.path)).length} protected endpoints`, anonOpen.slice(0, 5).join('; '));

// ---- 2. students are refused on every teacher endpoint
const stOpen = [];
for (const r of routes.filter((x) => x.master)) { const { status } = await req(r.method, fill(r.path), { token: S, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} }); if (status !== 403) stOpen.push(`${status} ${r.method} ${r.path}`); }
ok(!stOpen.length, `students refused (403) on ${routes.filter((x) => x.master).length} teacher endpoints`, stOpen.slice(0, 5).join('; '));

// ---- 3. forged and tampered tokens
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 1, role: 'master', v: 0 })}.`;
ok((await req('GET', '/api/me', { token: none })).status === 401, 'token with alg "none" is refused');
const [h, , sig] = S.split('.');
const tampered = `${h}.${b64({ id: 1, role: 'master', v: 0, iat: Math.floor(Date.now() / 1000) })}.${sig}`;
ok((await req('GET', '/api/students', { token: tampered })).status === 401, 'token with an edited payload (role: master) is refused');
ok((await req('GET', '/api/me', { token: 'garbage' })).status === 401, 'malformed token is refused');

// ---- 4. mass assignment: a student cannot change his own role or subscription
await req('PUT', '/api/me', { token: S, body: { role: 'master', admin_perms: null, sub_until: '2099-01-01', balance: 999999 } });
const me = (await req('GET', '/api/me', { token: S })).json;
ok(me?.role === 'student', 'PUT /api/me ignores role / subscription fields');
ok((await req('GET', '/api/students', { token: S })).status === 403, 'student still has no teacher access after trying');

// ---- 5. IDOR: other people's records by ID
const other = await req('POST', '/api/auth/register', { body: { name: 'Test Other', email: `other${PORT}@example.com`, password: 'Zx9!long-pass', accept_terms: true } });
const O = other.json?.token;
let idor = [];
for (const p of ['/api/attempts/1/result', '/api/qbank/mock/1', '/api/full-mocks/attempt/1', '/api/students/1', '/api/students/2']) {
  const r = await req('GET', p, { token: O });
  if (r.status === 200) idor.push(p);
}
ok(!idor.length, 'another student gets nothing by changing IDs', idor.join(', '));

// ---- 6. responses carry no secrets
const leakRe = /"(password_hash|token_version|_jwt_secret|bunny_api_key|bunny_token_key|giphy_key|_tg_token|_tg_pay_token|host_token)"\s*:\s*"[^"•]{4,}/i;
const leaks = [];
for (const [who, t] of [['student', S], ['teacher', M]]) for (const p of ['/api/me', '/api/students', '/api/settings', '/api/leaderboard', '/api/admins', '/api/config']) {
  const r = await req('GET', p, { token: t }); if (leakRe.test(r.text)) leaks.push(`${who} ${p}`);
}
ok(!leaks.length, 'no password hashes or secret keys in API responses', leaks.join(', '));

// ---- 6b. session cookie: HttpOnly, and a cookie-only request that changes something needs the app's X-SU header
const lr = await new Promise((resolve) => { const r = http.request(`${B}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.headers['set-cookie'] || [])); }); r.write(JSON.stringify({ login: 'shukurullo', password: 'student123' })); r.end(); });
const ck = (lr.find((c) => c.startsWith('su_sess=')) || '').split(';')[0];
ok(/HttpOnly/i.test(lr.join(';')) && /SameSite=Lax/i.test(lr.join(';')), 'session cookie is HttpOnly and SameSite');
ok((await req('GET', '/api/me', { headers: { cookie: ck } })).status === 200, 'session cookie signs in');
ok((await req('PUT', '/api/me', { body: { name: 'X Y' }, headers: { cookie: ck } })).status === 403, 'cookie request without X-SU is refused (CSRF)');
// ---- 6c. staff admins can't reach a section by changing the letter case or %-encoding the path
const MT = await login('master', 'master123');
const adm = (await req('POST', '/api/admins', { token: MT, body: { name: 'Sec Test', login: 'sectest', perms: ['content'], password: 'Sec-test-pass-91!' } })).json;
const AT = await login(adm?.login || 'sectest', 'Sec-test-pass-91!');
const codes = await Promise.all(['/api/finance', '/api/FINANCE', '/api/%66inance'].map(async (p) => (await req('GET', p, { token: AT })).status));
ok(codes.every((c) => c === 403), 'staff section check ignores case and %-encoding', codes.join(','));

// ---- 7. sign-in errors do not reveal which accounts exist
const e1 = (await req('POST', '/api/auth/login', { body: { login: 'no-such-user-xyz', password: 'Wrong-pass-1' } })).json?.error;
const e2 = (await req('POST', '/api/auth/login', { body: { login: 'shukurullo', password: 'Wrong-pass-1' } })).json?.error;
ok(e1 && e1 === e2, 'same error for unknown login and wrong password');

// ---- 8. default passwords are refused on the public host
const pub = await req('POST', '/api/auth/login', { body: { login: 'master', password: 'master123' }, headers: { host: 'www.ustozsat.uz' } });
ok(pub.status === 403 && pub.json?.code === 'default_password', 'default teacher password refused on the public site', `status ${pub.status}`);

// ---- 9. spoofed X-Forwarded-For does not reset the sign-in limiter
let limited = false;
for (let i = 0; i < 45; i++) {
  const r = await req('POST', '/api/auth/login', { body: { login: `nobody${i}`, password: 'x' }, headers: { 'x-forwarded-for': `10.0.${i}.1, 203.0.113.7` } });
  if (r.status === 429) { limited = true; break; }
}
ok(limited, 'sign-in rate limit holds when X-Forwarded-For is spoofed');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll security checks passed');
stop(failed ? 1 : 0);
