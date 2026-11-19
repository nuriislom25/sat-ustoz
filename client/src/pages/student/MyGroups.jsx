import { api } from '../../api.js';
import { Avatar, Card, Empty, Gate, PageHeader, useAsync } from '../../components/ui.jsx';
import { IconCalendar, IconClock, IconLayers, IconTelegram, IconTrophy, IconUsers } from '../../components/icons.jsx';
import { SUBJECT, scheduleText, shortDate } from '../master/Groups.jsx';

/** Student: my groups — schedule, level, dates, the teacher's note, Telegram link, my attendance, and this week's ranking among groupmates. */
export default function MyGroups() {
  const st = useAsync(() => api.get('/my-groups'), []);
  return (
    <div className="page grp-page">
      <PageHeader title="My group" sub="Your class: when lessons are, your attendance and how you rank among your groupmates this week." />
      <Gate state={st}>{(d) => !d.groups.length ? (
        <Card><Empty icon={<IconLayers />} title="You are not in a group yet" text="When your teacher adds you to a class, its schedule and ranking show here." /></Card>
      ) : (
        <div className="stack">
          {d.groups.map((g) => (
            <section key={g.id} className="mg" style={{ '--gc': g.color }}>
              <div className="mg-head">
                <span className="grp-dot lg">{g.name.slice(0, 1).toUpperCase()}</span>
                <div style={{ minWidth: 0 }} className="grow">
                  <h2>{g.name}</h2>
                  <div className="row wrap" style={{ gap: 6 }}><span className="chip">{SUBJECT[g.subject]}</span>{g.level && <span className="chip">{g.level}</span>}<span className="chip"><IconUsers width={13} height={13} /> {g.classmates}</span></div>
                </div>
                {g.telegram_url && <a className="btn sun mg-tg" href={g.telegram_url} target="_blank" rel="noreferrer"><IconTelegram width={18} height={18} /> Telegram group</a>}
              </div>
              <div className="mg-facts">
                {scheduleText(g) && <div><IconClock width={18} height={18} /><span><small>Lessons</small><b>{scheduleText(g)}</b></span></div>}
                {(g.starts_on || g.ends_on) && <div><IconCalendar width={18} height={18} /><span><small>Course</small><b>{shortDate(g.starts_on) || '…'} – {shortDate(g.ends_on) || '…'}</b></span></div>}
                <div className={g.attendance.pct != null && g.attendance.pct < 70 ? 'low' : ''}><IconUsers width={18} height={18} /><span><small>My attendance</small>
                  <b>{g.attendance.lessons ? `${g.attendance.pct}% · ${g.attendance.present} of ${g.attendance.lessons} lessons` : 'No lessons marked yet'}</b></span></div>
              </div>
              {g.note && <p className="mg-note">{g.note}</p>}
              <Card className="mg-board">
                <div className="row between wrap" style={{ gap: 6 }}>
                  <h3><IconTrophy width={18} height={18} /> This week in {g.name}</h3>
                  {g.me && <small className="muted">You: #{g.me.rank} · {g.me.points} points</small>}
                </div>
                {!g.ranked ? <p className="muted">Nobody has points yet this week. Answer questions to be first.</p> : (
                  <ol className="mg-list">
                    {g.board.filter((x) => x.points > 0 || x.me).map((x) => (
                      <li key={x.id} className={x.me ? 'me' : ''}>
                        <span className={`mg-rank r${x.rank}`}>{x.rank}</span>
                        <Avatar name={x.name} src={x.avatar_url} size={30} />
                        <span className="grow">{x.name}{x.me ? ' (you)' : ''}</span>
                        <b>{x.points}</b>
                      </li>
                    ))}
                    {g.me && g.me.rank > g.board.length && <li className="me"><span className="mg-rank">{g.me.rank}</span><Avatar name={g.me.name} src={g.me.avatar_url} size={30} /><span className="grow">{g.me.name} (you)</span><b>{g.me.points}</b></li>}
                  </ol>
                )}
                <small className="muted">Points: 10 per correct answer, 2 per word review, 1 per minute of study. Resets every Monday.</small>
              </Card>
            </section>
          ))}
        </div>
      )}</Gate>
    </div>
  );
}
