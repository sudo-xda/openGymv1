// A saved workout's heart rate from Health Connect, after the band's app synced (which may be
// minutes or hours after the session): read the window, work the sets out (lib/workout-hr.js),
// write onto the saved record. Android app only, and only with the recovery engine on.
import { useStore } from '../store/useStore.js'
import { recoveryStatus, readHeartRate } from './health-sync.js'
import { workoutHr, applyWorkoutHr } from './workout-hr.js'
import { sameWorkout } from './workout-date.js'

/** `{ ok, sets, hr }` or `{ ok: false, reason }`: 'unavailable', 'permission', 'nosamples', 'read'. */
export async function fillWorkoutHr(w) {
  if (!w || !(w.start > 0) || !(w.end > w.start)) return { ok: false, reason: 'nosamples' }
  const st = await recoveryStatus()
  if (st.status !== 'available') return { ok: false, reason: 'unavailable' }
  if (!st.readGranted) return { ok: false, reason: 'permission' }
  let rows
  try { rows = await readHeartRate(w.start - 60000, w.end + 60000) }
  catch (e) { return { ok: false, reason: e?.code === 'permission' ? 'permission' : 'read' } }
  const result = workoutHr(w, rows)
  if (!result.samples) return { ok: false, reason: 'nosamples' }
  let sets = 0
  useStore.getState().update(s => {
    const rec = s.workouts.find(x => sameWorkout(x, w))
    if (rec) sets = applyWorkoutHr(rec, result)
  })
  console.info('[workout-hr]', result.samples, 'samples;', sets, 'sets filled; session', result.hr)
  return { ok: true, sets, hr: result.hr, samples: result.samples }
}
