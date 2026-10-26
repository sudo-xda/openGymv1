// The two messages the Coach writes by itself: the morning briefing, once a day after the band's
// reading, and the weekly review, once a week on the first open. Each lands in a thread of its
// own (lib/coach-threads.js) and the latest briefing is kept where the Recovery card shows it.
// Both go through the chat's direct call (lib/coach-api.js requestAsk) with a mode, so they are
// seconds, not minutes, and need the Coach set up, consented to, and the switch in the chat's
// menu on. A phone that said "not now" to data sharing is never asked here.
import { useStore } from '../store/useStore.js'
import { requestAsk, disclosure, coachVia } from './coach-api.js'
import { hasConsent, emptyCoach } from './coach.js'
import { ensureThreads, pushMessageTo, newThread, renameThread, switchThread } from './coach-threads.js'
import { deviceContext } from './coach-context.js'
import { coachAvailable } from './coach.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'
import { todayISO } from './format.js'
import { t } from './i18n.js'

const weekKeyOf = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10) }

async function ready() {
  const st = useStore.getState()
  const S = st.S
  const ok = coachAvailable(st.config, st.user, { demo: DEMO, mobile: MOBILE, coachMode: st.coachLocal?.mode })
  if (!ok || !hasConsent(S) || !S.coach?.profile) return false
  if (DEMO) return true
  try {
    const { consentTarget, hasAiConsent } = await import('./coach-consent.js')
    const target = consentTarget(await disclosure(), coachVia())
    return !target || target.local || await hasAiConsent(target)
  } catch { return false }
}

/** A thread of the Coach's own, made once and kept by key (`briefing`, `weekly`). */
function ownThread(c, key, title) {
  ensureThreads(c)
  const keep = c.activeThread
  let th = (c.threads || []).find(x => x.own === key)
  if (!th) { th = newThread(c); th.own = key; renameThread(c, th.id, title); th.autoTitled = false }
  // Writing by itself must not steal the thread the person is in.
  if (keep && keep !== th.id) switchThread(c, keep)
  return th
}

/** The morning briefing for `day`; `{ ok, text }` or `{ ok: false, reason }`. Once per day unless `force`. */
export async function morningBriefing({ force = false, day = todayISO() } = {}) {
  const st = useStore.getState()
  const S = st.S
  if (!force && S.coach?.autoBriefing === false) return { ok: false, reason: 'off' }
  if (!force && S.coach?.briefing?.d === day) return { ok: false, reason: 'done' }
  if (!(await ready())) return { ok: false, reason: 'notready' }
  let r
  try { r = await requestAsk('', [], { mode: 'briefing', device: await deviceContext() }) }
  catch (e) { return { ok: false, reason: e?.data?.code || 'failed', detail: String(e?.message || e) } }
  const text = String(r?.reply || '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  st.update(s => {
    const c = (s.coach = s.coach || emptyCoach())
    const th = ownThread(c, 'briefing', t('Morning briefing'))
    pushMessageTo(c, th.id, { role: 'coach', kind: 'text', md: true, text })
    c.briefing = { d: day, text, at: Date.now() }
  })
  return { ok: true, text }
}

/** The weekly review; once per week on the first open unless `force`. */
export async function weeklyReview({ force = false, day = todayISO() } = {}) {
  const st = useStore.getState()
  const S = st.S
  const wk = weekKeyOf(day)
  if (!force && S.coach?.autoWeekly === false) return { ok: false, reason: 'off' }
  if (!force && S.coach?.lastWeekly === wk) return { ok: false, reason: 'done' }
  if (!force && (S.workouts || []).length < 3) return { ok: false, reason: 'toolittle' }
  if (!(await ready())) return { ok: false, reason: 'notready' }
  let r
  try { r = await requestAsk('', [], { mode: 'weekly', device: await deviceContext() }) }
  catch (e) { return { ok: false, reason: e?.data?.code || 'failed', detail: String(e?.message || e) } }
  const text = String(r?.reply || '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  st.update(s => {
    const c = (s.coach = s.coach || emptyCoach())
    const th = ownThread(c, 'weekly', t('Weekly review'))
    pushMessageTo(c, th.id, { role: 'coach', kind: 'text', md: true, text })
    c.lastWeekly = wk
    c.weekly = { wk, text, at: Date.now() }
  })
  return { ok: true, text }
}

/** The first open of the day: the briefing after the band's reading, the review once a week. */
let checkedDay = null
export async function autoCoach() {
  const day = todayISO()
  if (checkedDay === day) return
  checkedDay = day
  try { await morningBriefing({ day }) } catch { /* next time */ }
  try { await weeklyReview({ day }) } catch { /* next time */ }
}
export function _resetAutoCoach() { checkedDay = null }
