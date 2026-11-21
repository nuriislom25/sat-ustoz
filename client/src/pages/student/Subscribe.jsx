import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { InviteCard } from '../../components/Growth.jsx';
import { useAuth, useToast } from '../../context.jsx';
import { api, fmtDate } from '../../api.js';
import { getConfig } from '../../config.js';
import { Card, Field, Gate, Modal, PageHeader, Segmented, useAsync } from '../../components/ui.jsx';
import { IconCheck, IconCopy, IconCrown, IconSend, IconX } from '../../components/icons.jsx';

export const fmtMoney = (n, cur) => `${Number(n || 0).toLocaleString('en-US').replace(/,/g, ' ')} ${cur === 'UZS' ? "so'm" : cur || ''}`.trim();
const lim = (n, unit) => (n ? `${n} ${unit}` : `Unlimited ${unit.replace(/ \/.*/, '')}`);

/** What each plan gives, in plain words (limits come from Settings). */
export function tierPerks(t) {
  return [
    [true, `${lim(t.q_day, 'questions / day')} with explanations`],
    [true, `${t.quiz_day ? `${t.quiz_day} quizzes / day` : 'Unlimited quizzes'} and score tracking`],
    [true, t.fm_week ? `${t.fm_week} full mock${t.fm_week === 1 ? '' : 's'} / week` : 'Unlimited full mocks'],
    [true, 'Word Vault: every deck and Words in Context'],
    [t.roadmap, t.video ? 'Roadmap lessons with video' : 'Roadmap lessons (no video)'],
    [t.ask, 'Ask the teacher about any question'],
    [!!t.consult_days, t.consult_days ? `${t.consult_min}-min consultation ${t.consult_days <= 7 ? 'every week' : `every ${Math.round(t.consult_days / 7)} weeks`}` : 'Consultations with the teacher'],
    [t.live, t.live ? '12 live 1-on-1 lessons a month at your fixed time' : 'Live 1-on-1 lessons with the teacher'],
  ];
}

/** Math plans: the same Plus / Pro / Pro Max, with Math content (no live lessons). */
export function mathPerks(t) {
  return [
    [true, 'Unlimited SAT Math practice with explanations and Desmos'],
    [true, 'Math quizzes from your teacher, mistakes and results'],
    [t.roadmap, 'Math roadmap: every video lesson and its practice'],
    [t.ask, 'Ask the teacher about any Math question'],
  ];
}

const brand = (n) => { const d = String(n).replace(/\D/g, ''); return d.startsWith('8600') ? 'UZCARD' : d.startsWith('9860') ? 'HUMO' : d.startsWith('4') ? 'VISA' : d.startsWith('5') ? 'MASTERCARD' : 'CARD'; };

/** A bank card drawn for the eye: number in groups, holder, copy button. */
export function PayCard({ card }) {
  const toast = useToast();
  const num = String(card.number).replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const copy = async () => { try { await navigator.clipboard.writeText(num.replace(/\s/g, '')); toast('Card number copied'); } catch { toast(num); } };
  return (
    <div className="paycard">
      <div className="paycard-top"><span className="paycard-chip" aria-hidden="true" /><b>{brand(card.number)}</b></div>
      <button type="button" className="paycard-num" onClick={copy} aria-label="Copy card number">{num}<IconCopy width={18} height={18} /></button>
      <div className="paycard-bottom"><div><small>Card holder</small><span>{card.holder || '—'}</span></div><div><small>SAT Ustoz</small><span>Payments</span></div></div>
    </div>
  );
}

