import { describe, it, expect } from 'vitest'
import {
  parseSamples, nightWindow, sleepBlocks, sleepOf, restingHrOf, stepsOf, recoveryScore, readinessOf,
  baselineOf, dayReading, flagsOf, adviceOf, recordReading, coachView, SLEEP_KINDS, KEEP_DAYS
} from './biometrics.js'

const DAY = '2026-10-26'
const at = (day, h, m = 0) => new Date(day + 'T00:00:00').setHours(h, m, 0, 0)

/** A night as rows: from `fromMs`, one sample a minute, each `[kind, hr]` for `n` minutes. */
function night(fromMs, segments) {
  const rows = []
  let t = fromMs
  for (const [kind, hr, n, steps = 0] of segments) {
    for (let i = 0; i < n; i++) { rows.push([Math.floor(t / 1000), steps, hr, kind]); t += 60000 }
  }
  return rows
}
// 23:00 to 06:40: awake 20, light 90, deep 60, light 40, awake 10 (turning over), rem 60, light 100, deep 40, awake 40 (up)
const goodNight = () => night(at('2026-10-25', 23), [
  [92, 70, 20], [90, 58, 90], [89, 52, 60], [90, 56, 40], [92, 64, 10], [91, 60, 60], [90, 57, 100], [89, 51, 40], [92, 72, 40]
])

describe('parseSamples and the night window', () => {
  it('reads rows into sorted samples and drops the broken', () => {
    const s = parseSamples([[200, 1, 60, 1], [100, 0, 255, 90], 'x', [NaN, 0, 0, 0]])
    expect(s.map(x => x.t)).toEqual([100000, 200000])
    expect(s[0].hr).toBe(255)
  })
  it('the night before a day runs from 20:00 the evening before to noon', () => {
    const w = nightWindow(DAY)
    expect(new Date(w.from).getHours()).toBe(20)
    expect(new Date(w.from).getDate()).toBe(25)
    expect(new Date(w.to).getHours()).toBe(12)
    expect(new Date(w.to).getDate()).toBe(26)
  })
})

