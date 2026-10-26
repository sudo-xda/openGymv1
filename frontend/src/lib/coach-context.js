// What the phone adds to a message for the Coach (api/coach/core/chat.js `device`): the band's
// day and yesterday from the Health store, the energy balance against the food log, the training
// load, and the week's heart-rate zones. None of it is in the synced state — the Health store is
// the phone's own file — so it is sent with the request, and the server bounds it field by field.
// Everywhere but the Android app this is empty and nothing is sent.
import { useStore } from '../store/useStore.js'
import { loadHealthData } from './health-store.js'
import { loadRatio } from './training-load.js'
import { maxHrOf } from './hr-zones.js'
import { dayTotals } from './nutrition.js'
import { todayISO } from './format.js'

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
const dayBlock = s => (s ? {
  steps: s.steps || 0, distanceKm: s.distanceKm || 0, activeKcal: s.activeKcal || 0, totalKcal: s.totalKcal || 0, floors: s.floors || 0,
  ...(s.hr ? { hr: { min: s.hr.min, avg: s.hr.avg, max: s.hr.max } } : {}),
  ...(s.spo2 ? { spo2: { min: s.spo2.min, avg: s.spo2.avg } } : {}),
  workoutMinutes: (s.exercise || []).reduce((n, e) => n + (e.minutes || 0), 0)
} : null)

/** The block, or null when there is nothing the server does not already have. */
export async function deviceContext() {
  const S = useStore.getState().S
  const day = todayISO()
  const rhr = (() => { const days = Object.keys(S.biometrics || {}).sort().slice(-7); const v = days.map(d => S.biometrics[d]?.restingHr).filter(Number.isFinite); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 60 })()
  const load = S.workouts?.length ? loadRatio(S, day, { rhr, max: maxHrOf(S) }) : null
  let health = null
  if (S.recoveryOn === true) { try { health = await loadHealthData() } catch { health = null } }
  const today = dayBlock(health?.days?.[day]), yesterday = dayBlock(health?.days?.[shift(day, -1)])
  const eaten = dayTotals(S, day).cal
  const burned = health?.days?.[day]?.totalKcal || 0
  const zones = [0, 0, 0, 0, 0]; let sessions = 0
  for (const w of S.workouts || []) {
    if (!w || typeof w.d !== 'string' || w.d < shift(day, -6) || !Array.isArray(w.hrZones)) continue
    w.hrZones.forEach((m, i) => { zones[i] += Number(m) || 0 }); sessions++
  }
  const out = {
    ...(today ? { today } : {}), ...(yesterday ? { yesterday } : {}),
    ...(load && load.word !== 'none' ? { load: { ratio: load.ratio, weekTotal: load.weekTotal, acute: load.acute, chronic: load.chronic, word: load.word } } : {}),
    ...(burned > 0 || eaten > 0 ? { energy: { eaten, burned, balance: eaten - burned } } : {}),
    ...(sessions ? { zonesWeek: { minutes: zones, sessions } } : {})
  }
  return Object.keys(out).length ? out : null
}
