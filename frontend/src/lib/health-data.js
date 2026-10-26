// Everything Health Connect holds, read into days (views/Health.jsx): pure functions over the
// rows HealthConnectPlugin.readAll() returns. One summary per day, small enough to keep for a
// month in the phone's own file (lib/health-store.js); the raw samples are never stored.
//
//   { d, hr: { min, avg, max, n, series: [[t, bpm]] }, restingHr, hrv, sleep, steps, distanceKm,
//     activeKcal, totalKcal, floors, hydrationMl, exercise: [{ start, end, type, title, app, minutes }],
//     spo2: { min, avg, n }, respiratory, vo2max, weight, bodyFat, temperature, bmr, bloodPressure }
import { sleepOf, nightWindow, dayWindow, hrvOf, restingHrOf, stepsOf } from './biometrics.js'

export const HR_SERIES_STEP_MS = 5 * 60000     // the day's heart-rate curve, one point per five minutes
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
const pairs = rows => (Array.isArray(rows) ? rows : []).map(r => (Array.isArray(r) ? { t: num(r[0]), v: num(r[1]) } : null)).filter(x => x && x.t != null && x.v != null).sort((a, b) => a.t - b.t)
const inDay = (rows, w) => pairs(rows).filter(x => x.t >= w.from && x.t < w.to)
const clip = (from, to, w) => Math.max(0, Math.min(to, w.to) - Math.max(from, w.from))
const round1 = n => Math.round(n * 10) / 10

/** Interval records `[[start, end, value]]` summed into the day, pro rata where one straddles it. */
export function sumInDay(rows, w) {
  let n = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r)) continue
    const start = num(r[0]), end = num(r[1]), v = num(r[2])
    if (start == null || end == null || v == null || end <= start) continue
    n += v * (clip(start, end, w) / (end - start))
  }
  return n
}
const latest = (rows, w) => { const x = inDay(rows, w); return x.length ? round1(x[x.length - 1].v) : null }
const stats = (rows, w) => {
  const v = inDay(rows, w).map(x => x.v)
  if (!v.length) return null
  return { min: Math.round(Math.min(...v)), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), max: Math.round(Math.max(...v)), n: v.length }
}

/** The day's heart-rate curve, one point per five minutes, plus min, average and peak. */
export function hrDay(rows, w) {
  const s = inDay(rows, w).filter(x => x.v >= 25 && x.v <= 250)
  if (!s.length) return null
  const buckets = new Map()
  for (const x of s) { const b = Math.floor(x.t / HR_SERIES_STEP_MS); const cur = buckets.get(b) || { sum: 0, n: 0 }; cur.sum += x.v; cur.n++; buckets.set(b, cur) }
  const series = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([b, c]) => [b * HR_SERIES_STEP_MS, Math.round(c.sum / c.n)])
  return { ...stats(s.map(x => [x.t, x.v]), w), series }
}

// Health Connect's exercise types the band apps use, by code (ExerciseSessionRecord.EXERCISE_TYPE_*).
export const EXERCISE_TYPES = {
  0: 'Other', 2: 'Badminton', 4: 'Baseball', 5: 'Basketball', 8: 'Biking', 9: 'Stationary biking', 10: 'Boot camp', 11: 'Boxing', 13: 'Calisthenics',
  14: 'Cricket', 16: 'Dancing', 25: 'Elliptical', 26: 'Exercise class', 27: 'Fencing', 28: 'Football (American)', 29: 'Football (Australian)',
  31: 'Frisbee', 32: 'Golf', 33: 'Guided breathing', 34: 'Gymnastics', 35: 'Handball', 36: 'HIIT', 37: 'Hiking', 38: 'Ice hockey', 39: 'Ice skating',
  44: 'Martial arts', 46: 'Paddling', 47: 'Paragliding', 48: 'Pilates', 50: 'Racquetball', 51: 'Rock climbing', 52: 'Roller hockey', 53: 'Rowing',
  54: 'Rowing machine', 55: 'Rugby', 56: 'Running', 57: 'Treadmill', 58: 'Sailing', 59: 'Scuba diving', 60: 'Skating', 61: 'Skiing', 62: 'Snowboarding',
  63: 'Snowshoeing', 64: 'Soccer', 65: 'Softball', 66: 'Squash', 68: 'Stair climbing', 69: 'Stair machine', 70: 'Strength training', 71: 'Stretching',
  72: 'Surfing', 73: 'Open-water swimming', 74: 'Pool swimming', 75: 'Table tennis', 76: 'Tennis', 78: 'Volleyball', 79: 'Walking', 80: 'Water polo',
  81: 'Weightlifting', 82: 'Wheelchair', 83: 'Yoga'
}
export const exerciseName = type => EXERCISE_TYPES[type] || 'Workout'

