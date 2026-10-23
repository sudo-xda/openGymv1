// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Nutrition, { NutritionCard } from './Nutrition.jsx'

/* The nutrition screen over a fake store: the day adds up from lib/nutrition.js, a quick-add
   logs the anchor table's numbers without any model, and the Coach's buttons stay out of the
   way (a toast, no sheet) while the Coach is not set up. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: vi.fn(), toast: vi.fn(), sheets: [] }
  state.openSheet = vi.fn(render => { state.sheets.push(render); return { id: 's' + state.sheets.length } })
  state.storeSnapshot = () => ({ S: state.S, user: { id: 'u1' }, ready: true, config: {}, coachLocal: null, update: mut => mut(state.S) })
  state.uiSnapshot = () => ({ toast: state.toast, openSheet: state.openSheet })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => (selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot())
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn(o => o.onConfirm?.()) }))
vi.mock('../lib/coach-api.js', () => ({
  useCoachStatus: () => ({ job: null, pending: null, lastError: null, last: null, refresh: vi.fn() }),
  requestMeal: vi.fn(() => Promise.resolve({ job: { id: 'j1' } })), resolvePending: vi.fn(() => Promise.resolve({})),
  settleAwaited: vi.fn(), jobErrorText: () => 'err', JOB_ERRORS: {}, isDeclined: () => false,
}))
vi.mock('../lib/use-coach-gate.js', () => ({ useCoachGate: () => ({ known: true, ok: false }) }))
vi.mock('../nutrition.css', () => ({}))

const today = new Date().toISOString().slice(0, 10)
const state = () => ({
  unit: 'kg', lang: 'en', meals: [], water: {}, nutritionTargets: { cal: 2000, protein: 150, carbs: 200, fat: 60, water: 2500, _ts: 1 },
  bodyweight: [{ d: today, w: 80 }], targetW: 84, coach: null, workouts: [],
})
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const click = el => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
const btn = (host, re) => [...host.querySelectorAll('button')].find(b => re.test(b.textContent || '') || re.test(b.getAttribute('aria-label') || ''))

let host, root
beforeEach(() => { vi.clearAllMocks(); mocks.sheets.length = 0; mocks.S = state(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = (El = Nutrition) => act(() => { root.render(<El />) })
/** Renders the last sheet opened into its own host, so its buttons can be driven. */
function openLastSheet() {
  const render = mocks.sheets.at(-1)
  const h = document.createElement('div'); document.body.appendChild(h)
  const r = createRoot(h)
  const close = vi.fn()
  act(() => { r.render(render(close)) })
  return { h, close, unmount: () => { act(() => r.unmount()); h.remove() } }
}

describe('Nutrition', () => {
  it('shows what is left of the targets and the water, and water steps by 250 ml', async () => {
    mocks.S.meals = [{ id: 'm1', d: today, t: 1, text: 'eggs', cal: 300, protein: 20, carbs: 10, fat: 20, src: 'manual' }]
    mount()
    expect(host.querySelector('.nut-ring b').textContent).toBe('1,700')
    expect(host.querySelector('.nut-ring span').textContent).toBe('kcal left')
    expect(host.querySelector('[data-meal="m1"] .meal-cal').textContent).toContain('300')
    await click(btn(host, /Add 250 ml/))
    expect(mocks.S.water[today].ml).toBe(250)
    // The fake store mutates in place; the real one hands out a new state, so give it one.
    mocks.S = { ...mocks.S, water: { ...mocks.S.water } }
    await act(async () => { root.render(<Nutrition />) })
    expect(host.querySelector('.nut-water .v').textContent).toContain('250')
  })

  it('logs a quick-add meal with the anchor table\'s numbers, no model involved', async () => {
    mount()
    await click(btn(host, /Quick add/))
    const sheet = openLastSheet()
    const eggRow = [...sheet.h.querySelectorAll('.quick-row')].find(r => /Egg, large/.test(r.textContent))
    await click(eggRow.querySelector('[aria-label="More"]'))
    await click(eggRow.querySelector('[aria-label="More"]'))
    expect(eggRow.querySelector('.stp b').textContent).toBe('1.5')
    await click(btn(sheet.h, /Log this meal/))
    expect(mocks.S.meals.length).toBe(1)
    expect(mocks.S.meals[0]).toMatchObject({ src: 'quick', cal: 108, protein: 9.5 })
    expect(mocks.S.meals[0].text).toBe('1.5 × Egg, large')
    expect(sheet.close).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Meal logged')
    sheet.unmount()
  })

  it('reads a typed meal in the quick-add search against the list', async () => {
    mount()
    await click(btn(host, /Quick add/))
    const sheet = openLastSheet()
    act(() => { type(sheet.h.querySelector('input'), '2 eggs and toast') })
    expect(sheet.h.textContent).toContain('Read as: 2 × Egg, large, White bread')
    await click(btn(sheet.h, /Log this meal/))
    expect(mocks.S.meals[0]).toMatchObject({ src: 'quick', cal: 223, text: '2 eggs and toast' })
    sheet.unmount()
  })

  it('the Coach buttons only toast while the Coach is not set up', async () => {
    mount()
    await click(btn(host, /Describe/))
    await click(btn(host, /What should I eat next/))
    expect(mocks.openSheet).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledTimes(2)
  })

  it('suggests targets from the body weight and saves what is typed', async () => {
    mocks.S.nutritionTargets = null
    mount()
    expect(host.querySelector('.nut-ring span').textContent).toBe('kcal eaten')
    await click(btn(host, /^Targets$/))
    const sheet = openLastSheet()
    await click(btn(sheet.h, /Use the suggestion/))
    await click(btn(sheet.h, /^Save$/))
    expect(mocks.S.nutritionTargets).toMatchObject({ cal: 2780, protein: 144, fat: 72 })
    sheet.unmount()
  })

  it('deletes a meal', async () => {
    mocks.S.meals = [{ id: 'm1', d: today, t: 1, text: 'eggs', cal: 300, protein: 20, carbs: 10, fat: 20 }]
    mount()
    await click(host.querySelector('[data-meal="m1"] [aria-label="Delete"]'))
    expect(mocks.S.meals).toEqual([])
  })

  it('the Home card shows the day and opens the screen', async () => {
    mocks.S.meals = [{ id: 'm1', d: today, t: 1, text: 'eggs', cal: 2300, protein: 20, carbs: 10, fat: 20 }]
    mount(NutritionCard)
    expect(host.querySelector('.nut-ring').className).toContain('over')
    expect(host.querySelector('.nut-ring b').textContent).toBe('300')
    await click(btn(host, /Log a meal/))
    expect(mocks.nav).toHaveBeenCalledWith('/nutrition')
  })
})
