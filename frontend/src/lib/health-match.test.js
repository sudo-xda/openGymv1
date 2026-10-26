import { describe, it, expect } from 'vitest'
import { dedupeSessions, matchSessions, cardioWorkoutFrom, loggableSessions, sessionKey, alreadyLogged } from './health-match.js'

const T0 = new Date(2026, 9, 26, 15, 11).getTime()
const m = n => T0 + n * 60000
const walk = (start, end, extra = {}) => ({ start, end, type: 79, name: 'Walking', ...extra })

describe('dedupe and match', () => {
  it('folds a session a longer one covers under it', () => {
    const d = dedupeSessions([walk(m(0), m(6)), { start: m(0), end: m(10), type: 0, name: 'Other' }, walk(m(60), m(70))])
    expect(d.map(s => [s.start, s.end])).toEqual([[m(0), m(10)], [m(60), m(70)]])
    expect(d[0].also.length).toBe(1)
  })
  it('matches a band session to the openGym workout it overlaps, and only then', () => {
    const push = { id: 'w1', name: 'Push', start: m(5), end: m(55) }
    const other = { id: 'w2', name: 'Pull', start: m(200), end: m(250) }
    const r = matchSessions([{ start: m(0), end: m(30), type: 70, name: 'Strength' }, walk(m(100), m(120))], [push, other, { id: 'w3', d: '2026-10-26' }])
    expect(r[0].workout.id).toBe('w1')
    expect(r[0].shared).toBe(m(30) - m(5))
    expect(r[1].workout).toBeNull()
    // Two minutes in common is not the same session.
    expect(matchSessions([walk(m(0), m(10))], [{ id: 'x', start: m(8), end: m(60) }])[0].workout).toBeNull()
    // Unless the shorter one is mostly inside.
    expect(matchSessions([walk(m(0), m(4))], [{ id: 'x', start: m(1), end: m(60) }])[0].workout?.id).toBe('x')
  })
})

describe('cardioWorkoutFrom', () => {
  it('turns a walk into one cardio set with its minutes, speed and heart rate', () => {
    const w = cardioWorkoutFrom(walk(m(0), m(30), { hrAvg: 87.4, hrMax: 94 }), { unit: 'kg', distanceKm: 2.5, kcal: 120.6 })
    expect(w.d).toBe('2026-10-26')
    expect(w.entries[0].id).toBe('2258')
    expect(w.entries[0].sets[0]).toEqual({ min: 30, speed: 5, done: true, at: m(30), hr: { avg: 87, max: 94 } })
    expect(w.hr).toEqual({ avg: 87, max: 94 })
    expect(w.kcal).toBe(121)
    expect(w.distanceKm).toBe(2.5)
    expect(w.bandKey).toBe(sessionKey(walk(m(0), m(30))))
    expect(w.source).toBe('band')
    expect(cardioWorkoutFrom(walk(m(0), m(30)), { unit: 'lb', distanceKm: 1.609344 }).entries[0].sets[0].speed).toBe(2)
  })
  it('refuses a type the app cannot log and a session too short', () => {
    expect(cardioWorkoutFrom({ start: m(0), end: m(30), type: 0 })).toBeNull()
    expect(cardioWorkoutFrom(walk(m(0), m(5)))).toBeNull()
  })
  it('lists what could be logged and has not been', () => {
    const sessions = [walk(m(0), m(20)), { start: m(30), end: m(40), type: 0 }, walk(m(60), m(80)), walk(m(100), m(105))]
    const logged = cardioWorkoutFrom(walk(m(60), m(80)))
    const out = loggableSessions(sessions, [logged])
    expect(out.map(s => s.start)).toEqual([m(0)])
    expect(alreadyLogged([logged], walk(m(60), m(80)))).toBe(true)
  })
})
