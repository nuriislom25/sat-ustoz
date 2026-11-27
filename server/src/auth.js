import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_KIND, db } from './db.js';

let SECRET = process.env.JWT_SECRET || null;
/**
 * Signing secret for sessions: JWT_SECRET, else one generated once and kept in the database
 * (Postgres: shared by every server instance, e.g. on Vercel) or in DATA_DIR (local PGlite).
 */
export async function initSecret() {
  if (SECRET) return;
  if (DB_KIND === 'postgres') {
    await db.run("INSERT INTO settings (key, value) VALUES ('_jwt_secret', ?) ON CONFLICT (key) DO NOTHING", [crypto.randomBytes(48).toString('hex')]);
    SECRET = (await db.one("SELECT value FROM settings WHERE key = '_jwt_secret'")).value;
    return;
  }
  const f = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(f)) { SECRET = fs.readFileSync(f, 'utf8'); return; }
  SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, SECRET, { mode: 0o600 });
}

export const getSecret = () => SECRET;

export const signToken = (user) => jwt.sign({ id: user.id, role: user.role, v: Number(user.token_version || 0) }, SECRET, { expiresIn: user.role === 'master' ? '14d' : '30d', algorithm: 'HS256' });

/**
 * Sessions live in an HttpOnly cookie (JavaScript on the page can't read it, so a script injected into a page can't
 * steal it). A Bearer header still works (older app tabs, tests). A request signed in by the cookie that changes
 * something must also carry the X-SU header: other websites can't add it, so they can't act for a signed-in student.
 */
export const COOKIE = 'su_sess';
const cookieOf = (req, name) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return null;
};
/** { token, via: 'header' | 'cookie' } or null */
export function sessionToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && h.length > 20) return { token: h.slice(7), via: 'header' };
  const c = cookieOf(req, COOKIE);
  return c ? { token: c, via: 'cookie' } : null;
}
export const verifyToken = (t) => { try { return jwt.verify(t, SECRET, { algorithms: ['HS256'] }); } catch { return null; } };
/** The signed-in user's token payload, if any (no database check). */
export const tokenPayload = (req) => { const s = sessionToken(req); return s ? verifyToken(s.token) : null; };
const secure = () => process.env.NODE_ENV === 'production' || /^https:/.test(process.env.SITE_URL || '');
const cookieLine = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`;
/** Start a session: the cookie is set and the token is returned (older clients still read it). */
export function startSession(res, user) {
  const token = signToken(user);
  res.append('Set-Cookie', cookieLine(token, (user.role === 'master' ? 14 : 30) * 86400));
  return token;
}
export const endSession = (res) => res.append('Set-Cookie', cookieLine('', 0));

export const subActive = (u) => !!(u?.sub_until && new Date(u.sub_until) > new Date());

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, token_version, ...rest } = u;
  return { ...rest, has_password: !!password_hash, sub_active: subActive(u) };
}

/** Who sent this request, if anyone (no database check: only for counting visits). */
export async function userFrom(req) {
  const p = tokenPayload(req);
  return p ? { id: p.id, role: p.role } : null;
}

export async function requireAuth(req, res, next) {
  const sess = sessionToken(req);
  const token = sess?.token;
  if (!token) return res.status(401).json({ error: 'Please sign in' });
  if (sess.via === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-su'] !== '1') {
    return res.status(403).json({ error: 'This request did not come from the SAT Ustoz app. Reload the page and try again.' });
  }
  let p;
  try {
    p = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }
  try {
    const user = await db.one('SELECT * FROM users WHERE id = ?', [p.id]);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    // sessions end everywhere when the password changes or "Sign out everywhere" is used
    if (Number(p.v || 0) !== Number(user.token_version || 0)) return res.status(401).json({ error: 'Session expired — please sign in again' });
    if (p.role !== user.role) return res.status(401).json({ error: 'Session expired — please sign in again' });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireMaster = (req, res, next) =>
  req.user?.role === 'master' ? next() : res.status(403).json({ error: 'Teachers only' });

export const requireStudent = (req, res, next) =>
  req.user?.role === 'student' ? next() : res.status(403).json({ error: 'Students only' });

/**
 * “Sign in with Google” (Google Identity Services): the browser gets an ID token (JWT) from Google.
 * We verify its signature against Google's public keys, the audience (our client ID) and the issuer.
 * Only the public GOOGLE_CLIENT_ID is needed — no client secret.
 */
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export async function verifyGoogleCredential(credential, fromSettings = '') {
  const clientId = process.env.GOOGLE_CLIENT_ID || fromSettings;
  if (!clientId) throw Object.assign(new Error('Google sign-in is not configured on this server'), { status: 400 });
  let payload;
  try {
    ({ payload } = await jwtVerify(String(credential || ''), GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: [clientId, ...(process.env.GOOGLE_IOS_CLIENT_ID || '760000458169-chnecgm04b4631332r81mcv900uutbn6.apps.googleusercontent.com').split(',').map((s) => s.trim()).filter(Boolean)], // + the iOS app's Google client
    }));
  } catch (e) {
    const offline = /fetch|ENOTFOUND|ECONN|network/i.test(String(e?.message) + String(e?.cause?.code || ''));
    throw Object.assign(new Error(offline ? 'Could not reach Google — check your internet connection' : 'Google sign-in failed — please try again'), { status: offline ? 502 : 401 });
  }
  if (!payload.email || payload.email_verified === false) throw Object.assign(new Error('Your Google email is not verified'), { status: 400 });
  return { id: payload.sub, email: String(payload.email).toLowerCase(), name: payload.name || payload.email.split('@')[0], avatar: payload.picture || '' };
}
