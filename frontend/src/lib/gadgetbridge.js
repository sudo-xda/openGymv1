// The band, from the page: the Android plugin (GadgetbridgePlugin.java) asked for a sync and for
// the samples, the reading worked out here (lib/biometrics.js) and written into the state.
//
// Android app only. Everywhere else `available()` is false and nothing here is loaded: the
// Home card and the Settings section show nothing, the Coach gets no biometrics.
//
// Two triggers: once a day on the first open (the morning reading), and by hand — the card's
// Refresh, the Settings button, and the one the workout start offers. A sync broadcast goes
// first; Gadgetbridge fetches from the band in its own time and its auto-export writes the file
// the plugin reads, so the reading is as fresh as the last export.
import { MOBILE, isAndroid } from './mobile.js'
import { useStore } from '../store/useStore.js'
import { parseSamples, dayReading, recordReading } from './biometrics.js'
import { todayISO } from './format.js'

let pluginP = null
const plugin = () => pluginP || (pluginP = import('@capacitor/core').then(m => m.registerPlugin('Gadgetbridge')))

export async function available() {
  if (!MOBILE) return false
  try { return await isAndroid() } catch { return false }
}

/** `{ installed, hasDatabase, name }` — what the Settings section says. */
export async function status() {
  if (!(await available())) return { installed: false, hasDatabase: false }
  try { return await (await plugin()).status() } catch { return { installed: false, hasDatabase: false } }
}
export async function pickDatabase() {
  const r = await (await plugin()).pickDatabase()
  return r && r.uri ? r : null
}
export async function forget() {
  try { await (await plugin()).forget() } catch { /* nothing kept */ }
}
/** Asks Gadgetbridge to fetch from the band. `{ installed, sent }`; never throws. */
export async function sync() {
  try { return await (await plugin()).sync() } catch { return { installed: false, sent: false } }
}

// A sync lands on the band in seconds and in the export whenever Gadgetbridge writes it next;
// reading right after a sync reads the previous export. The read waits this long after a sync
// so a quick auto-export has a chance, and the person can refresh again later.
const SYNC_SETTLE_MS = 4000
const READ_DAYS = 3

/**
 * The day's reading, written into S.biometrics. `{ ok, reading }` or `{ ok: false, reason }`:
 * 'unavailable' (not the Android app), 'nodb' (no export chosen), 'read' (the file could not be
 * read), 'nosamples' (nothing in the last days), 'nosleep' (samples, but no night in them).
 */
export async function refreshBiometrics({ withSync = true, day = todayISO() } = {}) {
  if (!(await available())) return { ok: false, reason: 'unavailable' }
  const p = await plugin()
  if (withSync) {
    const s = await sync()
    if (s.sent) await new Promise(r => setTimeout(r, SYNC_SETTLE_MS))
  }
  let data
  try { data = await p.read({ days: READ_DAYS }) }
  catch (e) { return { ok: false, reason: /nodb|no Gadgetbridge database/.test(String(e?.code || e?.message)) ? 'nodb' : 'read', detail: String(e?.message || e) } }
  const samples = parseSamples(data?.rows)
  if (!samples.length) return { ok: false, reason: 'nosamples' }
  const reading = dayReading(samples, day, useStore.getState().S.biometrics || {})
  // What was read, for anyone checking the bridge works (the task's log requirement).
  console.info('[gadgetbridge]', data.table, data.count, 'samples;', day, 'sleep', reading.sleep ? `${reading.sleep.total} min (deep ${reading.sleep.deep}, light ${reading.sleep.light}, REM ${reading.sleep.rem}, awake ${reading.sleep.awake})` : 'none', 'RHR', reading.restingHr, 'steps', reading.steps, 'score', reading.score)
  if (!reading.sleep && reading.restingHr == null) return { ok: false, reason: 'nosleep', reading }
  useStore.getState().update(s => { recordReading(s, reading) })
  return { ok: true, reading }
}

/** The morning reading: once per day, on the first open, when an export is chosen. */
let checkedDay = null
export async function morningRefresh() {
  const day = todayISO()
  if (checkedDay === day) return
  checkedDay = day
  const S = useStore.getState().S
  if (S.biometricsAuto === false) return
  if (S.biometrics?.[day]?.sleep) return
  const st = await status()
  if (!st.hasDatabase) return
  try { await refreshBiometrics({ withSync: true, day }) } catch { /* next time */ }
}
