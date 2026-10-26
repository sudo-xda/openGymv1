// The Health screen's data (views/Health.jsx): everything Health Connect holds, read into days
// (lib/health-data.js) and kept in the phone's own file — a month of day summaries, never the raw
// samples, never in the synced state (it is the band's data as the band app wrote it, available
// again from Health Connect any time). The recovery engine's reading of the night is the part
// that syncs (S.biometrics); this is the rest.
//
// A refresh also joins the band to the log (lib/health-match.js): a workout in the window that
// has no heart rate yet gets it from the samples just read, with its zones; and, with the switch
// on, a walk or a ride the band recorded on its own is logged as a cardio workout.
import { readJsonFile, writeJsonFile } from './mobile.js'
import { readAllHealth, recoveryStatus } from './health-sync.js'
import { summarizeDays, hasData } from './health-data.js'
import { workoutHr, applyWorkoutHr } from './workout-hr.js'
import { maxHrOf, zonesOf } from './hr-zones.js'
import { loggableSessions, cardioWorkoutFrom } from './health-match.js'
import { useStore } from '../store/useStore.js'
import { todayISO } from './format.js'
import { sanitizeHr } from './heart-rate.js'

export const HEALTH_DATA_FILE = 'opengym-health-data.json'
export const KEEP_DAYS = 31
const READ_DAYS = 7

let cache = null
export async function loadHealthData() {
  if (cache) return cache
  const f = await readJsonFile(HEALTH_DATA_FILE)
  cache = f && typeof f === 'object' && f.days && typeof f.days === 'object' ? f : { days: {}, at: 0, denied: [] }
  return cache
}
const save = next => { cache = next; return writeJsonFile(HEALTH_DATA_FILE, next) }

/**
 * Reads the last week from Health Connect and keeps every day that holds something. `{ ok,
 * days, denied, filled, logged }` or `{ ok: false, reason }`: 'unavailable', 'permission', 'read'.
 */
export async function refreshHealthData() {
  const st = await recoveryStatus()
  if (st.status !== 'available') return { ok: false, reason: 'unavailable' }
  if (!st.readGranted) return { ok: false, reason: 'permission' }
  let data
  try { data = await readAllHealth(READ_DAYS) }
  catch (e) { return { ok: false, reason: e?.code === 'permission' ? 'permission' : 'read', detail: String(e?.message || e) } }
  const fresh = summarizeDays(data, todayISO(), READ_DAYS)
  const cur = await loadHealthData()
  const days = { ...cur.days }
  for (const [d, s] of Object.entries(fresh)) if (hasData(s)) days[d] = s
  const keys = Object.keys(days).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k]
  const next = { days, at: Date.now(), denied: Array.isArray(data?.denied) ? data.denied : [] }
  await save(next)
  const joined = joinWithLog(data, fresh)
  console.info('[health]', Object.keys(fresh).filter(d => hasData(fresh[d])).length, 'days with data of', READ_DAYS, '; denied:', next.denied.join(',') || 'none', '; heart rate filled on', joined.filled, 'workouts; band cardio logged:', joined.logged)
  return { ok: true, days: next.days, denied: next.denied, ...joined }
}

/** The band's samples onto the log's workouts of the window, and its own cardio into the log. */
export function joinWithLog(data, fresh) {
  const store = useStore.getState()
  const S = store.S
  const since = Object.keys(fresh).sort()[0]
  let filled = 0, logged = 0
  store.update(s => {
    const max = maxHrOf(s)
    for (const w of s.workouts || []) {
      if (!w || typeof w.d !== 'string' || w.d < since || !(w.start > 0) || !(w.end > w.start)) continue
      if (sanitizeHr(w.hr) && w.hrFrom !== 'health') continue
      const r = workoutHr(w, data?.hr)
      if (!r.samples) continue
      if (applyWorkoutHr(w, r) || !w.hrZones) { w.hrZones = zonesOf(r.series, max); filled++ }
    }
    if (s.bandCardioAuto === true) {
      for (const d of Object.keys(fresh)) {
        for (const session of loggableSessions(fresh[d].exercise, s.workouts)) {
          const w = cardioWorkoutFrom(session, { unit: s.unit, distanceKm: session.distanceKm ?? null, kcal: session.kcal ?? null })
          if (w) { s.workouts.push(w); logged++ }
        }
      }
      if (logged) s.workouts.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))
    }
  })
  return { filled, logged, unit: S.unit }
}

/** Logs one band session by hand (the Health screen's button). Returns the workout, or null. */
export function logBandSession(session) {
  let out = null
  useStore.getState().update(s => {
    if (loggableSessions([session], s.workouts).length === 0) return
    out = cardioWorkoutFrom(session, { unit: s.unit, distanceKm: session.distanceKm ?? null, kcal: session.kcal ?? null })
    if (out) { s.workouts.push(out); s.workouts.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0))) }
  })
  return out
}
export function _resetHealthData() { cache = null }
