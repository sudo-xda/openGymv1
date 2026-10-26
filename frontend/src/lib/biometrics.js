// A band's night and day as a recovery signal — pure functions over Gadgetbridge's minute
// samples (GadgetbridgePlugin.java read(): rows of [timestamp, steps, heartRate, rawKind]).
//
// What comes out, per day (S.biometrics[iso]):
//   sleep       { deep, light, rem, awake, total, efficiency }   minutes, and asleep / in bed
//   restingHr   the lowest sustained heart rate of the night's sleep blocks
//   steps       the day's steps
//   score       0–100, the readiness the Home card shows and the Coach reads
//
// Nothing here knows a band. The raw kinds a Mi Band 5 writes for sleep are in SLEEP_KINDS,
// a table to extend when a firmware writes others; a sample is read as sleep only by that
// table, never guessed from a low heart rate alone.
export const INVALID_HR = 255
export const HR_MIN = 30
export const HR_MAX = 200
// Gadgetbridge raw kinds, Mi Band 5 (Huami): the codes the task names, plus the Huami sample
// provider's own. A kind in none of these lists is activity or unknown, never sleep.
export const SLEEP_KINDS = Object.freeze({
  deep: [89, 11, 112, 123],
  light: [90, 9, 121, 122],
  rem: [91, 8, 124],
  awake: [92, 10, 110]
})
export const NIGHT_START_HOUR = 20      // the night before `day` starts at 20:00 …
export const NIGHT_END_HOUR = 12        // … and ends at noon of `day`
export const SLEEP_GAP_MIN = 30         // awake stretches shorter than this stay inside a sleep block
export const SLEEP_TARGET_MIN = 450     // 7.5 h scores full marks for duration
export const DEPTH_TARGET = 0.4         // deep + REM at 40 % of sleep scores full marks
export const RHR_WINDOW_DAYS = 7
export const KEEP_DAYS = 90

const kindOf = k => (SLEEP_KINDS.deep.includes(k) ? 'deep' : SLEEP_KINDS.light.includes(k) ? 'light' : SLEEP_KINDS.rem.includes(k) ? 'rem' : SLEEP_KINDS.awake.includes(k) ? 'awake' : null)
const validHr = hr => Number.isFinite(hr) && hr !== INVALID_HR && hr >= HR_MIN && hr <= HR_MAX

/** Rows from the plugin as samples: `{ t (ms), steps, hr, kind }`, sorted by time. */
export function parseSamples(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => (Array.isArray(r) ? { t: Number(r[0]) * 1000, steps: Number(r[1]) || 0, hr: Number(r[2]) || 0, kind: Number(r[3]) } : null))
    .filter(s => s && Number.isFinite(s.t) && s.t > 0)
    .sort((a, b) => a.t - b.t)
}

/** The night before `day` (local time): 20:00 the evening before until noon of the day. */
export function nightWindow(day) {
  const end = new Date(day + 'T00:00:00'); end.setHours(NIGHT_END_HOUR, 0, 0, 0)
  const start = new Date(day + 'T00:00:00'); start.setDate(start.getDate() - 1); start.setHours(NIGHT_START_HOUR, 0, 0, 0)
  return { from: start.getTime(), to: end.getTime() }
}
const within = (s, w) => s.t >= w.from && s.t < w.to

/**
 * The sleep blocks of a window: runs of sleep samples, with awake stretches shorter than
 * SLEEP_GAP_MIN kept inside a block (turning over is not getting up). Each block carries its
 * samples; minutes are counted one per sample, which is what a minute-sampling band writes.
 */
export function sleepBlocks(samples, window) {
  const night = samples.filter(s => within(s, window))
  const blocks = []
  let cur = null
  let gap = 0
  for (const s of night) {
    const k = kindOf(s.kind)
    const asleep = k === 'deep' || k === 'light' || k === 'rem'
    if (asleep) {
      if (!cur) cur = { from: s.t, to: s.t, samples: [] }
      cur.samples.push(s); cur.to = s.t; gap = 0
    } else if (cur) {
      gap++
      if (k === 'awake') cur.samples.push(s)
      if (gap >= SLEEP_GAP_MIN) { blocks.push(cur); cur = null; gap = 0 }
    }
  }
  if (cur) blocks.push(cur)
  // Trailing awake minutes belong to the morning, not the block.
  for (const b of blocks) {
    while (b.samples.length && kindOf(b.samples[b.samples.length - 1].kind) === 'awake') b.samples.pop()
    b.to = b.samples.length ? b.samples[b.samples.length - 1].t : b.from
  }
  return blocks.filter(b => b.samples.length >= 10)
}

