// The Stats tab's Muscle recovery card (views/Stats.jsx): the fatigue model's per-muscle value
// (lib/recovery.js fatigueOf, 0 = fresh, 1 = a full session's stimulus still in the muscle)
// read as a recovery percentage, with the same three states the fatigue map uses
// (lib/recovery-view.js), so the card and the map never disagree about a muscle.
import { MUSCLES } from './muscles.js'
import { fatigueStateOf } from './recovery-view.js'

/** 0–100: how recovered a muscle is. 1 - fatigue, clamped, as a whole number. */
export function recoveryPct(fatigue) {
  const f = Number(fatigue)
  if (!Number.isFinite(f)) return 100
  return Math.round((1 - Math.min(1, Math.max(0, f))) * 100)
}

/**
 * Every drawable muscle with its recovery percentage and state, most fatigued first (then the
 * map's own order), plus a count per state for the card's headline.
 */
export function recoveryScores(fatigue) {
  const rows = MUSCLES.map((slug, i) => {
    const f = Number(fatigue?.[slug]) || 0
    return { slug, fatigue: f, pct: recoveryPct(f), state: fatigueStateOf(f), order: i }
  }).sort((a, b) => a.pct - b.pct || a.order - b.order)
  const counts = { ready: 0, recovering: 0, fatigued: 0 }
  rows.forEach(r => { counts[r.state]++ })
  return { rows: rows.map(({ order, ...r }) => r), counts }
}
