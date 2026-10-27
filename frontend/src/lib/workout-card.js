// A finished workout as a picture, for "Share as image" in its detail sheet (#453): plain text
// loses its layout in most chat apps, a card keeps it. Three steps, so the part that decides what
// the card says and where it goes is testable without a canvas:
//   workoutCardModel  — what the card says: name, date, duration, sets, volume, new bests and
//                       how hard each muscle was worked
//   layoutWorkoutCard — where everything goes, given a way to measure text
//   drawWorkoutCard   — paints a layout onto a 2D canvas context
// Nothing here stores anything; the workout is read, never written.
import { sessionSections, workoutVolume, workoutDuration, workoutDay, doneUnits } from './history.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { MUSCLES, INERT, levelsOf, loadOfWorkouts } from './muscles.js'
import { fmtDate, fmtDur, fmtNum, fmtVol, capWords } from './format.js'
import { bestSetOf } from './onerm.js'
import { t, exerciseNameClass } from './i18n-core.js'

export const CARD_WIDTH = 1080
const PAD = 88
const MIN_HEIGHT = 720
// The two social formats (#share-card): an Instagram/WhatsApp story and a square post, both at
// a fixed size the card's content is centred in; 'auto' is the original card, as tall as it
// needs to be. The story and the square are painted in the brand's dark palette whatever the
// app's theme, so a card looks the same in every feed.
export const FORMATS = { auto: null, story: { width: 1080, height: 1920 }, square: { width: 1080, height: 1080 } }
export const MAX_TOP_LIFTS = 3
// More than this many new bests and the rest are counted instead of listed: a card that grows
// past a phone screen is not glanceable any more.
export const MAX_RECORDS = 6
const TITLE_LINES = 2
const STAT_SIZE = 56
const MAP_MAX_HEIGHT = 560

/**
 * What the card says. `unit` is the profile's, `nameOf(entry)` the exercise's display name — the
 * same pair "Copy as text" takes (workoutText). Sets are work sets, as the volume is: warm-ups are
 * left out of both, the way they are left out of records and progression everywhere else. A
 * per-side set counts once per side, as the workout screen counts it. `levels` is the finish
 * summary's muscle map for this one session (levelsOf over loadOfWorkouts), null when no set
 * reached a muscle the map can show — a card of only cardio has nothing to shade.
 */
export function workoutCardModel(w, { unit, nameOf, ai = null }) {
  const entries = w.entries || []
  const sets = entries.reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (isWarmupRow(s) ? 0 : doneUnits(s)), 0), 0)
  // New bests in the order the sheet lists the exercises, each named once — a combined session
  // can hold the same lift twice.
  const prs = new Set(w.prs || [])
  const records = []
  for (const i of sessionSections(entries).flatMap(section => section.units).flat()) {
    const entry = entries[i]
    if (!entry || !prs.has(entry.id) || records.some(r => r.id === entry.id)) continue
    const name = nameOf(entry)
    records.push({ id: entry.id, name: exerciseNameClass(EXIDX[entry.id]) ? capWords(name) : name })
  }
  const day = workoutDay(w)
  const ms = workoutDuration(w)
  const levels = levelsOf(loadOfWorkouts([w]))
  const hr = w.hr && Number.isFinite(Number(w.hr.avg)) && Number(w.hr.avg) > 0 ? { avg: Math.round(Number(w.hr.avg)), max: Math.round(Number(w.hr.max) || Number(w.hr.avg)) } : null
  // The heaviest work of the session: each exercise's best set by estimated 1RM, the top three.
  // A bodyweight or timed exercise has no estimate and stays out, as it does in Stats.
  const topLifts = entries.map(e => {
    const best = bestSetOf(e)
    if (!best || !(best.w > 0)) return null
    const name = nameOf(e)
    return { name: exerciseNameClass(EXIDX[e.id]) ? capWords(name) : name, line: `${fmtNum(best.w)} ${unit} × ${best.r}`, est: best.est }
  }).filter(Boolean).sort((a, b) => b.est - a.est).slice(0, MAX_TOP_LIFTS).map(({ est, ...x }) => x)
  return {
    title: w.name || '',
    date: day ? fmtDate(day, true, true) : '',
    prCount: records.length,
    topLifts,
    // The Coach's verdict, when the session has a debrief (lib/coach.js debriefFor): the score
    // out of ten and its summary sentence, so the card says how it went, not only what it was.
    ai: ai && Number.isFinite(Number(ai.score)) ? { score: Math.max(1, Math.min(10, Math.round(Number(ai.score)))), summary: String(ai.summary || '').replace(/\s+/g, ' ').trim() } : null,
    // Imported history has no clock: an unknown duration is left out rather than shown as 0.
    stats: [
      ...(ms >= 60000 ? [{ label: t('Duration'), value: fmtDur(ms) }] : []),
      { label: t('Sets'), value: fmtNum(sets) },
      { label: t('Volume'), value: fmtVol(w.vol ?? workoutVolume(w), unit) },
      // The band's session figure, when one was recorded: average, then peak.
      ...(hr ? [{ label: t('Heart rate'), value: `${hr.avg}·${hr.max}` }] : []),
    ],
    // The session's curve, one point a minute, for a sparkline under the tiles.
    hrSeries: hr && Array.isArray(w.hrSeries) && w.hrSeries.length >= 3 ? w.hrSeries.map(([x, y]) => [Number(x), Number(y)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) : null,
    records: records.map(r => r.name),
    levels: MUSCLES.some(m => levels[m] > 0) ? levels : null,
  }
}

