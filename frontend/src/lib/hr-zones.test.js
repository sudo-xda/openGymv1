import { describe, it, expect } from 'vitest'
import { maxHrOf, zoneOf, zonesOf, zoneBounds, DEFAULT_MAX_HR } from './hr-zones.js'
import { trimpOf, setLoadOf, sessionLoad, dailyLoads, loadRatio, SET_LOAD } from './training-load.js'

describe('zones', () => {
  it('takes the set maximum, else the highest recorded peak, else the age rule, else 190', () => {
    expect(maxHrOf({ maxHr: 185 })).toBe(185)
    expect(maxHrOf({ maxHr: 999, workouts: [{ hr: { avg: 120, max: 178 } }, { hr: { max: 171 } }] })).toBe(178)
    expect(maxHrOf({ birthYear: new Date().getFullYear() - 30 })).toBe(190)
    expect(maxHrOf({})).toBe(DEFAULT_MAX_HR)
  })
  it('places a rate in its zone and counts minutes per zone', () => {
    expect([80, 100, 125, 145, 165, 185].map(b => zoneOf(b, 200))).toEqual([0, 1, 2, 3, 4, 5])
    const series = [[0, 90], [1, 130], [2, 130], [3, 150], [4, 190], [5, 'x']]
    expect(zonesOf(series, 200)).toEqual([0, 2, 1, 0, 1])
    expect(zoneBounds(200)[0]).toEqual({ zone: 1, from: 100, to: 119 })
    expect(zoneBounds(200)[4]).toEqual({ zone: 5, from: 180, to: 200 })
  })
})

describe('training load', () => {
  const minutes = (n, bpm) => Array.from({ length: n }, (_, i) => [i * 60000, bpm])
  it('TRIMP rises steeply with the heart rate', () => {
    const easy = trimpOf(minutes(45, 110), { rhr: 60, max: 190 })
    const hard = trimpOf(minutes(45, 170), { rhr: 60, max: 190 })
    expect(easy).toBeGreaterThan(10)
    expect(hard).toBeGreaterThan(easy * 3)
    expect(trimpOf(minutes(10, 50), { rhr: 60, max: 190 })).toBe(0)
  })
  it('the set proxy weighs work sets by effort and leaves warm-ups out', () => {
    const w = { entries: [{ sets: [{ done: true, phase: 'warmup', w: 40, r: 10 }, { done: true, w: 60, r: 8, rir: 1 }, { done: true, w: 60, r: 8, rir: 3 }, { done: false, w: 60, r: 8 }, { done: true, min: 20 }] }] }
    expect(setLoadOf(w)).toBe(Math.round(SET_LOAD * 1.1 + SET_LOAD * 0.7 + SET_LOAD * 2))
    expect(sessionLoad(w).from).toBe('sets')
    expect(sessionLoad({ hrSeries: minutes(30, 150) }, { rhr: 60, max: 190 }).from).toBe('hr')
  })
  it('sums the days and reads the acute against the chronic', () => {
    const day = '2026-10-26'
    const S = { workouts: [] }
    for (let i = 0; i < 28; i++) {
      const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - i)
      if (i % 2 === 0) S.workouts.push({ d: d.toISOString().slice(0, 10), entries: [{ sets: Array.from({ length: 10 }, () => ({ done: true, w: 50, r: 8, rir: 2 })) }] })
    }
    const daily = dailyLoads(S, day)
    expect(daily.length).toBe(28)
    expect(daily[27].load).toBe(60)
    expect(daily[26].load).toBe(0)
    const r = loadRatio(S, day)
    expect(r.ratio).toBeGreaterThan(0.9)
    expect(r.ratio).toBeLessThan(1.3)
    expect(r.word).toBe('steady')
    // A big week on an empty month is a spike.
    const spike = { workouts: [{ d: day, entries: [{ sets: Array.from({ length: 30 }, () => ({ done: true, w: 50, r: 8, rir: 1 })) }] }] }
    expect(loadRatio(spike, day).word).toBe('spike')
    expect(loadRatio({ workouts: [] }, day).word).toBe('none')
  })
})
