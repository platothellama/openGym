// The muscle ledger: what each muscle has actually been asked to do lately, so a training
// system can hold or deload a lift on the muscle's account rather than only the exercise's.
//
// progression.js is per *exercise*. It knows a squat was hit three sessions in a row and nothing
// about the four other things in the plan that also train quads. This is the other half. Per
// canonical muscle it counts the hard sets actually logged, the sessions they appeared in, how
// long ago it was trained, and what the recovery model says about it — then hands progression
// one word: go up, hold, or come back down.
//
// The rule is conservative on purpose, and that is what makes it safe to switch on over a log
// that was built without it:
//
//   at or past the weekly hard-set cap ....... HOLD — no increase, no decrease
//   past a fatigue threshold, or over the cap
//   two weeks running ....................... DELOAD — one step back
//   under the cap, or no cap at all ........... the policy decides, exactly as today
//
// A hard week therefore costs a gain, never your standing. Only accumulated overload takes weight
// off the bar — the same shape as the deload progression.js already runs on one exercise's
// failures, just counted across everything that trains the muscle.
//
// Everything here is pure and derived on every read, exactly like nextPrescription: no stored
// counter to drift, and editing a past set changes today's answer the way it already does.
//
// A hard set is one within HARD_RIR of failure (isHardSet), so a planned-but-easy set does not
// inflate a muscle's week. Counting is per muscle, full weight for every muscle an exercise
// trains — a bench set is one set of chest and one of triceps, which is how set-count landmarks
// are written down.

import { MUSCLES, MUSCLE_NAME, musclesOf } from './muscles.js'
import { EXIDX } from './exercises.js'
import { isHardSet } from './effort.js'
import { fatigueOf, strengthOf } from './recovery.js'
import { isWarmupRow } from './workout-model.js'
import { isoOf, weekKey, weekStartOf } from './format.js'
import { systemOf, muscleTargetFor } from './training-systems.js'

/** Fatigue at or past which an over-cap muscle comes back down rather than holding. */
export const OVER_FATIGUE = 0.6

/** Consecutive over-cap weeks that turn a hold into a deload. */
export const SUSTAINED_WEEKS = 2

/** Weeks of history read. Two is all a hold/deload rule needs; the rest is for the chart. */
export const LEDGER_WEEKS = 8

const DAY_MS = 86400000

const KNOWN = Object.fromEntries(MUSCLES.map(slug => [slug, true]))

/**
 * The exercise a logged entry or a routine cfg trains.
 *
 * A finished workout stores only the id; the muscle metadata lives in the catalogue, the same way
 * recovery.js's exerciseFor resolves it. A cfg may carry a snapshot (a renamed or retagged exercise
 * keeps the muscles it was actually done for), and a test may pass the exercise inline — so the
 * inline object wins when there is one and the id fills in when there is not.
 */
function exerciseOf(thing) {
  if (!thing) return thing
  return thing.exercise || EXIDX[thing.id] || thing
}

/** One counter per week of the ledger horizon, oldest first. */
const emptyWeekCounts = () => new Array(LEDGER_WEEKS).fill(0)

/** The local calendar date of a timestamp, at noon so DST cannot move it. */
const localISO = ms => isoOf(new Date(ms))

