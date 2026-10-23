// The nutrition log: what was eaten, drunk and aimed for, as pure functions over S.
//
//   S.meals             one entry per meal: { id, d, t, text, items, cal, protein, carbs, fat, src }
//                       `t` is when it was last saved (the merge rule, like a weigh-in's);
//                       `src` is 'ai' (the Coach read the words), 'quick' (the anchor table) or
//                       'manual' (numbers typed in).
//   S.water             { [iso]: { ml, _ts } } — a stamped map, merged per day (lib/sync-merge.js)
//   S.nutritionTargets  { cal, protein, carbs, fat, water, _ts } or null when never set
//
// Every number the app shows comes from here, and every number the Coach is told comes from the
// same entries (api/coach/core/payload.js nutritionOf). The anchor table is the server's
// (api/coach/core/foods.js), so "an egg" is the same egg in the quick-add list and in the prompt.
import { FOODS, caloriesOf, crossCheck } from '../../../api/coach/core/foods.js'
import { uid } from './format.js'

export { FOODS, caloriesOf, crossCheck }
export const MEALS_MAX = 4000              // ~3 years of four meals a day; the oldest go first
export const WATER_STEP_ML = 250
export const LB_PER_KG = 2.2046226218

const round1 = n => Math.round((Number(n) || 0) * 10) / 10
const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
const list = v => (Array.isArray(v) ? v : [])

/* ---------- reading ---------- */

export const mealsOn = (S, iso) => list(S?.meals).filter(m => m && m.d === iso).sort((a, b) => (a.t || 0) - (b.t || 0))

/** What a day adds up to: calories, grams, and the water. */
export function dayTotals(S, iso) {
  const ms = mealsOn(S, iso)
  return {
    cal: Math.round(ms.reduce((n, m) => n + (Number(m.cal) || 0), 0)),
    protein: round1(ms.reduce((n, m) => n + (Number(m.protein) || 0), 0)),
    carbs: round1(ms.reduce((n, m) => n + (Number(m.carbs) || 0), 0)),
    fat: round1(ms.reduce((n, m) => n + (Number(m.fat) || 0), 0)),
    water: Number(S?.water?.[iso]?.ml) || 0,
    meals: ms.length
  }
}

/** Targets minus the day; null without targets. Negative means over. */
export function remainingOf(targets, totals) {
  if (!targets || !(targets.cal > 0)) return null
  return {
    cal: Math.round(targets.cal - (totals?.cal || 0)),
    protein: round1((targets.protein || 0) - (totals?.protein || 0)),
    carbs: round1((targets.carbs || 0) - (totals?.carbs || 0)),
    fat: round1((targets.fat || 0) - (totals?.fat || 0)),
    water: Math.round((targets.water || 0) - (totals?.water || 0))
  }
}

/** The last `days` days ending on `iso` (inclusive): per-day totals and the averages of logged days. */
export function weekSummary(S, iso, days = 7) {
  const end = new Date(iso + 'T12:00:00')
  const series = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(d.getDate() - i)
    const day = d.toISOString().slice(0, 10)
    series.push({ d: day, ...dayTotals(S, day) })
  }
  const logged = series.filter(x => x.meals > 0)
  const avg = k => (logged.length ? Math.round(logged.reduce((n, x) => n + x[k], 0) / logged.length) : 0)
  return { series, daysLogged: logged.length, avgCal: avg('cal'), avgProtein: avg('protein'), avgCarbs: avg('carbs'), avgFat: avg('fat') }
}

/* ---------- targets ---------- */

/**
 * A starting point for the targets, from the body weight and the goal: maintenance at about
 * 31 kcal per kilo, 300 kcal under it to lose and over it to gain (the direction S.targetW
 * points), protein at 1.8 g/kg, fat at 0.9 g/kg, carbohydrate the rest, water at 35 ml/kg.
 * A rule of thumb to edit, not a prescription: there is no height, age or activity in the
 * profile, and the screen says so. Null without a weigh-in.
 */
