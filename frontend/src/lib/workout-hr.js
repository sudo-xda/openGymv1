// A workout's heart rate from samples that arrived later — Health Connect's, written by the
// band's app after it synced (lib/health-sync.js readHeartRate) — or live from the band during
// the session (lib/live-hr.js). Pure: samples in, the per-set figures the Apple Watch already
// writes out (lib/heart-rate.js: `hr` and `restHr` as { avg, max }), plus the session's own.
//
// A set's span runs from the previous tick (or the workout's start) to its own tick (`at`);
// its rest runs from its tick to the next set's tick. Sets without a tick time (a backfilled
// workout, an older app) get nothing: there is no span to read.
import { zonesOf } from './hr-zones.js'
import { sanitizeHr } from './heart-rate.js'

export const SERIES_STEP_MS = 60000   // the kept series is one point a minute at most
export const MAX_SERIES = 240

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
/** `[[t, bpm], …]` as sorted samples; anything implausible dropped. */
export function parseHr(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => (Array.isArray(r) ? { t: num(r[0]), bpm: num(r[1]) } : r && typeof r === 'object' ? { t: num(r.t ?? r.at), bpm: num(r.bpm) } : null))
    .filter(s => s && s.t != null && s.bpm != null && s.bpm >= 25 && s.bpm <= 250)
    .sort((a, b) => a.t - b.t)
}

const stat = list => {
  if (!list.length) return null
  const avg = Math.round(list.reduce((n, s) => n + s.bpm, 0) / list.length)
  const max = Math.round(Math.max(...list.map(s => s.bpm)))
  return sanitizeHr({ avg, max })
}
const within = (samples, from, to) => samples.filter(s => s.t >= from && s.t <= to)

// A set's tick says when it ended, not when it began. Without a start (the watch has one, a
// phone tick does not) the set is taken as the last SET_SPAN_MS before its tick, and the time
// from the previous tick to that start is the previous set's rest.
export const SET_SPAN_MS = 90000

/** Every ticked set of the workout in time order: . */
export function setSpans(workout) {
  const ticks = []
  ;(workout?.entries || []).forEach((en, entryIdx) => (en?.sets || []).forEach((s, setIdx) => {
    const at = num(s?.at)
    if (at != null && (s.done || s.sides)) ticks.push({ entryIdx, setIdx, at })
  }))
  ticks.sort((a, b) => a.at - b.at)
  const start = num(workout?.start) ?? (ticks[0] ? ticks[0].at - SET_SPAN_MS : null)
  const end = num(workout?.end)
  return ticks.map((t, i) => {
    const prev = i ? ticks[i - 1].at : start
    const from = Math.max(prev, t.at - SET_SPAN_MS)
    const next = i + 1 < ticks.length ? ticks[i + 1].at : (end != null ? Math.min(end, t.at + 10 * 60000) : t.at)
    return { entryIdx: t.entryIdx, setIdx: t.setIdx, from, to: t.at, restFrom: t.at, restTo: Math.max(t.at, next - SET_SPAN_MS) }
  })
}

/**
 * The per-set figures and the session's own: `{ sets: [{ entryIdx, setIdx, hr, restHr }], hr,
 * series }` — `series` one point a minute, `[[t, bpm]]`, for a chart. Nothing for a set whose
 * span holds no sample.
 */
export function workoutHr(workout, rows) {
  const samples = parseHr(rows)
  const start = num(workout?.start), end = num(workout?.end)
  const inSession = start != null && end != null ? within(samples, start, end) : samples
  const sets = setSpans(workout).map(sp => {
    // (from, to]: the sample at the previous boundary belongs to the rest before, not the set.
    const hr = stat(samples.filter(x => x.t > sp.from && x.t <= sp.to))
    const restHr = sp.restTo > sp.restFrom ? stat(samples.filter(x => x.t > sp.restFrom && x.t < sp.restTo)) : null
    return hr || restHr ? { entryIdx: sp.entryIdx, setIdx: sp.setIdx, ...(hr ? { hr } : {}), ...(restHr ? { restHr } : {}) } : null
  }).filter(Boolean)
  const series = []
  let bucket = null
  for (const s of inSession) {
    const b = Math.floor(s.t / SERIES_STEP_MS)
    if (bucket && bucket.b === b) { bucket.sum += s.bpm; bucket.n++ } else { if (bucket) series.push(bucket); bucket = { b, sum: s.bpm, n: 1 } }
  }
  if (bucket) series.push(bucket)
  return {
    sets,
    hr: stat(inSession),
    samples: inSession.length,
    series: series.slice(0, MAX_SERIES).map(x => [x.b * SERIES_STEP_MS, Math.round(x.sum / x.n)])
  }
}

/**
 * Writes the figures onto the saved workout `w` (in place): a set keeps what the watch gave it,
 * the rest take Health Connect's; the session's `hr` and `hrSeries` are set when there are
 * samples. Returns how many sets gained a reading.
 */
export function applyWorkoutHr(w, result) {
  if (!w || !result) return 0
  let n = 0
  for (const x of result.sets) {
    const set = w.entries?.[x.entryIdx]?.sets?.[x.setIdx]
    if (!set) continue
    if (x.hr && !sanitizeHr(set.hr)) { set.hr = x.hr; n++ }
    if (x.restHr && !sanitizeHr(set.restHr)) set.restHr = x.restHr
  }
  if (result.hr) { w.hr = result.hr; w.hrSeries = result.series; w.hrFrom = w.hrFrom || 'health' }
  return n
}

/**
 * The band's live stream, reduced onto the finished workout `w` (in place): every set its
 * average and peak and the rest after it where the tick did not already write one, the session
 * its figure, its per-minute series and its minutes in zones at `max`; `hrFrom` is 'band-live'.
 * Returns the reduction, or null when the stream holds nothing from the session.
 */
export function applyLiveHr(w, samples, max) {
  const result = workoutHr(w, samples)
  if (!result || !result.hr || result.samples < 3) return null
  w.hrFrom = 'band-live'
  applyWorkoutHr(w, result)
  w.hrZones = zonesOf(result.series, max)
  return result
}

/** Live samples since a moment, as the set's figure — what the band's stream gives a set at its tick. */
export function liveSetHr(samples, from, to = Date.now()) {
  return stat(within(parseHr(samples), from, to))
}
