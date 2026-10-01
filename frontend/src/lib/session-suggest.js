// Smart session targets: progressive overload fused with recovery.
//
// The progression engine (progression.js) already derives the next weight/reps from
// history. This module answers the next question — "and how recovered am I today?" —
// by folding FitAI fuel + sleep + activity (yesterday + today) and muscle fatigue
// into a readiness score, then nudging that prescription before the session is built.
//
// Everything here is pure: history in, targets out, no store, no fetch. The LLM Coach
// session job (api/coach) produces the same shape remotely; this local engine is the
// offline fallback and the validator of what the model may say. Anything that decides
// what you lift next lives here with a unit test beside it (CONTRIBUTING.md).

import { isWarmupRow, isSideSet, syncSideAggregate } from './workout-model.js'
import { modeOf, isPerSide } from './history.js'
import { fuelReadiness, fuelLineOf } from './coach-insights.js'

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Last `n` counting sessions for one exercise, oldest first.
 * Each item is `{ d, summary, weight, reps }` where summary reads the way a
 * lifter would say it — e.g. "50×10,10,8" — so it can go straight into an LLM
 * payload or a "why this number" line.
 */
export function exerciseHistory(S, exId, n = 5) {
  const out = []
  const limit = Math.max(1, Math.min(10, Math.round(n) || 5))
  for (const w of S?.workouts || []) {
    const entry = (w.entries || []).find(e => e && e.id === exId)
    if (!entry) continue
    const sets = (entry.sets || []).filter(s => !isWarmupRow(s) && s.done)
    if (!sets.length) continue
    const reps = sets.map(s => Math.round(Number(s.r) || 0))
    const weights = sets.map(s => Number(s.w) || 0)
    const weight = Math.max(0, ...weights)
    const summary = `${weight}×${reps.join(',')}`
    out.push({ d: w.d || null, summary, weight, reps })
  }
  return out.slice(-limit)
}

/**
 * Readiness from FitAI fuel + recovery.
 *
 * `summary` is api/fitai.js summaryFor (cleaned or raw — both read by shape);
 * `yesterday` / `today` are api/fitai.js dayFor results (or null when unlinked).
 * Returns `{ score 0..100, level: 'ready'|'cautious'|'down', reasons: [] }`.
 */
export function readinessOf({ summary = null, yesterday = null, today = null } = {}) {
  let score = 100
  const reasons = []
  const nut = summary?.nutrition || {}
  const targets = summary?.targets || {}
  const act = summary?.activity || {}

  const penalize = (pts, reason) => {
    score -= pts
    if (reason) reasons.push(reason)
  }

  // Sleep: tonight/today matters most, the weekly average backs it up.
  const sleepToday = num(today?.activity?.sleepH)
  const sleepAvg = num(act.sleepAvgH)
  if (sleepToday != null) {
    if (sleepToday < 5) penalize(25, `only ${sleepToday}h sleep`)
    else if (sleepToday < 6) penalize(15, `${sleepToday}h sleep — short night`)
    else if (sleepToday < 7) penalize(5, `${sleepToday}h sleep`)
  } else if (sleepAvg != null && sleepAvg < 6) {
    penalize(10, `averaging ${sleepAvg}h sleep`)
  } else if (sleepAvg != null && sleepAvg < 7) {
    penalize(5, `averaging ${sleepAvg}h sleep`)
  }

  // Fuel: weekly deficit + protein gap. A stall in a deep deficit is
  // under-fuelling, not under-training (coach review prompt, same rule).
  const deficit = num(nut.deficitVsTarget)
  if (deficit != null) {
    if (deficit >= 500) penalize(15, `${Math.round(deficit)} kcal under target this week`)
    else if (deficit >= 300) penalize(10, `${Math.round(deficit)} kcal under target`)
  }
  const proteinGap = num(nut.proteinVsTarget)
  if (proteinGap != null) {
    if (proteinGap >= 30) penalize(10, `${Math.round(proteinGap)}g short of protein target`)
    else if (proteinGap >= 15) penalize(5, `${Math.round(proteinGap)}g short of protein`)
  }

  // Today so far: an empty day is not a deficit — only read it when food is logged.
  const todayKcal = num(today?.totals?.kcal)
  const todayMeals = Array.isArray(today?.meals) ? today.meals.length : null
  if (todayKcal != null && (todayMeals == null || todayMeals > 0) && todayKcal < 800) {
    const target = num(targets.calories)
    if (target == null || target > 1500) penalize(8, 'very little eaten today so far')
  }

  // Fasting: a heavy day deep inside a fast feels harder — schedule note, small penalty.
  const fast = today?.fasting || yesterday?.fasting || summary?.fasting?.active
  const fastMin = num(fast?.elapsedMin)
  if (fast && (fast.status === 'active' || fastMin != null)) {
    if (fastMin == null || fastMin >= 12 * 60) penalize(10, 'training fasted')
    else if (fastMin >= 6 * 60) penalize(5, 'training mid-fast')
  }

  // Resting HR: today clearly above its own weekly average = incomplete recovery.
  const rhrToday = num(today?.activity?.restingHr)
  const rhrAvg = num(act.restingHrAvg)
  if (rhrToday != null && rhrAvg != null && rhrAvg > 0) {
    const d = rhrToday - rhrAvg
    if (d >= 7) penalize(12, `resting HR ${Math.round(rhrToday)} (+${Math.round(d)})`)
    else if (d >= 5) penalize(7, `resting HR a little high (+${Math.round(d)})`)
  }

  // Steps are background movement, never training (review prompt). Only an extreme
  // day — e.g. 25k steps before legs — earns a small note.
  const stepsY = num(yesterday?.activity?.steps)
  if (stepsY != null && stepsY >= 25000) penalize(5, `${Math.round(stepsY / 1000)}k steps yesterday`)

  score = Math.max(0, Math.min(100, Math.round(score)))
  const level = score >= 80 ? 'ready' : score >= 55 ? 'cautious' : 'down'
  return { score, level, reasons }
}