export function suggestTargets(S) {
  const bw = list(S?.bodyweight).filter(b => b && b.w > 0).at(-1)
  if (!bw) return null
  const kg = S.unit === 'lb' ? bw.w / LB_PER_KG : bw.w
  const goal = Number(S.targetW)
  const dir = goal > 0 ? Math.sign(goal - bw.w) : 0
  const cal = Math.round((kg * 31 + dir * 300) / 10) * 10
  const protein = Math.round(kg * 1.8)
  const fat = Math.round(kg * 0.9)
  const carbs = Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4))
  return { cal, protein, carbs, fat, water: Math.round(kg * 35 / 50) * 50 }
}
export const cleanTargets = v => {
  const n = (x, hi) => { const k = Math.round(Number(x)); return Number.isFinite(k) && k >= 0 ? Math.min(hi, k) : 0 }
  return { cal: n(v?.cal, 20000), protein: n(v?.protein, 1000), carbs: n(v?.carbs, 2000), fat: n(v?.fat, 1000), water: n(v?.water, 20000) }
}

/* ---------- writing (inside store.update) ---------- */

export function addMeal(s, meal, iso) {
  const items = list(meal?.items).map(cleanItem).filter(Boolean)
  const sums = items.length ? sumItems(items) : { cal: Math.round(Number(meal?.cal) || 0), protein: round1(meal?.protein), carbs: round1(meal?.carbs), fat: round1(meal?.fat) }
  const entry = {
    id: uid(), d: isDay(iso) ? iso : new Date().toISOString().slice(0, 10), t: Date.now(),
    text: String(meal?.text || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    items, ...sums, src: ['ai', 'quick', 'manual'].includes(meal?.src) ? meal.src : 'manual'
  }
  s.meals = [...list(s.meals), entry].slice(-MEALS_MAX)
  return entry
}
export function removeMeal(s, id) {
  const before = list(s.meals).length
  s.meals = list(s.meals).filter(m => m.id !== id)
  return s.meals.length < before
}
export function setWater(s, iso, ml) {
  if (!s.water || typeof s.water !== 'object') s.water = {}
  const v = Math.max(0, Math.min(20000, Math.round(Number(ml) || 0)))
  if (v) s.water[iso] = { ml: v, _ts: Date.now() }
  else delete s.water[iso]
  return v
}
export function setTargets(s, targets) {
  s.nutritionTargets = targets ? { ...cleanTargets(targets), _ts: Date.now() } : null
}

const cleanItem = x => {
  if (!x || typeof x !== 'object') return null
  const g = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? round1(n) : 0 }
  const protein = g(x.protein), carbs = g(x.carbs), fat = g(x.fat)
  return { name: String(x.name || '').slice(0, 80), qty: String(x.qty || '').slice(0, 60), protein, carbs, fat, cal: crossCheck(x.cal, protein, carbs, fat).cal }
}
const sumItems = items => ({
  cal: items.reduce((n, x) => n + x.cal, 0), protein: round1(items.reduce((n, x) => n + x.protein, 0)),
  carbs: round1(items.reduce((n, x) => n + x.carbs, 0)), fat: round1(items.reduce((n, x) => n + x.fat, 0))
})

/* ---------- the anchor table, without a model ---------- */

/** A food from the table at `n` servings, as a meal item. */
export function foodItem(food, n = 1) {
  const k = Math.max(0.1, Math.min(20, Number(n) || 1))
  const protein = round1(food.p * k), carbs = round1(food.c * k), fat = round1(food.f * k)
  return { name: food.name, qty: (k === 1 ? '' : fmtK(k) + ' × ') + food.serving, protein, carbs, fat, cal: Math.round(food.cal * k) }
}
const fmtK = k => (Number.isInteger(k) ? String(k) : String(Math.round(k * 100) / 100))

