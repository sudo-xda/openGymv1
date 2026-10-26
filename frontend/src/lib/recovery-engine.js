// The recovery engine's loop: read Health Connect (lib/health-sync.js readRecovery), work the
// day out (lib/biometrics.js), write it into the state. Once a day on the first open, and on
// demand from the card, from Settings, and before a workout.
//
// Android app only. Everywhere else `recoveryStatus()` answers 'unsupported', the card and the
// Settings section show nothing, and the Coach gets no biometrics.
import { useStore } from '../store/useStore.js'
import { recoveryStatus, readRecovery } from './health-sync.js'
import { dayReading, recordReading } from './biometrics.js'
import { todayISO } from './format.js'

const READ_DAYS = 3

/** `{ on, available, readGranted }` — whether the engine can run on this phone right now. */
export async function engineStatus() {
  const s = await recoveryStatus()
  const on = useStore.getState().S.recoveryOn === true
  return { on, available: s.status === 'available', readGranted: s.readGranted, status: s.status }
}

/**
 * The day's reading, written into S.biometrics. `{ ok, reading }`, or `{ ok: false, reason }`:
 * 'unavailable' (not the Android app, or no Health Connect), 'permission' (reading not allowed),
 * 'nodata' (nothing in the last days), 'nonight' (data, but no sleep and no resting rate for
 * the day — the band has not synced its app yet).
 */
export async function refreshRecovery({ day = todayISO() } = {}) {
  const st = await recoveryStatus()
  if (st.status !== 'available') return { ok: false, reason: 'unavailable' }
  if (!st.readGranted) return { ok: false, reason: 'permission' }
  let data
  try { data = await readRecovery(READ_DAYS) }
  catch (e) { return { ok: false, reason: e?.code === 'permission' ? 'permission' : 'read', detail: String(e?.message || e) } }
  const n = (data?.sleep?.length || 0) + (data?.hr?.length || 0) + (data?.steps?.length || 0) + (data?.restingHr?.length || 0)
  if (!n) return { ok: false, reason: 'nodata' }
  const reading = dayReading(data, day, useStore.getState().S.biometrics || {})
  // What was read, for anyone checking the bridge works.
  console.info('[recovery]', `${data.sleep?.length || 0} sleep sessions, ${data.hr?.length || 0} HR samples, ${data.restingHr?.length || 0} resting HR, ${data.steps?.length || 0} step records, ${data.hrv?.length || 0} HRV;`, day,
    'sleep', reading.sleep ? `${reading.sleep.total} min (deep ${reading.sleep.deep}, light ${reading.sleep.light}, REM ${reading.sleep.rem}, awake ${reading.sleep.awake})` : 'none',
    'RHR', reading.restingHr, 'HRV', reading.hrv, 'steps', reading.steps, 'score', reading.score, reading.flags.join(','))
  if (!reading.sleep && reading.restingHr == null) {
    // Still keep the steps: the card has something to show and tomorrow's baseline too.
    useStore.getState().update(s => { if (!s.biometrics?.[day]?.sleep) recordReading(s, reading) })
    return { ok: false, reason: 'nonight', reading }
  }
  useStore.getState().update(s => { recordReading(s, reading) })
  return { ok: true, reading }
}

/** The morning reading: once per day on the first open, while the engine is on. */
let checkedDay = null
export async function morningRefresh() {
  const day = todayISO()
  if (checkedDay === day) return
  checkedDay = day
  const S = useStore.getState().S
  if (S.recoveryOn !== true || S.recoveryAuto === false) return
  if (S.biometrics?.[day]?.sleep) return
  try { await refreshRecovery({ day }) } catch { /* next time */ }
}
export function _resetMorning() { checkedDay = null }