// Greedy word wrap to `max` lines; the last line that does not fit is cut with an ellipsis.
// A word wider than the line on its own (a long German compound) is cut too, never overflowed.
export function wrapText(text, width, measure, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? line + ' ' + words[i] : words[i]
    if (measure(next) <= width) { line = next; continue }
    if (line) lines.push(line)
    line = words[i]
    if (lines.length === max) break
  }
  if (line && lines.length < max) lines.push(line)
  const rest = lines.join(' ').length < words.join(' ').length
  return lines.map((l, i) => (i === lines.length - 1 && (rest || measure(l) > width) ? ellipsize(l, width, measure) : l))
}
function ellipsize(text, width, measure) {
  let s = text
  while (s && measure(s + '…') > width) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}

// The largest size up to `max` at which `text` fits `width`: a 12,345.5 kg volume shrinks to fit
// its tile rather than running into the next one.
function fitSize(text, width, measure, weight, max, min = 28) {
  let size = max
  while (size > min && measure(text, weight, size) > width) size -= 2
  return size
}

/**
 * Where everything goes. `measure(text, weight, size)` returns a width in pixels — the canvas's
 * measureText in the app, a fake in the tests. `rtl` mirrors the card for Arabic: text anchors
 * at the right edge, the tiles run right to left and the trophy sits to the right of its line.
 * `map` is `{ aspect }`, one body view's height over its width, to include the muscle map, or
 * null to leave it out; a model without levels has none either way. Returns the canvas size and
 * a flat list of items for drawWorkoutCard; a text item carries its size and weight, the font
 * family is the drawer's.
 */
export function layoutWorkoutCard(model, { measure, rtl = false, width = CARD_WIDTH, map = null, format = 'auto' }) {
  const fixed = FORMATS[format] || null
  if (!fixed) return flowCard(model, { measure, rtl, width, map, lifts: true, records: MAX_RECORDS })
  // A fixed frame: the content is laid out as the flowing card is, then centred in the frame.
  // What does not fit gives way in order — the map first, then the top lifts, then the records
  // are counted rather than listed — so a card never runs past its own edge.
  const attempts = [
    { map, lifts: true, records: MAX_RECORDS },
    { map: null, lifts: true, records: MAX_RECORDS },
    { map: null, lifts: true, records: 3 },
    { map: null, lifts: false, records: 3 },
    { map: null, lifts: false, records: 1 },
  ]
  let layout = null
  for (const a of attempts) {
    layout = flowCard(model, { measure, rtl, width: fixed.width, map: a.map, lifts: a.lifts, records: a.records, frame: fixed.height })
    if (layout.height <= fixed.height) break
  }
  const shift = Math.max(0, Math.round((fixed.height - layout.height) / 2))
  const items = layout.items.map(it => (it.brand ? { ...it, y: fixed.height - PAD } : { ...it, y: it.y + shift }))
  return { width: fixed.width, height: fixed.height, rtl, items, format, decor: true }
}

