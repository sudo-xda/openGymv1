import { useLayoutEffect, useRef, useState } from 'react'
import { fmtNum, fmtDate, MONTHS, isoOf } from '../lib/format.js'
import { ZONE_FLOORS, ZONE_COLORS } from '../lib/hr-zones.js'
import { dateLocale } from '../lib/i18n-core.js'
import { t } from '../lib/i18n.js'

const W = 340   // viewBox width; the svg stretches to its container, height comes from `h`

// points: [{ t: ms, y: num, d?: iso, m?: 0..1, note?: str }] sorted by t.
//   m    marks the point — a second reading carried by the same dot (bigger and more solid =
//        more of it). Used for effort on the weight curve, where the two belong on one line:
//        the same weight with less left in the tank is not the same session.
//   note extra text for that point's tooltip.
// opts: { h, unit, color, axes, goal, invert, series, time, zones, spans }
//   zones = { max } shades the area under the line by heart-rate zone (lib/hr-zones.js): a
//   vertical gradient that changes colour at each zone's floor, so a hard hour reads red and an
//   easy one blue. spans = [{ from, to, label }] marks stretches of the x axis (a band's
//   workout on the day's curve) as a soft block with its label at the top.
//   time reads the x axis as hours of one day (a day's heart-rate curve): the ticks are round
//   hours and the tooltip says the clock time, not the date.
//   invert flips the y axis, for a scale that counts down as it gets harder (RIR). Without it
//   a curve of reps-in-reserve reads upside down, with the hardest sets at the floor.
//   series draws several lines instead of one: [{ points, color }] (issue #145, one per set
//   number). `points` then only anchors the hover — one per date, its `note` the tooltip — and
//   the y axis spans every series.
const clock = ms => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
export default function LineChart({ points, h = 150, unit = '', color = 'var(--acc)', axes = true, goal = null, invert = false, series = null, time = false, zones = null, spans = null }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const tipRef = useRef(null)
  const [hover, setHover] = useState(null)   // { x, y, iso, v }

  // A new dataset has different coordinates and meaning, so never carry the previous
  // point selection into it. Layout timing removes the marker before the new chart paints.
  useLayoutEffect(() => {
    setHover(null)
  }, [points])

  // The tooltip is placed after layout, from its measured size, because the chart
  // lives in an overflow-clipped box: a fixed half-width offset (what this used to
  // do) hangs the label off the edge on the first and last point, and the clip then
  // eats it. Reading offsetWidth here also covers translated labels, which are not
  // all the same length. Writing straight to the node's style keeps this off the
  // render path — hover fires on every mouse move.
  useLayoutEffect(() => {
    const tip = tipRef.current, wrap = wrapRef.current
    if (!hover || !tip || !wrap) return
    const cw = wrap.clientWidth, ch = wrap.clientHeight
    const tw = tip.offsetWidth, th = tip.offsetHeight
    const M = 4                                   // breathing room against the clip
    const cx = hover.x / W * cw, cy = hover.y / h * ch
    tip.style.left = Math.max(M, Math.min(cw - tw - M, cx - tw / 2)) + 'px'
    // Parked at the top, but dropped below the point when the point sits high
    // enough that the label would cover the very value it is reporting.
    tip.style.top = (cy < th + 14 ? Math.min(ch - th - M, cy + 14) : M) + 'px'
  })

  if (!points || points.length === 0) return <div className="empty small">{t('No data yet')}</div>
  const H = h
  const P = { l: axes ? 34 : 8, r: 12, t: 10, b: axes ? 22 : 8 }
  const single = points.length === 1
  const pts = single ? [points[0], points[0]] : points
  const multi = Array.isArray(series) && series.length > 0
  const ys = multi ? series.flatMap(s => s.points.map(p => p.y)) : pts.map(p => p.y)
  let ymin = Math.min(...ys), ymax = Math.max(...ys)
  if (goal != null && isFinite(goal)) { ymin = Math.min(ymin, goal); ymax = Math.max(ymax, goal) }
  if (ymin === ymax) { ymin -= 1; ymax += 1 }
  const pad = (ymax - ymin) * 0.12; ymin -= pad; ymax += pad
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1
  const X = t => (t1 === t0 ? (P.l + W - P.r) / 2 : P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r))
  const Y = y => {
    const f = (y - ymin) / (ymax - ymin)
    return P.t + (invert ? f : 1 - f) * (H - P.t - P.b)
  }

  const gridlines = []
  if (axes) {
    const range = ymax - ymin, raw = range / 3
    const pow = Math.pow(10, Math.floor(Math.log10(raw)))
    let step = 10 * pow
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) { step = m * pow; break }
    for (let v0 = Math.ceil(ymin / step) * step; v0 <= ymax + 1e-9; v0 += step) {
      // Snapped to the step, so adding it up never drifts, and `|| 0` turns the -0 that
      // Math.ceil gives a range just under zero into a plain 0 instead of a "-0" label.
      const v = Math.round(v0 / step) * step || 0
      const y = Y(v)
      gridlines.push(<g key={'y' + v}>
        <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={P.l - 5} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtNum(v)}</text>
      </g>)
    }
    const d0 = new Date(t0), d1 = new Date(t1)
    const ticks = []
    if (time && !single) {
      // Round hours, at a step that gives six ticks or fewer across the span.
      const hours = (t1 - t0) / 3600000
      const step = [1, 2, 3, 4, 6, 12].find(x => hours / x <= 6) || 24
      const first = new Date(d0); first.setMinutes(0, 0, 0); if (+first < t0) first.setHours(first.getHours() + 1)
      first.setHours(Math.ceil(first.getHours() / step) * step)
      for (let m = new Date(first); m <= d1; m.setHours(m.getHours() + step)) ticks.push({ t: +m, txt: clock(+m) })
    } else {
      let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1)
      while (m <= d1) { ticks.push({ t: +m, txt: t(MONTHS[m.getMonth()]) }); m = new Date(m.getFullYear(), m.getMonth() + 1, 1) }
    }
    if (ticks.length === 0 && !single && !time) {
      for (let i = 0; i <= 2; i++) {
        const tv = t0 + (t1 - t0) * i / 2, dd = new Date(tv)
        ticks.push({ t: tv, txt: dd.getDate() + ' ' + t(MONTHS[dd.getMonth()]), anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle' })
      }
    }
    const every = Math.max(1, Math.ceil(ticks.length / 7))
    ticks.forEach((tk, i) => {
      if (i % every) return
      const x = X(tk.t)
      gridlines.push(<g key={'x' + i}>
        <line x1={x} y1={P.t} x2={x} y2={H - P.b} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={x} y={H - 7} textAnchor={tk.anchor || 'middle'} fontSize="9.5" fill="var(--label-2)">{tk.txt}</text>
      </g>)
    })
  }

  const poly = pts.map(p => X(p.t).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')
  const last = pts[pts.length - 1]
  const gid = 'g' + Math.round(t0 % 1e7) + '_' + H
  // The zone gradient: from the top of the plot down, each zone's colour from its ceiling to
  // its floor, as stops on the plot's height; below zone 1 the line's own colour, faint.
  const zoneStops = zones && zones.max > 0 && !invert ? (() => {
    const top = P.t, bottom = H - P.b, span = bottom - top || 1
    const f = y => Math.max(0, Math.min(1, (Y(y) - top) / span))
    const stops = []
    for (let z = ZONE_FLOORS.length - 1; z >= 0; z--) {
      const floor = ZONE_FLOORS[z] * zones.max
      const ceil = z + 1 < ZONE_FLOORS.length ? ZONE_FLOORS[z + 1] * zones.max : Infinity
      const a = ceil === Infinity ? 0 : f(ceil), b = f(floor)
      if (b <= a) continue
      stops.push({ at: a, c: ZONE_COLORS[z] }, { at: b, c: ZONE_COLORS[z] })
    }
    stops.push({ at: f(ZONE_FLOORS[0] * zones.max), c: color }, { at: 1, c: color })
    return stops
  })() : null
  const spanBoxes = Array.isArray(spans) ? spans.map(sp => {
    const a = Math.max(P.l, X(Math.max(sp.from, t0))), b = Math.min(W - P.r, X(Math.min(sp.to, t1)))
    return b - a > 2 ? { x: a, w: b - a, label: sp.label } : null
  }).filter(Boolean) : []
  const hoverSource = single ? [points[0]] : points
  const hoverDates = hoverSource.map(p => p.d || isoOf(new Date(p.t)))
  const showYear = new Set(hoverDates.map(iso => new Date(iso + 'T12:00:00').getFullYear())).size > 1
  const hoverPts = hoverSource.map((p, i) => ({ x: X(p.t), y: Y(p.y), t: p.t, iso: hoverDates[i], v: p.y, note: p.note }))
  const marked = points.some(p => p.m != null)

  const onMove = e => {
    const c = e.touches ? e.touches[0] : e
    if (!c || c.clientX === undefined) return
    const r = svgRef.current.getBoundingClientRect()
    const w = r.width || W
    const vx = (c.clientX - r.left) / w * W
    let best = hoverPts[0]
    hoverPts.forEach(p => { if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p })
    setHover(best)
  }

  return (
    <div className="chart-i" ref={wrapRef}
      onMouseMove={onMove} onMouseDown={onMove}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onMove} onTouchMove={onMove}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ aspectRatio: `${W}/${H}` }}>
        <defs>{zoneStops
          ? <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            {zoneStops.map((st, i) => <stop key={i} offset={(st.at * 100).toFixed(1) + '%'} stopColor={st.c} stopOpacity={st.c === color ? 0.18 : 0.42} />)}
          </linearGradient>
          : <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>}</defs>
        {gridlines}
        {goal != null && isFinite(goal) && <>
          <line x1={P.l} y1={Y(goal)} x2={W - P.r} y2={Y(goal)} stroke="var(--yellow)" strokeWidth="1.6" strokeDasharray="7 4" />
          <text x={W - P.r - 2} y={Y(goal) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--yellow)">{fmtNum(goal)}</text>
        </>}
        {/* The first series is drawn widest and underneath, each next one thinner on top, so
            lines that share their values show as nested stripes instead of hiding each other. */}
        {spanBoxes.map((b, i) => <g key={'sp' + i}>
          <rect x={b.x} y={P.t} width={b.w} height={H - P.t - P.b} fill="var(--label-3)" opacity="0.14" rx="3" />
          {b.label && b.w > 36 && <text x={b.x + 4} y={P.t + 10} fontSize="9" fill="var(--label-2)">{b.label}</text>}
        </g>)}
        {multi ? series.map((s, k) => {
          const sw = 2 + (series.length - 1 - k) * 2.4
          return <g key={'s' + k}>
            {s.points.length > 1 && <polyline points={s.points.map(p => X(p.t).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')}
              fill="none" stroke={s.color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />}
            {s.points.map((p, i) => <circle key={i} cx={X(p.t)} cy={Y(p.y)} r={sw / 2 + 1.2} fill={s.color} />)}
          </g>
        }) : <>
          <polygon points={`${P.l},${H - P.b} ${poly} ${X(last.t).toFixed(1)},${H - P.b}`} fill={`url(#${gid})`} />
          <polyline points={poly} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {marked && pts.map((p, i) => (p.m == null ? null :
            <circle key={'m' + i} cx={X(p.t)} cy={Y(p.y)} r={2.4 + p.m * 3} fill={color} opacity={0.3 + p.m * 0.7} />))}
          <circle cx={X(last.t)} cy={Y(last.y)} r="4" fill={color} />
        </>}
        {hover && <g>
          <line className="cvl" x1={hover.x} y1={P.t} x2={hover.x} y2={H - P.b} stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />
          {multi
            ? series.map((s, k) => s.points.filter(p => p.t === hover.t).map((p, i) =>
              <circle key={k + '_' + i} cx={X(p.t)} cy={Y(p.y)} r="4.5" fill={s.color} stroke="var(--bg)" strokeWidth="2" />))
            : <>
              <line className="chl" x1={P.l} y1={hover.y} x2={W - P.r} y2={hover.y} stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={hover.x} cy={hover.y} r="5" fill={color} stroke="var(--bg)" strokeWidth="2" />
            </>}
        </g>}
      </svg>
      {hover && <div className="ctip" ref={tipRef}>
        {multi
          ? <>{fmtDate(hover.iso, true, showYear)}{hover.note ? ' · ' + hover.note : ''}</>
          : <>{time ? clock(hover.t) : fmtDate(hover.iso, true, showYear)} · {fmtNum(hover.v)}{unit ? ' ' + unit : ''}{hover.note ? ' · ' + hover.note : ''}</>}
      </div>}
    </div>
  )
}