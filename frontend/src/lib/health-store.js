// The Health screen's data (views/Health.jsx): everything Health Connect holds, read into days
// (lib/health-data.js) and kept in the phone's own file — a month of day summaries, never the raw
// samples, never in the synced state (it is the band's data as the band app wrote it, available
// again from Health Connect any time). The recovery engine's reading of the night is the part
// that syncs (S.biometrics); this is the rest.
import { readJsonFile, writeJsonFile } from './mobile.js'
import { readAllHealth, recoveryStatus } from './health-sync.js'
import { summarizeDays, hasData } from './health-data.js'
import { todayISO } from './format.js'

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
 * days, denied }` or `{ ok: false, reason }`: 'unavailable', 'permission', 'read'.
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
  console.info('[health]', Object.keys(fresh).filter(d => hasData(fresh[d])).length, 'days with data of', READ_DAYS, '; denied:', next.denied.join(',') || 'none')
  return { ok: true, days: next.days, denied: next.denied }
}
export function _resetHealthData() { cache = null }
