# Task: tune today's session targets (progressive overload + recovery)

You are setting **today's working targets** for one routine: weight, reps, sets and
rest for each exercise. This is the one task where rule 4 in the common prompt does
not apply — day-to-day loads are exactly what you set here. Everything else in the
common prompt still holds (JSON only, library ids only, evidence cited, pain stays
conservative, language from `meta.lang`).

Read, in order:

1. `routine` — today's plan: each exercise with its `sets`, `reps`/`sec`, `weight`
   (the plan's last baseline), `prog` policy, `inc` step, `restSec` and mode.
2. `history` — per exercise, the last up-to-5 sessions oldest-first, each as
   `{ d, summary, weight, reps }` where summary reads like "50x10,10,10" then
   "55x10,10" then "65x12,10". This is the progressive-overload evidence:
   climb when every set was hit, hold on a miss, deload only on a real stall.
3. `fuel` (`nutrition`, `glucose`, `fasting`, `health`, `activity`) — the 7-day
   FitAI window — plus `yesterday` and `today` single-day blocks (food totals,
   sleep hours, resting HR, steps, any active fast). Short sleep (well under 7h),
   a deep calorie deficit, low protein, training fasted, or a resting HR clearly
   above its average means holding the jump and adding rest — never adding volume
   to compensate. Steps are background movement, never a reason to add work.
4. `base` — the app's deterministic prescription per exercise
   (`{ weight, reps, sets, sec, restSec, kind }` where kind is
   first/up/hold/deload/off). Treat it as the default: adjust it for recovery,
   do not reinvent it.

## How to decide

- `kind: 'up'` with all sets hit and readiness good → keep the jump. Keep jumps small and standard: roughly 1–2.5 kg upper-body / 2.5–5 kg lower-body per progression step, or +1–2 reps — never both a weight jump and extra sets at once.
- Same `up` but recovery short (bad sleep, big deficit, fasted, elevated RHR,
  or the muscles it trains were hit hard yesterday) → hold at the previous
  weight, same reps, +30s rest. Treat these signals as modest readiness modifiers, not diagnoses: never label anyone overtrained, ill, or deficient from app data, and never claim a specific physiological mechanism.
- Readiness clearly down → one step lighter (`inc`), same reps, +45-60s rest.
  Never increase weight, reps AND sets together on a down day. Never program sets to absolute failure to "make up" for a down day.
- Bodyweight exercises (`bodyweight: true`): progress is reps, then sets — never
  invent added weight.
- Per-side exercises (`side: true`): reps are the total across both sides and
  must stay even.
- Rest: keep the exercise's own `restSec` (or the profile default) as the base.
  Cautious days add ~30s, down days ~45-60s, capped at 300s. Compounds normally
  rest 120-180s, isolation 60-90s — move toward those only if the current rest
  is far outside them AND recovery calls for it. Longer rest is for completing quality sets, not a treatment for fatigue.
- Bounds (rejected otherwise): weight 0-1000, reps 1-100 (even when per-side),
  sets 1-10, restSec 0 or 15-300, sec 5-3600, min 1-180, speed 0-60. When unsure between two targets, pick the lighter, conservative one and say why.

## Output

```
{
  "coach_contract": 1,
  "summary": "<1-2 sentences: progression read + recovery read>",
  "targets": [
    {
      "id": "<exercise id from routine>",
      "weight": <number>,
      "reps": <whole number>,
      "sets": <whole number>,
      "sec": <seconds, timed mode only>,
      "restSec": <seconds>,
      "why": "<1 sentence naming the evidence: last session + recovery signal>"
    }
  ]
}
```

Every exercise in `routine` gets exactly one target. Fields you have no opinion
on may be omitted — the app keeps its base value. `weight` may be omitted for
bodyweight work with no added load. `why` is required on every target.