/** One day's summary of everything, from the rows. `hrRows` may be the day's HR for the exercise sessions' averages. */
export function summarizeDay(data, day) {
  const w = dayWindow(day)
  const hrAll = pairs(data?.hr)
  const exercise = (Array.isArray(data?.exercise) ? data.exercise : [])
    .map(e => (e && typeof e === 'object' ? { start: num(e.start), end: num(e.end), type: num(e.type) ?? 0, title: String(e.title || '').slice(0, 80), app: String(e.app || '').slice(0, 80) } : null))
    .filter(e => e && e.start != null && e.end != null && e.end > e.start && clip(e.start, e.end, w) > 0)
    .map(e => {
      const inside = hrAll.filter(x => x.t >= e.start && x.t <= e.end).map(x => x.v)
      // The band's calories and distance for the session: its own records, clipped to the window.
      const kcal = Math.round(sumInDay(data?.activeKcal, { from: e.start, to: e.end }))
      const distanceKm = Math.round(sumInDay(data?.distance, { from: e.start, to: e.end }) / 10) / 100
      return { ...e, minutes: Math.round((e.end - e.start) / 60000), name: exerciseName(e.type), ...(inside.length ? { hrAvg: Math.round(inside.reduce((a, b) => a + b, 0) / inside.length), hrMax: Math.round(Math.max(...inside)) } : {}), ...(kcal ? { kcal } : {}), ...(distanceKm ? { distanceKm } : {}) }
    })
    .sort((a, b) => a.start - b.start)
  const sleep = sleepOf(data?.sleep, nightWindow(day))
  const bp = (Array.isArray(data?.bloodPressure) ? data.bloodPressure : []).map(r => (Array.isArray(r) ? { t: num(r[0]), s: num(r[1]), d: num(r[2]) } : null)).filter(x => x && x.t != null && x.t >= w.from && x.t < w.to).pop()
  return {
    d: day,
    hr: hrDay(data?.hr, w),
    restingHr: restingHrOf(data || {}, day),
    hrv: hrvOf(data?.hrv, day),
    sleep: sleep ? { deep: sleep.deep, light: sleep.light, rem: sleep.rem, awake: sleep.awake, total: sleep.total, efficiency: sleep.efficiency, from: sleep.from, to: sleep.to } : null,
    steps: stepsOf(data?.steps, day),
    distanceKm: round1(sumInDay(data?.distance, w) / 1000),
    activeKcal: Math.round(sumInDay(data?.activeKcal, w)),
    totalKcal: Math.round(sumInDay(data?.totalKcal, w)),
    floors: round1(sumInDay(data?.floors, w)),
    hydrationMl: Math.round(sumInDay(data?.hydration, w)),
    exercise,
    spo2: stats(data?.spo2, w),
    respiratory: latest(data?.respiratory, w),
    vo2max: latest(data?.vo2max, w),
    weight: latest(data?.weight, w),
    bodyFat: latest(data?.bodyFat, w),
    temperature: latest(data?.temperature, w),
    bmr: latest(data?.bmr, w) != null ? Math.round(latest(data?.bmr, w)) : null,
    bloodPressure: bp ? { systolic: Math.round(bp.s), diastolic: Math.round(bp.d) } : null,
    at: Date.now()
  }
}

/** The last `days` days ending on `day`, each summarised from the same rows. */
export function summarizeDays(data, day, days = 7) {
  const out = {}
  const end = new Date(day + 'T12:00:00')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(d.getDate() - i)
    const k = d.toISOString().slice(0, 10)
    out[k] = summarizeDay(data, k)
  }
  return out
}

/** Which of the day's summaries hold anything at all (a day the band did not sync has none). */
export const hasData = s => !!s && (!!s.hr || !!s.sleep || s.steps > 0 || !!s.exercise?.length || s.restingHr != null || !!s.spo2)
