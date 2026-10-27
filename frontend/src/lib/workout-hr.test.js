import { describe, it, expect } from 'vitest'
import { parseHr, setSpans, workoutHr, applyWorkoutHr, applyLiveHr, liveSetHr, SET_SPAN_MS } from './workout-hr.js'

const T0 = Date.parse('2026-10-26T18:00:00Z')
const m = n => T0 + n * 60000
const s = n => n * 1000
/** Samples every 10 s in (from, to], at `bpm`. */
const run = (from, to, bpm) => { const out = []; for (let t = from + s(10); t <= to; t += s(10)) out.push([t, bpm]); return out }
const workout = () => ({
  start: T0, end: m(30),
  entries: [
    { id: 'a', sets: [{ w: 60, r: 8, done: true, at: m(4) }, { w: 60, r: 8, done: true, at: m(8) }] },
    { id: 'b', sets: [{ w: 20, r: 10, done: true, at: m(14), hr: { avg: 100, max: 110 } }, { w: 20, r: 10, done: false }] }
  ]
})

describe('spans', () => {
  it('a set is the last 90 seconds before its tick; its rest runs to the next set\'s start', () => {
    const spans = setSpans(workout())
    expect(spans.map(x => [x.entryIdx, x.setIdx])).toEqual([[0, 0], [0, 1], [1, 0]])
    expect(spans[0]).toMatchObject({ from: m(4) - SET_SPAN_MS, to: m(4), restFrom: m(4), restTo: m(8) - SET_SPAN_MS })
    expect(spans[1]).toMatchObject({ from: m(8) - SET_SPAN_MS, to: m(8), restTo: m(14) - SET_SPAN_MS })
    expect(spans[2].restTo).toBe(m(24) - SET_SPAN_MS)   // the last set: ten minutes, capped by the end
    // A tick right after the previous one: the set starts at the previous tick, with no rest between.
    const quick = workout(); quick.entries[0].sets[1].at = m(4) + s(30)
    const q = setSpans(quick)
    expect(q[1].from).toBe(m(4))
    expect(q[0].restTo).toBe(m(4))
  })
})

describe('workoutHr', () => {
  // 120 during set 1, 90 at rest, 140 during set 2, 95 at rest, 150 during set 3, 100 after.
  const rows = () => [
    ...run(m(4) - SET_SPAN_MS, m(4), 120), ...run(m(4), m(8) - SET_SPAN_MS, 90), ...run(m(8) - SET_SPAN_MS, m(8), 140),
    ...run(m(8), m(14) - SET_SPAN_MS, 95), ...run(m(14) - SET_SPAN_MS, m(14), 150), ...run(m(14), m(30), 100)
  ]
  it('gives every ticked set its average and peak, the rest after it, and the session its own with a per-minute series', () => {
    const r = workoutHr(workout(), rows())
    expect(r.sets[0]).toEqual({ entryIdx: 0, setIdx: 0, hr: { avg: 120, max: 120 }, restHr: { avg: 90, max: 90 } })
    expect(r.sets[1]).toEqual({ entryIdx: 0, setIdx: 1, hr: { avg: 140, max: 140 }, restHr: { avg: 95, max: 95 } })
    expect(r.sets[2].hr).toEqual({ avg: 150, max: 150 })
    expect(r.hr.max).toBe(150)
    expect(r.samples).toBe(rows().length)
    expect(r.series[0][0]).toBe(m(2))
    expect(r.series.every(([, bpm]) => bpm >= 90 && bpm <= 150)).toBe(true)
  })
  it('drops implausible samples and those outside the session, and gives nothing to a set without samples', () => {
    const r = workoutHr(workout(), [[m(2), 300], [m(2), 0], [m(-5), 120], [m(13), 150], [m(13) + s(10), 152]])
    expect(r.sets).toEqual([{ entryIdx: 1, setIdx: 0, hr: { avg: 151, max: 152 } }])
    expect(r.hr).toEqual({ avg: 151, max: 152 })
    expect(parseHr('nope')).toEqual([])
  })
  it('applies onto the workout without overwriting what the watch wrote', () => {
    const w = workout()
    const n = applyWorkoutHr(w, workoutHr(w, rows()))
    expect(n).toBe(2)
    expect(w.entries[0].sets[0].hr).toEqual({ avg: 120, max: 120 })
    expect(w.entries[0].sets[0].restHr).toEqual({ avg: 90, max: 90 })
    expect(w.entries[1].sets[0].hr).toEqual({ avg: 100, max: 110 })   // the watch's stays
    expect(w.hr.max).toBe(150)
    expect(w.hrFrom).toBe('health')
    expect(w.hrSeries.length).toBeGreaterThan(0)
    expect(applyWorkoutHr(w, null)).toBe(0)
  })
})

describe('liveSetHr', () => {
  it('summarises the band\'s stream since the set started', () => {
    const stream = [{ at: m(1), bpm: 110 }, { at: m(2), bpm: 130 }, { at: m(3), bpm: 150 }]
    expect(liveSetHr(stream, m(1), m(3))).toEqual({ avg: 130, max: 150 })
    expect(liveSetHr(stream, m(10), m(12))).toBeNull()
  })
})

describe('applyLiveHr', () => {
  // The band's stream at finish: 120 during set 1, 90 at rest, 150 during set 2, then 100.
  const stream = () => [
    ...run(m(4) - SET_SPAN_MS, m(4), 120), ...run(m(4), m(8) - SET_SPAN_MS, 90), ...run(m(8) - SET_SPAN_MS, m(8), 150), ...run(m(8), m(30), 100)
  ].map(([t, bpm]) => ({ at: t, bpm }))
  it('writes the session curve, its zones and the sets the ticks missed, marked live from the band', () => {
    const w = workout()
    const r = applyLiveHr(w, stream(), 190)
    expect(r.samples).toBeGreaterThan(100)
    expect(w.hrFrom).toBe('band-live')
    expect(w.hr).toEqual({ avg: r.hr.avg, max: 150 })
    expect(w.hrSeries.length).toBeGreaterThanOrEqual(25)
    expect(w.hrZones.reduce((n, x) => n + x, 0)).toBeGreaterThan(20)
    expect(w.entries[0].sets[0].hr).toEqual({ avg: 120, max: 120 })
    expect(w.entries[0].sets[1].hr).toEqual({ avg: 150, max: 150 })
    expect(w.entries[1].sets[0].hr).toEqual({ avg: 100, max: 110 })   // the tick's own figure stays
  })
  it('leaves a workout alone when the stream holds nothing from its time', () => {
    const w = workout()
    expect(applyLiveHr(w, [{ at: m(-200), bpm: 70 }, { at: m(-199), bpm: 71 }, { at: m(-198), bpm: 72 }], 190)).toBeNull()
    expect(w.hr).toBeUndefined(); expect(w.hrFrom).toBeUndefined(); expect(w.hrZones).toBeUndefined()
  })
})
