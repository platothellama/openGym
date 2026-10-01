# Training systems and the muscle ledger

openGym's progression has always worked one exercise at a time: a squat was hit three sessions in a
row, so the next one goes up. A **training system** is the program wrapped around that — a
progression rule, rest periods, a weekly volume target per muscle — and the **muscle ledger** is
what makes that volume target bite.

Both are **off by default**, and turning them on changes nothing that you set by hand. Everything
below is what a system fills in, and what it refuses to touch.

---

## Choosing a system

**Settings → Training system.** Six choices, `off` first and `off` the default:

| System | Progression | Rest (compound / isolation) | Weekly hard sets (small / medium / large muscle) |
| --- | --- | --- | --- |
| **No training system** | whatever each exercise and routine already says | as set | none |
| **Linear progression** | every rep in every set, or the weight goes up; repeated misses deload | 120s / 75s | 6 / 10 / 14 |
| **Greyskull LP** | two straight sets plus a set to failure; beat the target and it goes up | 150s / 90s | 6 / 10 / 14 |
| **Double progression** | work up a rep range at one weight; top of the range in every set and it goes up | 105s / 60s | 8 / 12 / 16 |
| **Hypertrophy** | double progression in a 10–15 band, more weekly volume | 90s / 60s | 10 / 16 / 22 |
| **Strength** | low reps at a big step; deloads only after four failed sessions | 180s / 90s | 4 / 6 / 10 |

Two details behind the table:

- **Volume class, not muscle identity.** A weekly target is set for a *small*, *medium* or *large*
  muscle, so quads and hamstrings share a cap rather than each carrying their own number.
- **The increment scales with the lift.** 2.5 kg on a light lift, 5 kg on a heavy lower-body one
  (double in lb), which is the relationship the existing increment logic already used.

### How a system resolves

For any single exercise, the rule comes from the first of these that has an opinion:

1. the exercise's own setting (`cfg.prog`),
2. the routine's `prog`,
3. the profile's chosen system,
4. the mode's existing default.

So a system only ever **fills gaps**. An exercise told to progress a certain way, or a routine
already on a policy, keeps that — the system does not reach over it. This is the reason it is safe
to switch on over a log built without it: nothing that was deliberate gets reinterpreted.

Rest follows the same shape. A set that names its own rest keeps it.

---

## The muscle ledger

Progression knows a squat was hit three times. It does not know that four other things in the plan
also train quads. The ledger is the other half: per canonical muscle, it counts the **hard sets
actually logged this week**, how many sessions they came in, how long ago it was trained, and what
the recovery model says about it — then hands progression one word.

A *hard set* is one rated within 3 reps of failure, so a planned-but-easy set does not inflate a
muscle's week. Counting is per muscle at full weight for every muscle an exercise trains: a bench
set is one set of chest **and** one of triceps, which is how set-count landmarks are written down.

### The rule

| State | What the ledger says |
| --- | --- |
| at or past the weekly cap | **hold** — no increase, no decrease |
| over the cap *and* past the fatigue threshold, for two weeks running | **deload** — one step back |
| under the cap, or no cap at all | the policy decides, exactly as it does today |

A hard week therefore costs a gain, never your standing. Only accumulated overload takes weight off
the bar — the same shape as the deload progression already runs on one exercise's failures, counted
across everything that trains the muscle.

A secondary muscle can escalate a progress into a hold (tired triceps are a real reason to leave the
bench alone) but never deload on its own, because a bench press does not stop working because
triceps are tired.

### Adding or dropping a set

Off by default (`muscleAutoSets`). On, the ledger may change **today's set count by one** — add one
when the muscle is at least two sets under its cap and free to progress, drop one when it is more
than two over and is being held or deloaded. A muscle *near* its cap gets nothing: adding a set to a
muscle that is about to be over is the exact mistake this exists to prevent.

### Seeing it

- **On the workout card** — the line under the target when a weight was held, naming the muscle and
  the reason, e.g. *"Chest is at its weekly target of 10 hard sets - holding."*
- **Stats → Muscle balance → Weekly targets** — every muscle at or near its cap this week, with its
  hard sets against its target, and the same sentence. Without a system there is no cap, so the
  panel does not appear at all.

---

## Hold on recovery

**Settings → Training system → Hold on recovery** (`readinessAuto`, off by default). With FitAI
linked in Settings, a short-recovery day holds the weight instead of raising it, and the card names
the reason — a calorie deficit, low protein, or an active fast.

It is deliberately narrow:

- **Once per session.** The day's fuel is read once, when the workout opens, and stamped on the
  session (`active.readinessApplied`). Coming back to the app, or switching exercises, re-reads
  nothing and does not back the weight off a second time.
- **Nothing is guessed.** With no FitAI linked, or no fuel data for the week, the session is left
  alone rather than assumed to be a recovery day.
- **Logged sets are never touched.** It moves the *target*, and only for sets not yet done — what
  is already in the book stays in the book.
- **Past workouts are left alone.** A session being backfilled was a session, and correcting a date
  should not retroactively rewrite the weights it was built with.

This is a *readiness* rule, not a volume rule: it works with no training system chosen at all.

---

## Applying a system to one routine

Settings resolves a system implicitly. The routine editor can also write it in, so the rule is
visible where you edit it and travels with the routine:

- **Routine editor → "Apply *Hypertrophy* to this routine"**, behind a confirmation that says what
  it will do. It writes the routine's `prog`, and only that: nothing is removed, and an exercise
  with its own rule is untouched.
- A routine **deliberately on a different policy is left alone** — overriding that is your decision,
  not the system's — so the button stays available rather than reporting a change it did not make.
- **"Remove *Hypertrophy* from this routine"** appears when the system has been switched off in
  Settings but this routine still carries it. It clears exactly what was written and nothing else.

---

## What gets stored

All in the profile state (`gym_state_v1`, synced like the rest of it):

| Key | Meaning |
| --- | --- |
| `trainSystem` | the chosen system id, or absent for `off` |
| `muscleAutoSets` | `true` to let the ledger move a set count by one |
| `readinessAuto` | `true` to hold weights on a FitAI recovery day |
| `routines[].prog` / `routines[].systemApplied` | a system written into that routine |
| `active.readinessApplied` | this session has already read the day's fuel |

Everything else is derived on every read — there is no stored counter to drift, and editing a past
set changes today's answer the way it already does.

---

## For developers

- `frontend/src/lib/training-systems.js` — the catalogue (`SYSTEMS`), resolution, rest, and the
  explicit `applySystemToRoutine`. Tests beside it in `training-systems.test.js`.
- `frontend/src/lib/muscle-ledger.js` — `muscleLedger` (the numbers), `muscleVerdict` (one word per
  exercise), `ledgerSummary` (a screen's view), and `ledgerWhy` / `ledgerActionOf`, which are the
  single wording of a reason that both the workout card and Stats use. Tests in
  `muscle-ledger.test.js`.
- `frontend/src/lib/progression.js` — reads the resolved preset for the gate, the increment and the
  deload.
- `frontend/src/lib/session-start.js` — where a session's targets are built: the system and the
  ledger are applied here, once, when the workout opens.
- `frontend/src/lib/session-suggest.js` — `suggestTargets`, the *readiness* overlay only. It must
  not re-apply the ledger: doing so would apply the same hold twice.

Per `frontend/CONTRIBUTING.md`, anything that decides what you lift next or reads a logged session
back is a pure helper in `src/lib` with a unit test beside it. Training logic belongs there, not in
a view.