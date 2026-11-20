import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Character from '../../components/Character.jsx';
import { sfxRight, sfxWrong } from '../../components/gameAudio.js';
import { big } from './GameHub.jsx';

/** Cipher Raid: the player's secret password, mystery boxes after a right answer, and the hack itself. */

/** Pick one of five random passwords or type your own. */
export function PasswordPick({ code, value, onChange }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let live = true;
    api.get(`/game/${code}/passwords`).then((r) => { if (live) { setList(r.passwords); if (!value) onChange(r.passwords[0]); } }).catch(() => {});
    return () => { live = false; };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="raid-pw">
      <small className="arena-label">YOUR SECRET PASSWORD</small>
      <p className="raid-hint">Others try to guess it to steal your credits. Remember it.</p>
      <div className="raid-pw-list" role="radiogroup" aria-label="Choose a password">
        {list.map((p) => <button type="button" key={p} role="radio" aria-checked={value === p} className={value === p ? 'on' : ''} onClick={() => onChange(p)}>{p}</button>)}
      </div>
      <input value={list.includes(value) ? '' : value} onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24))} placeholder="or type your own" aria-label="Your own password" maxLength={24} />
    </div>
  );
}

/** Right after the host starts a Cipher Raid: each player chooses the secret password (once), then the questions start. */
export function PasswordGate({ code, token, onDone }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post(`/game/${code}/password`, { token, pw }); await onDone(); }
    catch (ex) { setErr(ex.message); setBusy(false); if (ex.status === 409) onDone(); }
  };
  return (
    <form className="arena-card arena-joinform raid-gate" onSubmit={save}>
      <small className="arena-label">CIPHER RAID · THE GAME HAS STARTED</small>
      <h2>Choose your secret password</h2>
      <PasswordPick code={code} value={pw} onChange={setPw} />
      {err && <p className="arena-err">{err}</p>}
      <button className="btn sun lg block" disabled={busy || pw.length < 3}>{busy ? 'Saving…' : 'Lock it and start'}</button>
    </form>
  );
}

const BOX = {
  bonus: 'Points', jackpot: 'Jackpot', double: 'Double', triple: 'Triple', steal: 'Steal', swap: 'Swap', shield: 'Shield', freeze: 'Freeze', hack: 'Hack',
};
const TARGET_TEXT = {
  steal: (pct) => `Steal ${pct}% of someone's points. Who?`,
  swap: () => 'Swap your score with someone. Who?',
  freeze: () => 'Freeze someone for 10 seconds. Who?',
};
/** Three mystery boxes after a right answer: points, Double, Triple, Steal, Swap, Shield, Freeze (and Hack in Cipher Raid).
 * Every choice takes two taps (select, then tap again to confirm); the player moves on with "Next question".
 * Calls onDone(score) when the player moves on. `others` = players who can be picked for Steal / Swap / Freeze. */
