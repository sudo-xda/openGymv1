import { describe, it, expect } from 'vitest'
import { dayTotals, remainingOf, weekSummary, suggestTargets, cleanTargets, addMeal, removeMeal, setWater, setTargets, foodItem, quickMatch, FOODS, MEALS_MAX } from './nutrition.js'

const egg = FOODS.find(f => f.id === 'egg')
const base = () => ({ unit: 'kg', meals: [], water: {}, nutritionTargets: null, bodyweight: [{ d: '2026-10-20', w: 80 }], targetW: 84 })

describe('reading a day', () => {
  it('adds a day up and leaves other days alone', () => {
    const s = base()
    addMeal(s, { text: '2 eggs', items: [foodItem(egg, 2)], src: 'quick' }, '2026-10-23')
    addMeal(s, { text: 'rice', cal: 206, protein: 4.3, carbs: 44.5, fat: 0.4 }, '2026-10-23')
    addMeal(s, { text: 'yesterday', cal: 999, protein: 9, carbs: 9, fat: 9 }, '2026-10-22')
    setWater(s, '2026-10-23', 750)
    expect(dayTotals(s, '2026-10-23')).toEqual({ cal: 350, protein: 16.9, carbs: 45.3, fat: 10, water: 750, meals: 2 })
    expect(dayTotals(s, '2026-10-21').meals).toBe(0)
    expect(remainingOf({ cal: 2000, protein: 150, carbs: 200, fat: 60, water: 3000 }, dayTotals(s, '2026-10-23'))).toEqual({ cal: 1650, protein: 133.1, carbs: 154.7, fat: 50, water: 2250 })
    expect(remainingOf(null, dayTotals(s, '2026-10-23'))).toBeNull()
  })
  it('the week averages only the days with a meal', () => {
    const s = base()
    addMeal(s, { cal: 2000, protein: 100, carbs: 200, fat: 50 }, '2026-10-23')
    addMeal(s, { cal: 1000, protein: 50, carbs: 100, fat: 25 }, '2026-10-20')
    const w = weekSummary(s, '2026-10-23')
    expect(w.series.length).toBe(7)
    expect(w.series[0].d).toBe('2026-10-17')
    expect(w.daysLogged).toBe(2)
    expect(w.avgCal).toBe(1500)
    expect(w.avgProtein).toBe(75)
  })
})

describe('targets', () => {
  it('suggests from the body weight and the goal direction, and nothing without a weigh-in', () => {
    const t = suggestTargets(base())
    expect(t).toEqual({ cal: 2780, protein: 144, carbs: 389, fat: 72, water: 2800 })
    expect(suggestTargets({ ...base(), targetW: 76 }).cal).toBe(2180)
    expect(suggestTargets({ ...base(), targetW: null }).cal).toBe(2480)
    expect(suggestTargets({ ...base(), bodyweight: [] })).toBeNull()
    // the same person in pounds
    expect(suggestTargets({ ...base(), unit: 'lb', bodyweight: [{ d: '2026-10-20', w: 176.4 }], targetW: 185 }).protein).toBe(144)
  })
  it('cleans what is typed and stamps the save', () => {
    expect(cleanTargets({ cal: '2500.4', protein: -3, carbs: 'x', fat: 99999, water: 2000 })).toEqual({ cal: 2500, protein: 0, carbs: 0, fat: 1000, water: 2000 })
    const s = base()
    setTargets(s, { cal: 2000, protein: 150, carbs: 200, fat: 60, water: 3000 })
    expect(s.nutritionTargets.cal).toBe(2000)
    expect(s.nutritionTargets._ts).toBeGreaterThan(0)
    setTargets(s, null)
    expect(s.nutritionTargets).toBeNull()
  })
})

describe('writing', () => {
  it('a meal with items takes its numbers from the items, cross-checked; one without keeps what was typed', () => {
    const s = base()
    const m = addMeal(s, { text: '  two   eggs ', items: [{ name: 'Egg', qty: '2', cal: 900, protein: 12.6, carbs: 0.8, fat: 9.6 }], src: 'ai' }, '2026-10-23')
    expect(m.text).toBe('two eggs')
    expect(m.items[0].cal).toBe(140)
    expect(m.cal).toBe(140)
    expect(m.src).toBe('ai')
    const n = addMeal(s, { text: 'typed', cal: 300, protein: 20, carbs: 30, fat: 10, src: 'nope' }, 'bad date')
    expect(n.src).toBe('manual')
    expect(n.cal).toBe(300)
    expect(n.d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(removeMeal(s, m.id)).toBe(true)
    expect(removeMeal(s, 'nope')).toBe(false)
    expect(s.meals.length).toBe(1)
  })
  it('keeps at most MEALS_MAX meals, newest kept', () => {
    const s = base()
    for (let i = 0; i < MEALS_MAX + 3; i++) addMeal(s, { text: 'm' + i, cal: 1, protein: 0, carbs: 0, fat: 0 }, '2026-10-23')
    expect(s.meals.length).toBe(MEALS_MAX)
    expect(s.meals.at(-1).text).toBe('m' + (MEALS_MAX + 2))
  })
  it('water is per day, stamped, and clearing removes the day', () => {
    const s = base()
    expect(setWater(s, '2026-10-23', 250.4)).toBe(250)
    expect(s.water['2026-10-23'].ml).toBe(250)
    expect(s.water['2026-10-23']._ts).toBeGreaterThan(0)
    setWater(s, '2026-10-23', 0)
    expect(s.water['2026-10-23']).toBeUndefined()
  })
})

describe('the anchor table without a model', () => {
  it('scales a serving and names the multiple', () => {
    expect(foodItem(egg, 2)).toEqual({ name: 'Egg, large', qty: '2 × 1 large (50 g)', protein: 12.6, carbs: 0.8, fat: 9.6, cal: 144 })
    expect(foodItem(egg).qty).toBe('1 large (50 g)')
  })
  it('reads counts and everyday words, longest alias first, and reports what it could not read', () => {
    const { items, unread } = quickMatch('2 eggs and a slice of toast with peanut butter, plus a mango')
    expect(items.map(x => [x.name, x.cal])).toEqual([['Egg, large', 144], ['White bread', 79], ['Peanut butter', 94]])
    expect(unread).toEqual(['mango'])
    expect(quickMatch('').items).toEqual([])
    expect(quickMatch('half a banana').items[0].cal).toBe(53)
  })
})
