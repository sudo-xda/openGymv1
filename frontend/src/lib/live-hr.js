// A band's live heart rate during a workout (BleHeartRatePlugin.java): the stream, the chosen
// band, and what a set and its rest got out of it (lib/workout-hr.js liveSetHr).
//
// The band is a fact of this phone — its Bluetooth address in the app's own file, never in the
// synced state. A Mi Band shares its heart rate over Bluetooth only while a workout mode runs
// on the band with "activity heart rate sharing" (and "discoverable") on in its app; a chest
// strap shares always.
// Android app only; elsewhere `available()` is false and nothing here is loaded.
import { MOBILE, nativePlatform, readJsonFile, writeJsonFile } from './mobile.js'
import { liveSetHr } from './workout-hr.js'

export const LIVE_HR_FILE = 'opengym-live-hr.json'
const KEEP_MS = 4 * 3600000     // the whole session's curve is reduced onto the workout at finish

let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || (await nativePlatform()) !== 'android') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { BLE: registerPlugin('BleHeartRate') }
})().catch(() => null))

export const available = async () => !!(await plugin())

let cfg = null
export async function loadLiveHr() {
  if (cfg) return cfg
  const f = await readJsonFile(LIVE_HR_FILE)
  cfg = { on: false, address: null, name: '', ...(f && typeof f === 'object' ? f : {}) }
  return cfg
}
const save = patch => { cfg = { ...(cfg || {}), ...patch }; return writeJsonFile(LIVE_HR_FILE, cfg) }

export async function status() {
  const p = await plugin()
  if (!p) return { supported: false, enabled: false, granted: false, connected: false }
  try { return await p.BLE.status() } catch { return { supported: false, enabled: false, granted: false, connected: false } }
}
export async function requestPermissions() {
  const p = await plugin()
  if (!p) return false
  try { return !!(await p.BLE.requestPermissions()).granted } catch { return false }
}
/** The bands around, best first: `{ address, name, connected, bonded, hrs, band }` — the one the
 * phone already holds a link to (its app is connected), the ones advertising a heart rate, the
 * band-like names, the paired ones, the rest. A Mi Band does not advertise the service, so
 * whether it really shares is only known on connect. */
export async function scan(ms = 8000) {
  const p = await plugin()
  if (!p) return []
  const r = await p.BLE.scan({ ms })
  return r?.devices || []
}
export async function chooseBand(device) {
  await loadLiveHr()
  await save({ address: device?.address || null, name: device?.name || '', on: !!device })
}
export async function setLiveHrOn(on) { await loadLiveHr(); await save({ on: !!on }) }

/* ---------- the stream ---------- */

const samples = []          // { at, bpm }, newest last
const listeners = new Set()
let connected = false
let handles = []
let lastBpm = null

/** Subscribe to readings and connection state: `fn({ bpm, at, connected })`. Returns unsubscribe. */
export function onLiveHr(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const emit = x => { for (const fn of listeners) { try { fn(x) } catch { /* a listener's problem */ } } }
export const isConnected = () => connected
export const latestBpm = () => (connected ? lastBpm : null)

/** Connects to the chosen band and starts listening. `{ ok, reason }`. */
export async function startLiveHr() {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unavailable' }
  const c = await loadLiveHr()
  if (!c.on || !c.address) return { ok: false, reason: 'off' }
  const st = await status()
  if (!st.supported) return { ok: false, reason: 'unsupported' }
  if (!st.enabled) return { ok: false, reason: 'bluetooth' }
  if (!st.granted && !(await requestPermissions())) return { ok: false, reason: 'permission' }
  await stopLiveHr()
  handles = [
    await p.BLE.addListener('hr', ev => {
      const bpm = Number(ev?.bpm), at = Number(ev?.at) || Date.now()
      if (!Number.isFinite(bpm)) return
      samples.push({ at, bpm }); lastBpm = bpm
      while (samples.length && samples[0].at < at - KEEP_MS) samples.shift()
      emit({ bpm, at, connected: true })
    }),
    await p.BLE.addListener('state', ev => { connected = !!ev?.connected; if (!connected) lastBpm = null; emit({ bpm: lastBpm, at: Date.now(), connected }) })
  ]
  try {
    await p.BLE.connect({ address: c.address })
    connected = true
    return { ok: true }
  } catch (e) {
    await stopLiveHr()
    return { ok: false, reason: e?.code === 'timeout' ? 'timeout' : 'failed', detail: String(e?.message || e) }
  }
}
export async function stopLiveHr() {
  const p = await plugin()
  for (const h of handles) { try { await h.remove() } catch { /* gone */ } }
  handles = []
  if (p && connected) { try { await p.BLE.disconnect() } catch { /* gone */ } }
  connected = false
  lastBpm = null
}

/** Every sample the stream still holds, oldest first — reduced onto the workout at finish (lib/workout-hr.js applyLiveHr). */
export const liveSamples = () => samples.slice()
/** The set's figure from the stream between two moments — null without readings. */
export const setHrSince = (from, to = Date.now()) => liveSetHr(samples, from, to)
/** The newest sample's time, so a set can be measured from the previous tick or the connection. */
export const firstSampleAt = () => (samples.length ? samples[0].at : null)
export function _resetLiveHr() { samples.length = 0; connected = false; lastBpm = null; cfg = null }
