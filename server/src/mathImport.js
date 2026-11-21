/**
 * Teacher: add many SAT Math questions at once from an Excel / CSV file (the Math Question Bank).
 *
 * Columns (header names are flexible, English or Uzbek):
 *   domain      Algebra | Advanced Math | Problem-Solving and Data Analysis | Geometry and Trigonometry (or alg/adv/psda/geo)
 *   skill       a skill name of that domain (e.g. "Linear functions"); empty = the domain's first skill
 *   difficulty  easy | medium | hard (empty = medium)
 *   question    the question; formulas between $ … $
 *   A B C D     answer choices (leave all four empty for a typed answer)
 *   answer      A–D for choices; for a typed answer the right value(s), several forms separated with ;  (e.g. 3/4; 0.75)
 *   explanation, tip, image (a picture link or an uploaded picture id) — optional
 * Questions already in the bank (same text) are skipped.
 */
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { db } from './db.js';
import { starter } from './math.js';
import { xlsxImages, storeImages, isZip } from './xlsxImages.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const COLS = {
  domain: ['domain', 'soha', 'bolim', 'section', 'area'],
  skill: ['skill', 'topic', 'mavzu', 'subtopic'],
  difficulty: ['difficulty', 'level', 'qiyinlik', 'daraja'],
  prompt: ['question', 'prompt', 'savol', 'stem', 'problem'],
  passage: ['passage', 'context', 'stimulus', 'matn'],
  a: ['a', 'optiona', 'choicea'], b: ['b', 'optionb', 'choiceb'], c: ['c', 'optionc', 'choicec'], d: ['d', 'optiond', 'choiced'],
  answer: ['answer', 'correct', 'key', 'javob', 'togri', 'correctanswer'],
  explanation: ['explanation', 'rationale', 'izoh', 'tushuntirish', 'solution'],
  tip: ['tip', 'hint', 'maslahat', 'ustoztip'],
  image: ['image', 'picture', 'graph', 'figure', 'rasm', 'grafik', 'imageurl'],
  module: ['module', 'modul', 'part', 'section2', 'mod'],
};
const pick = (row, key) => {
  for (const [k, v] of Object.entries(row)) if (COLS[key].includes(norm(k)) && String(v ?? '').trim() !== '') return String(v).trim();
  return '';
};
const DOMAIN_ALIASES = { alg: ['alg', 'algebra'], adv: ['adv', 'advancedmath', 'advanced'], psda: ['psda', 'problemsolvinganddataanalysis', 'problemsolving', 'dataanalysis', 'data'], geo: ['geo', 'geometryandtrigonometry', 'geometry', 'trigonometry'] };
const imgToken = (u) => {
  if (/^https:\/\/\S+$/i.test(u) || /^\/api\/qimg\/[\w-]+$/.test(u)) return `![Figure](${u})`;
  if (/^[\w-]{10,40}$/.test(u)) return `![Figure](/api/qimg/${u})`;
  return '';
};
export const textKey = (s) => norm(s).slice(0, 400);

/** Rows of the file → clean questions + per-row problems (row numbers as in Excel, header = row 1). */
export function readMathSheet(buffer, { withModule = false } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const domains = starter().domains;
  const ok = []; const problems = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const dRaw = norm(pick(r, 'domain'));
    const dom = domains.find((d) => DOMAIN_ALIASES[d.id].includes(dRaw) || norm(d.name) === dRaw) || (dRaw ? null : undefined);
    const sRaw = norm(pick(r, 'skill'));
    // the skill alone is enough to find the domain
    const bySkill = sRaw ? domains.flatMap((d) => d.skills.map((k) => ({ d, k }))).find(({ k }) => norm(k.name) === sRaw || norm(k.id) === sRaw || norm(k.name).startsWith(sRaw)) : null;
    const domain = dom || bySkill?.d;
    const skill = bySkill && (!dom || bySkill.d.id === dom.id) ? bySkill.k : domain?.skills[0];
    let prompt = pick(r, 'prompt');
    const passage = pick(r, 'passage');
    if (passage) prompt = `${passage}\n\n${prompt}`;
    const img = imgToken(pick(r, 'image'));
    if (img) prompt = `${prompt}\n\n${img}`;
    const opts = ['a', 'b', 'c', 'd'].map((k) => pick(r, k));
    const ans = pick(r, 'answer');
    const blank = !prompt && !ans && opts.every((o) => !o);
    if (blank) return;
    if (!domain) { problems.push(`row ${line}: unknown domain "${pick(r, 'domain')}"`); return; }
    if (!prompt) { problems.push(`row ${line}: no question`); return; }
    let kind; let options = []; let answer;
    if (opts.some(Boolean)) {
      if (opts.some((o) => !o)) { problems.push(`row ${line}: fill all four choices A–D (or none for a typed answer)`); return; }
      const L = String(ans).trim().toUpperCase().match(/^[ABCD]/);
      if (!L) { problems.push(`row ${line}: the answer must be A, B, C or D`); return; }
      kind = 'mcq'; options = opts.map((o) => o.slice(0, 600)); answer = L[0];
    } else {
      const acc = String(ans).split(/[;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
      if (!acc.length) { problems.push(`row ${line}: no answer`); return; }
      kind = 'spr'; answer = JSON.stringify(acc);
    }
    const lvl = norm(pick(r, 'difficulty'));
    ok.push({
      line, row: (r.__rowNum__ ?? i + 1) + 1, ...(withModule ? { module: pick(r, 'module') || '1' } : {}), domain: domain.id, skill: skill.id, kind, prompt: prompt.slice(0, 4000), options: JSON.stringify(options), answer,
      difficulty: ['easy', 'medium', 'hard'].includes(lvl) ? lvl : lvl === 'oson' ? 'easy' : lvl === 'qiyin' ? 'hard' : 'medium',
      explanation: pick(r, 'explanation').slice(0, 4000), tip: pick(r, 'tip').slice(0, 1000),
    });
  });
  return { ok, problems, rows: rows.length };
}

