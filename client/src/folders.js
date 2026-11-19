/** Quiz folder tree helpers (teacher and student Quizzes pages). */
export function folderTools(folders) {
  const by = new Map(folders.map((f) => [f.id, f]));
  const kids = (pid) => folders.filter((f) => (f.parent_id || null) === (pid || null));
  const path = (id) => { const out = []; let f = by.get(Number(id)); while (f && out.length < 50) { out.unshift(f); f = by.get(f.parent_id); } return out; };
  const under = (id) => { const out = [Number(id)]; for (let i = 0; i < out.length; i++) out.push(...kids(out[i]).map((f) => f.id)); return out; };
  return { by, kids, path, under };
}
