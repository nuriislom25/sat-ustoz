import { useState } from 'react';
import { api, fmtDate } from '../../api.js';
import { useToast } from '../../context.jsx';
import { Card, Empty, Field, Gate, PageHeader, useAsync } from '../../components/ui.jsx';
import { IconConsult } from '../../components/icons.jsx';

export const when = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATUS = { requested: ['warn', 'Waiting for the teacher'], scheduled: ['good', 'Booked'], done: ['', 'Done'], cancelled: ['', 'Cancelled'], declined: ['', 'Declined by the teacher'] };

/** Student: ask for a free consultation with the teacher (the teacher accepts or declines) and see past ones. */
export default function Consultations() {
  const toast = useToast();
  const st = useAsync(() => api.get('/consultations'), []);
  const [f, setF] = useState({ preferred: '', note: '' });
  const [busy, setBusy] = useState(false);
  const book = async () => {
    setBusy(true);
    try { await api.post('/consultations', f); toast('Request sent. The teacher will confirm the time.'); setF({ preferred: '', note: '' }); st.reload(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const cancel = async (id) => { try { await api.post(`/consultations/${id}/cancel`); toast('Cancelled'); st.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <PageHeader title="Consultations" sub="A one-to-one call with your teacher: your mistakes, your plan and what to study next." />
      <Gate state={st}>{(c) => {
        const upcoming = c.list.filter((x) => x.status === 'requested' || x.status === 'scheduled');
        const past = c.list.filter((x) => x.status === 'done' || x.status === 'cancelled' || x.status === 'declined');
        return (
          <>
            <div className="consult-top">
              <Card className="consult-plan">
                <span className="item-ic"><IconConsult /></span>
                <div><b>Free · {c.minutes || 30}-minute call</b>
                  <p className="muted">Ask whenever you need one. The teacher accepts and sends a time, or declines if it is not possible.</p></div>
              </Card>
              {upcoming.map((x) => (
                <Card key={x.id} className={`consult-next ${x.status}`}>
                  <small>{STATUS[x.status][1]}</small>
                  <b>{x.status === 'scheduled' && x.scheduled_at ? when(x.scheduled_at) : x.preferred}</b>
                  {x.note && <p className="muted">{x.note}</p>}
                  <div className="row wrap" style={{ gap: 8 }}>
                    {x.link && <a className="btn primary sm" href={x.link} target="_blank" rel="noreferrer">Join the call</a>}
                    <button className="btn ghost sm" onClick={() => cancel(x.id)}>Cancel</button>
                  </div>
                </Card>
              ))}
            </div>
            {!c.next_at && !upcoming.length && (
              <Card className="stack">
                <h3 className="sr-h">Ask for a consultation</h3>
                <div className="grid g2">
                  <Field label="When suits you?"><input value={f.preferred} onChange={(e) => setF({ ...f, preferred: e.target.value })} placeholder="Saturday after 15:00" /></Field>
                  <Field label="What to discuss" hint="optional"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="My last full mock, Boundaries…" /></Field>
                </div>
                <div><button className="btn primary" disabled={busy || !f.preferred.trim()} onClick={book}>Request a consultation</button></div>
                <small className="muted">The teacher confirms the time and adds a meeting link here. You also see it on this page.</small>
              </Card>
            )}
            <Card>
              <h3 className="sr-h">History</h3>
              {!past.length ? <Empty icon={<IconConsult />} title="No consultations yet" text="Your past calls will appear here." /> : (
                <div className="consult-hist">{past.map((x) => (
                  <div key={x.id}><span>{x.scheduled_at ? when(x.scheduled_at) : fmtDate(x.created_at)}</span><span className="muted">{x.note || x.preferred}</span><span className={`chip ${STATUS[x.status][0]}`}>{STATUS[x.status][1]}</span></div>
                ))}</div>
              )}
            </Card>
          </>
        );
      }}</Gate>
    </div>
  );
}
