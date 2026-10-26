// Recovery and readiness, from the band through Health Connect (lib/recovery-engine.js,
// lib/biometrics.js): the score, the night, the resting heart rate, HRV and steps, with today's
// session beside them and one line on what to do with it. At the top of Home, once the engine
// is on (Settings → Recovery from Health Connect).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { effectiveRoutines } from '../lib/history.js'
import { baselineOf, adviceOf } from '../lib/biometrics.js'
import { refreshRecovery } from '../lib/recovery-engine.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const COLOR = { ready: 'var(--green)', moderate: 'var(--yellow)', low: 'var(--orange)' }
const WORD = { ready: () => t('Ready to train'), moderate: () => t('Train, but easy'), low: () => t('Recover first') }
const hm = min => (min == null ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}`)
const FLAG = { rhrElevated: () => t('Resting HR up'), sleepShort: () => t('Short sleep'), deepRemLow: () => t('Little deep/REM'), restless: () => t('Restless night'), hrvLow: () => t('HRV down') }

export const adviceLine = (advice, routineName) => {
  if (advice === 'deload') return routineName ? t('Deload {0}: about 15% off the working weights, fewer sets, nothing to failure.', routineName) : t('A deload day: about 15% off the working weights, fewer sets, nothing to failure.')
  if (advice === 'easy') return routineName ? t('{0} as planned, but leave reps in the tank and skip PR attempts.', routineName) : t('Train as planned, but leave reps in the tank and skip PR attempts.')
  if (advice === 'go') return routineName ? t('Green light for {0}. Push the top sets.', routineName) : t('Green light. Push the top sets.')
  return ''
}
export const refreshToast = r => r.ok ? t('Recovery updated')
  : r.reason === 'permission' ? t('Allow reading in Settings → Recovery first.')
    : r.reason === 'nonight' ? t('No night for today yet. Sync the band in its app and refresh.')
      : r.reason === 'nodata' ? t('Health Connect has nothing from the last days.')
        : r.reason === 'unavailable' ? t('Health Connect is not available on this phone.') : t('Could not read Health Connect.')

export default function RecoveryCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const day = todayISO()
  const reading = S.biometrics?.[day] || null
  const latestDay = useMemo(() => Object.keys(S.biometrics || {}).sort().pop() || null, [S.biometrics])
  const shown = reading || (latestDay ? S.biometrics[latestDay] : null)
  const base = useMemo(() => baselineOf(S.biometrics || {}, shown?.d || day), [S.biometrics, shown?.d, day])
  const routine = effectiveRoutines(S, day)[0] || null
  if (S.recoveryOn !== true) return null

  const refresh = async () => {
    setBusy(true)
    const r = await refreshRecovery()
    setBusy(false)
    toast(refreshToast(r))
  }
  const advice = adviceOf(shown)
  const color = shown?.readiness ? COLOR[shown.readiness] : 'var(--label-3)'
  const delta = shown?.restingHr != null && base.restingHr != null ? Math.round(shown.restingHr - base.restingHr) : null
  return <div className="card" data-recovery-card>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Recovery')}{shown && shown.d !== day ? <span className="dim" style={{ textTransform: 'none' }}> · {t('last reading')}</span> : null}</h2>
      <Button size="sm" icon="repeat" disabled={busy} onClick={refresh}>{busy ? t('Reading…') : t('Refresh')}</Button>
    </div>
    {shown ? <>
      <div className="rec-hero">
        <div className="deb-ring rec-ring" style={{ '--pct': (shown.score || 0) / 100, '--c': color }}><span>{shown.score ?? '–'}</span></div>
        <div className="grow">
          <div className="rec-word" style={{ color }}>{shown.readiness ? WORD[shown.readiness]() : t('No night found yet')}</div>
          <div className="rec-tiles">
            <div><b>{shown.restingHr ?? '–'}{delta != null && delta !== 0 ? <small style={{ color: delta > 0 ? 'var(--orange)' : 'var(--green)' }}> {delta > 0 ? '+' : ''}{delta}</small> : null}</b><span>{t('Resting HR')}{base.restingHr ? ` · ${t('avg')} ${fmtNum(Math.round(base.restingHr))}` : ''}</span></div>
            <div><b>{hm(shown.sleep?.total)}</b><span>{t('Sleep')}{shown.sleep ? ` · ${Math.round(shown.sleep.efficiency * 100)}%` : ''}</span></div>
            <div><b>{shown.sleep ? hm(shown.sleep.deep + shown.sleep.rem) : '–'}</b><span>{t('Deep + REM')}</span></div>
            <div><b>{shown.hrv != null ? fmtNum(shown.hrv) + ' ms' : fmtNum(shown.steps || 0)}</b><span>{shown.hrv != null ? t('HRV') : t('Steps')}</span></div>
          </div>
        </div>
      </div>
      {advice !== 'none' && <div className="rec-advice" style={{ '--c': color }}>
        <Icon name={advice === 'deload' ? 'warning' : advice === 'easy' ? 'gauge' : 'bolt'} />
        <span>{adviceLine(advice, routine?.name)}</span>
      </div>}
      {!!shown.flags?.length && <div className="rec-flags">
        {shown.flags.map(f => <span key={f} className="tag">{FLAG[f] ? FLAG[f]() : f}</span>)}
      </div>}
    </> : <div className="muted small">{t('Reading Health Connect. Refresh once the band has synced to its app.')}</div>}
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
      <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/settings')}>{t('Recovery settings')}</Button>
    </div>
  </div>
}
