// The band's workouts and openGym's, joined (views/Health.jsx, lib/health-store.js): a band
// session that overlaps a logged workout is that workout seen from the wrist; a walk or a ride
// the band recorded on its own can become an openGym cardio workout. Pure over the day's
// summaries (lib/health-data.js) and S.workouts.
import { uid } from './format.js'
import { EXIDX } from './exercises.js'

export const MATCH_MIN_MS = 5 * 60000       // at least five minutes in common, or half the shorter
export const CARDIO_MIN_MINUTES = 8         // a band walk shorter than this is not a workout

// Health Connect exercise types the app can log as its own cardio, by catalogue exercise.
export const CARDIO_EXERCISE = Object.freeze({
  79: '2258',   // walking
  37: '2258',   // hiking
  56: '0685',   // running
  57: '0684',   // treadmill
  8: '2138',    // biking → stationary bike
  9: '2138',    // stationary biking
  25: '2141',   // elliptical
  53: '1161',   // rowing
  54: '1161',   // rowing machine
  73: '2870',   // open-water swimming
  74: '2870'    // pool swimming
})
export const loggableType = type => Object.prototype.hasOwnProperty.call(CARDIO_EXERCISE, type)

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)

/** Band sessions with the ones a longer one covers folded under it ("Others" beside a walk). */
export function dedupeSessions(sessions) {
  const list = (Array.isArray(sessions) ? sessions : []).filter(s => s && num(s.start) != null && num(s.end) != null && s.end > s.start)
    .slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))
  const kept = []
  for (const s of list) {
    const parent = kept.find(k => overlap(k, s) >= 0.6 * (s.end - s.start))
    if (parent) (parent.also = parent.also || []).push(s)
    else kept.push({ ...s })
  }
  return kept.sort((a, b) => a.start - b.start)
}

/**
 * Each band session with the openGym workout it overlaps, if any: `{ session, workout, shared }`.
 * A workout logged after the fact (no start) cannot match; a backfilled one with a start can.
 */
export function matchSessions(sessions, workouts) {
  const ws = (Array.isArray(workouts) ? workouts : []).filter(w => w && num(w.start) != null && num(w.end) != null && w.end > w.start)
  return dedupeSessions(sessions).map(session => {
    let best = null, shared = 0
    for (const w of ws) {
      const o = overlap(session, w)
      if (o > shared) { shared = o; best = w }
    }
    const shorter = best ? Math.min(session.end - session.start, best.end - best.start) : 0
    const ok = best && (shared >= MATCH_MIN_MS || shared >= shorter / 2)
    return { session, workout: ok ? best : null, shared: ok ? shared : 0 }
  })
}

/** The key a logged band session is remembered by, so a refresh never logs it twice. */
export const sessionKey = s => `band:${Math.round(s.start / 1000)}:${s.type ?? 0}`
export const alreadyLogged = (workouts, session) => (workouts || []).some(w => w && w.bandKey === sessionKey(session))

/**
 * A band cardio session as an openGym workout: one cardio exercise, one set of its minutes,
 * the speed from the distance when there is one, the heart rate as the set's and the session's.
 * Null for a type the app has no exercise for, or a session too short to be a workout.
 */
export function cardioWorkoutFrom(session, { unit = 'kg', distanceKm = null, kcal = null } = {}) {
  if (!session || !loggableType(session.type)) return null
  const minutes = Math.round((session.end - session.start) / 60000)
  if (minutes < CARDIO_MIN_MINUTES) return null
  const exId = CARDIO_EXERCISE[session.type]
  const ex = EXIDX[exId]
  const hr = session.hrAvg && session.hrMax ? { avg: Math.round(session.hrAvg), max: Math.round(session.hrMax) } : null
  // km/h, or mph for a profile in pounds, from the distance the band saw.
  const kmh = distanceKm != null && distanceKm > 0 ? distanceKm / (minutes / 60) : null
  const speed = kmh != null ? Math.round((unit === 'lb' ? kmh / 1.609344 : kmh) * 10) / 10 : 0
  const set = { min: minutes, speed, done: true, at: session.end, ...(hr ? { hr } : {}) }
  const d = new Date(session.start)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    id: uid(), d: day, start: session.start, end: session.end,
    name: session.title || session.name || (ex ? ex.n : 'Cardio'),
    entries: [{ id: exId, target: { mode: 'cardio', min: minutes, speed }, sets: [set] }],
    vol: 0, prs: [],
    ...(hr ? { hr, hrFrom: 'band' } : {}),
    ...(kcal != null ? { kcal: Math.round(kcal) } : {}),
    ...(distanceKm != null ? { distanceKm: Math.round(distanceKm * 100) / 100 } : {}),
    bandKey: sessionKey(session), source: 'band', _ts: Date.now()
  }
}

/** The band sessions of a day the app could log and has not: for the on-tap button and the auto switch. */
export function loggableSessions(sessions, workouts) {
  return matchSessions(sessions, workouts)
    .filter(m => !m.workout && loggableType(m.session.type) && !alreadyLogged(workouts, m.session) && (m.session.end - m.session.start) >= CARDIO_MIN_MINUTES * 60000)
    .map(m => m.session)
}