export default function Subscribe() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [buy, setBuy] = useState(null);
  const st = useAsync(() => Promise.all([api.get('/plans'), api.get('/me/balance')]), []);
  const [cfg, setCfg] = useState(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { getConfig().then(setCfg); }, []);
  const pay = async () => {
    setOpening(true);
    const w = window.open('', '_blank');
    try { const r = await api.get('/telegram/link'); if (w) w.location.href = r.url; else window.location.href = r.url; }
    catch (e) { w?.close(); toast(e.message, 'bad'); } finally { setOpening(false); }
  };
  const [params, setParams] = useSearchParams();
  const subj = ['english', 'math', 'both'].includes(params.get('subject')) ? params.get('subject') : user.subject === 'math' ? 'math' : 'english';
  const setSubj = (v) => { const n = new URLSearchParams(params); n.set('subject', v); setParams(n, { replace: true }); };
  const engOn = !!user.sub_active; const mathOn = !!user.access?.math?.sub_active;
  const tierId = subj === 'math' ? (mathOn ? user.access.math.tier.id : 'free') : subj === 'english' ? user.access?.tier?.id || 'free' : null;

  return (
    <div className="page">
      <PageHeader title="Plans & balance" sub="English and Math are separate plans. Take both and save." />
      <Gate state={st}>{([p, bal]) => {
        const pct = p.bundle_discount || 0;
        // the bundle discount: both at once, or the other subject already active
        const disc = subj === 'both' || (subj === 'math' && engOn) || (subj === 'english' && mathOn) ? pct : 0;
        const full = (t) => (subj === 'math' ? t.math_price : subj === 'both' ? t.price + t.math_price : t.price);
        const priceOf = (t) => Math.round((full(t) * (100 - disc)) / 100);
        const tiers = p.tiers.filter((t) => subj === 'english' || !t.live);
        return (
        <>
          <div className="sub-top">
            <Card className="sub-now">
              <span className="item-ic" style={{ width: 48, height: 48 }}><IconCrown /></span>
              <div className="grow">
                <small className="muted">Your plans</small>
                <div className="sub-two">
                  <div><small>English</small><b className="sub-plan">{engOn ? user.access?.tier?.name : 'Free'}</b><p className="muted">{engOn ? `Until ${fmtDate(user.sub_until)}` : `${p.free.q_day} questions a day`}</p></div>
                  <div><small>Math</small><b className="sub-plan">{mathOn ? user.access.math.tier.name : 'Free trial'}</b><p className="muted">{mathOn ? `Until ${fmtDate(user.access.math.sub_until)}` : `${p.math_free?.q_day ?? 10} questions a day · ${p.math_free?.free_lessons ?? 2} lessons`}</p></div>
                </div>
              </div>
            </Card>
            <div className="wallet-col">
              <WalletCard no={bal.wallet_no} name={user.name} balance={fmtMoney(bal.balance, p.currency)} />
              <div className="row wrap" style={{ gap: 8 }}>
                {cfg?.telegram_bot ? <button className="btn primary" disabled={opening} onClick={pay}><IconSend width={16} height={16} /> Top up in Telegram</button> : <a className="btn primary" href="#pay">Top up</a>}
                <small className="muted" style={{ flex: 1, minWidth: 180 }}>Any amount. Use it for plans, extra full mocks ({fmtMoney(p.fm_extra_price, p.currency)}) and, soon, books.</small>
              </div>
            </div>
          </div>

          <div className="subj-tabs" role="tablist" aria-label="Subject">
            {[['english', 'English'], ['math', 'Math'], ['both', 'English + Math']].map(([v, l]) => (
              <button key={v} role="tab" aria-selected={subj === v} className={subj === v ? 'on' : ''} onClick={() => setSubj(v)}>{l}{v === 'both' && pct > 0 && <span className="chip sun">-{pct}%</span>}</button>
            ))}
          </div>
          {disc > 0 && <p className="bundle-note"><IconCheck width={16} height={16} /> {subj === 'both' ? `English and Math together: ${pct}% off both.` : `You already have ${subj === 'math' ? 'English' : 'Math'}, so this plan is ${pct}% off.`}</p>}
          {subj !== 'both' && pct > 0 && !disc && <p className="muted bundle-note soft">Take English and Math together and get {pct}% off.</p>}

          <div className="tiers stagger">
            {tiers.map((t, i) => {
              const price = priceOf(t);
              const mine = t.id === tierId;
              return (
              <Card key={`${subj}-${t.id}`} className={`tier ${mine ? 'cur' : ''} ${i === 2 ? 'best' : ''}`}>
                {i === 2 && <span className="chip primary ribbon">Most chosen</span>}
                <small className="tier-n">{subj === 'both' ? 'English + Math' : subj === 'math' ? 'Math' : `Plan ${i + 1}`}</small>
                <b className="tier-name">{t.name}</b>
                <div className="price">{disc > 0 && !t.live && <s className="muted">{fmtMoney(full(t), p.currency)}</s>}{fmtMoney(t.live ? t.price : price, p.currency)}<small>{t.live ? ' / 12 lessons' : ' / month'}</small></div>
                <ul className="tier-perks">{(subj === 'math' ? mathPerks(t) : subj === 'both' ? [...tierPerks(t).slice(0, 5), ...mathPerks(t).slice(0, 3)] : tierPerks(t)).map(([on, x]) => <li key={x} className={on ? '' : 'off'}>{on ? <IconCheck width={16} height={16} /> : <IconX width={14} height={14} />}{x}</li>)}</ul>
                {t.live && <small className="muted tier-self">Fixed time, 3 lessons a week, one student per time</small>}
                {!t.live && t.id === 't3' && <small className="muted tier-self">Everything, at your own pace</small>}
                {t.live ? <Link className="btn sun" to="/live">{mine ? 'My lesson time' : 'Choose a lesson time'}</Link> : <>
                {bal.balance >= price ? <button className="btn primary" onClick={() => setBuy({ tier: t, subject: subj, price })}>{mine ? 'Extend from wallet' : 'Buy from wallet'}</button>
                  : bal.balance > 0 && <button className="btn ghost sm" onClick={() => setBuy({ tier: t, subject: subj, price })}>I have a promo code</button>}
                {mine ? <span className="chip good" style={{ justifySelf: 'start' }}><IconCheck width={14} height={14} /> Your plan</span>
                  : bal.balance >= price ? null : cfg?.telegram_bot ? <button className="btn primary" disabled={opening} onClick={pay}><IconSend width={18} height={18} /> Pay via Telegram</button>
                    : <a className="btn soft" href="#pay">Pay by card</a>}
                </>}
              </Card>
              );
            })}
          </div>

          <Card className="pay-how" id="pay">
            <div>
              <h2>How to pay</h2>
              <ol className="pay-steps">
                <li>Transfer the plan price (or any amount for your balance) to this card.</li>
                <li>Send a photo of the receipt in the Telegram bot or the <b>Ask Ustoz</b> chat, and write which plan you chose.</li>
                <li>The teacher checks it and turns your plan on (or adds the money to your balance), usually within a few hours.</li>
              </ol>
              <p className="muted" style={{ fontSize: '.84rem' }}>Your account: <b style={{ color: 'var(--ink)' }}>{user.email || user.login}</b>. Payments follow the <a href="/p/oferta" target="_blank" rel="noreferrer">oferta</a>.</p>
            </div>
            {p.card ? <PayCard card={p.card} /> : <p className="muted">The teacher has not added a card yet. Write in the Ask Ustoz chat.</p>}
          </Card>

          <Extras access={user.access} />
          <InviteCard />
          {buy && <BuyModal {...buy} balance={bal.balance} currency={p.currency} onClose={() => setBuy(null)} onDone={() => { setBuy(null); st.reload(); refresh(); }} />}

          {bal.history.length > 0 && (
            <Card>
              <h3 className="sr-h">Balance history</h3>
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Balance</th></tr></thead>
                <tbody>{bal.history.map((h, i) => <tr key={i}><td className="nowrap">{fmtDate(h.created_at)}</td><td>{h.reason === 'top_up' ? 'Top-up' : h.reason === 'full_mock' ? `Full mock${h.note ? ` · ${h.note}` : ''}` : h.reason === 'prize' ? `Leaderboard prize${h.note ? ` · ${h.note}` : ''}` : h.note || h.reason}</td>
                  <td className={h.amount > 0 ? 'good-text' : ''}>{h.amount > 0 ? '+' : ''}{fmtMoney(h.amount, p.currency)}</td><td>{fmtMoney(h.balance_after, p.currency)}</td></tr>)}</tbody>
              </table></div>
            </Card>
          )}
        </>
        );
      }}</Gate>
    </div>
  );
}

