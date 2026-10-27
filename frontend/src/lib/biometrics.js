// The recovery engine: a band's night and day, read from Health Connect, as a readiness score —
// pure functions over the rows HealthConnectPlugin.readRecovery() returns:
//
//   sleep      [{ start, end, stages: [[start, end, stage], …] }]   Health Connect sleep sessions
//   restingHr  [[time, bpm]]                                         what the band app computed
//   hr         [[time, bpm]]                                         every heart-rate sample
//   steps      [[start, end, count]]
//   hrv        [[time, rmssdMs]]
//
// What comes out, per day (S.biometrics[iso]):
//   sleep       { deep, light, rem, awake, total, efficiency }   minutes, and asleep / in bed
//   restingHr   the band app's resting heart rate for the day, else the lowest sustained rate
//               of the night's sleep
//   hrv         the night's mean RMSSD, when the band writes one
//   steps       the day's steps
//   score       0–100, the readiness the Home card shows and the Coach reads
//
// Stages are Health Connect's own codes (SleepSessionRecord.STAGE_TYPE_*), so nothing here
// guesses what a band's raw value means.
export const STAGE = Object.freeze({ UNKNOWN: 0, AWAKE: 1, SLEEPING: 2, OUT_OF_BED: 3, LIGHT: 4, DEEP: 5, REM: 6, AWAKE_IN_BED: 7 })
export const HR_MIN = 30
export const HR_MAX = 200
export const NIGHT_START_HOUR = 20      // the night before `day` starts at 20:00 …
export const NIGHT_END_HOUR = 12        // … and ends at noon of `day`
export const SLEEP_TARGET_MIN = 450     // 7.5 h scores full marks for duration
export const DEPTH_TARGET = 0.4         // deep + REM at 40 % of sleep scores full marks
export const RHR_WINDOW_DAYS = 7
export const KEEP_DAYS = 90

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
const validHr = hr => Number.isFinite(hr) && hr >= HR_MIN && hr <= HR_MAX
const minutes = ms => Math.round(ms / 60000)
const clip = (from, to, w) => Math.max(0, Math.min(to, w.to) - Math.max(from, w.from))

/** The night before `day` (local time): 20:00 the evening before until noon of the day. */
export function nightWindow(day) {
  const end = new Date(day + 'T00:00:00'); end.setHours(NIGHT_END_HOUR, 0, 0, 0)
  const start = new Date(day + 'T00:00:00'); start.setDate(start.getDate() - 1); start.setHours(NIGHT_START_HOUR, 0, 0, 0)
  return { from: start.getTime(), to: end.getTime() }
}
export const dayWindow = day => { const from = new Date(day + 'T00:00:00').getTime(); return { from, to: from + 86400000 } }

/** The sleep sessions as the plugin returns them, cleaned; stages sorted. */
export function parseSleep(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(s => (s && typeof s === 'object' ? {
      start: num(s.start), end: num(s.end),
      stages: (Array.isArray(s.stages) ? s.stages : []).map(r => (Array.isArray(r) ? { start: num(r[0]), end: num(r[1]), stage: num(r[2]) } : null)).filter(x => x && x.start != null && x.end != null && x.end > x.start).sort((a, b) => a.start - b.start)
    } : null))
    .filter(s => s && s.start != null && s.end != null && s.end > s.start)
    .sort((a, b) => a.start - b.start)
}
const pairs = rows => (Array.isArray(rows) ? rows : []).map(r => (Array.isArray(r) ? { t: num(r[0]), v: num(r[1]) } : null)).filter(x => x && x.t != null && x.v != null).sort((a, b) => a.t - b.t)

/**
 * Deep, light, REM and awake minutes of the night, from the sessions that touch the window,
 * each stage clipped to it. A session without stages (a band that only knows asleep/awake)
 * counts as light sleep for its whole length, so the total and the efficiency still stand.
 */
