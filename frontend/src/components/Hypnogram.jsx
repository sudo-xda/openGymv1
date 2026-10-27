// The night as a hypnogram: the sleep stages over the night's hours, awake at the top, deep
// at the bottom, in the sleep bar's colours (health.css). Pure SVG, the segments from
// lib/biometrics.js sleepOf: `[[start, end, kind]]`.
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'

const ROWS = ['awake', 'rem', 'light', 'deep']
const LABEL = { awake: () => t('Awake'), rem: () => t('REM'), light: () => t('Light'), deep: () => t('Deep') }
const W = 320, ROW_H = 16, PAD_L = 40, PAD_B = 16
const clock = ms => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })

export default function Hypnogram({ stages, from, to }) {
  const segs = (Array.isArray(stages) ? stages : []).filter(s => Array.isArray(s) && s[1] > s[0] && ROWS.includes(s[2]))
  if (segs.length < 2) return null
  const t0 = Math.min(from ?? Infinity, ...segs.map(s => s[0])), t1 = Math.max(to ?? -Infinity, ...segs.map(s => s[1]))
  if (!(t1 > t0)) return null
  const H = ROWS.length * ROW_H + PAD_B
  const X = ms => PAD_L + (ms - t0) / (t1 - t0) * (W - PAD_L - 4)
  const ticks = []
  const first = new Date(t0); first.setMinutes(0, 0, 0); if (+first < t0) first.setHours(first.getHours() + 1)
  const step = (t1 - t0) / 3600000 > 9 ? 3 : 2
  for (let m = new Date(first); m <= t1; m.setHours(m.getHours() + step)) ticks.push(+m)
  return <svg className="hypno" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Sleep stages through the night')}>
    {ROWS.map((k, i) => <g key={k}>
      <line x1={PAD_L} y1={i * ROW_H + ROW_H / 2} x2={W - 4} y2={i * ROW_H + ROW_H / 2} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
      <text x={PAD_L - 6} y={i * ROW_H + ROW_H / 2 + 3.5} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{LABEL[k]()}</text>
    </g>)}
    {segs.map(([a, b, k], i) => {
      const row = ROWS.indexOf(k)
      return <rect key={i} className={k} x={X(a)} y={row * ROW_H + 2} width={Math.max(1, X(b) - X(a))} height={ROW_H - 4} rx="2" />
    })}
    {segs.slice(1).map((s, i) => {
      // A thin step between one stage and the next, so the eye follows the night as a line.
      const prev = segs[i]
      if (s[0] - prev[1] > 60000) return null
      const ya = ROWS.indexOf(prev[2]) * ROW_H + ROW_H / 2, yb = ROWS.indexOf(s[2]) * ROW_H + ROW_H / 2
      return <line key={'l' + i} x1={X(s[0])} y1={ya} x2={X(s[0])} y2={yb} stroke="var(--label-3)" strokeWidth="1" opacity="0.6" />
    })}
    {ticks.map(ms => <text key={ms} x={X(ms)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--label-2)">{clock(ms)}</text>)}
  </svg>
}
