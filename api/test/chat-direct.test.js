/* The chat as a conversation: one call, a short persona, a compact snapshot, words back. What is
   pinned here is the shape of the snapshot (an allowlist, the account name never in it), the
   plain-text contract with the adapters, the reply clean-up, and the gate the direct call shares
   with the queue — consent, the cap, one thing at a time per profile. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState, D } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const chat = await import('../coach/core/chat.js');
const payload = await import('../coach/core/payload.js');
const { anthropicSpec } = await import('../coach/core/adapters/anthropic.js').catch(() => ({}));
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

cfg.save({ enabled: true, provider: 'fixture', caps: { perProfileDaily: 10, instanceDaily: 0 } });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const longState = () => {
  const workouts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date('2026-08-01T10:00:00Z'); d.setDate(d.getDate() + i * 4);
    workouts.push({ id: 'w' + i, d: d.toISOString().slice(0, 10), name: 'Full body A', start: d.getTime(), end: d.getTime() + 50 * 60000, vol: 600 + i * 30, prs: [], entries: [{ id: '0001', sets: [{ w: 20 + i, r: 10, done: true }, { w: 20 + i, r: 8, done: true }] }] });
  }
  return sampleState({ workouts, displayName: 'Alex', meals: [{ id: 'm1', d: new Date().toISOString().slice(0, 10), t: 1, text: 'eggs', cal: 300, protein: 20, carbs: 10, fat: 20 }], nutritionTargets: { cal: 2400, protein: 180, carbs: 260, fat: 70 } });
};

test('the snapshot is compact, bounded and carries no account identity', () => {
  const S = { ...longState(), name: 'Account Holder', email: 'a@b.c' };
  const snap = chat.snapshotOf(S, { handle: 'h'.repeat(16), lang: 'de', conversation: [{ who: 'user', text: 'x'.repeat(900) }, { who: 'bot', text: 'no' }] });
  assert.equal(snap.meta.lang, 'de');
  assert.equal(snap.name, 'Alex');
  assert.equal(snap.career.sessions, 12);
  assert.ok(snap.career.bests.length <= 8);
  assert.equal(snap.recent.length, chat.RECENT_SESSIONS);
  assert.equal(snap.recent[2].exercises[0].top, '31x10');
  assert.equal(snap.nutrition.today.cal, 300);
  assert.equal(snap.plan.routines[0].exercises, 2);
  assert.deepEqual(snap.conversation.map(l => l.who), ['user']);
  assert.equal(snap.conversation[0].text.length, 400);
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('Account Holder') && !json.includes('a@b.c'), 'the account stays out');
  assert.ok(json.length < 6000, `a snapshot is small: ${json.length} chars`);
});

test('buildChat makes a short persona and a user part with the snapshot and the message', () => {
  const { system, user, question } = chat.buildChat(longState(), { handle: 'h'.repeat(16), lang: 'en', question: '  how is  my squat? ' });
  assert.match(system, /coach in a chat/);
  assert.ok(system.length < 5000, 'the persona is short');
  assert.match(user, /## Snapshot[\s\S]*## Message\n\nhow is my squat\?/);
  assert.equal(question, 'how is my squat?');
});

test('cleanReply trims, caps and unwraps a JSON answer a model still gave', () => {
  assert.equal(chat.cleanReply('  Hi **there**  '), 'Hi **there**');
  assert.equal(chat.cleanReply('{"reply": "Unwrapped"}'), 'Unwrapped');
  assert.equal(chat.cleanReply('```json\n{"answer":"Fenced"}\n```'), 'Fenced');
  assert.equal(chat.cleanReply('{not json'), '{not json');
  assert.equal(chat.cleanReply('x'.repeat(chat.REPLY_MAX + 10)).length, chat.REPLY_MAX);
  assert.equal(chat.cleanReply(''), '');
});

test('the adapters send a plain request for the chat: the chat prefix, no JSON mode', async () => {
  const { chatCompletionsSpec } = await import('../coach/core/adapters/openai.js');
  const spec = chatCompletionsSpec('openai', { maxTokensField: 'max_tokens' });
  const plain = spec.body({ model: 'm', prompt: 'p', system: 's', schema: null, maxTokens: 10, plain: true });
  assert.equal(plain.response_format, undefined);
  assert.match(plain.messages[0].content, /never JSON/);
  const json = spec.body({ model: 'm', prompt: 'p', system: 's', schema: null, maxTokens: 10, plain: false });
  assert.equal(json.response_format.type, 'json_object');
  assert.match(json.messages[0].content, /requested JSON/);
  const { geminiSpec } = await import('../coach/core/adapters/gemini.js');
  assert.equal(geminiSpec.body({ prompt: 'p', system: 's', maxTokens: 10, plain: true }).generationConfig.responseMimeType, undefined);
  assert.equal(geminiSpec.body({ prompt: 'p', system: 's', maxTokens: 10 }).generationConfig.responseMimeType, 'application/json');
});

test('askNow answers in the same call, in words, with the snapshot and the thread in hand', async () => {
  const uid = 'u-direct';
  writeState(DIR, uid, longState());
  const r = await jobs.askNow(uid, { question: 'How is my squat going?', conversation: [{ who: 'user', text: 'hi' }, { who: 'coach', text: 'hey' }] });
  assert.match(r.reply, /Good question, Alex/);
  assert.match(r.reply, /\*\*12 sessions\*\*/);
  assert.match(r.reply, /2 earlier lines/);
  assert.match(r.reply, /You asked: How is my squat going\?/);
  assert.ok(r.ms >= 0);
  assert.equal(jobs.capState(uid).used, 1, 'a chat counts against the cap');
  assert.equal(jobs.status(uid).job, null, 'nothing is left in flight');
});

