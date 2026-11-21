import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { IMG_RE } from './Rich.jsx';
import { IconTrash, IconUpload } from './icons.jsx';

/**
 * Pictures in questions (graphs, charts, figures).
 * The teacher clicks "Add picture" (or pastes a screenshot straight into the text box); the picture is uploaded and
 * the text gets  ![Figure](/api/qimg/<id>)  at the cursor. Everything that shows question text draws it.
 */

const MAX_SIDE = 1800;

/** Large photos are scaled down in the browser first (graphs stay sharp: PNG stays PNG). */
async function shrink(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { blob: file, w: 0, h: 0 };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const w = img.naturalWidth; const h = img.naturalHeight;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    if (k === 1 && file.size < 1.5 * 1024 * 1024) return { blob: file, w, h };
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/webp';
    const blob = await new Promise((ok) => c.toBlob(ok, type, 0.9));
    return { blob: blob && blob.size < file.size ? blob : file, w: c.width, h: c.height };
  } catch { return { blob: file, w: 0, h: 0 }; } finally { URL.revokeObjectURL(url); }
}

export async function uploadPicture(file) {
  const { blob, w, h } = await shrink(file);
  const fd = new FormData();
  fd.append('file', blob, file.name || 'picture.png');
  if (w) { fd.append('width', String(w)); fd.append('height', String(h)); }
  const r = await api.upload('/qimg', fd);
  return `![Figure](${r.url})`;
}

/** Put text at the cursor of a textarea / input (or at the end), on its own line. */
export function insertAtCursor(el, value, token) {
  const v = String(value || '');
  const at = el && typeof el.selectionStart === 'number' && document.activeElement === el ? el.selectionStart : v.length;
  const before = v.slice(0, at); const after = v.slice(at);
  const pre = before && !before.endsWith('\n') ? '\n' : '';
  const post = after && !after.startsWith('\n') ? '\n' : '';
  return `${before}${pre}${token}${post}${after}`;
}

/**
 * Hook for one text field: returns { ref, onPaste, addFiles, busy }.
 * `get()` returns the field's current text, `set(text)` stores the new text.
 */
export function usePictureField(get, set) {
  const ref = useRef(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const addFiles = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true);
    try {
      let text = get();
      for (const f of list) text = insertAtCursor(ref.current, text, await uploadPicture(f));
      set(text);
      toast(list.length > 1 ? `${list.length} pictures added` : 'Picture added');
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  // a screenshot pasted into the text box becomes a picture
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  return { ref, onPaste, onDrop, addFiles, busy };
}

const ALL = new RegExp(IMG_RE.source.slice(1), 'g');
export const picturesIn = (text) => [...String(text || '').matchAll(ALL)].map((m) => ({ token: m[0], url: m[2], alt: m[1] }));

/** "Add picture" button + thumbnails of the pictures already in the text (with remove). */
export function PictureBar({ field, text, onChange, label = 'Add picture (graph, chart, figure)' }) {
  const input = useRef(null);
  const pics = picturesIn(text);
  return (
    <div className="qpic-bar">
      <button type="button" className="btn soft sm" disabled={field.busy} onClick={() => input.current?.click()}>
        <IconUpload width={15} height={15} /> {field.busy ? 'Uploading…' : label}
      </button>
      <small className="muted">or paste a screenshot into the text box</small>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { field.addFiles(e.target.files); e.target.value = ''; }} />
      {pics.length > 0 && (
        <div className="qpic-thumbs">
          {pics.map((p, i) => (
            <span key={`${p.url}-${i}`} className="qpic-thumb">
              <img src={p.url} alt={p.alt || 'Figure'} />
              <button type="button" aria-label="Remove picture" title="Remove picture" onClick={() => onChange(String(text).replace(p.token, '').replace(/\n{3,}/g, '\n\n').trim())}><IconTrash width={13} height={13} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
