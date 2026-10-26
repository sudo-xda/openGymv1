import { describe, it, expect } from 'vitest'
import {
  nightWindow, parseSleep, sleepOf, restingHrOf, stepsOf, hrvOf, recoveryScore, readinessOf,
  baselineOf, dayReading, flagsOf, adviceOf, recordReading, coachView, STAGE, KEEP_DAYS
} from './biometrics.js'

const DAY = '2026-10-26'
const at = (day, h, m = 0) => new Date(day + 'T00:00:00').setHours(h, m, 0, 0)
const MIN = 60000
/** A session from `start` as consecutive stages `[stage, minutes]`. */
function session(start, parts) {
  const stages = []
  let t = start
  for (const [stage, n] of parts) { stages.push([t, t + n * MIN, stage]); t += n * MIN }
  return { start, end: t, stages }
}
// 23:00 to 06:40: awake 20, light 90, deep 60, light 40, awake 10, REM 60, light 100, deep 40, awake 40
const goodNight = () => session(at('2026-10-25', 23), [
  [STAGE.AWAKE, 20], [STAGE.LIGHT, 90], [STAGE.DEEP, 60], [STAGE.LIGHT, 40], [STAGE.AWAKE, 10], [STAGE.REM, 60], [STAGE.LIGHT, 100], [STAGE.DEEP, 40], [STAGE.AWAKE, 40]
])
/** Heart-rate samples: one a minute from `start`, `[bpm, minutes]` runs. */
function hrRun(start, runs) {
  const out = []
  let t = start
  for (const [bpm, n] of runs) { for (let i = 0; i < n; i++) { out.push([t, bpm]); t += MIN } }
  return out
}

describe('the night window and sleep', () => {
  it('runs from 20:00 the evening before to noon', () => {
    const w = nightWindow(DAY)
    expect(new Date(w.from).getHours()).toBe(20)
    expect(new Date(w.from).getDate()).toBe(25)
    expect(new Date(w.to).getHours()).toBe(12)
  })
  it('reads the stages into deep, light, REM and awake minutes with the efficiency', () => {
    const s = sleepOf([goodNight()], nightWindow(DAY))
    expect(s.deep).toBe(100)
    expect(s.light).toBe(230)
    expect(s.rem).toBe(60)
    expect(s.awake).toBe(70)
    expect(s.total).toBe(390)
    expect(s.efficiency).toBe(0.85)
  })
  it('clips a session to the window, counts a stage-less session as light sleep, ignores a nap outside', () => {
    const early = session(at('2026-10-25', 18), [[STAGE.DEEP, 180]])            // 18:00–21:00: only the hour after 20:00 counts
    const plain = { start: at(DAY, 1), end: at(DAY, 5), stages: [] }             // 4 h, no stages
    const nap = session(at(DAY, 14), [[STAGE.LIGHT, 60]])
    const s = sleepOf([early, plain, nap], nightWindow(DAY))
    expect(s.deep).toBe(60)
    expect(s.light).toBe(240)
    expect(s.total).toBe(300)
  })
  it('out of bed is neither; broken rows are dropped; no sleep is null', () => {
    const s = sleepOf([session(at(DAY, 1), [[STAGE.LIGHT, 100], [STAGE.OUT_OF_BED, 30], [STAGE.AWAKE_IN_BED, 10]])], nightWindow(DAY))
    expect(s).toMatchObject({ light: 100, awake: 10, total: 100 })
    expect(parseSleep([null, { start: 5, end: 1 }, { start: 1, end: 9, stages: [[3, 2, 4], 'x'] }])).toEqual([{ start: 1, end: 9, stages: [] }])
    expect(sleepOf([], nightWindow(DAY))).toBeNull()
  })
})

describe('resting heart rate', () => {
  it('takes the band app\'s figure for the day when it wrote one', () => {
    expect(restingHrOf({ restingHr: [[at(DAY, 7), 49], [at(DAY, 9), 52]], hr: [], sleep: [] }, DAY)).toBe(52)
    expect(restingHrOf({ restingHr: [[at('2026-10-24', 7), 49]], hr: [], sleep: [] }, DAY)).toBeNull()
  })
  it('else the lowest sustained rate of the night\'s sleep, not one stray beat', () => {
    const night = goodNight()
    const hr = hrRun(night.start, [[70, 20], [58, 90], [52, 60], [56, 40], [64, 10], [60, 60], [57, 100], [51, 40], [72, 40]])
    hr[200][1] = 30
    hr[300][1] = 250
    expect(restingHrOf({ restingHr: [], hr, sleep: [night] }, DAY)).toBe(51)
    const daytime = hrRun(at(DAY, 14), [[45, 60]])          // a low rate outside sleep is not resting
    expect(restingHrOf({ restingHr: [], hr: daytime, sleep: [night] }, DAY)).toBeNull()
  })
})