export async function importMath(buffer, userId) {
  const { ok, problems, rows } = readMathSheet(buffer);
  // pictures pasted into the rows (graphs, figures) go under the question text
  const pics = isZip(buffer) ? xlsxImages(buffer) : new Map();
  let pictures = 0;
  const have = new Set((await db.all('SELECT prompt FROM math_questions')).map((q) => textKey(q.prompt)));
  let pos = Number((await db.one('SELECT COALESCE(MAX(position), 0) AS p FROM math_questions')).p);
  let added = 0; let dupes = 0;
  for (const q of ok) {
    const key = textKey(q.prompt);
    if (key.length > 8 && have.has(key)) { dupes++; continue; }
    have.add(key);
    const img = pics.has(q.row) ? await storeImages(pics.get(q.row), userId) : '';
    if (img) { q.prompt = `${q.prompt}\n\n${img}`; pictures++; }
    await db.run(`INSERT INTO math_questions (id, domain, skill, difficulty, kind, prompt, options, answer, explanation, tip, source, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,'teacher',?)`, [`t-${crypto.randomBytes(5).toString('hex')}`, q.domain, q.skill, q.difficulty, q.kind, q.prompt, q.options, q.answer, q.explanation, q.tip, ++pos]);
    added++;
  }
  return { rows, added, pictures, duplicates: dupes, problems: problems.slice(0, 30), problem_count: problems.length };
}

/** An example file with every column filled in. */
export function mathTemplate({ withModule = false } = {}) {
  const rows = [
    { domain: 'Algebra', skill: 'Linear equations in one variable', difficulty: 'easy', question: 'If $3x + 7 = 22$, what is the value of $x$?', A: '3', B: '5', C: '7', D: '15', answer: 'B', explanation: 'Subtract 7: $3x = 15$, so $x = 5$.', tip: 'Undo the operations in reverse order.', image: '' },
    { domain: 'Problem-Solving and Data Analysis', skill: 'Percentages', difficulty: 'medium', question: 'What is 15% of 240?', A: '', B: '', C: '', D: '', answer: '36', explanation: '$0.15 \\times 240 = 36$.', tip: '', image: '' },
    { domain: 'Geometry and Trigonometry', skill: 'Circles', difficulty: 'hard', question: 'A circle has the equation $x^2 + y^2 - 6x + 4y = 12$. What is its radius?', A: '', B: '', C: '', D: '', answer: '5', explanation: 'Complete the squares: $(x-3)^2 + (y+2)^2 = 25$, so $r = 5$.', tip: '', image: '' },
  ];
  if (withModule) rows.forEach((r, i) => { r.module = ['1', '2h', '2e'][i % 3]; });
  const ws = XLSX.utils.json_to_sheet(withModule ? rows.map(({ module, ...r }) => ({ module, ...r })) : rows);
  ws['!cols'] = [{ wch: 30 }, { wch: 34 }, { wch: 10 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 50 }, { wch: 30 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Math questions');
  const help = XLSX.utils.aoa_to_sheet([
    ['Column', 'What to write'],
    ['domain', 'Algebra, Advanced Math, Problem-Solving and Data Analysis, Geometry and Trigonometry'],
    ['skill', ...[]], ...starter().domains.map((d) => [d.name, d.skills.map((k) => k.name).join('; ')]),
    ['difficulty', 'easy, medium or hard'],
    ['question', 'The question; formulas between $ … $ (e.g. $\\frac{3}{4}$, $x^2$)'],
    ['A–D', 'Four answer choices. Leave all four empty when students type the answer.'],
    ['answer', 'A, B, C or D; for a typed answer the value — several accepted forms separated with ; (3/4; 0.75)'],
    ['explanation, tip', 'Optional, shown after the answer'],
    ...(withModule ? [['module', 'Full mock only: 1 = Module 1, 2 = one Module 2 for everyone, 2h = harder Module 2, 2e = easier Module 2 (22 questions each)']] : []),
    ['image', 'Optional: paste the picture (graph, figure) into the question\'s row — anywhere in that row, or in this column. A picture link (https://…) also works.'],
  ]);
  help['!cols'] = [{ wch: 34 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, help, 'How to fill');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
