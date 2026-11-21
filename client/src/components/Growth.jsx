import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { Card, Modal, useAsync } from './ui.jsx';
import { IconArrow, IconCopy, IconDownload, IconGift, IconShare, IconTelegram, IconTrendUp } from './icons.jsx';

const fmtMoney = (n) => `${Number(n || 0).toLocaleString('en-US').replace(/,/g, ' ')} so'm`;

/* ---------------- invite a friend ---------------- */
export function InviteCard({ compact = false }) {
  const st = useAsync(() => api.get('/me/referral').catch(() => null), []);
  const toast = useToast();
  const r = st.data;
  if (!r) return null;
  const text = `SAT Ustoz: free SAT practice test, Question Bank and Word Arena. Join with my link and get ${fmtMoney(r.friend_bonus)} on your wallet:`;
  const copy = async () => { try { await navigator.clipboard.writeText(r.link); toast('Link copied'); } catch { toast(r.link); } };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'SAT Ustoz', text, url: r.link }); return; } catch { /* closed */ } }
    copy();
  };
  const tg = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`;
  const rewarded = r.friends.filter((f) => f.rewarded).length;
  return (
    <Card className={`invite ${compact ? 'compact' : ''}`}>
      <div className="invite-top">
        <span className="invite-ic"><IconGift width={24} height={24} weight="duotone" /></span>
        <div className="grow">
          <b>Invite a friend: {fmtMoney(r.bonus)} for you</b>
          <small>Your friend gets {fmtMoney(r.friend_bonus)} too, when they take their first plan.</small>
        </div>
      </div>
      <div className="invite-link">
        <span className="mono">{r.link.replace(/^https?:\/\//, '')}</span>
        <button className="btn ghost sm" onClick={copy} aria-label="Copy link"><IconCopy width={16} height={16} /></button>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="btn primary sm" href={tg} target="_blank" rel="noreferrer"><IconTelegram width={16} height={16} /> Send in Telegram</a>
        <button className="btn soft sm" onClick={share}><IconShare width={16} height={16} /> Share</button>
      </div>
      {(r.friends.length > 0 || r.earned > 0) && (
        <p className="invite-stat"><b>{r.friends.length}</b> joined · <b>{rewarded}</b> took a plan · <b>{fmtMoney(r.earned)}</b> earned</p>
      )}
    </Card>
  );
}

/* ---------------- top 3 topics to raise the score ---------------- */
export function FocusTopics() {
  const st = useAsync(() => api.get('/me/focus').catch(() => ({ topics: [] })), []);
  const list = st.data?.topics || [];
  return (
    <Card className="focus3">
      <div className="card-title"><h2>Raise your score fastest</h2><small className="muted">Top 3 from your answers</small></div>
      {st.loading ? <p className="muted">Looking at your answers…</p> : !list.length ? (
        <p className="muted">Answer at least 3 questions in a topic (Question Bank or Math) and the topics that cost you the most points show up here.</p>
      ) : (
        <ol className="focus3-list">
          {list.map((t, i) => (
            <li key={`${t.subject}-${t.id}`}>
              <span className="focus3-n">{i + 1}</span>
              <span className="grow">
                <b>{t.name}</b>
                <small>{t.subject === 'math' ? 'Math' : 'Reading & Writing'} · {t.correct}/{t.answered} right ({t.pct}%)</small>
                <i className="focus3-bar"><em style={{ width: `${Math.max(4, t.pct)}%` }} /></i>
              </span>
              <span className="focus3-gain" title="Points this topic could add when you get 9 of 10 right"><IconTrendUp width={15} height={15} /> +{t.gain}</span>
              <Link className="btn soft sm" to={t.to}>Practise <IconArrow width={14} height={14} /></Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ---------------- shareable score card (Instagram / Telegram Stories, 1080×1920) ---------------- */
const W = 1080; const H = 1920;
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

/** card: { score, low, high, label, sub, correct, total, name, date, skills: [{ name, pct }] } */
async function drawCard(canvas, card) {
  const c = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  const D = '"Unbounded Variable", "Unbounded", system-ui, sans-serif';
  const B = '"Manrope Variable", "Manrope", system-ui, sans-serif';
  try { await Promise.all([document.fonts.load(`800 200px ${D}`), document.fonts.load(`600 40px ${B}`)]); } catch { /* system font */ }
  // ground: night ink with a sky glow and a fine dot grid
  c.fillStyle = '#161B3D'; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.8, H * 0.2, 40, W * 0.8, H * 0.2, 900);
  g.addColorStop(0, 'rgba(59,130,246,.55)'); g.addColorStop(1, 'rgba(59,130,246,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const g2 = c.createRadialGradient(W * 0.1, H * 0.85, 20, W * 0.1, H * 0.85, 700);
  g2.addColorStop(0, 'rgba(42,85,229,.45)'); g2.addColorStop(1, 'rgba(42,85,229,0)');
  c.fillStyle = g2; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.06)';
  for (let x = 40; x < W; x += 48) for (let y = 40; y < H; y += 48) c.fillRect(x, y, 3, 3);

  // wordmark
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#fff'; c.font = `800 64px ${D}`; c.fillText('SAT', 90, 190);
  const sw = c.measureText('SAT').width;
  c.fillStyle = '#FFCB3D'; c.font = `700 40px ${D}`; c.fillText('Ustoz', 90 + sw + 12, 190);

  // label
  c.fillStyle = 'rgba(255,255,255,.72)'; c.font = `600 40px ${B}`; c.fillText(card.label, 90, 420);
  // the score
  c.fillStyle = '#fff'; c.font = `800 330px ${D}`;
  c.fillText(String(card.score), 70, 760);
  c.fillStyle = '#FFCB3D'; roundRect(c, 90, 810, 260, 16, 8); c.fill();
  c.fillStyle = 'rgba(255,255,255,.9)'; c.font = `600 48px ${B}`;
  c.fillText(card.low && card.high ? `Likely ${card.low}–${card.high}` : card.sub || '', 90, 920);
  if (card.total) { c.fillStyle = 'rgba(255,255,255,.65)'; c.font = `500 40px ${B}`; c.fillText(`${card.correct} of ${card.total} correct · ${Math.round((card.correct / card.total) * 100)}%`, 90, 985); }

  // skills
  const sk = (card.skills || []).slice(0, 3);
  let y = 1070;
  if (sk.length) { c.fillStyle = 'rgba(255,255,255,.55)'; c.font = `700 30px ${B}`; c.fillText('BY QUESTION TYPE', 90, y); y += 50; }
  for (const s of sk) {
    c.fillStyle = '#fff'; c.font = `600 36px ${B}`;
    let nm = s.name; while (c.measureText(nm).width > 720 && nm.length > 4) nm = nm.slice(0, -2);
    c.fillText(nm === s.name ? nm : `${nm}…`, 90, y + 36);
    c.fillStyle = 'rgba(255,255,255,.75)'; c.font = `700 36px ${B}`; const t = `${s.pct}%`; c.fillText(t, W - 90 - c.measureText(t).width, y + 36);
    c.fillStyle = 'rgba(255,255,255,.14)'; roundRect(c, 90, y + 58, W - 180, 18, 9); c.fill();
    c.fillStyle = s.pct >= 80 ? '#3CCB9A' : s.pct >= 50 ? '#FFCB3D' : '#F28B6E'; roundRect(c, 90, y + 58, Math.max(18, ((W - 180) * s.pct) / 100), 18, 9); c.fill();
    y += 130;
  }

  // who and when
  c.fillStyle = 'rgba(255,255,255,.85)'; c.font = `700 44px ${B}`; c.fillText(card.name || '', 90, H - 320);
  c.fillStyle = 'rgba(255,255,255,.55)'; c.font = `500 34px ${B}`; c.fillText(card.date || '', 90, H - 272);
  // call to action
  c.fillStyle = '#FFCB3D'; roundRect(c, 90, H - 230, W - 180, 130, 65); c.fill();
  c.fillStyle = '#161B3D'; c.font = `800 44px ${D}`;
  const cta = 'ustozsat.uz'; c.fillText(cta, (W - c.measureText(cta).width) / 2, H - 150);
  c.fillStyle = 'rgba(255,255,255,.6)'; c.font = `500 30px ${B}`;
  const sub = 'Free SAT practice test · try it yourself'; c.fillText(sub, (W - c.measureText(sub).width) / 2, H - 50);
}

export function ShareScore({ card, label = 'Share my score', className = 'btn soft' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><IconShare width={16} height={16} /> {label}</button>
      {open && <ShareModal card={card} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareModal({ card, onClose }) {
  const ref = useRef(null);
  const [url, setUrl] = useState('');
  const [blob, setBlob] = useState(null);
  const toast = useToast();
  useEffect(() => {
    let off = false; let u = '';
    (async () => {
      const cv = document.createElement('canvas');
      await drawCard(cv, card);
      const b = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
      if (off || !b) return;
      u = URL.createObjectURL(b); setBlob(b); setUrl(u);
    })();
    return () => { off = true; if (u) URL.revokeObjectURL(u); };
  }, [card]);
  const file = () => new File([blob], `sat-ustoz-score-${card.score}.png`, { type: 'image/png' });
  const share = async () => {
    try {
      if (navigator.canShare?.({ files: [file()] })) { await navigator.share({ files: [file()], title: 'My SAT score', text: 'My SAT practice score on SAT Ustoz · ustozsat.uz' }); return; }
    } catch { return; }
    ref.current?.click();
    toast('Saved: post the picture in your story');
  };
  return (
    <Modal title="Your score card" onClose={onClose}
      footer={<><a ref={ref} className="btn ghost" href={url || undefined} download={`sat-ustoz-score-${card.score}.png`}><IconDownload width={16} height={16} /> Download</a><button className="btn primary" disabled={!blob} onClick={share}><IconShare width={16} height={16} /> Share to story</button></>}>
      <div className="sc-prev">{url ? <img src={url} alt={`Score card: ${card.score}`} /> : <div className="sc-wait">Drawing your card…</div>}</div>
      <p className="muted" style={{ fontSize: '.86rem' }}>Made for Instagram and Telegram stories (1080 × 1920). Only your first name is on it.</p>
    </Modal>
  );
}

export const firstName = (n) => { const w = String(n || '').trim().split(/\s+/); return w[0] ? `${w[0]}${w[1] ? ` ${w[1][0]}.` : ''}` : ''; };
export const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