// Default rest when neither the exercise nor the profile names one.
export const DEFAULT_REST_SEC = 90
export const restBaseOf = (cfg, S) =>
  num(cfg?.restSec) > 0 ? Math.round(cfg.restSec) : (num(S?.restSec) > 0 ? Math.round(S.restSec) : DEFAULT_REST_SEC)

/**
 * Nudge a progression prescription by readiness.
 *
 * `base` is `{ weight?, reps?, sets?, sec?, restSec?, kind?, prevWeight? }` —
 * typically the output of nextPrescription() plus restBaseOf(). `kind` is the
 * progression verdict ('first'|'up'|'hold'|'deload'|'off'): a cautious day holds
 * an 'up' at its previous weight instead of jumping, a down day backs off one
 * step. Rest grows when recovery is short (+30s cautious, +45-60s down,
 * capped at 300s). Never invents a jump the engine did not earn.
 */
export function adjustPrescription(base = {}, readiness = { score: 100, level: 'ready', reasons: [] }, opts = {}) {
  const mode = opts.mode || 'reps'
  const inc = num(opts.inc) > 0 ? Number(opts.inc) : 2.5
  const perSide = !!opts.perSide
  const level = readiness?.level || 'ready'
  const out = { ...base }
  const notes = []

  const snapDown = w => {
    if (!(w > 0) || !(inc > 0)) return Math.max(0, w || 0)
    return Math.round((Math.round(w / inc) * inc) * 10) / 10
  }

  if (mode === 'reps' && level !== 'ready' && out.kind === 'up' && out.weight != null) {
    const prev = num(out.prevWeight)
    const held = prev != null && prev >= 0 ? prev : snapDown(Number(out.weight) - inc)
    out.weight = Math.max(0, held)
    out.kind = 'hold'
    notes.push(level === 'down' ? 'recovery is short — holding last time\u2019s weight' : 'not fully recovered — holding last time\u2019s weight')
  } else if (mode === 'reps' && level === 'down' && out.kind !== 'deload' && out.kind !== 'first' && out.weight != null && Number(out.weight) > 0) {
    out.weight = Math.max(0, snapDown(Number(out.weight) - inc))
    out.kind = 'hold'
    notes.push('low readiness — one step lighter today')
  }

  // Reps stay inside the plan: per-side totals are always even.
  if (out.reps != null && perSide) {
    const r = Math.round(Number(out.reps))
    if (r % 2) out.reps = Math.max(2, r + 1)
  }

  const baseRest = num(out.restSec) > 0 ? Math.round(out.restSec) : null
  if (baseRest != null) {
    if (level === 'cautious') out.restSec = Math.min(300, baseRest + 30)
    else if (level === 'down') out.restSec = Math.min(300, baseRest + 60)
    if (out.restSec !== baseRest) notes.push(`rest ${baseRest}s → ${out.restSec}s for recovery`)
  }

  const reasons = [...(readiness?.reasons || []), ...notes]
  return { ...out, readiness: readiness?.level || 'ready', score: readiness?.score ?? 100, why: reasons }
}

/**
 * How recovered today is, as the levels adjustPrescription speaks, read off the same
 * signal the Home fuel card shows (coach-insights.fuelReadiness): a calorie/protein
 * deficit or an active fast is a short-recovery day. Nothing logged, or a fueled week,
 * is a normal day and moves nothing. The reason rides along as the raw line rather than
 * as a sentence — lib/ stays free of i18n and the view words it with fuelLineText(),
 * which is the line the fuel card already showed.
 */
export function readinessLevelOf(summary) {
  const { state } = fuelReadiness(summary || null)
  return {
    state,
    level: state === 'low' ? 'down' : state === 'fasted' ? 'cautious' : 'ready',
    score: state === 'low' ? 55 : state === 'fasted' ? 70 : 100,
    line: fuelLineOf(summary || null),
  }
}