test('askNow keeps the gate: consent, an empty question, the cap, one thing at a time', async () => {
  const uid = 'u-direct-gate';
  writeState(DIR, uid, sampleState({ coach: {} }));
  await assert.rejects(() => jobs.askNow(uid, { question: 'q' }), e => e.code === 'consent');
  writeState(DIR, uid, longState());
  await assert.rejects(() => jobs.askNow(uid, { question: '   ' }), e => e.code === 'noquestion');
  cfg.save({ caps: { perProfileDaily: 1, instanceDaily: 0 } });
  await jobs.askNow(uid, { question: 'one' });
  await assert.rejects(() => jobs.askNow(uid, { question: 'two' }), e => e.code === 'cap');
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
  // A job in the queue holds the profile's slot; the chat waits rather than overlapping it.
  jobs.enqueue(uid, { kind: 'review' });
  await assert.rejects(() => jobs.askNow(uid, { question: 'now?' }), e => e.code === 'busy');
  const until = Date.now() + 15000;
  while (Date.now() < until && jobs.status(uid).job) await new Promise(r => setTimeout(r, 25));
});

test('the route returns the reply with 200, and a refusal with its class', async () => {
  const uid = 'u-direct-route';
  writeState(DIR, uid, longState());
  const { coachRoutes } = await import('../coach/routes.js');
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: uid }),
    requireAdmin: () => true
  });
  let res = {};
  await routes['POST /api/coach/ask']({ body: { question: 'hi', lang: 'en' } }, res);
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /Good question/);
  res = {};
  await routes['POST /api/coach/ask']({ body: { question: ' ' } }, res);
  assert.equal(res.status, 400);
});

test('the briefing and the weekly review are modes of the same call, with their own persona and the phone\'s block bounded', async () => {
  const S = longState();
  S.week = { 1: ['r1'], 3: ['r1'], 5: ['r1'] };
  const dev = { today: { steps: 5200, totalKcal: 2100, hr: { min: 48, avg: 70, max: 999 } }, load: { ratio: 1.6, word: 'spike', weekTotal: 420 }, energy: { eaten: 1800, burned: 2100, balance: -300 }, evil: 'x' };
  const b = chat.buildChat(S, { handle: 'h'.repeat(16), lang: 'en', mode: 'briefing', device: dev });
  assert.match(b.system, /MORNING BRIEFING/);
  assert.equal(b.question, 'Write today\'s morning briefing.');
  assert.equal(b.maxTokens, chat.BRIEFING_MAX_TOKENS);
  const snap = JSON.parse(b.user.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(snap.device.today.hr.max, 250, 'bounded');
  assert.equal(snap.device.load.word, 'spike');
  assert.equal(snap.device.evil, undefined);
  assert.ok(Array.isArray(snap.today.planned));
  S.workouts[S.workouts.length - 1].d = new Date().toISOString().slice(0, 10);
  const w = chat.buildChat(S, { handle: 'h'.repeat(16), lang: 'en', mode: 'weekly' });
  assert.match(w.system, /WEEKLY REVIEW/);
  const ws = JSON.parse(w.user.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.ok(ws.week.thisWeek.sessions.length >= 1);
  assert.equal(ws.week.plannedPerWeek, 3);
  assert.equal(typeof ws.week.lastWeek.sessions, 'number');
  assert.equal(chat.buildChat(S, { handle: 'h'.repeat(16), mode: 'nonsense', question: 'q' }).mode, 'chat');
  assert.equal(chat.cleanDevice(null), null);
  assert.equal(chat.cleanDevice({ junk: 1 }), null);
  // Through the queue's direct call, no question needed.
  const uid = 'u-briefing';
  writeState(DIR, uid, S);
  const r = await jobs.askNow(uid, { mode: 'briefing', device: dev });
  assert.match(r.reply, /Good question/);
  await assert.rejects(() => jobs.askNow(uid, { mode: 'chat', question: '' }), e => e.code === 'noquestion');
});

test('a workout\'s band figures ride in the payload: session hr, zones, calories, and a set\'s hr', () => {
  const S = sampleState();
  S.workouts[0].hr = { avg: 131, max: 162 }; S.workouts[0].hrZones = [5, 10, 20, 8, 2]; S.workouts[0].kcal = 310.4;
  S.workouts[0].entries[0].sets[0].hr = { avg: 120.4, max: 140 };
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'debrief', workoutId: 'w1' });
  assert.deepEqual(p.session.hr, { avg: 131, max: 162 });
  assert.deepEqual(p.session.zones, [5, 10, 20, 8, 2]);
  assert.equal(p.session.kcal, 310.4);
  assert.equal(p.session.entries[0].sets[0].hr, '120/140');
  assert.equal(p.session.entries[0].sets[1].hr, undefined);
});
