// What you ate: one day at a time, against targets you set (or let the app suggest from your
// body weight), with three ways to log a meal — the anchor table without any model, numbers
// typed in, or a description the Coach reads into items (a `meal` job, api/coach/core/foods.js
// anchors it, the server cross-checks every calorie figure against the macros) — and three
// meals suggested for what is left of the day. Every number shown comes from lib/nutrition.js;
// the Coach's debrief and chat read the same entries (payload nutritionOf).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO, isoOf, DAYS } from '../lib/format.js'
import {
  dayTotals, remainingOf, weekSummary, suggestTargets, cleanTargets, addMeal, removeMeal, setWater, setTargets,
  foodItem, quickMatch, FOODS, WATER_STEP_ML
} from '../lib/nutrition.js'
import { hasConsent } from '../lib/coach.js'
import { useCoachGate } from '../lib/use-coach-gate.js'
import { useCoachStatus, requestMeal, resolvePending, settleAwaited, jobErrorText, JOB_ERRORS, isDeclined } from '../lib/coach-api.js'
import { confirmSheet } from '../sheets.jsx'
import { loadHealthData } from '../lib/health-store.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, SearchField, TextArea, TextField } from '../components/ui.jsx'
import '../nutrition.css'

const MACROS = [
  { key: 'protein', label: () => t('Protein'), color: 'var(--acc)' },
  { key: 'carbs', label: () => t('Carbs'), color: 'var(--blue)' },
  { key: 'fat', label: () => t('Fat'), color: 'var(--yellow)' },
]
const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }
const pct = (v, max) => (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0)