// Words the table answers to, so "2 eggs and toast" needs no model: each food's name words,
// plus a few everyday spellings.
const ALIASES = {
  egg: ['egg', 'eggs'], 'bread-white': ['toast', 'bread', 'slice of bread', 'white bread'], 'bread-whole': ['whole wheat', 'wholemeal', 'brown bread'],
  butter: ['butter'], 'olive-oil': ['olive oil', 'oil'], 'chicken-breast': ['chicken', 'chicken breast'], 'chicken-thigh': ['chicken thigh', 'thigh'],
  'beef-lean': ['beef', 'steak'], salmon: ['salmon'], 'tuna-can': ['tuna'], 'rice-white': ['rice', 'white rice'], 'rice-brown': ['brown rice'],
  pasta: ['pasta', 'spaghetti', 'noodles'], potato: ['potato', 'potatoes'], oats: ['oatmeal', 'porridge'], 'oats-dry': ['oats'],
  banana: ['banana', 'bananas'], apple: ['apple', 'apples'], orange: ['orange', 'oranges'], berries: ['berries', 'blueberries', 'strawberries'],
  'milk-whole': ['milk', 'whole milk'], 'milk-skim': ['skim milk', 'skimmed milk'], 'yogurt-greek': ['greek yogurt', 'yogurt', 'yoghurt'],
  'cheese-cheddar': ['cheese', 'cheddar'], cottage: ['cottage cheese'], whey: ['whey', 'protein shake', 'scoop of protein', 'protein powder'],
  'peanut-butter': ['peanut butter'], almonds: ['almonds', 'nuts'], avocado: ['avocado'], 'beans-black': ['beans', 'black beans'], lentils: ['lentils', 'dal'],
  tofu: ['tofu'], broccoli: ['broccoli'], salad: ['salad', 'greens'], 'sweet-potato': ['sweet potato'], tortilla: ['tortilla', 'wrap'],
  'coffee-latte': ['latte', 'coffee with milk'], chocolate: ['chocolate']
}
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 }
/**
 * The words of a meal matched against the table: "2 eggs and a slice of toast" gives two eggs
 * and one bread. Longer aliases win ("peanut butter" before "butter"); a count right before
 * the food scales it. `unread` lists the parts nothing matched. Good enough for the quick path
 * and the demo; the Coach reads anything else.
 */
export function quickMatch(text) {
  let s = ' ' + String(text || '').toLowerCase().replace(/[.,;+/]/g, ' ').replace(/\s+/g, ' ') + ' '
  const aliases = Object.entries(ALIASES).flatMap(([id, names]) => names.map(n => ({ id, n }))).sort((a, b) => b.n.length - a.n.length)
  const found = []
  for (const { id, n } of aliases) {
    // "2 eggs", "two eggs", "half a banana", "a slice of toast": a count, then maybe an article
    // and a serving word, then the food.
    const re = new RegExp(`(?:(\\d+(?:\\.\\d+)?|${Object.keys(WORDS).join('|')})\\s+(?:an? )?(?:slices? of |cups? of |scoops? of |pieces? of )?)?\\b${n.replace(/ /g, '\\s+')}\\b`, 'g')
    s = s.replace(re, (m, q, at) => {
      const food = FOODS.find(f => f.id === id)
      const k = q == null ? 1 : WORDS[q] != null ? WORDS[q] : Number(q)
      found.push({ at, item: foodItem(food, k) })
      // The same width of spaces, so later matches keep their place in the text.
      return ' '.repeat(m.length)
    })
  }
  // In the order the words came, as the person would list them.
  const items = found.sort((a, b) => a.at - b.at).map(x => x.item)
  const unread = s.replace(/\b(and|with|of|some|the|for|on|in|plus|a|an)\b/g, ' ').split(/\s+/).filter(w => w && !/^\d+(\.\d+)?$/.test(w))
  return { items, unread }
}
