import { describe, it, expect } from 'vitest'
import { recoveryPct, recoveryScores } from './recovery-score.js'
import { MUSCLES } from './muscles.js'

describe('recoveryPct', () => {
  it('reads fatigue as recovery, clamped to 0–100', () => {
    expect(recoveryPct(0)).toBe(100)
    expect(recoveryPct(0.25)).toBe(75)
    expect(recoveryPct(1)).toBe(0)
    expect(recoveryPct(1.7)).toBe(0)
    expect(recoveryPct(-0.2)).toBe(100)
    expect(recoveryPct(undefined)).toBe(100)
  })
})

describe('recoveryScores', () => {
  it('covers all 18 muscles, most fatigued first, with the map\'s states', () => {
    const { rows, counts } = recoveryScores({ chest: 0.8, quadriceps: 0.4, biceps: 0.1 })
    expect(rows.length).toBe(MUSCLES.length)
    expect(rows[0]).toMatchObject({ slug: 'chest', pct: 20, state: 'fatigued' })
    expect(rows[1]).toMatchObject({ slug: 'quadriceps', pct: 60, state: 'recovering' })
    expect(rows.find(r => r.slug === 'biceps')).toMatchObject({ pct: 90, state: 'ready' })
    expect(counts).toEqual({ ready: 16, recovering: 1, fatigued: 1 })
  })
  it('ties keep the map order, and an empty map is all ready', () => {
    const { rows, counts } = recoveryScores({})
    expect(rows.map(r => r.slug)).toEqual(MUSCLES)
    expect(counts.ready).toBe(18)
  })
})
