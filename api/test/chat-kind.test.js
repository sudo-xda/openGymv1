/* The fourth job kind: a question answered in prose. What is asserted here is the contract the
   chat screen depends on — the payload carries the question, the thread and the career summary;
   the validator keeps a reply and nothing else; the queue turns it into a pending proposal the
   app can read into a thread — and that the career summary the debrief now also reads is built
   from the whole log, bounded. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState, D } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const payload = await import('../coach/core/payload.js');
const { validateChat, CHAT_REPLY_MAX } = await import('../coach/core/validate.js');
const { taskOf, buildPromptParts } = await import('../coach/core/prompt.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
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

/** Three months of one routine, the main lift climbing 20 → 40 kg, so the career has a curve. */
function longState() {
  const workouts = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date('2026-04-01T10:00:00Z'); d.setDate(d.getDate() + i * 4);
    const w = 20 + i;
    workouts.push({
      id: 'w' + i, d: d.toISOString().slice(0, 10), name: 'Full body A', start: d.getTime(), end: d.getTime() + 50 * 60000, vol: w * 30, prs: i % 6 === 0 ? ['0001'] : [],
      entries: [{ id: '0001', target: { sets: 3, reps: 10, weight: w }, sets: [{ w, r: 10, done: true }, { w, r: 10, done: true }, { w, r: 8, done: true }] }]
    });
  }
  return sampleState({ workouts, bodyweight: [{ d: D('2026-04-01'), w: 80 }, { d: D('2026-07-01'), w: 77.5 }] });
}

test('a chat payload carries the question, the thread it continues and the career summary, and no library', () => {
  const S = longState();
  const p = payload.build(S, {
    handle: 'h'.repeat(16), kind: 'chat', question: 'How is my main lift going?',
    conversation: [{ who: 'user', text: 'hi' }, { who: 'coach', text: 'hello' }, { who: 'bot', text: 'ignored' }, { who: 'user', text: 'x'.repeat(1000) }]
  });
  assert.equal(p.task, 'chat');
  assert.equal(p.question, 'How is my main lift going?');
  assert.equal(p.library, undefined, 'a chat names nothing new');
  assert.deepEqual(p.conversation.map(l => l.who), ['user', 'coach', 'user'], 'only user and coach lines');
  assert.equal(p.conversation[2].text.length, payload.THREAD_CHARS);
  assert.ok(p.window.workouts.length <= payload.CHAT_SESSIONS);
  assert.ok(p.window.workouts.at(-1).entries[0].sets, 'the last session arrives set by set');
  assert.ok(p.window.workouts[0].compact, 'older ones compact');
  assert.equal(p.career.sessions, 24);
  assert.equal(p.career.since, '2026-04-01');
  const lift = p.career.bests.find(b => b.id === '0001');
  assert.equal(lift.first.top, '20x10');
  assert.equal(lift.best.top, '43x10');
  assert.ok(lift.bestEst1RM.kg > 43);
  assert.equal(p.career.prsTotal, 4);
  assert.equal(p.career.bodyweight12w.to.w, 77.5);
});

test('the career summary is bounded: a dozen exercises, the session\'s own first', () => {
  const S = longState();
  // Twenty more exercises trained once each; the focus session names one of them.
  const extra = Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i, sets: [{ w: 10, r: 5, done: true }] }));
  S.workouts.push({ id: 'wx', d: '2026-07-10', name: 'Odd', start: 1, end: 2, entries: extra });
  const focus = { entries: [{ id: 'x19' }] };
  const c = payload.careerOf(S, focus);
  assert.equal(c.bests.length, payload.CAREER_EXERCISES);
  assert.equal(c.bests[0].id, 'x19', 'what the session trained leads');
  assert.equal(c.bests[1].id, '0001', 'then the most trained');
  assert.equal(payload.careerOf({ workouts: [] }, null), null);
});

test('a debrief now reads the same routine further back and the career, both bounded', () => {
  const S = longState();
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'debrief', workoutId: 'w23' });
  assert.equal(p.previous.length, 3);
  assert.equal(p.earlier.length, payload.EARLIER_SESSIONS);
  assert.ok(p.earlier.every(w => w.compact));
  assert.equal(p.earlier.at(-1).d < p.previous[0].d, true, 'earlier is older than previous');
  assert.equal(p.career.sessions, 24);
});

test('the chat task has its own prompt and schema, and the validator keeps a bounded reply', () => {
  assert.equal(taskOf('chat', {}), 'chat');
  const parts = buildPromptParts('chat', { task: 'chat', question: 'q' }, null);
  assert.equal(parts.task, 'chat');
  assert.match(parts.system, /Task: answer a question/);
  assert.ok(SCHEMAS.chat.required.includes('reply'));

  assert.equal(validateChat({ coach_contract: 1, reply: '  **Hi**  ', title: '  Bench   stall ' }).proposal.reply, '**Hi**');
  assert.equal(validateChat({ coach_contract: 1, reply: 'x', title: '  Bench   stall ' }).proposal.title, 'Bench stall');
  assert.equal(validateChat({ coach_contract: 1, reply: 'x'.repeat(CHAT_REPLY_MAX + 50) }).proposal.reply.length, CHAT_REPLY_MAX);
  assert.equal(validateChat({ coach_contract: 1 }).ok, false);
  assert.equal(validateChat({ coach_contract: 1, reply: 'x', changes: [{ type: 'sets' }] }).ok, false, 'a chat may not smuggle plan changes');
});

test('through the queue: a chat job ends as a pending reply the app reads into its thread', async () => {
  const uid = 'u-chat';
  writeState(DIR, uid, longState());
  const { id } = jobs.enqueue(uid, { kind: 'chat', question: 'How is my main lift going?', conversation: [{ who: 'user', text: 'earlier' }, { who: 'coach', text: 'reply' }] });
  const s = await settle(uid);
  assert.ok(s.pending, 'a reply waits');
  assert.equal(s.pending.id, id);
  assert.equal(s.pending.kind, 'chat');
  assert.match(s.pending.reply, /24 sessions/, 'the career summary reached the provider');
  assert.match(s.pending.reply, /2 earlier lines/, 'the thread reached the provider');
  assert.equal(s.pending.title, 'Fixture answer');
  assert.equal(s.pending.changes, undefined);
  jobs.resolvePending(uid, {});
  assert.equal(jobs.status(uid).pending, null);
});

test('a chat without a question is refused at the route, before anything is queued', async () => {
  const { coachRoutes } = await import('../coach/routes.js');
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: 'u-route' }),
    requireAdmin: () => true
  });
  const res = {};
  await routes['POST /api/coach/ask']({ body: { question: '   ' } }, res);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'noquestion');
});