describe('steps, HRV and the score', () => {
  it('sums the day\'s steps, pro rata across midnight', () => {
    const steps = [[at(DAY, 8), at(DAY, 9), 3000], [at('2026-10-25', 23, 30), at(DAY, 0, 30), 1000], [at('2026-10-25', 10), at('2026-10-25', 11), 999]]
    expect(stepsOf(steps, DAY)).toBe(3500)
  })
  it('averages the night\'s RMSSD', () => {
    expect(hrvOf([[at(DAY, 2), 40], [at(DAY, 4), 50], [at(DAY, 15), 90]], DAY)).toBe(45)
    expect(hrvOf([], DAY)).toBeNull()
  })
  it('scores duration, depth, heart rate against the baseline, and efficiency', () => {
    const sleep = { deep: 100, light: 230, rem: 60, awake: 10, total: 390, efficiency: 0.98 }
    // 390/450 × 40 = 34.7, depth 160/390 ≥ 40 % → 20, at the baseline → 30, 0.98 × 10 = 9.8
    expect(recoveryScore({ sleep, restingHr: 51, baselineHr: 52 })).toBe(94)
    expect(recoveryScore({ sleep, restingHr: 58, baselineHr: 52 })).toBe(76)
    expect(recoveryScore({ sleep, restingHr: 58, baselineHr: null })).toBe(88)
    expect(recoveryScore({ sleep: null, restingHr: 50, baselineHr: 50 })).toBeNull()
    expect(readinessOf(95)).toBe('ready'); expect(readinessOf(60)).toBe('moderate'); expect(readinessOf(40)).toBe('low'); expect(readinessOf(null)).toBeNull()
  })
})

describe('a day against the week before', () => {
  const history = {
    '2026-10-20': { restingHr: 50, hrv: 60, sleep: { total: 420, deep: 80, rem: 70 }, score: 80, steps: 8000 },
    '2026-10-22': { restingHr: 52, hrv: 56, sleep: { total: 400, deep: 70, rem: 60 }, score: 76, steps: 6000 },
    '2026-10-25': { restingHr: 51, hrv: 64, sleep: { total: 440, deep: 90, rem: 80 }, score: 84, steps: 9000 },
    '2026-10-10': { restingHr: 70, hrv: 10, sleep: { total: 100, deep: 1, rem: 1 }, score: 10, steps: 1 }
  }
  it('averages the seven days before', () => {
    expect(baselineOf(history, DAY)).toEqual({ days: 3, restingHr: 51, sleepMin: 420, deepRemMin: 150, score: 80, steps: 7666.7, hrv: 60 })
  })
  it('reads a whole day: a good night with the band\'s own resting rate is ready, go', () => {
    const r = dayReading({ sleep: [goodNight()], restingHr: [[at(DAY, 7), 51]], hr: [], steps: [[at(DAY, 8), at(DAY, 9), 4200]], hrv: [[at(DAY, 3), 62]] }, DAY, history)
    expect(r.restingHr).toBe(51)
    expect(r.hrv).toBe(62)
    expect(r.steps).toBe(4200)
    expect(r.sleep.total).toBe(390)
    expect(r.score).toBe(93)       // efficiency 0.85 → 8.5
    expect(r.readiness).toBe('ready')
    expect(r.flags).toEqual([])
    expect(adviceOf(r)).toBe('go')
  })
  it('an elevated heart rate with short, shallow sleep flags a deload', () => {
    const bad = session(at(DAY, 1), [[STAGE.LIGHT, 200], [STAGE.DEEP, 60]])   // 4h20
    const r = dayReading({ sleep: [bad], restingHr: [[at(DAY, 6), 58]], hr: [], steps: [], hrv: [[at(DAY, 3), 40]] }, DAY, history)
    expect(r.flags).toEqual(expect.arrayContaining(['rhrElevated', 'sleepShort', 'deepRemLow', 'hrvLow']))
    expect(adviceOf(r)).toBe('deload')
    expect(flagsOf({ sleep: { total: 400, deep: 40, rem: 50, efficiency: 0.7 }, restingHr: 50, hrv: null }, { restingHr: 51, deepRemMin: 150, hrv: 60 })).toEqual(['deepRemLow', 'restless'])
  })
  it('keeps KEEP_DAYS days and builds the Coach\'s view from a mock, with no Health Connect at all', () => {
    const s = { biometrics: {} }
    for (let i = 0; i < KEEP_DAYS + 5; i++) {
      const d = new Date('2026-01-01T12:00:00'); d.setDate(d.getDate() + i)
      recordReading(s, { d: d.toISOString().slice(0, 10), score: 70, restingHr: 55, steps: 1, sleep: null, flags: [] })
    }
    expect(Object.keys(s.biometrics).length).toBe(KEEP_DAYS)
    const mock = { ...history, [DAY]: { d: DAY, score: 48, readiness: 'low', restingHr: 57, hrv: 38, steps: 2100, sleep: { deep: 40, light: 200, rem: 30, awake: 50, total: 270, efficiency: 0.84 }, flags: ['rhrElevated', 'sleepShort', 'deepRemLow', 'hrvLow'] } }
    const view = coachView(mock, DAY)
    expect(view.today.score).toBe(48)
    expect(view.baseline.restingHr).toBe(51)
    expect(view.advice).toBe('deload')
    expect(coachView({}, DAY)).toBeNull()
    expect(coachView(history, DAY).today).toBeNull()
  })
})