/** Whether the Coach can read a meal here: set up, consented, and a profile to bill it to. */
function useMealCoach() {
  const S = useStore(s => s.S)
  const gate = useCoachGate()
  return gate.ok && hasConsent(S) && !!S.coach?.profile
}

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [day, setDay] = useState(todayISO())
  const totals = useMemo(() => dayTotals(S, day), [S.meals, S.water, day])
  const targets = S.nutritionTargets
  const rem = remainingOf(targets, totals)
  const week = useMemo(() => weekSummary(S, day), [S.meals, S.water, day])
  const meals = useMemo(() => [...(S.meals || [])].filter(m => m.d === day).sort((a, b) => (b.t || 0) - (a.t || 0)), [S.meals, day])
  const aiReady = useMealCoach()
  // The band's calories for the day (lib/health-store.js), for the energy balance line.
  const [burned, setBurned] = useState(null)
  useEffect(() => { let alive = true; if (S.recoveryOn === true) loadHealthData().then(h => { if (alive) setBurned(h?.days?.[day] || null) }).catch(() => {}); else setBurned(null); return () => { alive = false } }, [day, S.recoveryOn])

  const log = (meal, src) => {
    update(s => { addMeal(s, { ...meal, src }, day) })
    toast(t('Meal logged'))
  }
  const describe = () => {
    if (!aiReady) { toast(t('Set up the Coach first to describe a meal in words.')); return }
    openSheet(close => <DescribeMealSheet close={close} onLog={m => log(m, 'ai')} />)
  }
  const suggest = () => {
    if (!aiReady) { toast(t('Set up the Coach first to get meal suggestions.')); return }
    openSheet(close => <SuggestMealSheet close={close} onLog={m => log(m, 'ai')} />)
  }
  const quick = () => openSheet(close => <QuickAddSheet close={close} onLog={m => log(m, 'quick')} />)
  const manual = () => openSheet(close => <ManualMealSheet close={close} onLog={m => log(m, 'manual')} />)
  const editTargets = () => openSheet(close => <TargetsSheet close={close} />)
  const water = delta => update(s => { setWater(s, day, (Number(s.water?.[day]?.ml) || 0) + delta) })
  const remove = m => confirmSheet({
    title: t('Delete this meal?'), message: m.text || t('Its numbers come off the day.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { removeMeal(s, m.id) }); toast(t('Meal deleted')) }
  })

  const calLeft = rem ? rem.cal : null
  const over = calLeft != null && calLeft < 0
  const isToday = day === todayISO()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Nutrition')}</h1><div className="sub">{targets ? t('{0} kcal a day', fmtNum(targets.cal)) : t('No targets yet')}</div></div>
      <button className="iconbtn" onClick={editTargets} aria-label={t('Targets')}><Icon name="target" /></button>
    </div>

    <div className="nut-day">
      <button className="iconbtn" onClick={() => setDay(d => shift(d, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <div>
        <div className="nut-day-t">{isToday ? t('Today') : fmtDate(day, true)}</div>
        <div className="nut-day-s">{t('{0} meals', totals.meals)}{isToday ? '' : ' · ' + fmtDate(day)}</div>
      </div>
      <button className="iconbtn" disabled={isToday} onClick={() => setDay(d => shift(d, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    <div className="card" data-nutrition-day={day}>
      <div className="nut-hero">
        <div className={'nut-ring' + (over ? ' over' : '')} style={{ '--pct': targets ? pct(totals.cal, targets.cal) : 0 }} role="img" aria-label={targets ? t('{0} of {1} kcal', fmtNum(totals.cal), fmtNum(targets.cal)) : t('{0} kcal', fmtNum(totals.cal))}>
          <b>{fmtNum(calLeft != null ? Math.abs(calLeft) : totals.cal)}</b>
          <span>{calLeft == null ? t('kcal eaten') : over ? t('kcal over') : t('kcal left')}</span>
        </div>
        <div className="nut-macros">
          {MACROS.map(m => {
            const v = totals[m.key], max = targets?.[m.key] || 0
            return <div key={m.key} className="nut-macro" style={{ '--c': m.color }}>
              <span className="nm">{m.label()}</span>
              <span className="tr"><i className={max && v > max ? 'over' : ''} style={{ width: (max ? pct(v, max) * 100 : v ? 100 : 0) + '%' }} /></span>
              <span className="v">{fmtNum(Math.round(v))}<small>{max ? ' / ' + fmtNum(max) + ' g' : ' g'}</small></span>
            </div>
          })}
        </div>
      </div>
      {burned?.totalKcal > 0 && <div className="nut-note" style={{ color: 'var(--label)' }}>{t('Band: {0} kcal burned today ({1} active)', fmtNum(burned.totalKcal), fmtNum(burned.activeKcal || 0))} · <b style={{ color: totals.cal - burned.totalKcal > 0 ? 'var(--orange)' : 'var(--green)' }}>{totals.cal - burned.totalKcal > 0 ? t('+{0} surplus', fmtNum(totals.cal - burned.totalKcal)) : t('{0} deficit', fmtNum(burned.totalKcal - totals.cal))}</b></div>}
      {!targets && <div className="nut-note">{t('Set targets to see what is left of the day. The app can suggest them from your body weight.')} <button className="link" onClick={editTargets} style={{ color: 'var(--acc)', background: 'none', padding: 0, fontSize: 'inherit' }}>{t('Set targets')}</button></div>}
      <div className="nut-actions">
        <button className="nut-act ai" onClick={describe}><Icon name="sparkles" />{t('Describe')}</button>
        <button className="nut-act" onClick={quick}><Icon name="magnifier" />{t('Quick add')}</button>
        <button className="nut-act" onClick={manual}><Icon name="pencil" />{t('Numbers')}</button>
      </div>
      <Button icon="lightbulb" onClick={suggest} style={{ marginTop: 6 }}>{t('What should I eat next?')}</Button>
    </div>

    <div className="card">
      <div className="nut-water">
        <span className="lrow-i" style={{ background: 'var(--blue)' }}><Icon name="swim" /></span>
        <div className="grow">
          <div className="row between"><span style={{ fontWeight: 600, fontSize: 15 }}>{t('Water')}</span><span className="v">{fmtNum(totals.water)}<small> / {fmtNum(targets?.water || 0)} ml</small></span></div>
          <div className="tr"><i style={{ width: (targets?.water ? pct(totals.water, targets.water) * 100 : totals.water ? 100 : 0) + '%' }} /></div>
        </div>
        <button className="iconbtn" onClick={() => water(-WATER_STEP_ML)} disabled={!totals.water} aria-label={t('Less water')}><Icon name="minus" /></button>
        <button className="iconbtn" onClick={() => water(WATER_STEP_ML)} aria-label={t('Add {0} ml', WATER_STEP_ML)}><Icon name="plus" /></button>
      </div>
    </div>

    <div className="card">
      <h2>{t('Meals')}</h2>
      {meals.length ? meals.map(m => <div key={m.id} className="meal" data-meal={m.id}>
        <div className="grow">
          <div className="meal-t">{m.text || (m.items || []).map(x => x.name).join(', ') || t('Meal')}
            {m.src === 'ai' && <span className="meal-src"><Icon name="sparkles" />{t('Coach')}</span>}
          </div>
          <div className="meal-s">{t('P {0} · C {1} · F {2}', fmtNum(Math.round(m.protein)), fmtNum(Math.round(m.carbs)), fmtNum(Math.round(m.fat)))}{m.items?.length > 1 ? ' · ' + t('{0} items', m.items.length) : ''}</div>
        </div>
        <span className="meal-cal">{fmtNum(m.cal)} <small className="dim">kcal</small></span>
        <button className="iconbtn sm" onClick={() => remove(m)} aria-label={t('Delete')}><Icon name="trash" /></button>
      </div>) : <div className="muted small">{isToday ? t('Nothing logged yet today. Describe what you ate, pick from the list, or type the numbers.') : t('Nothing logged on this day.')}</div>}
    </div>

    <div className="card">
      <h2>{t('This week')}</h2>
      <div className="nut-week">
        {week.series.map(x => {
          const max = Math.max(targets?.cal || 0, ...week.series.map(y => y.cal)) || 1
          const d = new Date(x.d + 'T12:00:00')
          return <button key={x.d} onClick={() => setDay(x.d)} aria-label={fmtDate(x.d, true) + ': ' + fmtNum(x.cal) + ' kcal'}>
            <span className={'bar' + (x.d === day ? ' sel' : '')} style={{ height: Math.max(4, Math.round(pct(x.cal, max) * 60)) + 'px' }}><i className={targets?.cal && x.cal > targets.cal ? 'over' : ''} style={{ height: '100%' }} /></span>
            <span className={'d' + (x.d === day ? ' on' : '')}>{t(DAYS[d.getDay()]).slice(0, 2)}</span>
          </button>
        })}
      </div>
      <div className="nut-week-sum">
        <span>{week.daysLogged ? t('{0} days logged · avg {1} kcal', week.daysLogged, fmtNum(week.avgCal)) : t('No days logged this week')}</span>
        {!!week.daysLogged && <span>{t('avg {0} g protein', fmtNum(week.avgProtein))}</span>}
      </div>
    </div>
  </div>
}

/* ---------------------------------- the Coach reads a meal ---------------------------------- */

/** The job's lifecycle for one sheet: start it, poll while it runs, hand back the pending result. */
function useMealJob() {
  const [state, setState] = useState('idle')     // idle | running | done | failed
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const { job, pending, lastError, last, refresh } = useCoachStatus(state === 'running')
  const id = useRef(null)
  const start = async meal => {
    setState('running'); setError(null); setResult(null)
    try { const r = await requestMeal(meal); id.current = r?.job?.id || null; refresh() }
    catch (e) { setState('idle'); if (!isDeclined(e)) setError(JOB_ERRORS[e.data?.code] || e.message || t('Could not ask the Coach')) }
  }
  useEffect(() => {
    if (state !== 'running') return
    if (pending?.kind === 'meal') {
      setResult(pending); setState('done'); settleAwaited(id.current)
    } else if (!job && id.current && !pending && (last?.id === id.current || lastError)) {
      const cls = lastError?.errorClass || last?.errorClass || 'internal'
      setError(jobErrorText(cls, lastError?.detail)); setState('failed'); settleAwaited(id.current)
    }
  }, [state, job, pending?.id, last?.id, lastError])
  const finish = () => { if (result) resolvePending({ accepted: ['meal'] }).catch(() => {}) }
  return { state, result, error, start, finish }
}

function Thinking({ text }) {
  return <div className="auto-deb-wait" style={{ margin: '8px 0 14px' }}>
    <div className="bub typing" style={{ background: 'var(--surface-2)' }}><i /><i /><i /></div>
    <span>{text}</span>
  </div>
}

function DescribeMealSheet({ close, onLog }) {
  const [text, setText] = useState('')
  const { state, result, error, start, finish } = useMealJob()
  const items = result?.items || []
  const logIt = () => { onLog({ text, items, cal: result.cal, protein: result.protein, carbs: result.carbs, fat: result.fat }); finish(); close() }
  const back = () => { finish() }
  return <>
    <h3>{t('Describe what you ate')}</h3>
    {state !== 'done' && <>
      <TextArea rows={3} maxLength={500} value={text} placeholder={t('e.g. 2 eggs, a slice of toast with butter and a latte')} onChange={e => setText(e.target.value)} disabled={state === 'running'} style={{ width: '100%', marginBottom: 10 }} />
      {state === 'running' ? <Thinking text={t('The Coach is reading the meal against USDA servings…')} />
        : <Button variant="primary" icon="sparkles" disabled={!text.trim()} onClick={() => start({ text: text.trim() })}>{t('Read it')}</Button>}
      {!!error && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
      <div className="muted small" style={{ marginTop: 10 }}>{t('Quantities you leave out are assumed as the usual serving and shown so you can correct them. Calories are checked against the macros before anything is logged.')}</div>
    </>}
    {state === 'done' && <>
      <div className="muted small" style={{ marginBottom: 4 }}>{text}</div>
      {items.length ? items.map((x, i) => <div key={i} className="est-item">
        <span className="nm">{x.name}</span>
        <span className="num">{fmtNum(x.cal)} kcal<small>{t('P {0} · C {1} · F {2}', fmtNum(x.protein), fmtNum(x.carbs), fmtNum(x.fat))}</small></span>
        <span className="qty">{x.qty}{x.adjusted && <span className="adj"> · {t('calories corrected')}</span>}</span>
      </div>) : <div className="chat-empty">{t('The Coach could not find food in that.')}</div>}
      {!!result.note && <div className="small" style={{ color: 'var(--yellow)', marginTop: 6 }}>{result.note}</div>}
      <div className="est-total"><b>{fmtNum(result.cal)} kcal</b><span>{t('P {0} · C {1} · F {2}', fmtNum(result.protein), fmtNum(result.carbs), fmtNum(result.fat))}</span></div>
      <Button variant="primary" icon="check" disabled={!items.length} onClick={logIt}>{t('Log this meal')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={() => { back(); start({ text: text.trim() }) }}>{t('Read it again')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => { back(); close() }}>{t('Cancel')}</Button>
    </>}
  </>
}

function SuggestMealSheet({ close, onLog }) {
  const { state, result, error, start, finish } = useMealJob()
  useEffect(() => { start({ suggest: true }) }, [])
  const meals = result?.meals || []
  return <>
    <h3>{t('What should I eat next?')}</h3>
    {state === 'running' && <Thinking text={t('The Coach is looking at what is left of today…')} />}
    {!!error && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
    {state === 'done' && <>
      {!!result.note && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>{result.note}</div>}
      {meals.map((m, i) => <div key={i} className="sug">
        <div className="sug-t">{m.title}</div>
        {!!m.desc && <div className="sug-d">{m.desc}</div>}
        <div className="sug-x">{m.text}</div>
        <div className="sug-n"><b>{fmtNum(m.cal)} kcal</b><span>P {fmtNum(m.protein)}</span><span>C {fmtNum(m.carbs)}</span><span>F {fmtNum(m.fat)}</span></div>
        <Button size="sm" variant="tinted" icon="plus" onClick={() => { onLog({ text: m.text, cal: m.cal, protein: m.protein, carbs: m.carbs, fat: m.fat }); finish(); close() }}>{t('Log this meal')}</Button>
      </div>)}
      {!meals.length && <div className="chat-empty">{t('No suggestion this time.')}</div>}
    </>}
    <Button variant="ghost" className="dim" onClick={() => { finish(); close() }}>{state === 'done' ? t('Not now') : t('Cancel')}</Button>
  </>
}

/* ---------------------------------- without a model ---------------------------------- */

function QuickAddSheet({ close, onLog }) {
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState({})
  const needle = q.trim().toLowerCase()
  const foods = FOODS.filter(f => !needle || f.name.toLowerCase().includes(needle) || f.id.includes(needle))
  // Typed as a meal ("2 eggs and toast"), the words are matched whole, no model involved.
  const matched = useMemo(() => (needle.includes(' ') ? quickMatch(q) : { items: [], unread: [] }), [q])
  const chosen = FOODS.filter(f => counts[f.id] > 0).map(f => foodItem(f, counts[f.id]))
  const items = chosen.length ? chosen : matched.items
  const total = items.reduce((n, x) => n + x.cal, 0)
  const bump = (id, d) => setCounts(c => ({ ...c, [id]: Math.max(0, Math.round(((c[id] || 0) + d) * 2) / 2) }))
  const logIt = () => {
    const text = chosen.length ? chosen.map(x => (x.qty.includes('×') ? x.qty.split(' × ')[0] + ' × ' : '') + x.name).join(', ') : q.trim()
    onLog({ text, items }); close()
  }
  return <>
    <h3>{t('Quick add')}</h3>
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search, or type a meal: 2 eggs and toast')} />
    <div style={{ height: 8 }} />
    {matched.items.length > 0 && !chosen.length && <div className="muted small" style={{ marginBottom: 6 }}>
      {t('Read as: {0}', matched.items.map(x => x.qty.includes('×') ? x.qty.split(' × ')[0] + ' × ' + x.name : x.name).join(', '))}
      {matched.unread.length ? ' · ' + t('Not read: {0}', matched.unread.join(', ')) : ''}
    </div>}
    <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
      {foods.map(f => <div key={f.id} className="quick-row">
        <div className="grow"><div className="nm">{f.name}</div><div className="ss">{f.serving} · {f.cal} kcal · P {f.p}</div></div>
        <div className="stp">
          <button className="iconbtn sm" disabled={!counts[f.id]} onClick={() => bump(f.id, -0.5)} aria-label={t('Less')}><Icon name="minus" /></button>
          <b>{counts[f.id] || 0}</b>
          <button className="iconbtn sm" onClick={() => bump(f.id, counts[f.id] ? 0.5 : 1)} aria-label={t('More')}><Icon name="plus" /></button>
        </div>
      </div>)}
      {!foods.length && <div className="chat-empty">{t('Nothing in the list matches. Describe it to the Coach, or type the numbers.')}</div>}
    </div>
    <div className="est-total"><b>{fmtNum(total)} kcal</b><span>{t('{0} items', items.length)}</span></div>
    <Button variant="primary" icon="check" disabled={!items.length} onClick={logIt}>{t('Log this meal')}</Button>
  </>
}

function ManualMealSheet({ close, onLog }) {
  const [text, setText] = useState('')
  const [v, setV] = useState({ cal: null, protein: null, carbs: null, fat: null })
  const set = k => n => setV(x => ({ ...x, [k]: n }))
  const ok = v.cal > 0 || v.protein > 0 || v.carbs > 0 || v.fat > 0
  return <>
    <h3>{t('Type the numbers')}</h3>
    <TextField value={text} maxLength={120} placeholder={t('What was it?')} onChange={e => setText(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
    <div className="manual-grid">
      <label><span>{t('Calories')}</span><NumberField value={v.cal} nullable decimal={false} onChange={set('cal')} /></label>
      <label><span>{t('Protein (g)')}</span><NumberField value={v.protein} nullable onChange={set('protein')} /></label>
      <label><span>{t('Carbs (g)')}</span><NumberField value={v.carbs} nullable onChange={set('carbs')} /></label>
      <label><span>{t('Fat (g)')}</span><NumberField value={v.fat} nullable onChange={set('fat')} /></label>
    </div>
    <Button variant="primary" icon="check" disabled={!ok} onClick={() => { onLog({ text: text.trim() || t('Meal'), cal: v.cal || 0, protein: v.protein || 0, carbs: v.carbs || 0, fat: v.fat || 0 }); close() }}>{t('Log this meal')}</Button>
  </>
}

/* ---------------------------------- targets ---------------------------------- */

function TargetsSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const suggested = useMemo(() => suggestTargets(S), [S.bodyweight, S.unit, S.targetW])
  const [v, setV] = useState(() => S.nutritionTargets ? cleanTargets(S.nutritionTargets) : (suggested || { cal: 2000, protein: 120, carbs: 230, fat: 65, water: 2500 }))
  const set = k => n => setV(x => ({ ...x, [k]: n }))
  const save = () => {
    const c = cleanTargets(v)
    if (!c.cal) { toast(t('Enter a calorie target')); return }
    update(s => { setTargets(s, c) }); toast(t('Targets saved')); close()
  }
  return <>
    <h3>{t('Daily targets')}</h3>
    <div className="targets-hint">{suggested
      ? t('Suggested from your body weight and goal: about 31 kcal per kg, protein at 1.8 g/kg, fat at 0.9 g/kg, the rest as carbs. A starting point to edit, not a prescription.')
      : t('Log a weigh-in and the app can suggest targets from your body weight. These are yours to set.')}</div>
    {suggested && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => setV(suggested)} style={{ marginBottom: 10 }}>{t('Use the suggestion')}</Button>}
    <div className="manual-grid">
      <label><span>{t('Calories')}</span><NumberField value={v.cal} decimal={false} onChange={set('cal')} /></label>
      <label><span>{t('Water (ml)')}</span><NumberField value={v.water} decimal={false} onChange={set('water')} /></label>
      <label><span>{t('Protein (g)')}</span><NumberField value={v.protein} decimal={false} onChange={set('protein')} /></label>
      <label><span>{t('Carbs (g)')}</span><NumberField value={v.carbs} decimal={false} onChange={set('carbs')} /></label>
      <label><span>{t('Fat (g)')}</span><NumberField value={v.fat} decimal={false} onChange={set('fat')} /></label>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Macros add up to {0} kcal.', fmtNum((v.protein || 0) * 4 + (v.carbs || 0) * 4 + (v.fat || 0) * 9))}</div>
    <Button variant="primary" icon="check" onClick={save}>{t('Save')}</Button>
    {S.nutritionTargets && <><div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { update(s => { setTargets(s, null) }); close() }}>{t('Clear targets')}</Button></>}
  </>
}

/* ---------------------------------- the Home card ---------------------------------- */

/** Today in one glance: the ring, the three macros, and a way in. */
export function NutritionCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const day = todayISO()
  const totals = useMemo(() => dayTotals(S, day), [S.meals, S.water, day])
  const targets = S.nutritionTargets
  const rem = remainingOf(targets, totals)
  const over = rem && rem.cal < 0
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/nutrition')} data-nutrition-card>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Nutrition')}</h2>
      <span className="small dim">{t('{0} meals today', totals.meals)}</span>
    </div>
    <div className="nut-card-row">
      <div className={'nut-ring' + (over ? ' over' : '')} style={{ '--pct': targets ? pct(totals.cal, targets.cal) : 0 }}>
        <b>{fmtNum(rem ? Math.abs(rem.cal) : totals.cal)}</b>
        <span>{!rem ? t('kcal') : over ? t('over') : t('left')}</span>
      </div>
      <div className="nut-macros">
        {MACROS.map(m => {
          const v = totals[m.key], max = targets?.[m.key] || 0
          return <div key={m.key} className="nut-macro" style={{ '--c': m.color }}>
            <span className="nm">{m.label()}</span>
            <span className="tr"><i className={max && v > max ? 'over' : ''} style={{ width: (max ? pct(v, max) * 100 : v ? 100 : 0) + '%' }} /></span>
            <span className="v">{fmtNum(Math.round(v))}<small>{max ? '/' + fmtNum(max) : ''} g</small></span>
          </div>
        })}
      </div>
    </div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
      <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={e => { e.stopPropagation(); nav('/nutrition') }}>{totals.meals ? t('Log a meal') : t('Start logging')}</Button>
    </div>
  </div>
}