function flowCard(model, { measure, rtl, width, map, lifts, records: maxRecords, frame = null }) {
  const items = []
  const inner = width - PAD * 2
  const start = rtl ? width - PAD : PAD
  const end = rtl ? PAD : width - PAD
  const dir = rtl ? -1 : 1
  // A fixed frame is tighter between sections: a square has room for the numbers, the lifts
  // and the records only if they sit closer than the flowing card spaces them.
  const sectionGap = frame ? 40 : 52
  const tail = frame ? 40 : 64
  let y = PAD
  const text = (str, size, weight, color, x = start, extra) => {
    items.push({ kind: 'text', text: str, x, y: y + size, size, weight, color, ...extra })
    y += Math.round(size * 1.3)
  }

  items.push({ kind: 'bar', x: start, y, w: 96 * dir, h: 10 })
  // The PR badge sits on the bar's line, at the far edge: "PR ×3", or just "PR" for one.
  if (model.prCount > 0) {
    const label = model.prCount > 1 ? `PR ×${model.prCount}` : 'PR'
    const bw = Math.round(measure(label, 700, 30) + 44)
    items.push({ kind: 'badge', text: label, x: rtl ? end : end - bw, y: y - 22, w: bw, h: 54, size: 30 })
  }
  y += 10 + 52
  for (const line of wrapText(model.title, inner, s => measure(s, 700, 76), TITLE_LINES)) text(line, 76, 700, 'label')
  if (model.date) { y += 4; text(model.date, 38, 400, 'label2') }

  // The Coach's verdict under the date: a soft pill with the score, then the summary, three
  // lines at most. A card without a debrief has neither and nothing moves.
  if (model.ai) {
    y += 22
    const label = `${t('Coach')} · ${model.ai.score}/10`
    const pw = Math.round(measure(label, 700, 30) + 44)
    items.push({ kind: 'badge', soft: true, text: label, x: rtl ? start - pw : start, y, w: pw, h: 50, size: 30 })
    y += 50 + 14
    for (const line of wrapText(model.ai.summary, inner, s => measure(s, 400, 34), 3)) text(line, 34, 400, 'label')
  }

  // The numbers as tiles, the way the finish summary shows them.
  y += 36
  const gap = 20
  const n = model.stats.length
  const tileW = (inner - gap * (n - 1)) / n
  const tileH = 150
  model.stats.forEach((stat, i) => {
    const x = rtl ? width - PAD - (i + 1) * tileW - i * gap : PAD + i * (tileW + gap)
    const textX = rtl ? x + tileW - 28 : x + 28
    const room = tileW - 56
    items.push({ kind: 'tile', x, y, w: tileW, h: tileH })
    const [label] = wrapText(stat.label, room, s => measure(s, 500, 28), 1)
    items.push({ kind: 'text', text: label, x: textX, y: y + 28 + 28, size: 28, weight: 500, color: 'label2' })
    const size = fitSize(stat.value, room, measure, 700, STAT_SIZE)
    items.push({ kind: 'text', text: stat.value, x: textX, y: y + tileH - 32, size, weight: 700, color: 'label' })
  })
  y += tileH

  // The heart's line across the session, under the numbers: a sparkline, no axes.
  if (model.hrSeries && model.hrSeries.length >= 3) {
    y += 28
    const h = 110
    const xs = model.hrSeries.map(p => p[0]), ys = model.hrSeries.map(p => p[1])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const points = model.hrSeries.map(([px, py]) => [
      start + dir * (x1 > x0 ? (px - x0) / (x1 - x0) : 0.5) * inner,
      y + h - (y1 > y0 ? (py - y0) / (y1 - y0) : 0.5) * h,
    ])
    items.push({ kind: 'spark', x: Math.min(start, end), y, w: inner, h, points })
    y += h
  }

  // Front and back side by side, as large as the width allows without running past a phone
  // screen, with the finish summary's five-step legend under them.
  if (map && model.levels) {
    y += 48
    const viewGap = 40
    let viewW = (inner - viewGap) / 2
    let viewH = viewW * map.aspect
    if (viewH > MAP_MAX_HEIGHT) { viewH = MAP_MAX_HEIGHT; viewW = viewH / map.aspect }
    const left = (width - (viewW * 2 + viewGap)) / 2
    items.push({ kind: 'map', view: 'front', x: left, y, w: viewW, h: viewH })
    items.push({ kind: 'map', view: 'back', x: left + viewW + viewGap, y, w: viewW, h: viewH })
    y += viewH + 32
    const sw = 26
    const swGap = 8
    const less = t('Less')
    const more = t('More')
    const labelGap = 16
    const total = measure(less, 400, 28) + labelGap + 5 * sw + 4 * swGap + labelGap + measure(more, 400, 28)
    let x = (width - total) / 2
    // Read the way the language reads: "Less" first on the reading side, the ramp toward "More".
    const parts = rtl ? [more, 4, 3, 2, 1, 0, less] : [less, 0, 1, 2, 3, 4, more]
    for (const part of parts) {
      if (typeof part === 'number') {
        items.push({ kind: 'swatch', x, y, size: sw, level: part })
        x += sw + (parts.indexOf(part) === parts.length - 2 ? labelGap : swGap)
      } else {
        const w = measure(part, 400, 28)
        // Drawn left-anchored whatever the direction, so the row lands where it was measured.
        items.push({ kind: 'text', text: part, x, y: y + sw - 3, size: 28, weight: 400, color: 'label2', anchor: 'left' })
        x += w + labelGap
      }
    }
    y += sw
  }

  // The heaviest sets: name on the reading side, the set on the other, one line each.
  if (lifts && (model.topLifts || []).length) {
    y += sectionGap
    text(t('Top lifts'), 34, 600, 'acc')
    y += 10
    for (const lift of model.topLifts) {
      const valueW = measure(lift.line, 600, 40)
      const [name] = wrapText(lift.name, inner - valueW - 32, s => measure(s, 500, 40), 1)
      items.push({ kind: 'text', text: lift.line, x: end, y: y + 40, size: 40, weight: 600, color: 'label', anchor: rtl ? 'left' : 'right' })
      text(name, 40, 500, 'label2')
      y += 10
    }
  }

  if (model.records.length) {
    y += sectionGap
    text(t('New personal records'), 34, 600, 'acc')
    y += 10
    const icon = 44
    const indent = icon + 22
    const shown = model.records.length > maxRecords ? model.records.slice(0, Math.max(0, maxRecords - 1)) : model.records
    for (const name of shown) {
      items.push({ kind: 'trophy', x: rtl ? start - icon : start, y: y + 4, size: icon })
      const [line] = wrapText(name, inner - indent, s => measure(s, 500, 42), 1)
      text(line, 42, 500, 'label', start + indent * dir)
      y += 14
    }
    if (shown.length < model.records.length) text(t('and {0} more', model.records.length - shown.length), 38, 400, 'label2', start + indent * dir)
  }

  y += tail
  const height = Math.max(frame ? 0 : MIN_HEIGHT, Math.round(y + 34 + PAD))
  items.push({ kind: 'text', brand: true, text: 'openGym', x: start, y: height - PAD, size: 34, weight: 700, color: 'acc' })
  return { width, height, rtl, items }
}

