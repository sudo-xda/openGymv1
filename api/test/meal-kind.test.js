/* The nutrition side of the Coach: a meal in words read into items, three meals suggested for
   the day's gap, and the nutrition log riding along with a debrief and a chat. The assertions
   that matter are the deterministic ones — the server's cross-check overrides a calorie figure
   that disagrees with the macros, totals are added up here and never taken from the model, and
   nothing of the log leaves for a profile that never logged a meal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const payload = await import('../coach/core/payload.js');
const { validateMeal, validateMealSuggest } = await import('../coach/core/validate.js');
const { crossCheck, caloriesOf, FOODS } = await import('../coach/core/foods.js');
const { taskOf, buildPromptParts } = await import('../coach/core/prompt.js');
const { DATA_CATEGORIES } = await import('../coach/core/categories.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}
const today = new Date().toISOString().slice(0, 10);
const fed = () => sampleState({
  meals: [
    { id: 'm1', d: today, t: 1, text: '2 eggs and toast', cal: 223, protein: 15.3, carbs: 15.6, fat: 10.6 },
    { id: 'm2', d: today, t: 2, text: 'chicken and rice', cal: 371, protein: 35.3, carbs: 44.5, fat: 4.0 },
    { id: 'm0', d: '2020-01-01', t: 0, text: 'ancient', cal: 999, protein: 1, carbs: 1, fat: 1 }
  ],
  water: { [today]: { ml: 1500, _ts: 3 } },
  nutritionTargets: { cal: 2400, protein: 180, carbs: 260, fat: 70, water: 3000 }
});

test('the anchor table agrees with its own arithmetic within the tolerance', () => {
  for (const f of FOODS) assert.equal(crossCheck(f.cal, f.p, f.c, f.f).adjusted, false, `${f.name}: ${f.cal} vs ${caloriesOf(f.p, f.c, f.f)}`);
  assert.deepEqual(crossCheck(300, 10, 10, 10), { cal: 170, adjusted: true });
  assert.deepEqual(crossCheck(172, 10, 10, 10), { cal: 172, adjusted: false });
  assert.deepEqual(crossCheck(undefined, 0, 0, 0), { cal: 0, adjusted: false });
});

test('validateMeal keeps items, corrects calories that disagree with the macros, and adds up the totals itself', () => {
  const r = validateMeal({ coach_contract: 1, items: [
    { name: 'Egg, large', qty: '2 large', cal: 144, protein: 12.6, carbs: 0.8, fat: 9.6 },
    { name: 'White bread', cal: 500, protein: 2.7, carbs: 14.8, fat: 1.0 },     // 500 is nonsense
    { name: 'Nothing', cal: '9', protein: '0', carbs: '2', fat: '0' }
  ], note: '  assumed white  ' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.proposal.items[1].cal, 79, 'the arithmetic wins');
  assert.equal(r.proposal.items[1].adjusted, true);
  assert.equal(r.proposal.items[0].adjusted, false);
  assert.equal(r.proposal.items[2].cal, 8);
  assert.equal(r.proposal.adjusted, 2, 'two items corrected: one far off, one read from strings');
  assert.equal(r.proposal.cal, 144 + 79 + 8);
  assert.equal(r.proposal.protein, 15.3);
  assert.equal(r.proposal.note, 'assumed white');
  assert.equal(validateMeal({ coach_contract: 1, items: [{ name: 'x', cal: 1, protein: -1, carbs: 0, fat: 0 }] }).ok, false, 'a negative macro is refused');
  assert.equal(validateMeal({ coach_contract: 1, items: [{ cal: 1, protein: 1, carbs: 0, fat: 0 }] }).ok, false, 'an item needs a name');
  assert.ok(validateMeal({ coach_contract: 1, items: [] }).ok, 'nothing to read is an answer');
});

test('validateMealSuggest keeps up to three meals, each loggable as text, cross-checked', () => {
  const r = validateMealSuggest({ coach_contract: 1, meals: [
    { title: 'Bowl', desc: 'why', text: '150 g chicken, 1 cup rice', cal: 9999, protein: 50, carbs: 44, fat: 6 },
    { title: 'No text', cal: 100, protein: 10, carbs: 10, fat: 1 }
  ] });
  assert.equal(r.ok, false, 'a meal without its loggable text is refused');
  const ok = validateMealSuggest({ coach_contract: 1, meals: [{ title: 'Bowl', text: '150 g chicken, 1 cup rice', cal: 9999, protein: 50, carbs: 44, fat: 6 }] });
  assert.ok(ok.ok);
  assert.equal(ok.proposal.meals[0].cal, caloriesOf(50, 44, 6));
  assert.equal(ok.proposal.meals[0].adjusted, true);
});

test('the meal payloads: words only for an estimate; the gap, today and the targets for a suggestion', () => {
  const S = fed();
  const est = payload.build(S, { handle: 'h'.repeat(16), kind: 'meal', meal: { text: 'x'.repeat(900) } });
  assert.equal(est.task, 'meal');
  assert.equal(est.meal.text.length, payload.MEAL_WORDS_MAX);
  assert.equal(est.library, undefined);
  assert.equal(est.nutrition, undefined, 'an estimate reads nothing of the log');
  assert.equal(taskOf('meal', est), 'meal');
  assert.match(buildPromptParts('meal', est).system, /Egg, large, 1 large \(50 g\): 72 kcal/, 'the anchor table is quoted');

  const sug = payload.build(S, { handle: 'h'.repeat(16), kind: 'meal', meal: { suggest: true } });
  assert.equal(sug.task, 'mealsuggest');
  assert.equal(taskOf('meal', sug), 'mealsuggest');
  assert.deepEqual(sug.mealGap.logged, { cal: 594, protein: 50.6, carbs: 60.1, fat: 14.6, water: 1500 });
  assert.deepEqual(sug.mealGap.remaining, { cal: 2400 - 594, protein: 129.4, carbs: 199.9, fat: 55.4 });
  assert.equal(sug.mealGap.meals.length, 2, 'the ancient meal is not today');
  assert.ok(sug.career);
});

test('a debrief and a chat carry the nutrition log, bounded, and nothing for a profile without one', () => {
  const S = fed();
  S.workouts[0].d = today;
  const d = payload.build(S, { handle: 'h'.repeat(16), kind: 'debrief', workoutId: 'w1' });
  assert.equal(d.nutrition.day, today);
  assert.equal(d.nutrition.today.cal, 594);
  assert.equal(d.nutrition.todayMeals.length, 2);
  assert.equal(d.nutrition.targets.cal, 2400);
  assert.equal(d.nutrition.week, null, 'nothing logged in the seven days before');
  const c = payload.build(S, { handle: 'h'.repeat(16), kind: 'chat', question: 'q' });
  assert.equal(c.nutrition.today.water, 1500);
  const bare = payload.build(sampleState(), { handle: 'h'.repeat(16), kind: 'chat', question: 'q' });
  assert.equal(bare.nutrition, undefined);
  assert.ok(DATA_CATEGORIES.includes('nutrition'), 'the consent screen names it');
});

test('through the queue: an estimate comes back corrected and totalled; a suggestion answers the gap', async () => {
  const uid = 'u-meal';
  writeState(DIR, uid, fed());
  jobs.enqueue(uid, { kind: 'meal', meal: { text: '2 eggs and toast' } });
  let s = await settle(uid);
  assert.equal(s.pending.kind, 'meal');
  assert.equal(s.pending.items.length, 2);
  assert.equal(s.pending.items[1].cal, 79, 'the fixture said 120 for the toast; the arithmetic says 79');
  assert.equal(s.pending.cal, 144 + 79);
  assert.equal(s.pending.adjusted, 1);
  jobs.resolvePending(uid, {});

  jobs.enqueue(uid, { kind: 'meal', meal: { suggest: true } });
  s = await settle(uid);
  assert.equal(s.pending.kind, 'meal');
  assert.equal(s.pending.meals.length, 3);
  assert.match(s.pending.meals[0].title, /Chicken/);
  assert.ok(s.pending.meals[0].text.length > 0);
  jobs.resolvePending(uid, {});
});

test('the route refuses a meal with neither words nor a request for suggestions', async () => {
  const { coachRoutes } = await import('../coach/routes.js');
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: 'u-route-meal' }),
    requireAdmin: () => true
  });
  const res = {};
  await routes['POST /api/coach/meal']({ body: { text: '  ' } }, res);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'nomeal');
});
