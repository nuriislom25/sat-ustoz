/**
 * Quiz folders (teacher panel, also shown to students).
 *
 * - Folders inside folders, any depth (parent_id). Each quiz lives in one folder (quizzes.folder_id) or at the top.
 * - Order: folders and quizzes each have a position; drag & drop sends the new order.
 * - Colour per folder.
 * - Deleting a folder never deletes quizzes: its quizzes and sub-folders move up one level.
 * - A whole folder (with its sub-folders) can be opened to groups / all students in one step;
 *   assigning a whole folder goes through POST /api/assignments with quiz_ids.
 * Students get the folder tree (names, colours, order) and see only folders that hold quizzes open to them.
 */
import { db } from './db.js';

const COLORS = ['#3B82F6', '#22B07D', '#F07A55', '#8E5CF7', '#F5B82E', '#12A39A', '#E2553D', '#64748B'];

export async function migrateFolders() {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_folders (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES quiz_folders(id) ON DELETE SET NULL,
    color TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_quiz_folders_parent ON quiz_folders(parent_id);
  ALTER TABLE quiz_folders ENABLE ROW LEVEL SECURITY;
  ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES quiz_folders(id) ON DELETE SET NULL;
  ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_quizzes_folder ON quizzes(folder_id);`);
}

/** id → all folder ids under it (itself included). */
export async function subtree(rootId) {
  const all = await db.all('SELECT id, parent_id FROM quiz_folders');
  const kids = new Map();
  for (const f of all) { if (!kids.has(f.parent_id)) kids.set(f.parent_id, []); kids.get(f.parent_id).push(f.id); }
  const out = []; const stack = [rootId];
  while (stack.length) { const id = stack.pop(); out.push(id); stack.push(...(kids.get(id) || [])); }
  return out;
}

const clean = (b, old = {}) => {
  const name = 'name' in b ? String(b.name || '').trim().slice(0, 80) : old.name;
  if (!name) throw Object.assign(new Error('Write the folder name'), { status: 400 });
  const color = 'color' in b ? (/^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '') : old.color || '';
  return { name, color };
};

export function registerFolders(app, { h, bad, requireMaster }) {
  // everyone signed in: the tree (no quiz data here; students only see folders that hold quizzes open to them)
  app.get('/api/quiz-folders', h(async (req, res) => {
    const rows = await db.all('SELECT id, name, parent_id, color, position FROM quiz_folders ORDER BY position, lower(name), id');
    res.json(rows.map((f) => ({ ...f, color: f.color || COLORS[f.id % COLORS.length] })));
  }));

  app.post('/api/quiz-folders', requireMaster, h(async (req, res) => {
    const f = clean(req.body || {});
    const parent = req.body?.parent_id ? await db.one('SELECT id FROM quiz_folders WHERE id = ?', [Number(req.body.parent_id)]) : null;
    if (req.body?.parent_id && !parent) return bad(res, 'Parent folder not found', 404);
    const pos = (await db.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM quiz_folders WHERE parent_id IS NOT DISTINCT FROM ?', [parent?.id ?? null])).p;
    const r = await db.one('INSERT INTO quiz_folders (name, parent_id, color, position) VALUES (?,?,?,?) RETURNING id', [f.name, parent?.id ?? null, f.color || COLORS[Math.floor(Math.random() * COLORS.length)], pos]);
    res.json({ id: r.id });
  }));

  // rename, recolour or move a folder into another one (never into itself or its own sub-folder)
  app.put('/api/quiz-folders/:id', requireMaster, h(async (req, res) => {
    const old = await db.one('SELECT * FROM quiz_folders WHERE id = ?', [Number(req.params.id)]);
    if (!old) return bad(res, 'Folder not found', 404);
    const b = req.body || {};
    const f = clean(b, old);
    let parent = old.parent_id;
    if ('parent_id' in b) {
      parent = b.parent_id ? Number(b.parent_id) : null;
      if (parent && !(await db.one('SELECT id FROM quiz_folders WHERE id = ?', [parent]))) return bad(res, 'Folder not found', 404);
      if (parent && (await subtree(old.id)).includes(parent)) return bad(res, 'A folder cannot go inside itself');
    }
    await db.run('UPDATE quiz_folders SET name = ?, color = ?, parent_id = ? WHERE id = ?', [f.name, f.color || old.color, parent, old.id]);
    res.json({ ok: true });
  }));

  // delete: quizzes and sub-folders move up to the parent; nothing else is lost
  app.delete('/api/quiz-folders/:id', requireMaster, h(async (req, res) => {
    const f = await db.one('SELECT * FROM quiz_folders WHERE id = ?', [Number(req.params.id)]);
    if (!f) return bad(res, 'Folder not found', 404);
    await db.tx(async (t) => {
      await t.run('UPDATE quizzes SET folder_id = ? WHERE folder_id = ?', [f.parent_id, f.id]);
      await t.run('UPDATE quiz_folders SET parent_id = ? WHERE parent_id = ?', [f.parent_id, f.id]);
      await t.run('DELETE FROM quiz_folders WHERE id = ?', [f.id]);
    });
    res.json({ ok: true });
  }));

  // drag & drop: put quizzes and/or folders into a folder (null = top), in the given order
  app.post('/api/quiz-folders/move', requireMaster, h(async (req, res) => {
    const b = req.body || {};
    const to = b.folder_id ? Number(b.folder_id) : null;
    if (to && !(await db.one('SELECT id FROM quiz_folders WHERE id = ?', [to]))) return bad(res, 'Folder not found', 404);
    const quizIds = (Array.isArray(b.quiz_ids) ? b.quiz_ids : []).map(Number).filter(Boolean).slice(0, 500);
    const folderIds = (Array.isArray(b.folder_ids) ? b.folder_ids : []).map(Number).filter(Boolean).slice(0, 200);
    for (const id of folderIds) if (to && (await subtree(id)).includes(to)) return bad(res, 'A folder cannot go inside itself');
    await db.tx(async (t) => {
      if (quizIds.length) await t.run('UPDATE quizzes SET folder_id = ? WHERE id = ANY(?::int[])', [to, quizIds]);
      if (folderIds.length) await t.run('UPDATE quiz_folders SET parent_id = ? WHERE id = ANY(?::int[])', [to, folderIds]);
    });
    res.json({ ok: true });
  }));

  // new order inside one folder (ids in the order shown)
  app.post('/api/quiz-folders/order', requireMaster, h(async (req, res) => {
    const b = req.body || {};
    const q = (Array.isArray(b.quiz_ids) ? b.quiz_ids : []).map(Number).filter(Boolean).slice(0, 1000);
    const f = (Array.isArray(b.folder_ids) ? b.folder_ids : []).map(Number).filter(Boolean).slice(0, 500);
    await db.tx(async (t) => {
      for (let i = 0; i < q.length; i++) await t.run('UPDATE quizzes SET position = ? WHERE id = ?', [i + 1, q[i]]);
      for (let i = 0; i < f.length; i++) await t.run('UPDATE quiz_folders SET position = ? WHERE id = ?', [i + 1, f[i]]);
    });
    res.json({ ok: true });
  }));

  // open everything in a folder (and its sub-folders) to groups / all students; 'add' keeps what each quiz had, 'set' replaces it
  app.post('/api/quiz-folders/:id/access', requireMaster, h(async (req, res) => {
    const f = await db.one('SELECT id FROM quiz_folders WHERE id = ?', [Number(req.params.id)]);
    if (!f) return bad(res, 'Folder not found', 404);
    const ids = await subtree(f.id);
    const quizzes = (await db.all("SELECT id FROM quizzes WHERE folder_id = ANY(?::int[]) AND kind <> 'diagnostic'", [ids])).map((r) => r.id);
    const groups = (Array.isArray(req.body?.group_ids) ? req.body.group_ids : []).map(Number).filter(Boolean);
    const mode = req.body?.mode === 'set' ? 'set' : 'add';
    const pub = req.body?.is_public;
    await db.tx(async (t) => {
      for (const q of quizzes) {
        if (mode === 'set') await t.run('DELETE FROM quiz_groups WHERE quiz_id = ?', [q]);
        for (const g of groups) await t.run('INSERT INTO quiz_groups (quiz_id, group_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [q, g]);
        if (pub === true || pub === false) await t.run('UPDATE quizzes SET is_public = ? WHERE id = ?', [pub, q]);
      }
    });
    res.json({ quizzes: quizzes.length });
  }));
}