/* ---------- colours ---------- */

// "#rgb", "#rrggbb", "rgb(…)" or "rgba(…)" as [r, g, b, a]; null for anything else.
export function parseColor(value) {
  const s = String(value || '').trim()
  let m = s.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = i => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(p => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)))
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
}
// CSS color-mix(in srgb, a p%, b): p of `a` over the rest of `b`, as an rgb() string. A canvas
// is handed plain rgb, so the card does not depend on how a WebView parses color-mix().
export function mixColor(a, b, p) {
  const x = parseColor(a)
  const y = parseColor(b)
  if (!x || !y) return x ? a : b
  const ch = i => Math.round(x[i] * p + y[i] * (1 - p))
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}
/**
 * The muscle map's fills for the card, worked out the way index.css works them out for .bodymap:
 * the silhouette and an untouched muscle as a little label over the surface, levels 1–4 as more
 * and more accent over that. A semi-transparent label (the light theme's) is flattened onto the
 * surface first.
 */
export function mapColors({ label, surface, acc }) {
  const lab = parseColor(label)
  const flat = lab && lab[3] < 1 ? mixColor(`rgb(${lab[0]}, ${lab[1]}, ${lab[2]})`, surface, lab[3]) : label
  const base = mixColor(flat, surface, 0.11)
  return {
    sil: mixColor(flat, surface, 0.18),
    levels: [base, mixColor(acc, base, 0.32), mixColor(acc, base, 0.56), mixColor(acc, base, 0.78), acc],
  }
}

/* ---------- drawing ---------- */

// The trophy from components/Icon.jsx, on its 24×24 grid, so the card and the app agree.
const TROPHY = [
  'M7.6 4h8.8v4.6a4.4 4.4 0 0 1-8.8 0Z',
  'M7.6 5.6H4.9v1.5a3 3 0 0 0 2.9 3M16.4 5.6h2.7v1.5a3 3 0 0 1-2.9 3M12 13v3.4M8.6 20.4h6.8l-.7-4H9.3Z',
]
export const CARD_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif"

/** One body view's height over its width, from its `vb` ("minX minY width height"). */
export const viewAspect = view => {
  const [, , w, h] = String(view?.vb || '').split(/\s+/).map(Number)
  return w > 0 && h > 0 ? h / w : 1.76
}

