/**
 * The weekly plan as a *frequency*, not a set of named weekdays.
 *
 * The person setting up a plan answers two questions — how many days a week, and how many of
 * those are optional — and never picks "Monday". The app lays the week out. Internally the plan
 * is still weekday-keyed (`S.week`), because every consumer of it (Home's strip, the calendar,
 * `effectiveRoutineIds`, history) needs to know which date a routine belongs to; the weekday
 * stopped being something the user chooses and became something the app derives.
 *
 * Two fields, and the split between them is a derivation rather than a third:
 *   - `S.week`        { 0-6: routineId[] }  key-absent = nothing to do that day (see
 *                                           docs/COMBINE_ROUTINES.md — never store `[]`).
 *   - `S.weekOptional` 0-6[]                which of those days are the optional ones.
 *   - `S.weekRequired` 0-6[]                *only* the required days that have nothing on them
 *                                           yet. Absent on a plan that has no empty slots, and
 *                                           absent on every plan written before the frequency
 *                                           picker existed, which is read straight off `week`.
 *
 * A day in `weekOptional` may hold routines or may hold none. That is the whole point of it: the
 * Coach names the slot and leaves it open, and filling it in is the user's call. So *required*
 * days are the optional list's complement among the slots, which is why adding an optional day
 * never silently changes the weekly target, and filling one in never makes the user look over
 * target.
 *
 * `weekRequired` exists because the required list has to be readable back with nothing on it: a
 * person who says "four days a week" and has planned two of them has still said four, and the
 * Plan screen has to keep showing them two more slots to fill rather than quietly dropping its
 * dial to two. It is derived away whenever every required day already holds routines, so a
 * fully-planned week stores nothing extra and fingerprints exactly as it did before.
 */

import { weekStartOf, weekDayOffset, weekOrder } from './format.js'

/** Every weekday index, 0-6. */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/**
 * Default shape of a week for N training days, as offsets from the first day of the week.
 *
 * A table rather than `round(i * 7 / n)`: evenly spacing by that formula gives 3 days as
 * Mon/Wed/Sat, which puts a rest day where a lifter expects one and trains two days running in
 * the middle. The irregular patterns below are the ones people actually train on, and a
 * distribution is a judgement call that does not belong in arithmetic.
 */
const SPREAD = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6]
}

const intOr = (v, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : fallback
}
/** Training days are 1-7. `?? `not `||`: a stored 0 is an answer, and clamps to one day. */
const clampDays = n => Math.min(7, Math.max(1, intOr(n, 1)))
/** Optional days are 0-4 — a bonus, capped below a half again of a week. */
export const MAX_OPTIONAL = 4
const clampOptional = n => Math.min(MAX_OPTIONAL, Math.max(0, intOr(n, 0)))

/**
 * The most optional days a week of `days` required days can have.
 *
 * A week is seven days and the two kinds are disjoint, so the two answers cannot be independent
 * the way the intake screen first suggested: "seven days a week" and "four of them optional" asks
 * for eleven slots and there is no week with eleven days in it. Left unsaid, the server's plan
 * validator rejects the resulting plan outright — the model is told to produce two disjoint
 * weekday lists of 7 and 4, which no answer can satisfy.
 *
 * So the optional answer is bounded by the space the required one leaves, and both the intake
 * screen and the Plan steppers read this rather than showing a button that cannot be pressed.
 */
export const maxOptionalFor = days => Math.max(0, Math.min(MAX_OPTIONAL, 7 - clampDays(days)))

/** The days a plan of `n` training days uses, as weekday indices, for a week starting on `ws`. */
export const defaultDays = (n, ws = weekStartOf()) => (SPREAD[clampDays(n)] || SPREAD[1]).map(off => (ws + off) % 7)

/** Weekday indices, accepting the string keys a JSON bundle carries. */
const asDays = v => (Array.isArray(v) ? v : [])
  .map(d => (typeof d === 'string' && /^\d$/.test(d) ? +d : d))
  .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)

const byWeekOrder = ws => (a, b) => weekDayOffset(a, ws) - weekDayOffset(b, ws)

