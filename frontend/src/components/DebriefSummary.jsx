// A workout debrief, as the Coach read it: the score, the session's numbers against the last
// time the same routine was trained, and the three lists. Its own component because two
// screens show it — the chat (views/CoachChat.jsx), and the finish summary the moment a
// workout ends (sheets.jsx FinishSummary), where the summary is written automatically.
import { useMemo } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { sessionInsights } from '../lib/coach-insights.js'
import Icon from './Icon.jsx'

export const Tile = ({ v, l }) => <div className="ins-tile"><div className="ins-tile-v">{v}</div><div className="ins-tile-l">{l}</div></div>
export const kfmt = n => (n >= 10000 ? Math.round(n / 1000) + 'k' : fmtNum(n))
const Delta = ({ v, unit, label }) => <span className={'ins-delta' + (v > 0 ? ' up' : v < 0 ? ' down' : '')}>{v > 0 ? '+' : ''}{fmtNum(v)} {unit} {label}</span>
const DebriefList = ({ icon, tint, title, items }) => !!items?.length && <div className="deb-list">
  <div className="deb-list-h" style={{ color: tint }}><Icon name={icon} />{title}</div>
  {items.map((x, i) => <div key={i} className="deb-item">{x}</div>)}
</div>
export const scoreWord = s => s >= 9 ? t('Excellent session') : s >= 7 ? t('Good session') : s >= 5 ? t('Solid session') : t('Tough session')

export default function DebriefSummary({ p, S }) {
  const w = p.workout || {}
  const live = useMemo(() => sessionInsights(S, (S.workouts || []).find(x => x.id === w.id) || null), [S, w.id])
  const score = Number.isFinite(p.score) ? Math.max(1, Math.min(10, p.score)) : null
  return <>
    {score != null && <div className="deb-score">
      <div className="deb-ring" style={{ '--pct': score / 10 }}><span>{score}</span><small>/10</small></div>
      <div className="deb-score-t"><b>{scoreWord(score)}</b><span>{w.name || t('Workout')}{w.d ? ' · ' + fmtDate(w.d) : ''}</span></div>
    </div>}
    {live && <div className="ins">
      <div className="ins-tiles">
        <Tile v={live.now.sets} l={t('Sets')} />
        <Tile v={live.now.minutes != null ? live.now.minutes : '–'} l={t('Minutes')} />
        <Tile v={live.now.volume ? kfmt(live.now.volume) : '–'} l={t('Volume ({0})', S.unit)} />
        <Tile v={live.now.prs || '–'} l={t('PRs')} />
      </div>
      {live.then && <div className="ins-cmp">
        {t('vs. last {0} on {1}:', w.name || t('session'), fmtDate(live.prevDate))}{' '}
        <Delta v={live.now.volume - live.then.volume} unit={S.unit} label={t('volume')} />
        {live.now.minutes != null && live.then.minutes != null && <Delta v={live.now.minutes - live.then.minutes} unit="min" label={t('time')} />}
      </div>}
      {!!live.lifts.length && <div className="ins-block">
        <div className="ins-h"><span>{t('Best set, estimated 1RM')}</span></div>
        {live.lifts.slice(0, 6).map(x => <div key={x.id} className="ins-row">
          <span className="ins-row-n">{x.name} <span className="dim">{fmtNum(x.w)}×{x.r}</span></span>
          <span className="ins-row-v"><span className="tag acc">{fmtNum(x.est)}</span></span>
          {x.prev != null && <span className={'ins-delta' + (x.est > x.prev ? ' up' : x.est < x.prev ? ' down' : '')}>{x.est > x.prev ? '▲' : x.est < x.prev ? '▼' : '•'} {fmtNum(Math.abs(x.est - x.prev))}</span>}
        </div>)}
      </div>}
    </div>}
    <DebriefList icon="checkCircle" tint="var(--green)" title={t('What went well')} items={p.highlights} />
    <DebriefList icon="warning" tint="var(--yellow)" title={t('Worth watching')} items={p.watch} />
    <DebriefList icon="arrowUp" tint="var(--acc)" title={t('Next time')} items={p.nextTime} />
  </>
}
