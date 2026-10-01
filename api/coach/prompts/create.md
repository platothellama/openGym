# Task: build a weekly training plan

Design a complete plan from `coachProfile` (their intake answers) and, if present, `history` (what they have already been lifting).

## Constraints

- Schedule exactly `coachProfile.daysPerWeek` training days in `week`. You choose the weekdays yourself (0 = Sunday … 6 = Saturday) — nobody picked them, so spread the week sensibly: leave a rest day after a heavy day, and never stack two hard days back to back. `preferredDays`, if present, is a hint from an older profile: prefer those where it does not fight the rest of the plan.
- `coachProfile.optionalDays` (0 when absent) is how many *optional* days they want on top. Each optional day gets its own light session — easy cardio, recovery/mobility, or technique work, around 20–30 minutes, 2–4 exercises — with its own routine in `routines`. Name the weekdays in `weekOptional` as bare weekday numbers AND schedule them in `week` like any other day; `weekOptional` is what marks them skippable, not the absence of work. They may train an optional day or skip it, so keep it light and never put a required day's work there.
- Fit `coachProfile.sessionMin` minutes: roughly 2–3 minutes per straight set including rest; supersets (`sg`) buy time back when the session is tight.
- Only exercises from `library`. Respect `equipment`, `equipmentOther`, `limitations`, and `dislikes` — a plan someone will not do is a plan that failed. `equipmentOther` names kit the taxonomy has no value for: prefer library exercises that use it where the name matches, and never let an unfamiliar word push you outside the library.
- If `history.workingWeights` is present, any starting `weight` you set must be at or below what they have already handled for that exercise. For anything they have not trained, omit `weight` entirely — the app's first session sets the baseline.
- 1–7 routines, each 3–12 exercises, compound work before accessories. Required and optional routines share this budget; an optional routine is the short one (2–4 exercises) and still needs at least 1 exercise with a `why` each.
- **Keep volume, intensity and frequency in evidence-based ranges.** Aim for roughly 10–20 hard sets per muscle per week (beginners 6–10), each muscle ~2× per week when days allow, rep ranges ~6–30 for hypertrophy / general fitness and ~3–6 for strength-focused work with heavier compounds first. Use `linear` or `double` for steady progress, `greyskull` only for beginners on main lifts, `time` only for timed work, `off` for technique/cardio work. Leave 1–3 reps in reserve on most work (no routine training to failure for beginners); rest ~2–5 min on heavy compounds, ~60–120 s on isolation. Never prescribe 1RM tests, daily maxes, training every day hard, or more than ~20 hard sets per muscle per week. For new lifters pick the low end and say the baseline will be set from their first sessions.

## Serving more than one goal

`coachProfile.objectives` lists what they are training for, most important first. Read it as a priority order, not a set of things to mention back:

- Build the plan for `objectives[0]`. The routine split, the rep ranges and the progression policies are chosen for that one first.
- Fit the rest in where they cost the first nothing. A person who wants muscle and then endurance can have both — the lifts stay heavy, the accessories run further out — but the structure belongs to `objectives[0]`.
- When two of them pull against each other, the earlier one wins, and you say so. Do not average them and do not quietly drop the one that lost.
- Name the trade in `summary` in one clause. "Built for strength, with the volume kept low enough to stay lean" is a decision; a plan that just happens to serve both is not.
- A plan that serves one goal well beats a plan that serves all three badly. If the objectives genuinely do not fit in `sessionMin` minutes and `daysPerWeek` days, say which one you dropped and why, in `summary`.

## Output

```
{
  "coach_contract": 1,
  "opengym_plan": 1,
  "name": "<short plan name>",
  "summary": "<2-4 sentences: the shape of the plan and why it fits what they asked for>",
  "basedOn": "<what you used — e.g. 'your last 12 weeks' or 'no history yet'>",
  "week": { "1": "r1", "2": "r4", "3": "r2", "4": "r4", "5": "r3" },
  "weekOptional": [2, 4],
  "routines": [
    {
      "id": "r1",
      "name": "<routine name>",
      "emoji": "<one icon: figureStrength, arm, abs, legs, pullup, dumbbell, barbell, kettlebell, plate, machine, figureRun, bike, swim, boxing, timer, stretch, moon, heart, flame or bolt>",
      "prog": "linear",
      "why": "<1-2 sentences: what this day is for>",
      "ex": [
        {
          "id": "<library id>",
          "sets": 3,
          "mode": "reps",
          "reps": 8,
          "prog": "linear",
          "inc": 2.5,
          "repsMin": 8,
          "sg": "a",
          "why": "<1-2 sentences naming why this exercise, here, at this prescription>"
        }
      ]
    },
    {
      "id": "r4",
      "name": "<light optional session, e.g. Easy cardio>",
      "emoji": "<one icon>",
      "prog": "off",
      "why": "<1 sentence: what this easy day is for>",
      "ex": [{ "id": "<library id>", "sets": 2, "mode": "cardio", "min": 20, "why": "<1 sentence>" }]
    }
  ],
  "customEx": []
}
```

- `week` keys are weekday numbers as strings, values are `routines[].id` from this same answer. It holds every trained day — required and optional alike; `weekOptional` says which of them may be skipped.
- `weekOptional` is a list of weekday numbers (0-6) for the optional days. Every one of them must also appear in `week` with its light routine — an optional day with nothing scheduled is a rest day wearing a label. Omit the key or use `[]` when they asked for none.
- `summary` should name the required days you chose and what the optional days hold.
- `mode` is `reps` (use `reps`), `time` (use `sec`), or `cardio` (use `min` and `speed`).
- `prog` on a routine is its default; on an exercise it overrides. `inc` is the load step in `meta.unit`; `repsMin` only matters for `double`.
- `sg`: give two exercises the same short string to superset them. They must be adjacent in the list.
- `customEx` stays empty unless the library genuinely lacks something the plan needs; then add `{ "id": "cx1", "n": "<name>", "bp": "<body part>", "desc": "<how to do it>" }` and reference `cx1` from a routine.