export function sleepOf(sleep, window) {
  const m = { deep: 0, light: 0, rem: 0, awake: 0 }
  let first = Infinity, last = -Infinity
  // The night as a timeline, for a hypnogram: `[start, end, kind]`, clipped to the window,
  // touching segments of one kind merged.
  const segments = []
  const push = (start, end, kind) => {
    const from = Math.max(start, window.from), to = Math.min(end, window.to)
    if (to <= from) return
    const prev = segments[segments.length - 1]
    if (prev && prev[2] === kind && from - prev[1] <= 60000) prev[1] = Math.max(prev[1], to)
    else segments.push([from, to, kind])
  }
  for (const s of parseSleep(sleep)) {
    if (!clip(s.start, s.end, window)) continue
    first = Math.min(first, Math.max(s.start, window.from)); last = Math.max(last, Math.min(s.end, window.to))
    if (!s.stages.length) { m.light += minutes(clip(s.start, s.end, window)); push(s.start, s.end, 'light'); continue }
    for (const st of s.stages) {
      const ms = clip(st.start, st.end, window)
      if (!ms) continue
      const kind = stageKind(st.stage)
      if (kind) { m[kind] += minutes(ms); push(st.start, st.end, kind) }
      // OUT_OF_BED is neither asleep nor in bed
    }
  }
  const total = m.deep + m.light + m.rem
  if (!total) return null
  return { ...m, total, efficiency: Math.round((total / (total + m.awake)) * 100) / 100, from: first, to: last, segments }
}
/** A Health Connect stage code as the app's four kinds; null for out of bed. */
export function stageKind(stage) {
  if (stage === STAGE.DEEP) return 'deep'
  if (stage === STAGE.REM) return 'rem'
  if (stage === STAGE.LIGHT || stage === STAGE.SLEEPING || stage === STAGE.UNKNOWN) return 'light'
  if (stage === STAGE.AWAKE || stage === STAGE.AWAKE_IN_BED) return 'awake'
  return null
}

/**
 * The resting heart rate: the band app's own figure for the day when it wrote one (the newest
 * inside the day); otherwise the lowest sustained rate inside the night's sleep sessions — a
 * rolling median of five samples, so one stray beat does not become the number. Null without
 * ten valid samples.
 */
export function restingHrOf({ restingHr, hr, sleep }, day) {
  const dw = dayWindow(day), nw = nightWindow(day)
  const written = pairs(restingHr).filter(x => validHr(x.v) && ((x.t >= dw.from && x.t < dw.to) || (x.t >= nw.from && x.t < nw.to)))
  if (written.length) return Math.round(written[written.length - 1].v)
  const sessions = parseSleep(sleep).filter(s => clip(s.start, s.end, nw))
  const inSleep = pairs(hr).filter(x => validHr(x.v) && sessions.some(s => x.t >= s.start && x.t <= s.end))
  if (inSleep.length < 10) return null
  let best = Infinity
  for (let i = 2; i < inSleep.length - 2; i++) {
    const w = inSleep.slice(i - 2, i + 3).map(x => x.v).sort((a, b) => a - b)
    best = Math.min(best, w[2])
  }
  return Number.isFinite(best) ? Math.round(best) : null
}

/** The day's steps: every step record clipped to the day, pro rata where a record straddles midnight. */
export function stepsOf(steps, day) {
  const w = dayWindow(day)
  let n = 0
  for (const r of Array.isArray(steps) ? steps : []) {
    if (!Array.isArray(r)) continue
    const start = num(r[0]), end = num(r[1]), count = num(r[2])
    if (start == null || end == null || count == null || end <= start) continue
    n += count * (clip(start, end, w) / (end - start))
  }
  return Math.round(n)
}

/** The night's heart-rate variability (RMSSD, ms), averaged; null when the band writes none. */
export function hrvOf(hrv, day) {
  const nw = nightWindow(day)
  const v = pairs(hrv).filter(x => x.t >= nw.from && x.t < nw.to && x.v > 0 && x.v < 500).map(x => x.v)
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
}

/**
 * 0–100: how ready the body looks. Duration against 7.5 h (40), depth — deep and REM against
 * 40 % of sleep (20), the resting heart rate against the seven-day average (30: full marks at
 * or below it, three off per beat above), efficiency (10). Without a baseline the heart-rate
 * part is given at four fifths; without sleep there is no score.
 */
export function recoveryScore({ sleep, restingHr, baselineHr }) {
  if (!sleep || !sleep.total) return null
  const duration = Math.min(1, sleep.total / SLEEP_TARGET_MIN) * 40
  const depth = Math.min(1, ((sleep.deep + sleep.rem) / sleep.total) / DEPTH_TARGET) * 20
  let hr = 24
  if (Number.isFinite(restingHr) && Number.isFinite(baselineHr) && baselineHr > 0) hr = 30 - Math.min(10, Math.max(0, restingHr - baselineHr)) * 3
  const eff = Math.min(1, sleep.efficiency || 0) * 10
  return Math.round(duration + depth + hr + eff)
}
export const readinessOf = score => (score == null ? null : score >= 75 ? 'ready' : score >= 50 ? 'moderate' : 'low')

