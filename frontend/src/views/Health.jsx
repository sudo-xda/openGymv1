// Everything the band wrote to Health Connect, day by day (lib/health-store.js, lib/health-data.js),
// joined with the app's own: the heart rate's curve, the night, activity, the band's workouts
// beside the logged ones, the body's numbers with the app's weigh-ins and measurements filling
// what the band does not write, and a month of trends. Android app only; the second tab while the
// recovery engine is on, else reached from the Recovery card, Stats and Settings.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO, isoOf, DAYS } from '../lib/format.js'
import { loadHealthData, refreshHealthData, logBandSession } from '../lib/health-store.js'
import { hasData } from '../lib/health-data.js'
import { matchSessions, loggableType, alreadyLogged } from '../lib/health-match.js'
import { requestRecoveryPermissions } from '../lib/health-sync.js'
import { latestMeasurement } from '../lib/measurements.js'
import { maxHrOf, zoneBounds, ZONE_COLORS } from '../lib/hr-zones.js'
import { baselineOf } from '../lib/biometrics.js'
import { workoutDetailSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Hypnogram from '../components/Hypnogram.jsx'
import { Tiles, SectionHead } from '../components/Tiles.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField } from '../components/ui.jsx'

const READY_COLOR = { ready: 'var(--green)', moderate: 'var(--yellow)', low: 'var(--orange)' }
import '../nutrition.css'
import '../health.css'

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }
const hm = min => (min == null ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}`)
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const DENIED_LABEL = { distance: 'Distance', activeKcal: 'Active calories', totalKcal: 'Total calories', exercise: 'Workouts', spo2: 'Blood oxygen', respiratory: 'Respiratory rate', vo2max: 'VO₂ max', weight: 'Weight', bodyFat: 'Body fat', floors: 'Floors', bloodPressure: 'Blood pressure', bmr: 'Basal metabolic rate', temperature: 'Temperature', hydration: 'Hydration', hrv: 'HRV' }
const LB_PER_KG = 2.2046226218

export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [store, setStore] = useState(null)
  const [busy, setBusy] = useState(false)
  const [day, setDay] = useState(todayISO())
  useEffect(() => { loadHealthData().then(setStore) }, [])
  const refresh = async () => {
    setBusy(true)
    const r = await refreshHealthData()
    setBusy(false)
    if (r.ok) {
      setStore(await loadHealthData())
      toast(r.filled || r.logged ? t('Updated · heart rate on {0} workouts · {1} band workouts logged', r.filled, r.logged) : t('Health data updated'))
    } else toast(r.reason === 'permission' ? t('Allow reading in Settings → Recovery first.') : r.reason === 'unavailable' ? t('Health Connect is not available on this phone.') : t('Could not read Health Connect.'))
  }
  const allowMore = async () => { try { await requestRecoveryPermissions() } catch { /* dismissed */ } refresh() }
  useEffect(() => { if (store && !store.at && S.recoveryOn === true) refresh() }, [store?.at])

  const days = store?.days || {}
  const s = days[day] || null
  const week = useMemo(() => { const out = []; for (let i = 6; i >= 0; i--) { const d = shift(day, -i); out.push({ d, s: days[d] || null }) } return out }, [days, day])
  const month = useMemo(() => Object.keys(days).sort().slice(-30).map(d => ({ d, s: days[d] })), [days])
  const isToday = day === todayISO()
  const hrPoints = useMemo(() => (s?.hr?.series || []).map(([x, y]) => ({ t: x, y, d: day })), [s])
  const hrSpans = useMemo(() => (s?.exercise || []).map(e => ({ from: e.start, to: e.end, label: e.title || t(e.name) })), [s])
  // The resting heart rate against the seven days before: the number that decides the day.
  const bio = S.biometrics || {}
  const base = useMemo(() => baselineOf(bio, day), [bio, day])
  const restingHr = s?.restingHr ?? bio[day]?.restingHr ?? null
  const rhrDelta = restingHr != null && base.restingHr != null ? Math.round(restingHr - base.restingHr) : null
  const fortnight = useMemo(() => { const out = []; for (let i = 13; i >= 0; i--) { const d = shift(day, -i); out.push({ d, r: bio[d] || null, has: !!days[d] }) } return out }, [bio, days, day])
  const denied = (store?.denied || []).filter(k => DENIED_LABEL[k])

  // The band's sessions beside the logged workouts of the day.
  const matches = useMemo(() => matchSessions(s?.exercise || [], S.workouts), [s, S.workouts])
  const logOne = session => {
    const w = logBandSession(session)
    toast(w ? t('Logged as {0}', w.name) : t('Already logged'))
  }

  // The body: the band's figure, else the app's own.
  const appWeight = useMemo(() => { const w = [...(S.bodyweight || [])].filter(b => b && b.d <= day).pop(); return w ? { value: S.unit === 'lb' ? w.w / LB_PER_KG : w.w, d: w.d } : null }, [S.bodyweight, S.unit, day])
  const appFat = useMemo(() => { try { const m = latestMeasurement(S, 'bodyFat'); return m && m.value != null ? m.value : null } catch { return null } }, [S.measurements])
  const weightKg = s?.weight ?? appWeight?.value ?? null
  const bodyFat = s?.bodyFat ?? appFat
  const bmi = weightKg && S.heightCm > 0 ? Math.round((weightKg / ((S.heightCm / 100) ** 2)) * 10) / 10 : null
  const bandWeightIsNew = s?.weight != null && !(S.bodyweight || []).some(b => b.d === day)
  const saveBandWeight = () => {
    const w = S.unit === 'lb' ? Math.round(s.weight * LB_PER_KG * 10) / 10 : Math.round(s.weight * 10) / 10
    update(st => { st.bodyweight.push({ d: day, w, t: Date.now() }); st.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1)) })
    toast(t('Weight saved'))
  }
  const bodySheet = () => openSheet(close => <BodySettings close={close} />)
  const showWeight = weightKg != null ? fmtNum(S.unit === 'lb' ? Math.round(weightKg * LB_PER_KG * 10) / 10 : Math.round(weightKg * 10) / 10) + ' ' + S.unit : null
  const body = [
    s?.spo2 && { v: s.spo2.avg + '%', l: t('Blood oxygen') + ` · ${t('low')} ${s.spo2.min}%` },
    s?.respiratory != null && { v: fmtNum(s.respiratory), l: t('Breaths / min') },
    showWeight && { v: showWeight, l: t('Weight') + (s?.weight == null && appWeight ? ' · ' + t('openGym') : '') },
    bodyFat != null && { v: fmtNum(bodyFat) + '%', l: t('Body fat') + (s?.bodyFat == null ? ' · ' + t('openGym') : '') },
    bmi != null && { v: fmtNum(bmi), l: t('BMI') },
    S.heightCm > 0 && { v: fmtNum(S.heightCm) + ' cm', l: t('Height') },
    s?.vo2max != null && { v: fmtNum(s.vo2max), l: 'VO₂ max' },
    s?.bloodPressure && { v: `${s.bloodPressure.systolic}/${s.bloodPressure.diastolic}`, l: t('Blood pressure') },
    s?.temperature != null && { v: fmtNum(s.temperature) + '°', l: t('Temperature') },
    s?.bmr != null && { v: fmtNum(s.bmr), l: t('BMR kcal') },
    { v: fmtNum(maxHrOf(S)), l: t('Max HR') + (S.maxHr ? '' : ' · ' + t('estimated')) }
  ].filter(Boolean)

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Health')}</h1><div className="sub">{store?.at ? t('Read {0}', fmtDate(isoOf(new Date(store.at)), true)) : t('From Health Connect')}</div></div>
      <Button size="sm" icon="repeat" disabled={busy} onClick={refresh}>{busy ? t('Reading…') : t('Refresh')}</Button>
    </div>

    {S.recoveryOn !== true && <div className="card"><div className="muted small">{t('Turn the recovery engine on under Settings → Recovery from Health Connect, and everything the band writes shows up here.')}</div>
      <div style={{ height: 8 }} /><Button onClick={() => nav('/settings/data')}>{t('Open Settings')}</Button></div>}

    <div className="nut-day">
      <button className="iconbtn" onClick={() => setDay(d => shift(d, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <div><div className="nut-day-t">{isToday ? t('Today') : fmtDate(day, true)}</div><div className="nut-day-s">{s && hasData(s) ? t('{0} heart-rate readings', fmtNum(s.hr?.n || 0)) : t('No data for this day')}</div></div>
      <button className="iconbtn" disabled={isToday} onClick={() => setDay(d => shift(d, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    {/* Fourteen days as dots coloured by the recovery score: jump to a day, see the pattern. */}
    <div className="hl-strip" role="tablist" aria-label={t('Last 14 days')}>
      {fortnight.map(x => {
        const c = x.r?.readiness ? READY_COLOR[x.r.readiness] : x.has ? 'var(--label-3)' : 'var(--surface-2)'
        return <button key={x.d} role="tab" aria-selected={x.d === day} className={x.d === day ? 'on' : ''} onClick={() => setDay(x.d)} aria-label={fmtDate(x.d, true) + (x.r?.score != null ? ' · ' + x.r.score : '')}>
          <i style={{ background: c }}>{x.r?.score != null && x.d === day ? x.r.score : ''}</i><span>{new Date(x.d + 'T12:00:00').getDate()}</span>
        </button>
      })}
    </div>

    <div className="card">
      <SectionHead title={t('Heart rate')} note={s?.hr ? t('{0} readings', fmtNum(s.hr.n || 0)) : null} />
      {restingHr != null && <div className="hl-hero">
        <div className="hl-hero-n" style={{ color: rhrDelta != null && rhrDelta >= 4 ? 'var(--orange)' : rhrDelta != null && rhrDelta <= -2 ? 'var(--green)' : 'var(--label)' }}>{restingHr}<small>bpm</small></div>
        <div className="hl-hero-t">
          <div className="hl-hero-l">{t('Resting heart rate')}</div>
          {rhrDelta != null
            ? <div className="hl-hero-s" style={{ color: rhrDelta >= 4 ? 'var(--orange)' : rhrDelta <= -2 ? 'var(--green)' : 'var(--label-2)' }}>{rhrDelta > 0 ? '▲' : rhrDelta < 0 ? '▼' : '='} {Math.abs(rhrDelta)} · {t('7-day average {0}', fmtNum(Math.round(base.restingHr)))}</div>
            : <div className="hl-hero-s dim">{t('A seven-day average builds as the band reads more nights.')}</div>}
        </div>
      </div>}
      {s?.hr ? <>
        <div className="chart"><LineChart points={hrPoints} h={150} unit="bpm" color="var(--red)" time zones={{ max: maxHrOf(S) }} spans={hrSpans} /></div>
        <div className="row between small" style={{ color: 'var(--label-2)', marginTop: 2 }}>
          <span>{t('low')} <b style={{ color: 'var(--label)' }}>{s.hr.min}</b> · {t('avg')} <b style={{ color: 'var(--label)' }}>{s.hr.avg}</b> · {t('peak')} <b style={{ color: 'var(--label)' }}>{s.hr.max}</b></span>
          {s.hrv != null && <span>HRV <b style={{ color: 'var(--label)' }}>{fmtNum(s.hrv)}</b> ms</span>}
        </div>
        <div className="zones-legend" style={{ marginTop: 6 }}>{zoneBounds(maxHrOf(S)).map(z => <span key={z.zone}><i style={{ background: ZONE_COLORS[z.zone - 1] }} />Z{z.zone} {z.from}–{z.to}</span>)}</div>
      </> : <EmptyNote text={t('No heart-rate samples for this day.')} hint={isToday ? t('The band writes its readings when it syncs to its app.') : null} action={isToday ? { label: t('Refresh'), onClick: refresh } : null} />}
    </div>

    <div className="card">
      <SectionHead title={t('Sleep')} note={s?.sleep ? `${clock(s.sleep.from)} – ${clock(s.sleep.to)}` : null} />
      {s?.sleep ? <>
        <div className="row between" style={{ alignItems: 'baseline' }}><div className="big" style={{ fontSize: 26 }}>{hm(s.sleep.total)}</div><span className="small dim">{t('{0}% efficiency', Math.round(s.sleep.efficiency * 100))}{bio[day]?.score != null ? ` · ${t('recovery {0}', bio[day].score)}` : ''}</span></div>
        {!!s.sleep.stages?.length && <Hypnogram stages={s.sleep.stages} from={s.sleep.from} to={s.sleep.to} />}
        <div className="sleep-bar" aria-hidden="true">
          {['deep', 'rem', 'light', 'awake'].map(k => <i key={k} className={k} style={{ width: (s.sleep[k] / (s.sleep.total + s.sleep.awake) * 100) + '%' }} />)}
        </div>
        <div className="sleep-legend">
          <span><i className="deep" />{t('Deep')} {hm(s.sleep.deep)}</span><span><i className="rem" />{t('REM')} {hm(s.sleep.rem)}</span>
          <span><i className="light" />{t('Light')} {hm(s.sleep.light)}</span><span><i className="awake" />{t('Awake')} {hm(s.sleep.awake)}</span>
        </div>
      </> : <EmptyNote text={t('No sleep recorded for the night before.')} hint={t('Wear the band to bed and let its app sync in the morning; the night shows up here and on Home.')} action={denied.includes('sleep') ? { label: t('Allow sleep'), onClick: allowMore } : null} />}
    </div>

    <div className="card">
      <SectionHead title={t('Activity')} note={base.steps ? t('avg {0} steps', fmtNum(Math.round(base.steps))) : null} />
      <Tiles items={[
        { v: fmtNum(s?.steps || 0), l: t('Steps'), color: 'var(--green)' },
        { v: s?.distanceKm ? fmtNum(s.distanceKm) : '–', l: 'km' },
        { v: s?.activeKcal ? fmtNum(s.activeKcal) : '–', l: t('Active kcal') },
        { v: s?.totalKcal ? fmtNum(s.totalKcal) : '–', l: t('Total kcal') },
      ]} />
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
      <SectionHead title={t('Workouts on the band')} note={matches.length ? tn('{0} session', '{0} sessions', matches.length) : null} />
      {matches.length ? matches.map((m, i) => {
        const e = m.session
        const canLog = !m.workout && loggableType(e.type) && !alreadyLogged(S.workouts, e) && e.minutes >= 8
        return <div key={i} className="meal">
          <div className="grow">
            <div className="meal-t">{e.title || t(e.name)}{e.also?.length ? <span className="dim small"> · {tn('{0} overlapping record', '{0} overlapping records', e.also.length)}</span> : null}</div>
            <div className="meal-s">{clock(e.start)} – {clock(e.end)} · {t('{0} min', e.minutes)}{e.hrAvg ? ` · ♥ ${e.hrAvg}/${e.hrMax}` : ''}{e.kcal ? ` · ${fmtNum(e.kcal)} kcal` : ''}{e.distanceKm ? ` · ${fmtNum(e.distanceKm)} km` : ''}</div>
            {m.workout && <button type="button" className="band-match" onClick={() => workoutDetailSheet(m.workout)}><Icon name="dumbbell" />{t('Logged: {0}', m.workout.name || t('Workout'))}{m.workout.vol ? ` · ${fmtNum(Math.round(m.workout.vol))} ${S.unit}` : ''}<Icon name="chevronRight" /></button>}
          </div>
          {canLog && <Button size="sm" variant="tinted" icon="plus" onClick={() => logOne(e)}>{t('Log')}</Button>}
        </div>
      }) : <EmptyNote text={t('No workout recorded by the band on this day.')} hint={t('Start a workout mode on the band and it lands here, matched to what you logged.')} />}
      {S.bandCardioAuto !== true && matches.some(m => !m.workout && loggableType(m.session.type)) && <div className="small dim" style={{ marginTop: 6 }}>{t('Walks and rides can be logged by themselves: Settings → Recovery → Log band cardio automatically.')}</div>}
    </div>

    <div className="card">
      <SectionHead title={t('Body')} action={<Button size="sm" variant="ghost" icon="pencil" onClick={bodySheet}>{t('Height & max HR')}</Button>} />
      <Tiles items={body} />
      {bandWeightIsNew && <div style={{ marginTop: 8 }}><Button size="sm" variant="tinted" icon="scale" onClick={saveBandWeight}>{t('Save {0} as today’s weigh-in', showWeight)}</Button></div>}
    </div>

    {month.length > 1 && <div className="card">
      <SectionHead title={t('Last 30 days')} note={t('tap a line for the full chart')} />
      <Trend label={t('Resting HR')} points={month.map(x => ({ d: x.d, y: x.s.restingHr })).filter(p => p.y != null)} unit="bpm" color="var(--red)" />
      <Trend label={t('Sleep')} points={month.map(x => ({ d: x.d, y: x.s.sleep ? Math.round(x.s.sleep.total / 6) / 10 : null })).filter(p => p.y != null)} unit="h" color="var(--indigo)" />
      <Trend label={t('Steps')} points={month.map(x => ({ d: x.d, y: x.s.steps || 0 }))} unit="" color="var(--green)" />
      {month.some(x => x.s.hrv != null) && <Trend label={t('HRV')} points={month.map(x => ({ d: x.d, y: x.s.hrv })).filter(p => p.y != null)} unit="ms" color="var(--purple)" />}
    </div>}

    {!!denied.length && <div className="card">
      <div className="small muted" style={{ marginBottom: 8 }}>{t('Not allowed yet: {0}.', denied.map(k => t(DENIED_LABEL[k])).join(', '))}</div>
      <Button size="sm" variant="tinted" icon="key" onClick={allowMore}>{t('Allow more types')}</Button>
    </div>}
  </div>
}

/** One trend line: this week against the one before, tappable to a full chart with axes and the 7-day mean. */
function Trend({ label, points, unit, color }) {
  const openSheet = useUI(s => s.openSheet)
  if (points.length < 2) return null
  const last = points[points.length - 1].y
  const avg = Math.round((points.reduce((n, p) => n + p.y, 0) / points.length) * 10) / 10
  const wk = points.slice(-7), prev = points.slice(-14, -7)
  const mean = xs => (xs.length ? xs.reduce((n, p) => n + p.y, 0) / xs.length : null)
  const a = mean(wk), b = mean(prev)
  const change = a != null && b ? Math.round((a - b) / b * 100) : null
  const pts = points.map(p => ({ t: new Date(p.d + 'T12:00:00').getTime(), y: p.y, d: p.d }))
  const open = () => openSheet(close => <TrendSheet label={label} points={pts} unit={unit} color={color} avg={avg} change={change} close={close} />)
  return <button type="button" className="hl-trend" onClick={open}>
    <div className="row between" style={{ fontSize: 13 }}>
      <span style={{ color: 'var(--label-2)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}><b>{fmtNum(last)}</b>{unit ? ' ' + unit : ''} <span className="dim">· {t('avg')} {fmtNum(avg)}</span>{change != null && change !== 0 && <span style={{ color: change > 0 ? 'var(--label)' : 'var(--label-2)', marginInlineStart: 6 }}>{change > 0 ? '▲' : '▼'} {Math.abs(change)}%</span>}</span>
    </div>
    <div className="chart"><LineChart points={pts} h={70} unit={unit} color={color} axes={false} /></div>
  </button>
}
function TrendSheet({ label, points, unit, color, avg, change, close }) {
  // The seven-day mean as a second series, so a single bad night reads against its week.
  const smooth = points.map((p, i) => { const w = points.slice(Math.max(0, i - 6), i + 1); return { t: p.t, y: Math.round(w.reduce((n, x) => n + x.y, 0) / w.length * 10) / 10, d: p.d } })
  return <>
    <h3>{label}</h3>
    <div className="small dim" style={{ marginBottom: 8 }}>{t('30 days · average {0}{1}', fmtNum(avg), unit ? ' ' + unit : '')}{change != null && change !== 0 ? ` · ${t('this week vs last')} ${change > 0 ? '+' : ''}${change}%` : ''}</div>
    <div className="chart"><LineChart points={points} h={200} unit={unit} series={[{ points: smooth, color: 'var(--label-3)' }, { points, color }]} /></div>
    <div className="zones-legend" style={{ marginTop: 6 }}><span><i style={{ background: color }} />{t('Daily')}</span><span><i style={{ background: 'var(--label-3)' }} />{t('7-day mean')}</span></div>
    <div style={{ height: 12 }} />
    <Button onClick={close}>{t('Close')}</Button>
  </>
}
/** An empty state that says why and offers the fix, inline. */
function EmptyNote({ text, hint, action }) {
  return <div className="hl-empty">
    <div className="muted small">{text}</div>
    {hint && <div className="small" style={{ color: 'var(--label-2)', marginTop: 2 }}>{hint}</div>}
    {action && <Button size="sm" variant="tinted" onClick={action.onClick} style={{ marginTop: 8 }}>{action.label}</Button>}
  </div>
}

/** Height, the maximum heart rate and the birth year: what BMI and the zones are drawn from. */
function BodySettings({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [h, setH] = useState(S.heightCm || null)
  const [max, setMax] = useState(S.maxHr || null)
  const [year, setYear] = useState(S.birthYear || null)
  const save = () => {
    update(s => {
      s.heightCm = h > 0 ? Math.round(h) : null
      s.maxHr = max >= 120 && max <= 230 ? Math.round(max) : null
      s.birthYear = year > 1900 && year <= new Date().getFullYear() ? Math.round(year) : null
    })
    close()
  }
  return <>
    <h3>{t('Height & max HR')}</h3>
    <div className="manual-grid">
      <label><span>{t('Height (cm)')}</span><NumberField value={h} nullable decimal={false} onChange={setH} /></label>
      <label><span>{t('Birth year')}</span><NumberField value={year} nullable decimal={false} onChange={setYear} /></label>
      <label><span>{t('Max heart rate')}</span><NumberField value={max} nullable decimal={false} onChange={setMax} /></label>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Leave the maximum empty and the app takes the highest peak a workout recorded, else 220 minus your age. The zones and the training load are drawn from it.')}</div>
    <Button variant="primary" icon="check" onClick={save}>{t('Save')}</Button>
  </>
}
