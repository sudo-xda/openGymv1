// Everything the band wrote to Health Connect, day by day (lib/health-store.js, lib/health-data.js):
// the heart rate's curve, the night, activity, the band's own workouts with their heart rate,
// and the body's numbers. Android app only; reached from the Recovery card, Stats and Settings.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO, isoOf, DAYS } from '../lib/format.js'
import { loadHealthData, refreshHealthData } from '../lib/health-store.js'
import { hasData } from '../lib/health-data.js'
import { requestRecoveryPermissions } from '../lib/health-sync.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../nutrition.css'
import '../health.css'

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }
const hm = min => (min == null ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}`)
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const DENIED_LABEL = { distance: 'Distance', activeKcal: 'Active calories', totalKcal: 'Total calories', exercise: 'Workouts', spo2: 'Blood oxygen', respiratory: 'Respiratory rate', vo2max: 'VO₂ max', weight: 'Weight', bodyFat: 'Body fat', floors: 'Floors', bloodPressure: 'Blood pressure', bmr: 'Basal metabolic rate', temperature: 'Temperature', hydration: 'Hydration', hrv: 'HRV' }

export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [store, setStore] = useState(null)
  const [busy, setBusy] = useState(false)
  const [day, setDay] = useState(todayISO())
  useEffect(() => { loadHealthData().then(setStore) }, [])
  const refresh = async () => {
    setBusy(true)
    const r = await refreshHealthData()
    setBusy(false)
    if (r.ok) { setStore(await loadHealthData()); toast(t('Health data updated')) }
    else toast(r.reason === 'permission' ? t('Allow reading in Settings → Recovery first.') : r.reason === 'unavailable' ? t('Health Connect is not available on this phone.') : t('Could not read Health Connect.'))
  }
  const allowMore = async () => { try { await requestRecoveryPermissions() } catch { /* dismissed */ } refresh() }
  // The first visit reads at once, so the screen is never empty for no reason.
  useEffect(() => { if (store && !store.at && S.recoveryOn === true) refresh() }, [store?.at])

  const days = store?.days || {}
  const s = days[day] || null
  const week = useMemo(() => { const out = []; for (let i = 6; i >= 0; i--) { const d = shift(day, -i); out.push({ d, s: days[d] || null }) } return out }, [days, day])
  const isToday = day === todayISO()
  const hrPoints = useMemo(() => (s?.hr?.series || []).map(([x, y]) => ({ t: x, y, d: day })), [s])
  const denied = (store?.denied || []).filter(k => DENIED_LABEL[k])
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Health')}</h1><div className="sub">{store?.at ? t('Read {0}', fmtDate(isoOf(new Date(store.at)), true)) : t('From Health Connect')}</div></div>
      <Button size="sm" icon="repeat" disabled={busy} onClick={refresh}>{busy ? t('Reading…') : t('Refresh')}</Button>
    </div>

    {S.recoveryOn !== true && <div className="card"><div className="muted small">{t('Turn the recovery engine on under Settings → Recovery from Health Connect, and everything the band writes shows up here.')}</div>
      <div style={{ height: 8 }} /><Button onClick={() => nav('/settings/data')}>{t('Open Settings')}</Button></div>}

    <div className="nut-day">
      <button className="iconbtn" onClick={() => setDay(d => shift(d, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <div><div className="nut-day-t">{isToday ? t('Today') : fmtDate(day, true)}</div><div className="nut-day-s">{s && hasData(s) ? t('{0} heart-rate readings', fmtNum(s.hr?.n || 0)) : t('No data for this day')}</div></div>
      <button className="iconbtn" disabled={isToday} onClick={() => setDay(d => shift(d, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{t('Heart rate')}</h2>{s?.restingHr != null && <span className="small" style={{ color: 'var(--label-2)' }}>{t('resting {0}', s.restingHr)}</span>}</div>
      {s?.hr ? <>
        <div className="hl-tiles">
          <div><b>{s.hr.min}</b><span>{t('Low')}</span></div>
          <div><b>{s.hr.avg}</b><span>{t('Average')}</span></div>
          <div><b>{s.hr.max}</b><span>{t('Peak')}</span></div>
          <div><b>{s.hrv != null ? fmtNum(s.hrv) : '–'}</b><span>{t('HRV ms')}</span></div>
        </div>
        <div className="chart"><LineChart points={hrPoints} h={140} unit="bpm" color="var(--red)" /></div>
      </> : <div className="muted small">{t('No heart-rate samples for this day.')}</div>}
    </div>

    <div className="card">
      <h2>{t('Sleep')}</h2>
      {s?.sleep ? <>
        <div className="row between" style={{ alignItems: 'baseline' }}><div className="big" style={{ fontSize: 26 }}>{hm(s.sleep.total)}</div><span className="small dim">{clock(s.sleep.from)} – {clock(s.sleep.to)} · {Math.round(s.sleep.efficiency * 100)}%</span></div>
        <div className="sleep-bar" aria-hidden="true">
          {['deep', 'rem', 'light', 'awake'].map(k => <i key={k} className={k} style={{ width: (s.sleep[k] / (s.sleep.total + s.sleep.awake) * 100) + '%' }} />)}
        </div>
        <div className="sleep-legend">
          <span><i className="deep" />{t('Deep')} {hm(s.sleep.deep)}</span><span><i className="rem" />{t('REM')} {hm(s.sleep.rem)}</span>
          <span><i className="light" />{t('Light')} {hm(s.sleep.light)}</span><span><i className="awake" />{t('Awake')} {hm(s.sleep.awake)}</span>
        </div>
      </> : <div className="muted small">{t('No sleep recorded for the night before.')}</div>}
    </div>

    <div className="card">
      <h2>{t('Activity')}</h2>
      <div className="hl-tiles">
        <div><b>{fmtNum(s?.steps || 0)}</b><span>{t('Steps')}</span></div>
        <div><b>{s?.distanceKm ? fmtNum(s.distanceKm) : '–'}</b><span>km</span></div>
        <div><b>{s?.activeKcal ? fmtNum(s.activeKcal) : '–'}</b><span>{t('Active kcal')}</span></div>
        <div><b>{s?.totalKcal ? fmtNum(s.totalKcal) : '–'}</b><span>{t('Total kcal')}</span></div>
      </div>
      {!!(s?.floors || s?.hydrationMl) && <div className="small dim" style={{ marginTop: 6 }}>{s.floors ? t('{0} floors', fmtNum(s.floors)) : ''}{s.floors && s.hydrationMl ? ' · ' : ''}{s.hydrationMl ? t('{0} ml water', fmtNum(s.hydrationMl)) : ''}</div>}
      <div className="nut-week" style={{ marginTop: 10 }}>
        {week.map(x => {
          const max = Math.max(1, ...week.map(y => y.s?.steps || 0))
          const d = new Date(x.d + 'T12:00:00')
          return <button key={x.d} onClick={() => setDay(x.d)} aria-label={fmtDate(x.d, true) + ': ' + fmtNum(x.s?.steps || 0)}>
            <span className={'bar' + (x.d === day ? ' sel' : '')} style={{ height: Math.max(4, Math.round((x.s?.steps || 0) / max * 60)) + 'px' }}><i style={{ height: '100%' }} /></span>
            <span className={'d' + (x.d === day ? ' on' : '')}>{t(DAYS[d.getDay()]).slice(0, 2)}</span>
          </button>
        })}
      </div>
    </div>

    <div className="card">
      <h2>{t('Workouts on the band')}</h2>
      {s?.exercise?.length ? s.exercise.map((e, i) => <div key={i} className="meal">
        <div className="grow"><div className="meal-t">{e.title || t(e.name)}</div><div className="meal-s">{clock(e.start)} – {clock(e.end)} · {t('{0} min', e.minutes)}{e.hrAvg ? ` · ♥ ${e.hrAvg}/${e.hrMax}` : ''}</div></div>
      </div>) : <div className="muted small">{t('No workout recorded by the band on this day.')}</div>}
    </div>

    <div className="card">
      <h2>{t('Body')}</h2>
      <div className="hl-tiles">
        <div><b>{s?.spo2 ? s.spo2.avg + '%' : '–'}</b><span>{t('Blood oxygen')}{s?.spo2 ? ` · ${t('low')} ${s.spo2.min}%` : ''}</span></div>
        <div><b>{s?.respiratory != null ? fmtNum(s.respiratory) : '–'}</b><span>{t('Breaths / min')}</span></div>
        <div><b>{s?.weight != null ? fmtNum(s.weight) + ' kg' : '–'}</b><span>{t('Weight')}{s?.bodyFat != null ? ` · ${fmtNum(s.bodyFat)}% ${t('fat')}` : ''}</span></div>
        <div><b>{s?.vo2max != null ? fmtNum(s.vo2max) : '–'}</b><span>VO₂ max</span></div>
        <div><b>{s?.bloodPressure ? `${s.bloodPressure.systolic}/${s.bloodPressure.diastolic}` : '–'}</b><span>{t('Blood pressure')}</span></div>
        <div><b>{s?.temperature != null ? fmtNum(s.temperature) + '°' : '–'}</b><span>{t('Temperature')}</span></div>
        <div><b>{s?.bmr != null ? fmtNum(s.bmr) : '–'}</b><span>{t('BMR kcal')}</span></div>
      </div>
    </div>

    {!!denied.length && <div className="card">
      <div className="small muted" style={{ marginBottom: 8 }}>{t('Not allowed yet: {0}.', denied.map(k => t(DENIED_LABEL[k])).join(', '))}</div>
      <Button size="sm" variant="tinted" icon="key" onClick={allowMore}>{t('Allow more types')}</Button>
    </div>}
  </div>
}