/**
 * The suggested targets for a whole session, keyed by exercise id — the input
 * shape `applySessionTargets` takes.
 *
 * This is the readiness overlay and nothing else. The training system and its muscle
 * ledger are already inside each entry by the time it gets here: session-start.js
 * (buildPlannedEntry) is where the gate, the system's rest and the ±1 set count are
 * decided, so re-deciding them at this point would apply the ledger twice.
 *
 * Off — the default, and what a profile written before the setting existed reads as —
 * it returns {} and the session stands exactly as progression built it.
 *
 * Pure, and derived on read like everything else in lib/ — `opts.summary` is the
 * FitAI summary read for this moment, so a session started later is judged by the day
 * it is started.
 */
export function suggestTargets(entries, S = {}, opts = {}) {
  const out = {}
  if (S?.readinessAuto !== true) return out
  const r = opts.readiness || readinessLevelOf(opts.summary)
  if (!r || r.level === 'ready') return out

  for (const entry of entries || []) {
    const id = entry?.id
    if (!id) continue
    const plan = entry.plan || {}
    const target = entry.target || {}
    // Only the numbers adjustPrescription reads: `kind` is what tells it whether
    // progression earned a jump that a short day should not spend.
    const nudged = adjustPrescription(
      {
        kind: plan.kind,
        weight: target.weight,
        reps: target.reps,
        sec: target.sec,
        sets: target.sets,
        restSec: target.restSec,
      },
      { score: r.score, level: r.level, reasons: [] },
      { mode: modeOf(target), inc: num(target.inc) > 0 ? Number(target.inc) : null, perSide: isPerSide(target) },
    )
    const t = {}
    for (const key of ['weight', 'reps', 'sec', 'restSec']) {
      if (nudged[key] != null && nudged[key] !== target[key]) t[key] = nudged[key]
    }
    // Never propagate the built-in rest when the session already has the system's rest;
    // that would flag it as "changed" and create a reason where none is needed.
    if (t.restSec != null && target.restSec != null && t.restSec === target.restSec) delete t.restSec
    // A day that moved no number has nothing to explain — the card keeps its own reason.
    if (!Object.keys(t).length) continue
    out[id] = {
      ...t,
      readiness: r.level,
      score: r.score,
      ...(r.line ? { line: r.line } : {}),
    }
  }
  return out
}

/**
 * Auto-fill freshly built session entries with smart targets.
 * Only undone work rows are touched; logged sets, warm-ups and side-set
 * symmetry are preserved. `targets` is keyed by exercise id:
 * `{ [exId]: { weight?, reps?, sets?, sec?, restSec?, why?, readiness?, score?, muscles?, line? } }`
 * where `line` is a raw coach-insights fuel line the view words with fuelLineText.
 */
export function applySessionTargets(entries, targets = {}) {
  return (entries || []).map(entry => {
    const t = targets[entry?.id]
    if (!t) return entry
    const next = { ...entry }
    const target = { ...(entry.target || {}) }
    if (t.weight != null) target.weight = t.weight
    if (t.reps != null) target.reps = t.reps
    if (t.sec != null) target.sec = t.sec
    if (t.restSec != null) target.restSec = t.restSec
    if (t.sets != null) target.sets = t.sets
    next.target = target

    let sets = (entry.sets || []).map(s => {
      // A logged row is what happened and a warm-up is the ramp the planner built for the weight
      // this target is about to change. Rewriting either would be a lie: a logged set is history,
      // and a warm-up written at the new working weight is no longer lighter than the set it
      // warms up for, which is the one thing a warm-up has to be.
      if (s.done || isWarmupRow(s)) return s
      if (isSideSet(s)) {
        if (t.weight == null && t.reps == null) return s
        const sides = Object.fromEntries(['L', 'R'].map(side => {
          const row = s.sides[side]
          if (row.done) return [side, row]
          return [side, {
            ...row,
            ...(t.weight != null ? { w: t.weight } : {}),
            ...(t.reps != null ? { r: Math.round(Number(t.reps) / 2) } : {}),
          }]
        }))
        return syncSideAggregate({ ...s, sides })
      }
      const o = { ...s }
      if (t.weight != null) o.w = t.weight
      if (t.reps != null) o.r = t.reps
      if (t.sec != null) o.sec = t.sec
      return o
    })

    // Grow (never shrink a session in progress) to the suggested set count.
    const want = Math.max(1, Math.round(Number(t.sets)) || 0)
    if (want > 0) {
      const work = sets.filter(s => !isWarmupRow(s))
      if (work.length && work.length < want) {
        const seed = work[work.length - 1]
        while (sets.filter(s => !isWarmupRow(s)).length < want) {
          sets.push(isSideSet(seed) ? { ...syncSideAggregate(seed), sides: { L: { ...seed.sides.L, done: false }, R: { ...seed.sides.R, done: false } }, done: false } : { ...seed, done: false })
        }
      }
    }
    next.sets = sets
    if (t.why || t.readiness || t.muscles || t.line) {
      next.suggestion = {
        ...(t.why ? { why: t.why } : {}),
        ...(t.readiness ? { readiness: t.readiness } : {}),
        ...(t.score != null ? { score: t.score } : {}),
        ...(t.muscles?.length ? { muscles: t.muscles } : {}),
        ...(t.line ? { line: t.line } : {}),
      }
    }
    return next
  })
}
