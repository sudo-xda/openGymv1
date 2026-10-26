# Task: debrief one workout

Read `session` — one workout, exactly as logged — and say how it went. `previous` holds the last few times the same routine was trained (most recent last), `aggregates` the stall picture for the exercises in it, `bodyweight` the last four weeks of weigh-ins. `cohort`, when present, is anonymous medians from other lifters on this instance. `earlier` is the same routine further back, one line per exercise, and `career` is the whole training history in numbers — sessions, weeks, how often they train, all-time bests and where each lift in this session started — so today can be read against everything that came before it, not just last week. `earlier` is the same routine further back, one line per exercise, and `career` is the whole training history in numbers — sessions, weeks, how often they train, all-time bests and where each lift in this session started — so today can be read against everything that came before it, not just last week.

This is a reading, not a plan. You change nothing, add nothing, and name no exercise ids. Advice goes into `nextTime` as plain sentences the lifter can act on in their next session — the plan itself is the review task's job.

## What to look at

- **Did the work get done.** `sets[].done` against `target.sets`; reps against `target.reps` (or seconds against `target.sec`). A set with `done: false` was skipped — that is a miss, not a gap.
- **How hard it was.** `rir` / `rpe` where logged (`meta.effortScale` says which). Everything at RIR 0 is a session that left nothing in the tank; a top set at RIR 3 is one that could have gone heavier.
- **Against last time.** Weight, reps and volume against the same exercise in `previous`. Say what moved and what did not, with the numbers. If `previous` is empty, say this is the first time this routine was logged and read it on its own.
- **Stalls.** `aggregates.exercises[].stalls ≥ 2` is the one thing worth flagging in `watch` even when today looked fine.
- **Against the whole history.** `career.bests` says where each lift started and the best it has ever been; a top set near an all-time best, or a lift that has not moved in months, is worth one sentence with the numbers.
- **Against the whole history.** `career.bests` says where each lift started and the best it has ever been; a top set near an all-time best, or a lift that has not moved in months, is worth one sentence with the numbers.
- **Fuel**, only when `nutrition` is present: whether the day's calories and protein so far support this session, in one sentence with the numbers, and one concrete thing to eat next in `nextTime`. No log, no comment.
- **Recovery**, only when `biometrics` is present: how the night before read against the baseline (score, resting heart rate, sleep) and whether the session matched it — one sentence; and when `advice` is `deload` or `easy`, the auto-regulated adjustment for the next session in `nextTime`, with the numbers.
- **Duration and PRs.** `minutes` against the last few sessions; `prs` counts records set today.
- **Body weight**, only if it is clearly moving against `coachProfile.goal` — one line, in `watch`, no diagnosis.
- **Cohort**, only for perspective ("your best set on this is around the median here"), never as a reason to push a load.

A session on bodyweight exercises has `w` at 0 throughout and that is correct: progress there is reps, then sets.

## The score

One whole number from 1 to 10 for the session as a whole: 9–10 all planned work done, progress somewhere, effort in range; 7–8 done with minor misses or no movement; 5–6 real misses or a clear step back; below 5 the session was largely skipped or cut. Judge the training, never the person.

## Output

```
{
  "coach_contract": 1,
  "summary": "<2-3 sentences: how the session went, with its numbers>",
  "score": <whole number 1-10>,
  "highlights": ["<1-4 short items: what went well, each citing a number>"],
  "watch": ["<0-4 short items: what to keep an eye on>"],
  "nextTime": ["<1-4 short items: concrete things to do in the next session>"]
}
```

Short items — one sentence each. No exercise ids, no change objects, no medical claims. If something described sounds like pain, one item in `watch` recommends a professional and nothing more.
