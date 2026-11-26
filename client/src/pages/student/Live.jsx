import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, useToast } from '../../context.jsx';
import { Card, Confirm, Gate, Modal, PageHeader, useAsync } from '../../components/ui.jsx';
import { IconCheck, IconClock, IconLive, IconLock, IconTelegram, IconX } from '../../components/icons.jsx';
import { useTopUp } from '../../components/StudentCard.jsx';
import { fmtMoney } from './Subscribe.jsx';

/**
 * Live 1-on-1 lessons (Ultra): six fixed times, one student each, 12 lessons per 4 weeks.
 * Students book, pre-book, renew or join the waitlist; the teacher sees who has which time and the queue.
 */
const day = (d, o = { day: 'numeric', month: 'short' }) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o }) : '—');
const wday = (d) => day(d, { weekday: 'short', day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Live() {
  const { user } = useAuth();
  const st = useAsync(() => api.get('/live/slots'), []);
  return (
    <div className="page">
      <PageHeader title="Live lessons" sub={user.role === 'master' ? 'Students whose booked live period is still running. New bookings are closed.' : 'Your booked one-on-one lessons with the teacher.'} />
      <Gate state={st}>{(d) => (user.role === 'master' ? <Board d={d} reload={st.reload} /> : <Student d={d} reload={st.reload} />)}</Gate>
    </div>
  );
}

const STATE = { free: ['Free', 'good'], taken: ['Taken', ''], mine: ['Your time', 'primary'], mine_next: ['Booked', 'primary'], closed: ['Closed', ''] };

/**
 * SAT Ustoz is free and live lessons are no longer offered: a student whose booked period is still running sees
 * their time and the next lessons until it ends. Nothing can be booked, renewed or paid.
 */
function Student({ d }) {
  const mine = (d.mine || []).filter((b) => b.started);
  return (
    <>
      {mine.length ? mine.map((b) => <MyTime key={b.id} b={b} slot={null} />) : (
        <Card className="lv-intro">
          <span className="item-ic lv-ic"><IconLive /></span>
          <div><h2>Live lessons have ended</h2><p className="muted">New live lessons are no longer offered. Everything else on SAT Ustoz is free and open to you.</p></div>
        </Card>
      )}
      {mine.length > 0 && <p className="muted lv-end-note">Your lessons continue as booked until the last date shown. New live lessons are no longer offered.</p>}
    </>
  );
}

function MyTime({ b, slot, onRenew }) {
  return (
    <Card className="lv-mine">
      <div className="lv-mine-h">
        <span className="item-ic lv-ic"><IconLive /></span>
        <div className="grow">
          <small className="muted">Your lesson time</small>
          <b className="lv-mine-t">{b.days} · {b.from}–{b.to}</b>
          <span className="muted">{b.left} lesson{b.left === 1 ? '' : 's'} left · last on {day(b.last)}</span>
        </div>
        {slot?.action === 'renew' && <button className="btn primary" onClick={() => onRenew(slot)}>Renew</button>}
      </div>
      <div className="lv-next">{b.next_lessons.map((x, i) => <span key={x} className={i === 0 ? 'on' : ''}>{wday(x)}</span>)}</div>
      {slot?.action === 'renew' && slot.renew_by && <small className="muted">Renew by {wday(slot.renew_by)} to keep this time for the next 4 weeks.</small>}
      {slot?.note && <small className="muted">{slot.note}</small>}
    </Card>
  );
}

function BookModal({ s, d, onClose, onDone }) {
  const toast = useToast();
  const top = useTopUp();
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => Math.random().toString(36).slice(2) + Date.now().toString(36));
  const enough = d.balance >= d.price;
  const title = s.action === 'renew' ? 'Renew your time' : s.action === 'prebook' ? 'Pre-book this time' : 'Book this time';
  const go = async () => {
    setBusy(true);
    try { const r = await api.post('/live/book', { slot: s.id, key }); toast(`Booked: ${s.days} ${s.from}, from ${day(r.starts_on)}`); onDone(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        {enough ? <button className="btn primary" disabled={busy} onClick={go}>Pay {fmtMoney(d.price, d.currency)}</button>
          : top.ready ? <button className="btn primary" disabled={top.busy} onClick={top.open}><IconTelegram width={16} height={16} /> Top up in Telegram</button>
            : <Link className="btn primary" to="/subscribe#pay">Top up</Link>}</>}>
      <div className="lv-sum">
        <div><small>Time</small><b>{s.days} · {s.from}–{s.to}</b></div>
        <div><small>Lessons</small><b>12 · {wday(s.period.starts_on)} – {day(s.period.last)}</b></div>
        <div><small>Price</small><b>{fmtMoney(d.price, d.currency)}</b></div>
        <div><small>Wallet after</small><b className={enough ? '' : 'bad-text'}>{enough ? fmtMoney(d.balance - d.price, d.currency) : `${fmtMoney(d.price - d.balance, d.currency)} short`}</b></div>
      </div>
      <ul className="lv-terms">
        <li><IconCheck width={14} height={14} /> Ultra plan for the whole period: unlimited practice, mocks, roadmap and video lessons.</li>
        {s.action === 'prebook' && <li><IconCheck width={14} height={14} /> If the current student renews in time, your start moves 4 weeks later. You can cancel before it starts and get the money back.</li>}
        {s.action === 'offer' && <li><IconCheck width={14} height={14} /> The waitlist offer is yours until {when(s.offer_until)}.</li>}
        <li><IconCheck width={14} height={14} /> Renew {d.priority_days}+ days before the end to keep this time.</li>
      </ul>
    </Modal>
  );
}

/* ---------- teacher ---------- */
function Board({ d, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [end, setEnd] = useState(null);
  const closed = new Set(d.closed || []);
  const run = async (k, fn, ok) => { setBusy(k); try { await fn(); if (ok) toast(ok); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); } };
  const taken = d.board.filter((b) => b.cur).length;
  const waiting = d.board.reduce((s, b) => s + b.queue.length, 0);
  return (
    <>
      <div className="ql-kpis lv-kpis">
        <div><b>{taken} / 6</b><span>times taken</span></div>
        <div><b>{d.board.reduce((s, b) => s + b.future.length, 0)}</b><span>booked ahead</span></div>
        <div><b>{waiting}</b><span>on waitlists</span></div>
        <div><b>{fmtMoney(d.price, d.currency)}</b><span>per 12 lessons (Settings → plans)</span></div>
      </div>
      <div className="lv-grid">
        {d.groups.map((g) => (
          <Card key={g.id} className="lv-col">
            <h3 className="lv-days">{g.label}</h3>
            {d.board.filter((b) => b.id.startsWith(g.id)).map((b) => {
              const s = d.slots.find((x) => x.id === b.id);
              return (
                <div key={b.id} className="lv-tslot">
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div className="lv-time"><IconClock width={16} height={16} /><b>{s.from}–{s.to}</b></div>
                    <label className="row lv-close"><input type="checkbox" checked={closed.has(b.id)} disabled={busy === b.id}
                      onChange={(e) => run(b.id, () => api.put('/live/closed', { slot: b.id, closed: e.target.checked }))} /> Closed for new students</label>
                  </div>
                  {b.cur ? (
                    <div className="lv-who">
                      <div><Link to={`/students/${b.cur.user_id}`}><b>{b.cur.name}</b></Link><small className="muted">{day(b.cur.starts_on)} – {day(b.cur.ends_on)} · renew by {day(b.cur.renew_by)}</small></div>
                      <button className="btn ghost sm" onClick={() => setEnd({ ...b.cur, started: true })}>End</button>
                    </div>
                  ) : <p className="muted lv-empty">Free</p>}
                  {b.future.map((f) => (
                    <div key={f.id} className="lv-who next">
                      <div><span className="chip">Next</span> <Link to={`/students/${f.user_id}`}>{f.name}</Link><small className="muted">from {day(f.starts_on)}</small></div>
                      <button className="btn ghost sm" onClick={() => setEnd(f)}>Cancel</button>
                    </div>
                  ))}
                  {b.queue.length > 0 && (
                    <ol className="lv-q">
                      {b.queue.map((q) => (
                        <li key={q.id}>
                          <span><Link to={`/students/${q.user_id}`}>{q.name}</Link>{q.status === 'offered' ? <small className="warn-text"> · offered until {when(q.offer_until)}</small> : ''}{!q.tg && <small className="muted"> · no Telegram</small>}</span>
                          <button className="icon-btn" aria-label="Remove from waitlist" disabled={busy === `q${q.id}`} onClick={() => run(`q${q.id}`, () => api.del(`/live/queue-entry/${q.id}`), 'Removed')}><IconX width={14} height={14} /></button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </Card>
        ))}
      </div>
      {end && <Confirm title={end.started ? 'End this period now?' : 'Cancel this booking?'}
        text={end.started ? `${end.name}'s lessons stop now. No money moves automatically: top up their wallet if you return part of it. Their plan stays until its date.` : `${end.name}'s booking from ${day(end.starts_on)} is cancelled and the full price goes back to their wallet.`}
        confirmLabel={end.started ? 'End period' : 'Cancel and refund'} onClose={() => setEnd(null)}
        onConfirm={async () => { try { await api.post(`/live/bookings/${end.id}/cancel`); toast('Done'); setEnd(null); reload(); } catch (e) { toast(e.message, 'bad'); } }} />}
    </>
  );
}
