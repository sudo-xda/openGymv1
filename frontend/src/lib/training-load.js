// Training load: one number per session that a lift and a run can share, a day's total, and
// the acute (7-day) against chronic (28-day) ratio the recovery dashboards are built on.
//
// With a heart-rate curve the load is Banister's TRIMP: each minute weighted by how high the
// heart rate sat between resting and maximum, rising steeply towards the top. Without one — a
// lift logged on the phone with no band — the load is a set-based proxy scaled to sit on the same
// axis: a hard work set is about the TRIMP of a minute near threshold, so a 20-set session at
// RIR 1 lands near a 45-minute tempo run, which is roughly what a lifter feels the next day.
import { isWarmupRow } from './workout-model.js'
import { rirOf } from './effort.js'

export const SET_LOAD = 6            // one work set at RIR ≤ 2
export const ACUTE_DAYS = 7
export const CHRONIC_DAYS = 28

/** Banister TRIMP from a per-minute series `[[t, bpm]]`, with the resting and maximum rate. */
export function trimpOf(series, { rhr = 60, max = 190 } = {}) {
  let load = 0
  const span = Math.max(1, max - rhr)
  for (const p of Array.isArray(series) ? series : []) {
    const bpm = Array.isArray(p) ? Number(p[1]) : NaN
    if (!Number.isFinite(bpm)) continue
    const r = Math.min(1, Math.max(0, (bpm - rhr) / span))
    load += r * 0.64 * Math.exp(1.92 * r)
  }
  return Math.round(load)
}

/** The set-based proxy: work sets weighted by how close to failure they were. */
export function setLoadOf(w) {
  let load = 0
  for (const en of w?.entries || []) {
    for (const s of en?.sets || []) {
      if (!s || !s.done || isWarmupRow(s)) continue
      if (s.min > 0 && !(s.r > 0)) { load += SET_LOAD * Math.min(60, s.min) / 10; continue }   // cardio without a band: six per ten minutes
      const rir = rirOf(s)
      const effort = rir == null ? 0.8 : rir <= 1 ? 1.1 : rir <= 2 ? 1 : rir <= 4 ? 0.7 : 0.4
      load += SET_LOAD * effort
    }
  }
  return Math.round(load)
}

/** A session's load: TRIMP when it has a curve, the proxy otherwise, and which it was. */
export function sessionLoad(w, ctx = {}) {
  if (Array.isArray(w?.hrSeries) && w.hrSeries.length >= 5) return { load: trimpOf(w.hrSeries, ctx), from: 'hr' }
  return { load: setLoadOf(w), from: 'sets' }
}

/** Per-day totals for the `days` days ending on `day`: `[{ d, load, sessions }]`, oldest first. */
export function dailyLoads(S, day, days = CHRONIC_DAYS, ctx = {}) {
  const byDay = new Map()
  for (const w of S?.workouts || []) {
    if (!w || typeof w.d !== 'string') continue
    const cur = byDay.get(w.d) || { load: 0, sessions: 0 }
    cur.load += sessionLoad(w, ctx).load
    cur.sessions++
    byDay.set(w.d, cur)
  }
  const out = []
  const end = new Date(day + 'T12:00:00')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(d.getDate() - i)
    const k = d.toISOString().slice(0, 10)
    const x = byDay.get(k) || { load: 0, sessions: 0 }
    out.push({ d: k, load: Math.round(x.load), sessions: x.sessions })
  }
  return out
}

/**
 * The acute:chronic picture on a day: the 7-day and 28-day daily averages, their ratio, and a
 * word for it — `fresh` (< 0.8), `steady` (0.8–1.3), `high` (1.3–1.5), `spike` (> 1.5).
 */
export function loadRatio(S, day, ctx = {}) {
  const series = dailyLoads(S, day, CHRONIC_DAYS, ctx)
  const acute = series.slice(-ACUTE_DAYS)
  const avg = list => (list.length ? list.reduce((n, x) => n + x.load, 0) / list.length : 0)
  const a = avg(acute), c = avg(series)
  const ratio = c > 0 ? Math.round((a / c) * 100) / 100 : null
  const word = ratio == null ? 'none' : ratio < 0.8 ? 'fresh' : ratio <= 1.3 ? 'steady' : ratio <= 1.5 ? 'high' : 'spike'
  return { series, acute: Math.round(a * 10) / 10, chronic: Math.round(c * 10) / 10, ratio, word, weekTotal: acute.reduce((n, x) => n + x.load, 0) }
}