/** The seven days before `day`, averaged where a value exists. */
export function baselineOf(biometrics, day) {
  const days = []
  const d = new Date(day + 'T12:00:00')
  for (let i = 1; i <= RHR_WINDOW_DAYS; i++) { d.setDate(d.getDate() - 1); days.push(d.toISOString().slice(0, 10)) }
  const rows = days.map(k => biometrics?.[k]).filter(Boolean)
  const avg = pick => { const v = rows.map(pick).filter(n => Number.isFinite(n)); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null }
  return { days: rows.length, restingHr: avg(r => r.restingHr), sleepMin: avg(r => r.sleep?.total), deepRemMin: avg(r => (r.sleep ? r.sleep.deep + r.sleep.rem : null)), score: avg(r => r.score), steps: avg(r => r.steps), hrv: avg(r => r.hrv) }
}

/** What is off today, in words the card and the Coach both use. */
export function flagsOf({ sleep, restingHr, hrv }, base) {
  const f = []
  if (Number.isFinite(restingHr) && Number.isFinite(base?.restingHr) && restingHr - base.restingHr >= 3) f.push('rhrElevated')
  if (sleep && sleep.total < 360) f.push('sleepShort')
  if (sleep && Number.isFinite(base?.deepRemMin) && base.deepRemMin > 0 && (sleep.deep + sleep.rem) < base.deepRemMin * 0.7) f.push('deepRemLow')
  if (sleep && sleep.efficiency < 0.8) f.push('restless')
  if (Number.isFinite(hrv) && Number.isFinite(base?.hrv) && base.hrv > 0 && hrv < base.hrv * 0.75) f.push('hrvLow')
  return f
}

/** The card's one line: what to do with today's session, from the score and the flags. */
export function adviceOf(reading) {
  if (!reading || reading.score == null) return 'none'
  const f = reading.flags || []
  if (reading.readiness === 'low' || (f.includes('rhrElevated') && (f.includes('sleepShort') || f.includes('hrvLow')))) return 'deload'
  if (reading.readiness === 'moderate' || f.length) return 'easy'
  return 'go'
}

/** One day's reading from what Health Connect returned, against the days before it. */
export function dayReading(data, day, biometrics = {}) {
  const sleep = sleepOf(data?.sleep, nightWindow(day))
  const restingHr = restingHrOf(data || {}, day)
  const hrv = hrvOf(data?.hrv, day)
  const base = baselineOf(biometrics, day)
  const score = recoveryScore({ sleep, restingHr, baselineHr: base.restingHr })
  const r = {
    d: day, sleep: sleep ? { deep: sleep.deep, light: sleep.light, rem: sleep.rem, awake: sleep.awake, total: sleep.total, efficiency: sleep.efficiency } : null,
    restingHr, hrv, steps: stepsOf(data?.steps, day), score, readiness: readinessOf(score), flags: [], _ts: Date.now()
  }
  r.flags = flagsOf({ sleep, restingHr, hrv }, base)
  return r
}

/** Writes a reading into the state, keeping KEEP_DAYS days. */
export function recordReading(s, reading) {
  if (!s.biometrics || typeof s.biometrics !== 'object') s.biometrics = {}
  s.biometrics[reading.d] = reading
  const keys = Object.keys(s.biometrics).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete s.biometrics[k]
  return reading
}

/**
 * The payload shape the Coach reads (api/coach/core/payload.js biometricsOf mirrors it): today,
 * the baseline, and the flags. Exported so a test can build the mock without Health Connect.
 */
export function coachView(biometrics, day) {
  const today = biometrics?.[day] || null
  if (!today && !Object.keys(biometrics || {}).length) return null
  const base = baselineOf(biometrics, day)
  return {
    day,
    today: today ? { score: today.score, readiness: today.readiness, restingHr: today.restingHr, hrv: today.hrv, steps: today.steps, sleep: today.sleep, flags: today.flags } : null,
    baseline: base,
    advice: adviceOf(today)
  }
}