/** `S.weekOptional` read raw, before required-day overlap is ruled out. Private, so that the
 *  two public readers can each go first without recursing into one another. */
const optionalShape = S => [...new Set(asDays(S?.weekOptional))].sort(byWeekOrder(weekStartOf(S)))

/** The optional days: weekday indices, de-duplicated, in week order. */
export function optionalDaysOf(S) {
  const req = new Set(requiredDaysOf(S))
  return optionalShape(S).filter(d => !req.has(d))
}

/**
 * The required days, in week order: the days with routines planned on them, plus the days that
 * have none yet. A union, not a choice between the two — `weekRequired` only ever holds the
 * empty ones, so a plan with Monday planned and Wednesday still to do needs both to come back.
 *
 * A day claimed by both lists is corruption — a hand-edited bundle, a stale merge — and optional
 * wins, because that is the order the two are read in and the rule only has to be one rule. It
 * is also the choice that loses nothing: optional-winning keeps the slot in the week and only
 * relabels it, where the other way round would drop a slot the person had both allocated and
 * then filled.
 *
 * A plan with no `weekRequired` is a legacy or fully-planned one, and reads as just the
 * assignments — which is the whole rule in one line.
 */
export function requiredDaysOf(S) {
  const ws = weekStartOf(S)
  const opt = new Set(optionalShape(S))
  const planned = Object.keys(S?.week || {})
    .map(Number)
    .filter(d => S.week[d]?.length && !opt.has(d))
  const empty = asDays(S?.weekRequired).filter(d => !opt.has(d) && !S?.week?.[d]?.length)
  return [...new Set([...planned, ...empty])].sort(byWeekOrder(ws))
}

/**
 * The required days with nothing planned on them — the days `week` cannot say anything about,
 * and so the only part of the weekly shape worth persisting or fingerprinting. Empty when every
 * required day holds routines, which is the case for every plan the Coach writes.
 */
export const emptyRequiredOf = S => requiredDaysOf(S).filter(d => !S?.week?.[d]?.length)

/** Every slot the plan has, in week order, each as `{ day, optional }`. */
export const slotsOf = S => {
  const req = new Set(requiredDaysOf(S))
  return ALL_DAYS
    .filter(d => req.has(d) || optionalShape(S).includes(d))
    .sort(byWeekOrder(weekStartOf(S)))
    .map(day => ({ day, optional: !req.has(day) }))
}

/**
 * `slotsOf` with the number each slot is called, as `{ day, optional, n }`.
 *
 * A slot is a session, not a weekday: the week is set by how many days there are, not by which
 * ones, and `syncFrequency` re-lays them out whenever a count moves. So a row headed "Monday"
 * states a day the app does not hold — nudge a stepper and Monday is a different session, or no
 * session at all. Every surface that renders a week asks for its label here, so the Plan screen,
 * the sheet that fills one slot, and the printout cannot disagree about what a day is called.
 *
 * The two kinds number within themselves, so "Day 3" is always one of the days meant to be
 * trained and the optional days count from 1 on their own. Counting all slots together would let
 * Day 2 be optional and Day 3 required, which reads as a mistake.
 */
export const numberedSlotsOf = S => {
  let req = 0
  let opt = 0
  return slotsOf(S).map(({ day, optional }) => {
    if (optional) return { day, optional, n: ++opt }
    return { day, optional, n: ++req }
  })
}

/** The number one slot is called within its own kind — what a row is titled. */
export const slotNumber = (S, day) => {
  const s = numberedSlotsOf(S).find(x => x.day === day)
  return s ? s.n : 0
}

/** How many days a week this plan trains, planned or not. */
export const requiredCount = S => requiredDaysOf(S).length
export const optionalCount = S => optionalDaysOf(S).length

/** Every day that trains something, optional included — what Home and adherence count. */
export const trainedDays = S => slotsOf(S).filter(({ day }) => S.week?.[day]?.length).map(({ day }) => day)

/**
 * Grow a set of days to `n`.
 *
 * `keep` wins, and keeps its own order — the caller uses that to say which of several candidates
 * matters more (see `syncFrequency`). It is not sorted, because sorting would throw that away.
 * The spread table supplies new days, and the rest of the week after it: a day can be optional
 * on a week where every day the table names is already required, and without the fallback the
 * optional budget would quietly come up empty.
 */
