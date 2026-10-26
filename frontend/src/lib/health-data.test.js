import { describe, it, expect } from 'vitest'
import { summarizeDay, summarizeDays, sumInDay, hrDay, exerciseName, hasData } from './health-data.js'
import { dayWindow, STAGE } from './biometrics.js'

const DAY = '2026-10-26'
const at = (day, h, mi = 0) => new Date(day + 'T00:00:00').setHours(h, mi, 0, 0)
const series = (from, to, stepMs, v) => { const out = []; for (let t = from; t < to; t += stepMs) out.push([t, v(t)]); return out }

describe('sums and the heart-rate day', () => {
  it('sums interval records into the day, pro rata across midnight', () => {
    const w = dayWindow(DAY)
    expect(sumInDay([[at(DAY, 8), at(DAY, 9), 1000], [at('2026-10-25', 23), at(DAY, 1), 600], [at('2026-10-25', 10), at('2026-10-25', 11), 999]], w)).toBe(1300)
    expect(sumInDay(null, w)).toBe(0)
  })
  it('the day\'s curve is one point per five minutes with min, average and peak', () => {
    const rows = series(at(DAY, 7), at(DAY, 7, 20), 60000, (t, i) => 60 + Math.floor((t - at(DAY, 7)) / 60000))   // 60…79
    const h = hrDay(rows, dayWindow(DAY))
    expect(h).toMatchObject({ min: 60, max: 79, n: 20 })
    expect(h.series.length).toBe(4)
    expect(h.series[0]).toEqual([at(DAY, 7), 62])
    expect(hrDay([[at(DAY, 7), 999]], dayWindow(DAY))).toBeNull()
  })
})

describe('summarizeDay', () => {
  const data = {
    hr: [...series(at(DAY, 7), at(DAY, 8), 60000, () => 70), ...series(at(DAY, 18), at(DAY, 19), 60000, () => 140)],
    restingHr: [[at(DAY, 6), 52]],
    hrv: [[at(DAY, 3), 48]],
    sleep: [{ start: at('2026-10-25', 23), end: at(DAY, 7), stages: [[at('2026-10-25', 23), at(DAY, 7), STAGE.LIGHT]] }],
    steps: [[at(DAY, 8), at(DAY, 20), 8000]],
    distance: [[at(DAY, 8), at(DAY, 20), 6400]],
    activeKcal: [[at(DAY, 0), at(DAY, 23, 59), 520]],
    totalKcal: [[at(DAY, 0), at(DAY, 23, 59), 2300]],
    floors: [[at(DAY, 9), at(DAY, 10), 12]],
    hydration: [[at(DAY, 9), at(DAY, 10), 500]],
    exercise: [{ start: at(DAY, 18), end: at(DAY, 19), type: 70, title: 'Push', app: 'com.huami.watch.hmwatchmanager' }, { start: at('2026-10-20', 18), end: at('2026-10-20', 19), type: 56 }],
    spo2: [[at(DAY, 2), 96], [at(DAY, 3), 98]],
    respiratory: [[at(DAY, 3), 14.5]],
    vo2max: [[at(DAY, 19), 41.2]],
    weight: [[at(DAY, 7), 78.4]],
    bodyFat: [[at(DAY, 7), 18.2]],
    temperature: [[at(DAY, 3), 36.5]],
    bmr: [[at(DAY, 0), 1750.4]],
    bloodPressure: [[at(DAY, 8), 121, 79]]
  }
  it('reads every type into one day', () => {
    const s = summarizeDay(data, DAY)
    expect(s.hr).toMatchObject({ min: 70, max: 140, n: 120 })
    expect(s.restingHr).toBe(52)
    expect(s.hrv).toBe(48)
    expect(s.sleep.total).toBe(480)
    expect(s.steps).toBe(8000)
    expect(s.distanceKm).toBe(6.4)
    expect(s.activeKcal).toBe(520)
    expect(s.totalKcal).toBe(2300)
    expect(s.floors).toBe(12)
    expect(s.hydrationMl).toBe(500)
    expect(s.exercise.length).toBe(1)
    expect(s.exercise[0]).toMatchObject({ start: at(DAY, 18), end: at(DAY, 19), type: 70, title: 'Push', app: 'com.huami.watch.hmwatchmanager', minutes: 60, name: 'Strength training', hrAvg: 140, hrMax: 140 })
    expect(s.exercise[0].kcal).toBe(22)          // the day's 520 over 23 h 59, one hour of it
    expect(s.exercise[0].distanceKm).toBe(0.53)  // 6.4 km over twelve hours, one of them
    expect(s.spo2).toEqual({ min: 96, avg: 97, max: 98, n: 2 })
    expect(s.respiratory).toBe(14.5)
    expect(s.vo2max).toBe(41.2)
    expect(s.weight).toBe(78.4)
    expect(s.bodyFat).toBe(18.2)
    expect(s.temperature).toBe(36.5)
    expect(s.bmr).toBe(1750)
    expect(s.bloodPressure).toEqual({ systolic: 121, diastolic: 79 })
    expect(hasData(s)).toBe(true)
  })
  it('an empty day is empty, and the week keeps seven days', () => {
    const s = summarizeDay({}, DAY)
    expect(s.hr).toBeNull(); expect(s.sleep).toBeNull(); expect(s.steps).toBe(0); expect(s.exercise).toEqual([]); expect(s.weight).toBeNull()
    expect(hasData(s)).toBe(false)
    const week = summarizeDays(data, DAY)
    expect(Object.keys(week)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', DAY])
    expect(week['2026-10-20'].exercise[0].name).toBe('Running')
    expect(exerciseName(9999)).toBe('Workout')
  })
})