describe('sleep', () => {
  it('splits the night into deep, light, REM and awake minutes, bridging short wakes', () => {
    const s = parseSamples(goodNight())
    const sleep = sleepOf(s, nightWindow(DAY))
    expect(sleep.deep).toBe(100)
    expect(sleep.light).toBe(230)
    expect(sleep.rem).toBe(60)
    expect(sleep.awake).toBe(10)             // the 10 inside; the 20 before and the 40 after are not sleep
    expect(sleep.total).toBe(390)
    expect(sleep.efficiency).toBe(0.98)
    expect(sleep.blocks).toBe(1)
    expect(sleepBlocks(s, nightWindow(DAY))[0].samples.length).toBe(400)
  })
  it('a long wake splits the night into two blocks; a nap outside the window does not count', () => {
    const rows = [...night(at('2026-10-25', 23), [[90, 58, 120], [92, 70, 45], [89, 52, 120]]), ...night(at(DAY, 14), [[90, 60, 60]])]
    const sleep = sleepOf(parseSamples(rows), nightWindow(DAY))
    expect(sleep.blocks).toBe(2)
    expect(sleep.total).toBe(240)
    expect(sleep.awake).toBe(0)
  })
  it('no sleep kinds at all is no sleep, whatever the heart rate did', () => {
    expect(sleepOf(parseSamples(night(at('2026-10-25', 23), [[1, 48, 400]])), nightWindow(DAY))).toBeNull()
  })
  it('every kind code the band may write is in exactly one list', () => {
    const all = Object.values(SLEEP_KINDS).flat()
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('resting heart rate', () => {
  it('is the lowest sustained reading of the sleep blocks, not one stray beat, and never 255', () => {
    const rows = goodNight()
    rows[200][2] = 30            // one stray low beat inside a deep block
    rows[201][2] = 255           // off wrist
    const rhr = restingHrOf(parseSamples(rows), nightWindow(DAY))
    expect(rhr).toBe(51)
  })
  it('needs ten valid readings', () => {
    expect(restingHrOf(parseSamples(night(at('2026-10-25', 23), [[89, 255, 60]])), nightWindow(DAY))).toBeNull()
  })
})

describe('steps and the score', () => {
  it('counts the day\'s steps, midnight to midnight', () => {
    const rows = [...night(at(DAY, 8), [[1, 80, 30, 100]]), ...night(at('2026-10-25', 18), [[1, 90, 10, 50]])]
    expect(stepsOf(parseSamples(rows), DAY)).toBe(3000)
  })
  it('scores duration, depth, heart rate against the baseline, and efficiency', () => {
    const sleep = { deep: 100, light: 230, rem: 60, awake: 10, total: 390, efficiency: 0.98 }
    // 390/450 × 40 = 34.7, depth 160/390 ≥ 40 % → 20, heart rate at the baseline → 30, 0.98 × 10 = 9.8
    expect(recoveryScore({ sleep, restingHr: 51, baselineHr: 52 })).toBe(94)
    expect(recoveryScore({ sleep, restingHr: 58, baselineHr: 52 })).toBe(76)
    expect(recoveryScore({ sleep, restingHr: 58, baselineHr: null })).toBe(88)
    expect(recoveryScore({ sleep: null, restingHr: 50, baselineHr: 50 })).toBeNull()
    expect(readinessOf(95)).toBe('ready'); expect(readinessOf(60)).toBe('moderate'); expect(readinessOf(40)).toBe('low'); expect(readinessOf(null)).toBeNull()
  })
})

describe('a day against the week before', () => {
  const history = {
    '2026-10-20': { restingHr: 50, sleep: { total: 420, deep: 80, rem: 70 }, score: 80, steps: 8000 },
    '2026-10-22': { restingHr: 52, sleep: { total: 400, deep: 70, rem: 60 }, score: 76, steps: 6000 },
    '2026-10-25': { restingHr: 51, sleep: { total: 440, deep: 90, rem: 80 }, score: 84, steps: 9000 },
    '2026-10-10': { restingHr: 70, sleep: { total: 100, deep: 1, rem: 1 }, score: 10, steps: 1 }   // outside the window
  }
  it('averages the seven days before', () => {
    expect(baselineOf(history, DAY)).toEqual({ days: 3, restingHr: 51, sleepMin: 420, deepRemMin: 150, score: 80, steps: 7666.7 })
  })
  it('reads a whole day: a good night is ready, go', () => {
    const r = dayReading(parseSamples(goodNight()), DAY, history)
    expect(r.restingHr).toBe(51)
    expect(r.sleep.total).toBe(390)
    expect(r.score).toBe(94)
    expect(r.readiness).toBe('ready')
    expect(r.flags).toEqual([])
    expect(adviceOf(r)).toBe('go')
  })
  it('an elevated heart rate and short sleep flag a deload', () => {
    const rows = night(at(DAY, 1), [[90, 60, 200], [89, 58, 60]])    // 01:00–05:20 of the day: 4h20, RHR 58 vs 51
    const r = dayReading(parseSamples(rows), DAY, history)
    expect(r.flags).toEqual(expect.arrayContaining(['rhrElevated', 'sleepShort', 'deepRemLow']))
    expect(adviceOf(r)).toBe('deload')
    expect(flagsOf({ sleep: { total: 400, deep: 40, rem: 50, efficiency: 0.7 }, restingHr: 50 }, { restingHr: 51, deepRemMin: 150 })).toEqual(['deepRemLow', 'restless'])
  })
  it('keeps KEEP_DAYS days of readings and builds the Coach\'s view, with a mock and without a database', () => {
    const s = { biometrics: {} }
    for (let i = 0; i < KEEP_DAYS + 5; i++) {
      const d = new Date('2026-01-01T12:00:00'); d.setDate(d.getDate() + i)
      recordReading(s, { d: d.toISOString().slice(0, 10), score: 70, restingHr: 55, steps: 1, sleep: null, flags: [] })
    }
    expect(Object.keys(s.biometrics).length).toBe(KEEP_DAYS)
    const mock = {
      ...history,
      [DAY]: { d: DAY, score: 48, readiness: 'low', restingHr: 57, steps: 2100, sleep: { deep: 40, light: 200, rem: 30, awake: 50, total: 270, efficiency: 0.84 }, flags: ['rhrElevated', 'sleepShort', 'deepRemLow'] }
    }
    const view = coachView(mock, DAY)
    expect(view.today.score).toBe(48)
    expect(view.baseline.restingHr).toBe(51)
    expect(view.advice).toBe('deload')
    expect(coachView({}, DAY)).toBeNull()
    expect(coachView(history, DAY).today).toBeNull()
  })
})