/**
 * Paint a layout. `colors` holds bg, surface, tile, label, label2 and acc as CSS colours — the
 * app's current theme and accent, read off the root element by the caller. `map`, when the
 * layout has a map in it, is `{ body, levels }`: body-paths.js geometry for the profile's body
 * ({ front, back }) and the model's levels.
 */
export function drawWorkoutCard(ctx, layout, colors, map = null, family = CARD_FONT) {
  const { width, height, rtl, items } = layout
  const shades = mapColors(colors)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, height)
  const inset = 36
  ctx.fillStyle = colors.surface
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 48)
  ctx.fill()
  // The social formats get two soft pools of the accent in opposite corners, clipped to the
  // card: enough to read as a designed card in a feed, not enough to fight the numbers.
  if (layout.decor && typeof ctx.createRadialGradient === 'function') {
    ctx.save()
    roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 48)
    ctx.clip()
    for (const [cx, cy] of [[width * 0.9, height * 0.08], [width * 0.1, height * 0.95]]) {
      const r = width * 0.55
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, mixColor(colors.acc, colors.surface, 0.22))
      g.addColorStop(1, mixColor(colors.acc, colors.surface, 0))
      ctx.fillStyle = g
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    ctx.restore()
  }
  ctx.textBaseline = 'alphabetic'
  for (const item of items) {
    if (item.kind === 'bar') {
      ctx.fillStyle = colors.acc
      roundRect(ctx, Math.min(item.x, item.x + item.w), item.y, Math.abs(item.w), item.h, item.h / 2)
      ctx.fill()
    } else if (item.kind === 'badge') {
      // Solid accent for the PR badge; a soft tint with accent text for the Coach's score.
      ctx.fillStyle = item.soft ? mixColor(colors.acc, colors.surface, 0.18) : colors.acc
      roundRect(ctx, item.x, item.y, item.w, item.h, item.h / 2)
      ctx.fill()
      ctx.fillStyle = item.soft ? colors.acc : colors.bg
      ctx.font = `700 ${item.size}px ${family}`
      ctx.textAlign = 'center'
      ctx.direction = 'ltr'
      ctx.fillText(item.text, item.x + item.w / 2, item.y + item.h / 2 + item.size * 0.36)
    } else if (item.kind === 'tile') {
      ctx.fillStyle = colors.tile || colors.bg
      roundRect(ctx, item.x, item.y, item.w, item.h, 28)
      ctx.fill()
    } else if (item.kind === 'spark') {
      ctx.save()
      ctx.strokeStyle = colors.acc
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      item.points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.stroke()
      ctx.restore()
    } else if (item.kind === 'swatch') {
      ctx.fillStyle = shades.levels[item.level]
      roundRect(ctx, item.x, item.y, item.size, item.size, 7)
      ctx.fill()
    } else if (item.kind === 'map') {
      const view = map?.body?.[item.view]
      if (view) drawView(ctx, view, item, map.levels, shades)
    } else if (item.kind === 'trophy') {
      ctx.save()
      ctx.translate(item.x, item.y)
      ctx.scale(item.size / 24, item.size / 24)
      ctx.strokeStyle = colors.acc
      ctx.lineWidth = 1.7
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const d of TROPHY) ctx.stroke(new Path2D(d))
      ctx.restore()
    } else {
      // 'brand' is the footer wordmark: a text item the fixed formats pin to the bottom edge.
      ctx.direction = item.anchor === 'left' || item.anchor === 'right' ? 'ltr' : rtl ? 'rtl' : 'ltr'
      ctx.textAlign = item.anchor === 'left' ? 'left' : item.anchor === 'right' ? 'right' : 'start'
      ctx.fillStyle = colors[item.color] || colors.label
      ctx.font = `${item.weight} ${item.size}px ${family}`
      ctx.fillText(item.text, item.x, item.y)
    }
  }
}
function drawView(ctx, view, box, levels, shades) {
  const [minX, minY, vw, vh] = String(view.vb).split(/\s+/).map(Number)
  ctx.save()
  ctx.translate(box.x, box.y)
  ctx.scale(box.w / vw, box.h / vh)
  ctx.translate(-minX, -minY)
  ctx.fillStyle = shades.sil
  for (const slug of INERT) for (const d of view.p[slug] || []) ctx.fill(new Path2D(d))
  for (const slug of MUSCLES) {
    ctx.fillStyle = shades.levels[levels?.[slug] || 0]
    for (const d of view.p[slug] || []) ctx.fill(new Path2D(d))
  }
  ctx.restore()
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
