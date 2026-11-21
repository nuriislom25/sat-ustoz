/**
 * Pictures inside questions (graphs, charts, figures, diagrams).
 *
 * A teacher uploads a picture (or pastes it into the editor); it is stored in the database and placed in the question
 * text as  ![caption](/api/qimg/<id>)  — every place that shows question text (tests, results, mistakes, previews)
 * draws it from there. Pictures are public by link (students and guests taking a test need them); the id is random.
 */
import crypto from 'node:crypto';
import { db } from './db.js';

export async function migrateQuestionImages() {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS question_images (
    id TEXT PRIMARY KEY, data BYTEA NOT NULL, type TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER, height INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ALTER TABLE question_images ENABLE ROW LEVEL SECURITY;`);
}

const MAX = 5 * 1024 * 1024;
/** The file's real type from its first bytes (the browser's claim is not trusted; SVG and HTML are refused). */
function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Public: the picture itself (cached for a year — a picture never changes under its id). */
export function registerQuestionImagesPublic(app, { h }) {
  app.get('/api/qimg/:id', h(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) return res.status(404).end();
    const r = await db.one('SELECT data, type FROM question_images WHERE id = ?', [id]);
    if (!r) return res.status(404).end();
    res.set({ 'Content-Type': r.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.send(Buffer.from(r.data));
  }));
}

/** Teacher: upload a picture → { id, url }. */
export function registerQuestionImages(app, { h, bad, requireMaster, upload }) {
  app.post('/api/qimg', requireMaster, upload.single('file'), h(async (req, res) => {
    const f = req.file;
    if (!f?.buffer?.length) return bad(res, 'Choose a picture');
    if (f.buffer.length > MAX) return bad(res, 'The picture is larger than 5 MB');
    const type = sniff(f.buffer);
    if (!type) return bad(res, 'Use a PNG, JPG, WEBP or GIF picture');
    const w = Math.max(0, Math.min(20000, Math.round(Number(req.body?.width) || 0))) || null;
    const hgt = Math.max(0, Math.min(20000, Math.round(Number(req.body?.height) || 0))) || null;
    const id = crypto.randomBytes(12).toString('base64url');
    await db.run('INSERT INTO question_images (id, data, type, bytes, width, height, created_by) VALUES (?,?,?,?,?,?,?)', [id, f.buffer, type, f.buffer.length, w, hgt, req.user.id]);
    res.json({ id, url: `/api/qimg/${id}` });
  }));
}