/** Deep, light, REM and awake minutes of the night, the total asleep, and the efficiency. */
export function sleepOf(samples, window) {
  const blocks = sleepBlocks(samples, window)
  const m = { deep: 0, light: 0, rem: 0, awake: 0 }
  for (const b of blocks) for (const s of b.samples) { const k = kindOf(s.kind); if (k) m[k]++ }
  const total = m.deep + m.light + m.rem
  if (!total) return null
  const inBed = total + m.awake
  return { ...m, total, efficiency: Math.round((total / inBed) * 100) / 100, blocks: blocks.length, from: blocks[0].from, to: blocks[blocks.length - 1].to }
}

/**
 * The resting heart rate: the lowest sustained reading inside the sleep blocks — a rolling
 * median of five, so one stray beat does not become the number — ignoring 255 (off wrist, no
 * reading) and anything outside a living range. Null without ten valid readings.
 */
export function restingHrOf(samples, window) {
  const hrs = sleepBlocks(samples, window).flatMap(b => b.samples.map(s => s.hr)).filter(validHr)
  if (hrs.length < 10) return null
  let best = Infinity
  for (let i = 2; i < hrs.length - 2; i++) {
    const w = hrs.slice(i - 2, i + 3).sort((a, b) => a - b)
    best = Math.min(best, w[2])
  }
  return Number.isFinite(best) ? best : null
}

/** The day's steps, midnight to midnight, local time. */
export function stepsOf(samples, day) {
  const from = new Date(day + 'T00:00:00').getTime()
  const to = from + 86400000
  return samples.filter(s => s.t >= from && s.t < to).reduce((n, s) => n + Math.max(0, s.steps), 0)
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
  return { days: rows.length, restingHr: avg(r => r.restingHr), sleepMin: avg(r => r.sleep?.total), deepRemMin: avg(r => (r.sleep ? r.sleep.deep + r.sleep.rem : null)), score: avg(r => r.score), steps: avg(r => r.steps) }
}

/** One day's reading from the samples, against the days before it. */
export function dayReading(samples, day, biometrics = {}) {
  const window = nightWindow(day)
  const sleep = sleepOf(samples, window)
  const restingHr = restingHrOf(samples, window)
  const base = baselineOf(biometrics, day)
  const score = recoveryScore({ sleep, restingHr, baselineHr: base.restingHr })
  return {
    d: day, sleep: sleep ? { deep: sleep.deep, light: sleep.light, rem: sleep.rem, awake: sleep.awake, total: sleep.total, efficiency: sleep.efficiency } : null,
    restingHr, steps: stepsOf(samples, day), score, readiness: readinessOf(score),
    flags: flagsOf({ sleep, restingHr }, base), _ts: Date.now()
  }
}

/** What is off today, in words the card and the Coach both use. */
export function flagsOf({ sleep, restingHr }, base) {
  const f = []
  if (Number.isFinite(restingHr) && Number.isFinite(base?.restingHr) && restingHr - base.restingHr >= 3) f.push('rhrElevated')
  if (sleep && sleep.total < 360) f.push('sleepShort')
  if (sleep && Number.isFinite(base?.deepRemMin) && base.deepRemMin > 0 && (sleep.deep + sleep.rem) < base.deepRemMin * 0.7) f.push('deepRemLow')
  if (sleep && sleep.efficiency < 0.8) f.push('restless')
  return f
}

/** The card's one line: what to do with today's session, from the score and the flags. */
export function adviceOf(reading) {
  if (!reading || reading.score == null) return 'none'
  if (reading.readiness === 'low' || (reading.flags.includes('rhrElevated') && reading.flags.includes('sleepShort'))) return 'deload'
  if (reading.readiness === 'moderate' || reading.flags.length) return 'easy'
  return 'go'
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
 * the baseline, and the flags. Exported so a test can build the mock the task asks for without a
 * database at all.
 */
export function coachView(biometrics, day) {
  const today = biometrics?.[day] || null
  if (!today && !Object.keys(biometrics || {}).length) return null
  const base = baselineOf(biometrics, day)
  return {
    day,
    today: today ? { score: today.score, readiness: today.readiness, restingHr: today.restingHr, steps: today.steps, sleep: today.sleep, flags: today.flags } : null,
    baseline: base,
    advice: adviceOf(today)
  }
}
