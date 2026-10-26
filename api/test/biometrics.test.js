/* The band in the Coach's context: the reading rides with a review, a debrief and a chat, bounded
   and shaped like the app's own view of it, and the prompts carry the auto-regulation protocol.
   Built from a mock that matches what the app writes (frontend lib/biometrics.js dayReading), so
   the injection is tested with no Health Connect and no band at all. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const chat = await import('../coach/core/chat.js');
const { PROMPTS } = await import('../coach/core/prompts.js');
const { DATA_CATEGORIES } = await import('../coach/core/categories.js');

const today = new Date().toISOString().slice(0, 10);
const dayBefore = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
// A bad night today over a normal week.
const MOCK = {
  [today]: { d: today, score: 48, readiness: 'low', restingHr: 57, hrv: 38, steps: 2100, sleep: { deep: 40, light: 200, rem: 30, awake: 50, total: 270, efficiency: 0.84 }, flags: ['rhrElevated', 'sleepShort', 'deepRemLow', 'hrvLow'], _ts: 1 },
  [dayBefore(1)]: { d: dayBefore(1), score: 84, readiness: 'ready', restingHr: 51, hrv: 62, steps: 9000, sleep: { deep: 90, light: 250, rem: 80, awake: 20, total: 420, efficiency: 0.95 }, flags: [], _ts: 1 },
  [dayBefore(2)]: { d: dayBefore(2), score: 76, readiness: 'ready', restingHr: 52, hrv: 58, steps: 6000, sleep: { deep: 70, light: 260, rem: 60, awake: 30, total: 390, efficiency: 0.93 }, flags: [], _ts: 1 },
  [dayBefore(3)]: { d: dayBefore(3), score: 80, readiness: 'ready', restingHr: 50, hrv: 60, steps: 8000, sleep: { deep: 80, light: 270, rem: 70, awake: 25, total: 420, efficiency: 0.94 }, flags: [], _ts: 1 },
  [dayBefore(20)]: { d: dayBefore(20), score: 10, readiness: 'low', restingHr: 90, steps: 1, sleep: null, flags: [], _ts: 1 }
};

test('biometricsOf: today against the seven-day baseline, with the advice, bounded', () => {
  const b = payload.biometricsOf(sampleState({ biometrics: MOCK }), today);
  assert.equal(b.day, today);
  assert.equal(b.today.score, 48);
  assert.equal(b.today.restingHr, 57);
  assert.equal(b.today.hrv, 38);
  assert.deepEqual(b.today.flags, ['rhrElevated', 'sleepShort', 'deepRemLow', 'hrvLow']);
  assert.equal(b.baseline.days, 3);
  assert.equal(b.baseline.restingHr, 51);
  assert.equal(b.baseline.hrv, 60);
  assert.equal(b.baseline.deepRemMin, 150);
  assert.equal(b.advice, 'deload');
  const odd = payload.biometricsOf(sampleState({ biometrics: { [today]: { score: 900, restingHr: -5, steps: 1e9, sleep: { total: 5000 }, flags: ['evil', 'restless'], readiness: 'great' } } }), today);
  assert.equal(odd.today.score, 100);
  assert.equal(odd.today.restingHr, 20);
  assert.equal(odd.today.steps, 200000);
  assert.equal(odd.today.sleep.total, 1440);
  assert.deepEqual(odd.today.flags, ['restless']);
  assert.equal(odd.today.readiness, null);
  assert.equal(payload.biometricsOf(sampleState(), today), null, 'no band, nothing');
  assert.ok(DATA_CATEGORIES.includes('biometrics'), 'the consent screen names it');
});

test('the reading rides with a review, a debrief and the chat snapshot', () => {
  const S = sampleState({ biometrics: MOCK });
  S.workouts[0].d = today;
  assert.equal(payload.build(S, { handle: 'h'.repeat(16), kind: 'review' }).biometrics.advice, 'deload');
  assert.equal(payload.build(S, { handle: 'h'.repeat(16), kind: 'debrief', workoutId: 'w1' }).biometrics.today.score, 48);
  assert.equal(chat.snapshotOf(S, { handle: 'h'.repeat(16), lang: 'en' }).biometrics.baseline.restingHr, 51);
  assert.equal(payload.build(sampleState(), { handle: 'h'.repeat(16), kind: 'review' }).biometrics, undefined);
});

test('the prompts carry the auto-regulation protocol', () => {
  assert.match(PROMPTS.common, /auto-regulation protocol/i);
  assert.match(PROMPTS.common, /Health Connect/);
  assert.match(PROMPTS.common, /15% off the working weights/);
  assert.match(PROMPTS.review, /Auto-regulation/);
  assert.match(PROMPTS.debrief, /Recovery\*\*, only when `biometrics`/);
  assert.match(chat.chatSystem('en'), /Auto-regulate/);
});
