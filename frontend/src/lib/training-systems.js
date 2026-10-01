// Training systems: a named bundle of the progression settings a program is actually made of.
//
// The engine has always had policies (progression.js: linear, Greyskull, double, time). What it
// never had was a way to say "run linear progression, but with a 3-5 rep band, five minutes of
// rest on the big lifts and ten hard sets a week per muscle" as one choice. That is what a system
// is here: a preset that fills in policy, load step, deload cadence, rep band, rest defaults and
// a weekly volume target per muscle, and leaves every one of them overridable.
//
// Two things this deliberately does NOT do:
//
//   · It adds no progression maths. Every system resolves to one of the existing POLICIES, so
//     the audited engine in progression.js is still the only thing that decides a weight.
//   · It writes nothing into a routine to apply itself. A system is a *layer* read underneath
//     cfg.prog and routine.prog (see policyFor), so switching back is instant and reversible and
//     an imported or shared routine keeps the progression it arrived with. Putting a system on a
//     routine anyway is a separate, explicit act — applySystemToRoutine() below, which nothing
//     calls on its own.
//
// Everything is a pure function of the profile, and the default (`'off'`) resolves to null: a
// profile that has never chosen one behaves exactly as it did before this file existed.

import { POLICIES, POLICY_NAME, POLICIES_FOR, DELOAD_AFTER, DELOAD_FACTOR, isHeavyLift } from './progression.js'
import { EXIDX } from './exercises.js'

/**
 * How big a muscle is, in the only sense that matters for a weekly set count: how much work it
 * can take before volume stops being productive. The 18 drawable slugs split three ways, and
 * this is the one place that split is written down. Unlisted slugs count as 'medium'.
 */
export const MUSCLE_VOLUME_CLASS = {
  // Big: the trunk and legs. Can absorb a lot, recovers slowly.
  quadriceps: 'large', hamstring: 'large', gluteal: 'large',
  chest: 'large', 'upper-back': 'large',
  // Medium: everything that works at a believable size.
  deltoids: 'medium', biceps: 'medium', triceps: 'medium', abs: 'medium',
  obliques: 'medium', 'lower-back': 'medium', latissimus: 'medium', serratus: 'medium',
  adductors: 'medium', 'hip-flexors': 'medium',
  // Small: arms and lower legs. Grow on reps and frequency, not weekly tonnage.
  forearm: 'small', trapezius: 'small', calves: 'small', tibialis: 'small'
}

export const volumeClassOf = slug => MUSCLE_VOLUME_CLASS[slug] || 'medium'

// The step a preset asks for. Only the light number is written here: a heavy lower-body lift takes
// the double of whatever the light lift takes, which is exactly the relationship
// defaultIncrement encodes (5 kg vs 2.5, 10 lb vs 5), so a preset scales with it instead of
// naming four numbers that could drift apart from the engine's own pair.
const INC = { kg: 2.5, lb: 5 }
const HEAVY_MULT = 2

export const SYSTEM_IDS = ['off', 'linear', 'greyskull', 'double', 'hypertrophy', 'strength']

/**
 * Each system, in full. The first four are the existing policies with the surrounding program
 * filled in; the last two are composites that ride on 'double' and 'linear' but aim at a
 * different goal, which is the whole difference a training program makes.
 *
 *   policy        which of progression.js's policies drives the load (reps mode)
 *   timePolicy    ...and for timed holds, or null to leave 'off' alone
 *   inc           the load step, and its heavy-body-part variant
 *   deloadAt      sessions of failure before a deload (defaults to the policy's own)
 *   deloadFactor  the Epley target a deload aims at, or null for the policy's 0.9
 *   repBand       [min, max] the system programs toward, or null for "whatever the plan says"
 *   restCompound  default seconds between sets on a big multi-joint lift
 *   restIsolation default seconds between sets on everything else
 *   weeklyHardSets  hard sets per week per muscle, by volume class
 */