/** A local calendar date shifted by whole days. */
function isoShift(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

/**
 * When a workout happened, in ms, or null when the log has no usable date.
 *
 * A session filed under a past date is counted in that week, not in the week it was typed: a
 * backfilled session was a session, and a ledger that moved it would punish correcting a typo.
 */
function workoutAt(w) {
  if (w?.d) {
    const parsed = Date.parse(w.d + 'T12:00:00')
    if (Number.isFinite(parsed)) return parsed
  }
  if (Number.isFinite(Number(w?.start))) return Number(w.start)
  return null
}

/**
 * The ledger for a profile at `now`.
 *
 * Per muscle: this week's hard sets, the same split for each of the last `LEDGER_WEEKS` weeks
 * (oldest first, so "two weeks running" is the last two entries), sessions this week, days since
 * it was last trained, recovery-model fatigue, retained strength, the system's weekly target, and
 * a derived `state`:
 *
 *   'fresh'    no target and nothing logged — nothing to gate on
 *   'under'    below the cap; the policy is free to progress
 *   'near'     within one set of the cap — progress, but the reason says so
 *   'over'     at or past the cap — hold
 *   'fatigued' no cap (no system on) but the recovery model says rest
 *
 * A profile with no system still gets a ledger, because Settings and Stats show the same numbers
 * either way; `target` is null throughout.
 *
 * @param {object} st     the profile (`workouts`, `weekStart`, `trainSystem`)
 * @param {number} [now]  injected, so the ledger is deterministic under test
 * @param {object} [opts] `{ workouts, preset, bodyWeightKg, unit }` to narrow what it reads
 */
export function muscleLedger(st, now = Date.now(), opts = {}) {
  const current = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const ws = weekStartOf(st)
  const workouts = opts.workouts || st?.workouts || []
  const preset = opts.preset !== undefined ? opts.preset : systemOf(st)

  // The current week comes off `current`, not off the wall clock: a caller that injects `now` (a
  // test, or a rebuild of a past week) must get the weeks *around that moment*, and reading
  // todayISO() here would anchor the horizon to the real today and drop every week between.
  const today = localISO(current)

  // Oldest first, so the newest week — the one a cap is judged against — is the last entry.
  // (Stepping back from today would give newest-first; index from the far end instead.)
  const weeks = Array.from({ length: LEDGER_WEEKS }, (_, i) => weekKey(isoShift(today, -(LEDGER_WEEKS - 1 - i) * 7), ws))
  const weekAt = new Map(weeks.map((k, i) => [k, i]))
  const newest = weeks.length - 1

  const perMuscle = Object.fromEntries(MUSCLES.map(slug => [slug, {
    hardSets: emptyWeekCounts(),
    lastAt: -Infinity
  }]))
  // Sessions this week per muscle, counted once per workout that trained it.
  const sessionCount = Object.fromEntries(MUSCLES.map(slug => [slug, 0]))

  const horizon = current - LEDGER_WEEKS * 7 * DAY_MS
  for (const w of workouts || []) {
    const at = workoutAt(w)
    if (at == null || at < horizon || at > current) continue
    const wi = weekAt.get(w.d ? weekKey(w.d, ws) : null)
    if (wi == null) continue

    // A set is one session per muscle for this workout, however many entries trained it: a
    // superset of two chest exercises is one chest session, not two.
    const touched = new Set()
    for (const entry of w.entries || []) {
      if (!entry) continue
      const doneSets = (entry.sets || []).filter(s => s && s.done && !isWarmupRow(s))
      if (!doneSets.length) continue
      const hard = doneSets.filter(isHardSet).length
      const weights = musclesOf(exerciseOf(entry))
      for (const slug of Object.keys(weights)) {
        if (!KNOWN[slug]) continue
        const cell = perMuscle[slug]
        if (at > cell.lastAt) cell.lastAt = at
        cell.hardSets[wi] += hard
        touched.add(slug)
      }
    }
    if (wi === newest) for (const slug of touched) sessionCount[slug]++
  }

  const stamp = opts.bodyWeightKg ?? opts.bodyweightKg ?? null
  const recoveryOpts = { bodyweightKg: stamp, unit: opts.unit || st?.unit }
  const fatigue = fatigueOf(workouts, current, recoveryOpts)
  const strength = strengthOf(workouts, current, recoveryOpts)

  const muscles = {}
  for (const slug of MUSCLES) {
    const cell = perMuscle[slug]
    const target = muscleTargetFor(preset, slug)
    const weekHard = cell.hardSets[newest]
    const fatigueNow = fatigue[slug] ?? 0

    // Consecutive over-cap weeks ending with the current one.
    let overWeeks = 0
    if (target != null) {
      while (overWeeks < weeks.length && cell.hardSets[newest - overWeeks] >= target) overWeeks++
    }

    let state
    if (target == null) {
      state = fatigueNow > OVER_FATIGUE ? 'fatigued' : weekHard > 0 ? 'under' : 'fresh'
    } else if (weekHard >= target) state = 'over'
    else if (weekHard >= target - 1) state = 'near'
    else state = 'under'

    muscles[slug] = {
      slug,
      name: MUSCLE_NAME[slug],
      target,
      weekHard,
      hardSets: cell.hardSets,
      overWeeks,
      sessionsWeek: sessionCount[slug],
      daysSince: Number.isFinite(cell.lastAt) ? Math.floor((current - cell.lastAt) / DAY_MS) : null,
      fatigue: fatigueNow,
      strength: strength[slug] ?? 1,
      state
    }
  }

  return { systemId: preset?.id || null, on: !!preset, weeks, thisWeek: weeks[newest], muscles, order: MUSCLES }
}

/**
 * What the ledger says about one exercise, and why.
 *
 * Reads every muscle the exercise trains, ordered by how much of it the exercise owns. The
 * heaviest share decides. A secondary muscle can escalate progress → hold (triceps being tired
 * is a real reason to leave the bench press alone) but never deload on its own, because a bench
 * press does not stop working because triceps are tired.
 *
 * @param {object} ledger  muscleLedger(st, now)
 * @param {object} ex      the exercise, or an entry carrying one
 * @param {object} [opts]  `{ autoSets }` — let the ledger add or drop a set (opt-in)
 * @returns {{ action: 'progress'|'hold'|'deload', muscles: string[], setDelta: -1|0|1, why: ?string[] }}
 *          `why` is null when the ledger had no opinion (action 'progress'), in which case the
 *          progression policy's own reason stands. Otherwise it is ONE `[template, ...args]` tuple —
 *          the shape progression.js emits and Workout.jsx feeds to `t(...why)` in a single line —
 *          naming the one muscle that decided the verdict.
 */
export function muscleVerdict(ledger, ex, opts = {}) {
  const weights = musclesOf(exerciseOf(ex))
  const rows = Object.keys(weights)
    .filter(slug => KNOWN[slug] && ledger?.muscles?.[slug])
    .sort((a, b) => weights[b] - weights[a])
    .map(slug => ({ slug, row: ledger.muscles[slug] }))

  const lead = rows[0]
  if (!lead) return { action: 'progress', muscles: [], setDelta: 0, why: null }

  let action = ledgerActionOf(lead.row)
  const named = action === 'progress' ? [] : [lead.row]
  for (const other of rows.slice(1)) {
    if (action !== 'progress') break
    if (ledgerActionOf(other.row) === 'hold') {
      action = 'hold'
      named.push(other.row)
    }
  }

  // Set steering, opt-in and deliberately timid: one set, and only when the gap is real. Adding a
  // set to a muscle already near its cap is the exact mistake this feature exists to prevent, so
  // the 'near' state gets nothing.
  let setDelta = 0
  if (opts.autoSets) {
    const { weekHard, target } = lead.row
    if (action === 'progress' && target != null && weekHard <= target - 2) setDelta = 1
    else if (action !== 'progress' && target != null && weekHard > target + 2) setDelta = -1
  }

  // One [template, ...args] tuple — the shape progression.js emits and Workout.jsx feeds to
  // `t(...why)` in a single line. At most one muscle ever names the reason: the lead decides, and a
  // secondary can only escalate a still-progressing verdict, so there is never a second one to add.
  const row = named[0] || lead.row

  return { action, muscles: named.map(r => r.slug), setDelta, why: ledgerWhy(row) }
}

/**
 * The one word the ledger hands back for a single muscle: go up, hold, or come back down.
 *
 * Split out of muscleVerdict so the Stats panel can answer the same question about one muscle
 * without pretending an exercise owns it — the two read the same rule, so they cannot disagree.
 */
export function ledgerActionOf(row) {
  if (!row) return 'progress'
  const { weekHard, target, overWeeks, fatigue } = row
  if (overWeeks >= SUSTAINED_WEEKS) return 'deload'
  if (target != null && weekHard > target && fatigue > OVER_FATIGUE) return 'deload'
  if (target != null && weekHard >= target) return 'hold'
  if (target == null && fatigue > OVER_FATIGUE) return 'hold'
  return 'progress'
}

/**
 * The reason for a muscle that was not allowed to progress, as ONE `[template, ...args]` tuple —
 * null when it was, in which case the policy's own reason stands on its own.
 *
 * Wording it in one place is the point: the workout card says this sentence when it holds a weight,
 * and the Stats panel says it again when it explains the week, so a hold can never be explained two
 * different ways.
 */
export function ledgerWhy(row) {
  const action = ledgerActionOf(row)
  if (action === 'progress' || !row) return null
  const who = row.name || MUSCLE_NAME[row.slug] || row.slug
  if (row.overWeeks >= SUSTAINED_WEEKS) {
    return ['{0} has been over its weekly target for {1} weeks running - back off a step.', who, row.overWeeks]
  }
  if (action === 'deload') {
    return ['{0} is over its weekly target ({1} hard sets vs {2}) and has not recovered - back off a step.',
      who, row.weekHard, row.target ?? 0]
  }
  if (row.target != null) return ['{0} is at its weekly target of {1} hard sets - holding.', who, row.target]
  return ['{0} has not recovered - holding.', who]
}

/**
 * The ledger flattened for a screen that walks the body: every muscle with its numbers, plus the
 * one-line summary a card puts above the list.
 *
 * `headline` is 'over' / 'near' / 'under' when a system is running, and 'fatigued' / 'fresh' when
 * there is no cap to judge against.
 */
export function ledgerSummary(st, now = Date.now(), opts = {}) {
  const ledger = muscleLedger(st, now, opts)
  const rows = ledger.order.map(slug => ledger.muscles[slug])
  const pick = key => rows.filter(r => r.state === key).map(r => r.slug)
  const headline = ledger.on
    ? (pick('over').length ? 'over' : pick('near').length ? 'near' : 'under')
    : (pick('fatigued').length ? 'fatigued' : 'fresh')
  return {
    systemId: ledger.systemId,
    on: ledger.on,
    thisWeek: ledger.thisWeek,
    weeks: ledger.weeks,
    rows,
    over: pick('over'),
    near: pick('near'),
    fatigued: pick('fatigued'),
    headline
  }
}