function fillTo(n, keep, taken, ws) {
  const busy = new Set(taken)
  const out = [...new Set(keep)].filter(d => !busy.has(d))
  const used = new Set([...out, ...busy])
  for (const d of [...defaultDays(n, ws), ...weekOrder(ws)]) {
    if (out.length >= n) break
    if (used.has(d)) continue
    out.push(d)
    used.add(d)
  }
  // A `keep` longer than `n` is not truncated here — callers decide what to do with the surplus.
  return out
}

/**
 * Reshape the week to `days` required and `optional` optional days, in place (call inside
 * `store.update`). Returns the days it settled on.
 *
 * Two rules make this safe to call on every keystroke of a stepper:
 *
 *  1. **A routine is never thrown away.** Shrinking turns surplus required days into *optional*
 *     days rather than rest days, so going 4 → 3 moves Friday to the optional list with its
 *     routine still on it. Only a surplus day that does not fit the optional budget is dropped,
 *     and by then it is one the user has already disowned twice.
 *  2. **A day is never both.** Required and optional are disjoint by construction, and a day
 *     that is optional keeps its `week` entry — filling an optional slot in is an ordinary
 *     assignment, not a change of the week's shape.
 *
 * `weekOptional` is only written when the answer is non-empty, matching the rest of the model:
 * a fresh plan has no optional days, and an absent key is the same as `[]`. `weekRequired` is
 * written only for the days that have nothing on them, and deleted once every required day is
 * planned — the same "do not store what can be derived" rule, which is what keeps a fully-planned
 * week's fingerprint identical to the one it had before the frequency picker existed.
 */
export function syncFrequency(s, { days, optional: wantOptionalRaw } = {}) {
  const ws = weekStartOf(s)
  const wantDays = clampDays(days)
  // Bounded by the room the required days leave in a seven-day week, not just by MAX_OPTIONAL:
  // asking for more optional days than there are days left is not a request to satisfy, it is an
  // impossible one, and quietly settling on fewer is the only honest answer.
  const wantOptional = Math.min(clampOptional(wantOptionalRaw), maxOptionalFor(wantDays))

  const currentOpt = optionalShape(s)
  const currentReq = requiredDaysOf(s)

  // The required count is the one the person actually trains against, so it is drawn from the
  // whole week with nothing held back for it. Holding the optional days out of the draw would
  // make the count unreachable instead: on a week where two days are already optional, asking
  // for 6 required could only ever produce 5. An optional day the required count takes gives up
  // its slot below and competes for the optional budget like any other surplus day.
  const required = fillTo(wantDays, currentReq, [], ws).slice(0, wantDays)
  const kept = new Set(required)
  // Days already marked optional come before days that are merely surplus required ones: the user
  // chose the first pair, and moving a day they have been training on into a slot they picked
  // beats evicting a slot they have been using.
  const keep = [...currentOpt, ...currentReq.filter(d => !kept.has(d))]
  const optional = fillTo(wantOptional, keep, required, ws)
    .filter(d => !kept.has(d))
    .slice(0, wantOptional)
    .sort(byWeekOrder(ws))

  const live = new Set([...required, ...optional])
  ALL_DAYS.forEach(d => { if (!live.has(d)) delete s.week[d] })
  if (optional.length) s.weekOptional = optional
  else delete s.weekOptional
  const emptyRequired = required.filter(d => !s.week[d]?.length)
  if (emptyRequired.length) s.weekRequired = emptyRequired
  else delete s.weekRequired

  return { required: required.sort(byWeekOrder(ws)), optional }
}

/**
 * A one-line description of the week's shape, for the Coach to read back and for the Plan
 * screen's subtitle. `null` when there is no plan at all.
 */
export function describeWeek(S) {
  const required = requiredDaysOf(S)
  const optional = optionalDaysOf(S)
  if (!required.length && !optional.length) return null
  return {
    required,
    optional,
    scheduled: required.filter(d => S.week?.[d]?.length).length + optional.filter(d => S.week?.[d]?.length).length
  }
}

export { weekOrder }