export const SYSTEMS = {
  off: {
    id: 'off',
    name: 'No training system',
    desc: 'Progression works exactly as it always has: each routine and each exercise keeps the rule it was given.',
    policy: null,
    timePolicy: null,
    inc: null,
    deloadAt: null,
    deloadFactor: null,
    repBand: null,
    restCompound: null,
    restIsolation: null,
    weeklyHardSets: null
  },

  linear: {
    id: 'linear',
    name: 'Linear progression',
    desc: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
    policy: 'linear',
    timePolicy: null,
    inc: INC,
    deloadAt: DELOAD_AFTER.linear,
    deloadFactor: DELOAD_FACTOR,
    repBand: null,
    restCompound: 120,
    restIsolation: 75,
    weeklyHardSets: { small: 6, medium: 10, large: 14 }
  },

  greyskull: {
    id: 'greyskull',
    name: 'Greyskull LP',
    desc: 'Two straight sets plus a final set to failure. Beat the target on that set and the weight goes up, double if you double the reps.',
    policy: 'greyskull',
    timePolicy: null,
    inc: INC,
    deloadAt: DELOAD_AFTER.greyskull,
    deloadFactor: DELOAD_FACTOR,
    repBand: null,
    restCompound: 150,
    restIsolation: 90,
    weeklyHardSets: { small: 6, medium: 10, large: 14 }
  },

  double: {
    id: 'double',
    name: 'Double progression',
    desc: 'Work up through a rep range at the same weight. Top of the range in every set and the weight goes up, reps back to the bottom.',
    policy: 'double',
    timePolicy: null,
    inc: INC,
    deloadAt: DELOAD_AFTER.double,
    deloadFactor: DELOAD_FACTOR,
    repBand: [8, 12],
    restCompound: 105,
    restIsolation: 60,
    weeklyHardSets: { small: 8, medium: 12, large: 16 }
  },

  // Same engine as double, a different program: more reps, more weekly volume, same short rest.
  // The volume target is what makes it distinct, and it is what the muscle ledger steers toward.
  hypertrophy: {
    id: 'hypertrophy',
    name: 'Hypertrophy',
    desc: 'Double progression in a 10-15 rep band, higher weekly volume per muscle and short rests. Progresses when the top of the band is hit in every set.',
    policy: 'double',
    timePolicy: null,
    inc: INC,
    deloadAt: 2,
    deloadFactor: DELOAD_FACTOR,
    repBand: [10, 15],
    restCompound: 90,
    restIsolation: 60,
    weeklyHardSets: { small: 10, medium: 16, large: 22 }
  },

  // Low reps, long rest, fewer weekly sets per muscle. The volume target is deliberately low so
  // the ledger holds a strength run back instead of pushing volume at it.
  strength: {
    id: 'strength',
    name: 'Strength',
    desc: 'Low-rep work at a big step, three minutes of rest on the main lifts and few weekly sets per muscle. Deloads only after four failed sessions.',
    policy: 'linear',
    timePolicy: null,
    inc: INC,
    deloadAt: 4,
    deloadFactor: 0.85,
    repBand: [3, 5],
    restCompound: 180,
    restIsolation: 90,
    weeklyHardSets: { small: 4, medium: 6, large: 10 }
  }
}

/** The ids, in the order the picker lists them, with 'off' first and 'off' the default. */
export const SYSTEM_LIST = SYSTEM_IDS

export const SYSTEM_NAME = Object.fromEntries(SYSTEM_IDS.map(id => [id, SYSTEMS[id].name]))
export const SYSTEM_DESC = Object.fromEntries(SYSTEM_IDS.map(id => [id, SYSTEMS[id].desc]))

/** Every system but 'off' names a real policy; 'off' names none and is resolved away. */
const REAL_POLICY_IDS = SYSTEM_IDS.filter(id => id !== 'off' && POLICIES.includes(SYSTEMS[id].policy))

/**
 * The system a profile is running, or null when there is none.
 *
 * null is the answer for anything that is not a known id, which is what makes this safe against
 * a hand-edited profile, an older state file and a shared plan bundle alike: no system means the
 * engine runs exactly the code it ran before. `st` may be the whole profile or just its setting.
 */
export function systemOf(st) {
  const id = typeof st === 'string' ? st : st?.trainSystem
  if (id !== 'linear' && id !== 'greyskull' && id !== 'double' && id !== 'hypertrophy' && id !== 'strength') return null
  return SYSTEMS[id]
}

export const systemIdOf = st => systemOf(st)?.id || null

/** Whether progression should consult the muscle ledger at all. Off means untouched. */
export const isSystemOn = st => !!systemOf(st)

/**
 * The policy a system drives in a given mode, or null for "leave this mode alone".
 *
 * A mode the policy cannot drive returns null rather than 'off': 'off' would be a decision, and
 * a system must not switch timed work or cardio off just because it has an opinion about reps.
 */