/** The student's own wallet on the platform, drawn as a card. */
export function WalletCard({ no, name, balance }) {
  return (
    <div className="paycard wallet">
      <div className="paycard-top"><span className="wallet-logo">SAT<i>Ustoz</i></span><b>WALLET</b></div>
      <div className="wallet-bal"><small>Balance</small><span>{balance}</span></div>
      <div className="paycard-bottom"><div><small>Owner</small><span>{name}</span></div><div style={{ textAlign: 'right' }}><small>Wallet No.</small><span className="mono">{no}</span></div></div>
    </div>
  );
}

/** Pay a plan from the wallet: 1, 3 or 6 months, one confirmation, charged once. */
function BuyModal({ tier, subject = 'english', price, balance, currency, onClose, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => Math.random().toString(36).slice(2) + Date.now().toString(36));
  const [code, setCode] = useState('');
  const [promo, setPromo] = useState(null); // { code, pct, price, saved } for the chosen months
  const [promoErr, setPromoErr] = useState('');
  const base = (price ?? tier.price) * months;
  const total = promo ? promo.price : base;
  const what = subject === 'both' ? `${tier.name} · English + Math` : subject === 'math' ? `${tier.name} · Math` : tier.name;
  const check = async (c = code, m = months) => {
    if (!c.trim()) { setPromo(null); setPromoErr(''); return; }
    try { setPromo(await api.post('/promo/check', { code: c.trim(), plan: tier.id, months: m, subject })); setPromoErr(''); }
    catch (e) { setPromo(null); setPromoErr(e.message); }
  };
  useEffect(() => { if (promo) check(promo.code, months); }, [months]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post('/plans/buy', { plan: tier.id, months, subject, key: `${key}-${subject}-${months}-${promo?.code || ''}`, promo: promo?.code || '' });
      toast(`${what} is active until ${fmtDate(r.until || r.math_until)}${r.promo ? ` · you saved ${fmtMoney(r.promo.saved, currency)}` : ''}`); onDone();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${what} from your wallet`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || total > balance} onClick={go}>Pay {fmtMoney(total, currency)}</button></>}>
      <Segmented value={months} onChange={setMonths} options={[1, 3, 6].map((m) => ({ value: m, label: `${m} month${m > 1 ? 's' : ''}` }))} />
      <form className="promo-row" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Promo code" aria-label="Promo code" maxLength={24} autoCapitalize="characters" />
        <button type="submit" className="btn soft">Apply</button>
      </form>
      {promoErr && <p className="bad-text">{promoErr}</p>}
      {promo && <p className="promo-ok"><IconCheck width={16} height={16} /> {promo.code}: -{promo.pct}% · <s className="muted">{fmtMoney(base, currency)}</s> <b>{fmtMoney(promo.price, currency)}</b></p>}
      <p className="muted">Wallet: {fmtMoney(balance, currency)} → after payment {fmtMoney(Math.max(0, balance - total), currency)}.</p>
      {total > balance && <p className="bad-text">Not enough in the wallet: top it up by {fmtMoney(total - balance, currency)}.</p>}
      {subject !== 'math' && user.sub_active && user.access?.tier?.id !== tier.id && <p className="warn-text">Your English plan ({user.access?.tier?.name}, until {fmtDate(user.sub_until)}) is replaced by {tier.name} from today.</p>}
      {subject !== 'english' && user.access?.math?.sub_active && user.access.math.tier.id !== tier.id && <p className="warn-text">Your Math plan ({user.access.math.tier.name}, until {fmtDate(user.access.math.sub_until)}) is replaced by {tier.name} from today.</p>}
    </Modal>
  );
}

/** Plan extras: consultation booking (plans 2–4) and live lessons (plan 4). */
export function Extras({ access, stacked = false }) {
  const toast = useToast();
  const consult = useAsync(() => (access?.tier?.consult_days ? api.get('/consultations') : Promise.resolve(null)), [access?.tier?.consult_days]);
  const live = useAsync(() => (access?.live ? api.get('/live') : Promise.resolve(null)), [access?.live]);
  const [f, setF] = useState({ preferred: '', note: '' });
  const [busy, setBusy] = useState(false);
  const book = async () => {
    setBusy(true);
    try { await api.post('/consultations', f); toast('Request sent. The teacher will confirm the time.'); setF({ preferred: '', note: '' }); consult.reload(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const c = consult.data;
  if (!c && !live.data) return null;
  return (
    <div className={stacked ? 'stack' : 'grid g2'}>
      {c && (
        <Card className="stack">
          <h3 className="sr-h">Consultation with the teacher</h3>
          <p className="muted">{c.minutes} minutes, {c.every_days <= 7 ? 'once a week' : `once every ${Math.round(c.every_days / 7)} weeks`}.{c.list.some((x) => x.status === 'scheduled') ? ' You have a booked call.' : ''}</p>
          <Link className="btn soft" to="/consultations">Open Consultations</Link>
        </Card>
      )}
      {live.data && (
        <Card className="stack">
          <h3 className="sr-h">Live 1-on-1 lessons</h3>
          <p className="muted">{live.data.note || 'Your fixed lesson time, renewal and next lessons.'}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <Link className="btn soft" to="/live">Open Live lessons</Link>
            {live.data.link && <a className="btn primary" href={live.data.link} target="_blank" rel="noreferrer">Join the live lesson</a>}
          </div>
        </Card>
      )}
    </div>
  );
}
