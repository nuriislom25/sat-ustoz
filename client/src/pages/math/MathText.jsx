import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Text with formulas: $…$ inline, $$…$$ on its own line (KaTeX). "\$" is a dollar sign.
 * Plain text stays plain; a formula that does not parse is shown as typed.
 */
const cache = new Map();
function tex(src, display) {
  const k = `${display ? 'D' : 'I'}${src}`;
  if (!cache.has(k)) {
    let html;
    try { html = katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, output: 'html' }); } catch { html = null; }
    cache.set(k, html);
  }
  return cache.get(k);
}

export function parts(text) {
  const s = String(text ?? '');
  const out = [];
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\\$|[^$])+?)\$/g;
  let last = 0; let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    out.push(m[1] != null ? { d: m[1] } : { i: m[2] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}

export default function MathText({ children, as: Tag = 'span', className = '' }) {
  return (
    <Tag className={`mtx ${className}`}>
      {parts(children).map((p, i) => {
        if (p.t != null) return <span key={i}>{p.t.replace(/\\\$/g, '$')}</span>;
        const html = tex(p.d ?? p.i, p.d != null);
        if (!html) return <code key={i}>{p.d ?? p.i}</code>;
        return <span key={i} className={p.d != null ? 'mtx-d' : 'mtx-i'} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </Tag>
  );
}