export function policyOf(preset, mode) {
  if (!preset) return null
  const allowed = POLICIES_FOR[mode] || ['off']
  const pick = mode === 'time' ? preset.timePolicy : preset.policy
  return pick && allowed.includes(pick) ? pick : null
}

/**
 * The load step a system asks for, or the value the exercise already has.
 *
 * An exercise's own `cfg.inc` always wins: the per-exercise override is the more specific
 * statement, and a 1.25 kg plate does not become 2.5 because a system was chosen. `unit` is the
 * profile's unit, and a heavy body part takes the double of the light step, which is the same
 * ratio defaultIncrement uses.
 */
export function presetInc(cfg, preset, unit) {
  const own = Number(cfg?.inc)
  if (Number.isFinite(own) && own > 0) return own
  if (!preset?.inc) return null
  const step = preset.inc[unit === 'lb' ? 'lb' : 'kg']
  return isHeavyLift(cfg?.id) ? step * HEAVY_MULT : step
}

/**
 * Weekly hard sets a system aims for on one muscle, or null when it has no volume opinion
 * (which is 'off', and any preset that left weeklyHardSets unset).
 */
export function muscleTargetFor(preset, slug) {
  const table = preset?.weeklyHardSets
  if (!table) return null
  const n = Number(table[volumeClassOf(slug)])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The rep band a system programs toward, as [min, max], or null.
 *
 * This is a *suggestion*, never a rewrite: it reaches an exercise only through suggestTargets,
 * which never touches a plan the user has already given a range of its own.
 */
export function repBandFor(preset) {
  const band = preset?.repBand
  if (!Array.isArray(band) || band.length !== 2) return null
  const min = Math.round(Number(band[0]))
  const max = Math.round(Number(band[1]))
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max <= min) return null
  return [min, max]
}

// The body parts whose lifts are the big multi-joint ones a program gives three minutes over.
// The first five are progression.js's HEAVY_BP verbatim (isHeavyLift agrees with all of them);
// chest and shoulders join them because a barbell bench and a press are the other two places a
// strength program asks for real rest, and a bicep curl or a lateral raise is not.
const COMPOUND_BP = new Set(['upper legs', 'lower legs', 'back', 'hips', 'glutes', 'chest', 'shoulders'])

/** Whether an exercise is one of the big multi-joint lifts, for a preset's rest split. */
export const isCompoundLift = exId => {
  const ex = EXIDX[exId]
  return !!(ex && COMPOUND_BP.has(ex.bp))
}

/**
 * The rest a system wants between sets of one exercise, or null when it has no opinion.
 *
 * `exId` decides the compound/isolation split — the same body-part test `isCompoundLift` makes —
 * so a preset's 180/90 lands on the squat and the fly-over, not on whatever the caller thought was
 * big. An exercise the dataset does not know is treated as isolation: the shorter rest is the
 * smaller mistake, and an unknown exercise is more often a custom one than a squat.
 */
export function restSecFor(preset, exId) {
  const sec = isCompoundLift(exId) ? preset?.restCompound : preset?.restIsolation
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : null
}

/**
 * Write a system's progression settings into one routine, as a new object.
 *
 * This is the *explicit* half of applying a system, for people who want to see the policy in
 * the routine editor rather than resolve it implicitly. It is deliberately conservative:
 *
 *   · `prog` is written whenever the routine has none of its own, and overwritten when it names
 *     the same policy the system does (a routine already on 'linear' moving to Hypertrophy is
 *     meant to move). A routine deliberately on a *different* policy is left alone and reported
 *     in `skipped`, because overriding that is the user's decision, not the system's.
 *   · Nothing is removed. Switching back to 'off' clears what was written here and nothing else,
 *     because applySystemToRoutine(null) is the inverse and touches only these fields.
 */
export function applySystemToRoutine(routine, preset) {
  if (!routine) return { routine, skipped: [] }
  const out = { ...routine }
  const skipped = []
  if (!preset) {
    if (out.prog != null) delete out.prog
    if (out.systemApplied) delete out.systemApplied
    return { routine: out, skipped }
  }
  if (out.prog && out.prog !== preset.policy) skipped.push(out.prog)
  else if (POLICIES_FOR.reps.includes(preset.policy)) out.prog = preset.policy
  out.systemApplied = preset.id
  return { routine: out, skipped }
}

/** Every system but 'off', for callers that need the real policies (docs, MCP, tests). */
export const APPLIED_SYSTEM_IDS = REAL_POLICY_IDS

export { POLICY_NAME }
