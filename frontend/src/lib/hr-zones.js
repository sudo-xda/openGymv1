// Heart-rate zones: five bands of the maximum, the way watches draw them, and how long a
// session spent in each. The maximum is what the person set (S.maxHr), else the highest peak any
// of their workouts recorded, else the textbook 220 minus age — and without an age, 190.
export const ZONE_FLOORS = [0.5, 0.6, 0.7, 0.8, 0.9]      // zone 1 starts at 50 % of max, zone 5 at 90 %
export const ZONE_NAMES = ['Easy', 'Fat burn', 'Aerobic', 'Threshold', 'Max']
export const ZONE_COLORS = ['var(--blue)', 'var(--teal)', 'var(--green)', 'var(--orange)', 'var(--red)']
export const DEFAULT_MAX_HR = 190

/** The maximum heart rate to draw the zones from. */
export function maxHrOf(S) {
  const set = Number(S?.maxHr)
  if (Number.isFinite(set) && set >= 120 && set <= 230) return Math.round(set)
  const peaks = (S?.workouts || []).map(w => Number(w?.hr?.max)).filter(n => Number.isFinite(n) && n >= 120 && n <= 230)
  if (peaks.length) return Math.max(...peaks)
  const year = Number(S?.birthYear)
  if (Number.isFinite(year) && year > 1900) return Math.max(120, Math.min(230, 220 - (new Date().getFullYear() - year)))
  return DEFAULT_MAX_HR
}

/** 0 for below zone 1, else 1–5. */
export function zoneOf(bpm, max) {
  const r = bpm / max
  let z = 0
  for (let i = 0; i < ZONE_FLOORS.length; i++) if (r >= ZONE_FLOORS[i]) z = i + 1
  return z
}

/**
 * Minutes in each zone from a per-minute series `[[t, bpm]]` (lib/workout-hr.js) — each point
 * counts the minute it stands for. `[z1, z2, z3, z4, z5]`, below zone 1 left out.
 */
export function zonesOf(series, max) {
  const out = [0, 0, 0, 0, 0]
  for (const p of Array.isArray(series) ? series : []) {
    const bpm = Array.isArray(p) ? Number(p[1]) : Number(p?.bpm)
    if (!Number.isFinite(bpm)) continue
    const z = zoneOf(bpm, max)
    if (z) out[z - 1]++
  }
  return out
}

/** The zone bounds in bpm, for a legend: `[{ zone, from, to }]`. */
export const zoneBounds = max => ZONE_FLOORS.map((f, i) => ({ zone: i + 1, from: Math.round(f * max), to: i + 1 < ZONE_FLOORS.length ? Math.round(ZONE_FLOORS[i + 1] * max) - 1 : max }))