export function RaidPanel({ code, token, init, onDone, others = [] }) {
  const [stage, setStage] = useState(init?.stage || 'boxes');
  const [boxes, setBoxes] = useState(['', '', '']);
  const [pick, setPick] = useState(-1);   // the box that was opened
  const [sel, setSel] = useState(null);    // selected, waiting for the second tap
  const [res, setRes] = useState(init?.stage === 'hack' ? { kind: 'hack', action: init.action || 'hack', victim: init.victim, options: init.options }
    : init?.stage === 'target' ? { kind: init.target.kind, pct: init.target.pct, targets: others } : null);
  const [out, setOut] = useState(null);
  const [done, setDone] = useState(false); // the result is shown: "Next question"
  const [now, setNow] = useState(0);
  const t0 = useRef(Date.now());
  const busy = useRef(false);
  const guard = useRef(Date.now() + 400);
  const score = useRef(null);
  const fresh = () => { guard.current = Date.now() + 400; setSel(null); };
  const twice = (key, go) => {
    if (busy.current || Date.now() < guard.current) return;
    if (sel === key) go(); else setSel(key);
  };

  useEffect(() => { if (stage !== 'hack' || out) return undefined; t0.current = Date.now(); const t = setInterval(() => setNow(Date.now() - t0.current), 200); return () => clearInterval(t); }, [stage, out]);

  const open = async (i) => {
    if (pick >= 0) return;
    busy.current = true; setPick(i);
    try {
      const r = await api.post(`/game/${code}/box`, { token, i });
      setBoxes(r.boxes || boxes); setRes(r); fresh();
      if (r.kind === 'hack') setStage('hack');
      else if (r.targets) setTimeout(() => { setStage('target'); fresh(); }, 700);
      else { score.current = r.score; sfxRight(); setStage('gift'); setDone(true); }
    } catch { onDone(null); }
    busy.current = false;
  };
  const target = async (id) => {
    if (out) return;
    busy.current = true;
    try {
      const r = await api.post(`/game/${code}/target`, { token, id });
      // Cipher Raid swap: first crack their password
      if (r.code) { setRes({ kind: 'hack', action: r.kind, victim: r.victim, options: r.options }); setStage('hack'); fresh(); busy.current = false; return; }
      setOut(r); score.current = r.score; (r.blocked ? sfxWrong : sfxRight)(); setDone(true); fresh();
    }
    catch { onDone(null); }
    busy.current = false;
  };
  const hack = async (k) => {
    if (out) return;
    busy.current = true;
    try { const r = await api.post(`/game/${code}/hack`, { token, choice: k }); setOut({ ...r, pick: k }); score.current = r.score; (r.found && !r.blocked && (r.amt || r.action) ? sfxRight : sfxWrong)(); setDone(true); fresh(); }
    catch { onDone(null); }
    busy.current = false;
  };
  const moveOn = () => { if (Date.now() >= guard.current) onDone(score.current); };

  const sec = now / 1000;
  const live = sec <= 6 ? 60 - 10 * (sec / 6) : sec <= 20 ? 50 - 30 * ((sec - 6) / 14) : 20;
  const label = (t) => BOX[t] || '';
  const giftTitle = { jackpot: 'Jackpot', double: 'Double!', triple: 'Triple!', shield: 'Shield on', bonus: 'Points' }[res?.kind] || 'Points';
  const giftText = res?.kind === 'shield' ? 'The next steal, swap, freeze or hack on you is blocked.' : res?.kind === 'double' || res?.kind === 'triple' ? `Your score: ${big(res.score)}` : `+${big(res?.amt)} points`;
  const again = <p className="raid-again">Tap again to confirm</p>;

  return (
    <div className="raid-layer" role="dialog" aria-modal="true" aria-label="Lucky chance">
      <div className="raid-card">
        {(stage === 'boxes' || stage === 'gift') && (
          <>
            <small className="raid-tag">LUCKY CHANCE</small>
            <h3>{stage === 'boxes' ? 'Pick a box' : giftTitle}</h3>
            <div className="raid-boxes">
              {boxes.map((b, i) => (
                <button key={i} type="button" className={`raid-box ${pick === i ? 'on' : ''} ${sel === `b${i}` ? 'sel' : ''} ${b ? `t-${b}` : ''}`} onClick={() => twice(`b${i}`, () => open(i))} disabled={pick >= 0} aria-label={`Box ${i + 1}`}>
                  <span className="raid-lock" aria-hidden="true" />
                  <b>{b ? label(b) : sel === `b${i}` ? 'Open?' : `Box ${i + 1}`}</b>
                </button>
              ))}
            </div>
            {stage === 'boxes' && (sel ? again : <p className="raid-again soft">Tap a box, then tap it again to open</p>)}
            {stage === 'gift' && <p className="raid-gain">{giftText}</p>}
          </>
        )}
        {stage === 'target' && res && (
          <>
            <small className="raid-tag hot">{label(res.kind).toUpperCase()}</small>
            <h3>{(TARGET_TEXT[res.kind] || TARGET_TEXT.steal)(res.pct)}</h3>
            {!out ? (
              <>
                <div className="box-targets">
                  {(res.targets?.length ? res.targets : others).map((o) => (
                    <button key={o.id} type="button" className={sel === `t${o.id}` ? 'sel' : ''} onClick={() => twice(`t${o.id}`, () => target(o.id))}><Character kind={o.avatar} size={40} /><b>{o.name}</b><span>{big(o.score)}</span></button>
                  ))}
                </div>
                {sel && again}
              </>
            ) : (
              <p className={`raid-gain ${out.blocked ? 'miss' : ''}`}>
                {out.blocked ? `${out.victim.name} had a shield. Blocked!`
                  : out.kind === 'steal' ? (out.amt ? `You took ${big(out.amt)} points from ${out.victim.name}` : `${out.victim.name} had nothing to take`)
                    : out.kind === 'swap' ? `You swapped scores with ${out.victim.name}: now ${big(out.score)}`
                      : `${out.victim.name} is frozen for ${out.seconds} seconds`}
              </p>
            )}
          </>
        )}
        {stage === 'hack' && res && (
          <>
            <small className="raid-tag hot">{res.action === 'swap' ? 'SWAP · ENTER THE CODE' : res.action === 'freeze' ? 'FREEZE · ENTER THE CODE' : 'HACK'}</small>
            <div className="raid-target"><Character kind={res.victim.avatar} size={54} /><div><b>{res.victim.name}</b><small>{res.action === 'swap' ? 'Pick their password to swap scores with them.' : res.action === 'freeze' ? 'Pick their password to freeze them for 10 seconds.' : 'Which one is their password?'}</small></div></div>
            <div className="raid-opts">
              {res.options.map((o, k) => (
                <button key={o} type="button" className={`raid-opt ${out ? (out.pick === k ? (out.found ? 'right' : 'wrong') : 'dim') : sel === `h${k}` ? 'sel' : ''}`} onClick={() => twice(`h${k}`, () => hack(k))} disabled={!!out}>{o}</button>
              ))}
            </div>
            {!out && (sel ? again : res.action === 'swap' ? <p className="raid-again soft">Right password = your scores swap</p> : res.action === 'freeze' ? <p className="raid-again soft">Right password = they are frozen</p> : <p className="raid-meter">Steal now: <b>{Math.round(live)}%</b> of their credits <small>(drops the longer you wait)</small></p>)}
            {out && res.action === 'swap' && <p className={`raid-gain ${out.found ? '' : 'miss'}`}>{out.blocked ? `${res.victim.name} had a shield. Blocked!` : out.found ? `Code cracked! You swapped scores with ${res.victim.name}: now ${big(out.score)}` : 'Wrong password. No swap.'}</p>}
            {out && res.action === 'freeze' && <p className={`raid-gain ${out.found && !out.blocked ? '' : 'miss'}`}>{out.blocked ? `${res.victim.name} had a shield. Blocked!` : out.found ? `Code cracked! ${res.victim.name} is frozen for ${out.freeze} seconds` : 'Wrong password. No freeze.'}</p>}
            {out && res.action !== 'swap' && res.action !== 'freeze' && <p className={`raid-gain ${out.found && out.amt ? '' : 'miss'}`}>{out.blocked ? `${res.victim.name} had a shield. Blocked!` : out.found ? (out.amt ? `Access! You took ${big(out.amt)} credits (${out.pct}%) in ${out.seconds}s` : 'Access, but they had nothing left') : 'Wrong password. Nothing stolen.'}</p>}
          </>
        )}
        {done && <button type="button" className="btn sun lg block" onClick={moveOn}>Next question</button>}
      </div>
    </div>
  );
}

/** Slides in when someone has just stolen from the player. */
export function HitBanner({ hit }) {
  const [shown, setShown] = useState(null);
  const seen = useRef(hit?.seq || 0);
  useEffect(() => {
    if (!hit || hit.seq <= seen.current) return undefined;
    seen.current = hit.seq; setShown(hit);
    const t = setTimeout(() => setShown(null), 4200);
    return () => clearTimeout(t);
  }, [hit?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const k = shown.kind || 'hack';
  return (
    <div className={`raid-hit ${k === 'blocked' ? 'good' : ''}`} role="status">
      {k === 'blocked' ? <>Your shield blocked <b>{shown.by}</b></>
        : k === 'steal' ? <><b>{shown.by}</b> stole <b>{big(shown.amt)}</b> points from you</>
          : k === 'swap' ? <><b>{shown.by}</b> swapped scores with you</>
            : k === 'freeze' ? <><b>{shown.by}</b> froze you for 10 seconds</>
              : <><b>{shown.by}</b> hacked you and took <b>{big(shown.amt)}</b> credits</>}
    </div>
  );
}
