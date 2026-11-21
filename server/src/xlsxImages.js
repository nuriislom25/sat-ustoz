/**
 * Pictures inside an Excel file, by row — so a question's graph can simply be pasted into its row.
 *
 * Three ways a picture can sit in a sheet are read:
 *  1. a floating picture placed over the row (Excel, Google Sheets, WPS: xl/drawings/drawingN.xml anchors);
 *  2. Excel 365 "Place in cell" pictures (cells with vm="…" → xl/richData/…);
 *  3. WPS Office in-cell pictures (=DISPIMG("ID_…") → xl/cellimages.xml).
 * Only the first sheet is read. Returns Map(excelRow (1-based) → [{ data: Buffer }]) in left-to-right order.
 * The pictures are stored like uploaded ones (question_images) and become ![Figure](/api/qimg/<id>) in the text.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { db } from './db.js';

const txt = (f) => (f?.content ? Buffer.from(f.content).toString('utf8') : '');
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const rels = (xml) => Object.fromEntries([...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => attrs(m[1])).map((a) => [a.Id, a.Target]));
const join = (base, target) => (target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(base), target)));
const relsPath = (p) => `${path.posix.dirname(p)}/_rels/${path.posix.basename(p)}.rels`;
const rowOf = (ref) => Number(String(ref).replace(/^[A-Z]+/i, '')) || 0;
const colOf = (ref) => String(ref).replace(/\d+$/, '').toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

export function xlsxImages(buffer) {
  const out = new Map();
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer', bookFiles: true, sheetRows: 1 }); } catch { return out; }
  const files = wb.files || {};
  const get = (p) => files[p] || files[`/${p}`];
  const media = (p) => { const f = get(p); return f?.content ? Buffer.from(f.content) : null; };
  const add = (row, col, data) => { if (!row || !data) return; if (!out.has(row)) out.set(row, []); out.get(row).push({ col, data }); };
  // the first sheet's file
  const wbRels = rels(txt(get('xl/_rels/workbook.xml.rels')));
  const firstRid = (txt(get('xl/workbook.xml')).match(/<(?:\w+:)?sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
  const sheetPath = firstRid && wbRels[firstRid] ? join('xl/workbook.xml', wbRels[firstRid]) : 'xl/worksheets/sheet1.xml';
  const sheetXml = txt(get(sheetPath));
  if (!sheetXml) return out;
  const sheetRels = rels(txt(get(relsPath(sheetPath))));

  // 1. floating pictures (drawing anchors)
  for (const [, rid] of sheetXml.matchAll(/<(?:\w+:)?drawing\b[^>]*r:id="([^"]+)"/g)) {
    if (!sheetRels[rid]) continue;
    const dPath = join(sheetPath, sheetRels[rid]);
    const dXml = txt(get(dPath)); const dRels = rels(txt(get(relsPath(dPath))));
    // namespace prefixes differ between programs (xdr:, none, …): match with or without one
    for (const [anchor] of dXml.matchAll(/<(?:\w+:)?(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:\w+:)?(?:twoCellAnchor|oneCellAnchor)>/g)) {
      const from = anchor.match(/<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?col>(\d+)<\/(?:\w+:)?col>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/);
      const embed = (anchor.match(/<(?:\w+:)?blip\b[^>]*r:embed="([^"]+)"/) || [])[1];
      if (from && embed && dRels[embed]) add(Number(from[2]) + 1, Number(from[1]) + 1, media(join(dPath, dRels[embed])));
    }
  }

  // 2. Excel 365 pictures placed in cells
  const rvRel = txt(get('xl/richData/richValueRel.xml'));
  if (rvRel) {
    const rvRels = rels(txt(get('xl/richData/_rels/richValueRel.xml.rels')));
    const relIds = [...rvRel.matchAll(/<rel\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
    const values = [...txt(get('xl/richData/rdrichvalue.xml')).matchAll(/<rv\b[^>]*>([\s\S]*?)<\/rv>/g)].map((m) => Number((m[1].match(/<v[^>]*>(\d+)<\/v>/) || [])[1]));
    // vm is 1-based into valueMetadata; in files written by Excel it points to rich value vm-1
    for (const [, a] of sheetXml.matchAll(/<c\b([^>]*\bvm="\d+"[^>]*)>/g)) {
      const at = attrs(a); const rv = values[Number(at.vm) - 1];
      const rel = relIds[rv]; const target = rel && rvRels[rel];
      if (target) add(rowOf(at.r), colOf(at.r), media(join('xl/richData/richValueRel.xml', target)));
    }
  }

  // 3. WPS Office =DISPIMG("ID_…") pictures
  const ciXml = txt(get('xl/cellimages.xml'));
  if (ciXml) {
    const ciRels = rels(txt(get('xl/_rels/cellimages.xml.rels')));
    const byName = new Map();
    for (const [pic] of ciXml.matchAll(/<(?:\w+:)?pic>[\s\S]*?<\/(?:\w+:)?pic>/g)) {
      const name = (pic.match(/<(?:\w+:)?cNvPr\b[^>]*name="([^"]+)"/) || [])[1];
      const embed = (pic.match(/<(?:\w+:)?blip\b[^>]*r:embed="([^"]+)"/) || [])[1];
      if (name && embed && ciRels[embed]) byName.set(name, join('xl/cellimages.xml', ciRels[embed]));
    }
    for (const [, a, f] of sheetXml.matchAll(/<c\b([^>]*)>\s*<f>([^<]*DISPIMG[^<]*)<\/f>/g)) {
      const id = (f.match(/DISPIMG\(&quot;([^&]+)&quot;|DISPIMG\("([^"]+)"/) || []).slice(1).find(Boolean);
      if (id && byName.has(id)) add(rowOf(attrs(a).r), colOf(attrs(a).r), media(byName.get(id)));
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.col - y.col);
  return out;
}

const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
  : b.toString('ascii', 0, 4) === 'GIF8' ? 'image/gif' : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null);

/** Store the pictures of one row; returns their tokens joined by blank lines ('' when none). */
export async function storeImages(list, userId) {
  const parts = [];
  for (const { data } of list || []) {
    const type = data && sniff(data);
    if (!type || data.length > 5 * 1024 * 1024) continue;
    const id = crypto.randomBytes(12).toString('base64url');
    await db.run('INSERT INTO question_images (id, data, type, bytes, created_by) VALUES (?,?,?,?,?)', [id, data, type, data.length, userId || null]);
    parts.push(`![Figure](/api/qimg/${id})`);
  }
  return parts.join('\n\n');
}
/** Every picture of the file stored; Map(excelRow → tokens). */
export async function storeSheetImages(buffer, userId) {
  const tokens = new Map();
  if (!isZip(buffer)) return tokens;
  for (const [row, list] of xlsxImages(buffer)) { const t = await storeImages(list, userId); if (t) tokens.set(row, t); }
  return tokens;
}
export const isZip = (b) => !!b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
