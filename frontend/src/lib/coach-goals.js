/**
 * What someone is training for, as a ranked list rather than a single word.
 *
 * One goal is a lie about most people. Somebody wants to get stronger *and* put on muscle, and
 * somebody else wants to lose fat without losing what they have already built - and the two do
 * not want the same plan, or even the same week. So the intake collects several and asks which
 * matters most, and the plan is built for the order rather than the set.
 *
 * **Priority is the order of the array, and nothing else.** There is no `priority: 1` field next
 * to each entry, because a rank stored separately from a list is a second thing to keep in sync
 * and a third way to be inconsistent. `objectives[0]` is the one the plan serves first; the rest
 * are served as far as the week and the evidence allow, and the prompt is told to say which it
 * could not.
 *
 * `profile.goal` stays the *first* objective, derived. It is what an older build wrote, what
 * `debrief.md` and the consent copy read, and what makes a profile with one objective look
 * exactly like the profile it used to be. The same rule as `weekRequired`: keep what is derived
 * only where something older still needs to read it.
 */

/**
 * The objectives on offer, with the copy for each. The key is what the model is given; the
 * labels are translated by the caller, since this module must not depend on the i18n layer.
 *
 * Order is the order they are offered in, which is also roughly how often people want them, and
 * it is *not* a default priority - picking in this order says nothing, and `normalizeObjectives`
 * keeps whatever order the person actually chose.
 */
export const GOALS = [
  ['strength', 'Get stronger', 'Heavier lifts, lower reps.', 'barbell'],
  ['muscle', 'Build muscle', 'Volume and progression.', 'arm'],
  ['general', 'General fitness', 'Balanced, sustainable training.', 'heart'],
  ['fatloss', 'Lose fat', 'Keep strength while leaning out.', 'flame'],
  ['endurance', 'Endurance', 'Higher reps, less rest, cardio.', 'figureRun']
]

/** The keys, in the order offered. */
export const GOAL_KEYS = GOALS.map(([key]) => key)

/**
 * How many objectives a person may pick.
 *
 * Three, not five, and deliberately: a plan that served five goals at once would be five plans
 * at once, and the priority would be doing no work. Three is enough to say "this first, and keep
 * an eye on these two" and few enough that the first one still wins a real argument in the
 * prompt. The cap is on the *count*, not on which - any of the five can be the top one.
 */
export const MAX_OBJECTIVES = 3

const isKey = v => typeof v === 'string' && GOAL_KEYS.includes(v)

/**
 * The ranked objectives of a profile, as a clean list of known keys.
 *
 * Reads a legacy profile - one written before this screen, carrying only `goal` - as a
 * single-element list, so every caller gets the same shape and nothing has to ask which kind of
 * profile it is looking at. An empty or absent answer is an empty list; the caller decides
 * whether that is allowed (the intake does not allow it, the payload treats it as "not said").
 *
 * Anything unrecognised is dropped rather than passed on: a key the model has no copy for is a
 * word it cannot programme for, and forwarding it would put a bare string in the prompt where
 * the list of objectives is supposed to be.
 */
export function normalizeObjectives(profile) {
  const list = Array.isArray(profile?.objectives) ? profile.objectives : []
  const out = []
  for (const v of list) {
    if (isKey(v) && !out.includes(v)) out.push(v)
    if (out.length >= MAX_OBJECTIVES) break
  }
  // A profile that only ever had the single `goal` field. Checked after the list, so a profile
  // that has both is read as the list and the derived `goal` cannot re-append a duplicate.
  if (!out.length && isKey(profile?.goal)) out.push(profile.goal)
  return out
}

/**
 * Add or remove one objective, in place of the caller's array.
 *
 * Adding goes on the end, so a person who taps in priority order gets that order for free and
 * never has to reorder. Removing takes it out entirely - an objective dropped from the list is
 * dropped from the plan, which is the only honest reading of unticking it.
 */
export function toggleObjective(list, key) {
  const cur = Array.isArray(list) ? list : []
  if (!isKey(key)) return cur
  return cur.includes(key)
    ? cur.filter(k => k !== key)
    : cur.length >= MAX_OBJECTIVES ? cur : [...cur, key]
}

/**
 * Move the objective at `from` one place towards the front, returning a new list.
 *
 * `dir` is -1 for up and 1 for down, matching the arrow that was pressed, and a move that would
 * step past either end returns the same list - so the caller can disable the arrow instead of
 * having its click quietly do nothing.
 */
export function moveObjective(list, from, dir) {
  const cur = Array.isArray(list) ? list : []
  const to = from + (dir < 0 ? -1 : 1)
  if (from < 0 || from >= cur.length || to < 0 || to >= cur.length) return cur
  const out = [...cur]
  ;[out[from], out[to]] = [out[to], out[from]]
  return out
}

/** The one that matters most, or null when none was chosen. */
export const primaryObjective = profile => normalizeObjectives(profile)[0] ?? null

/** The English label for a key, or the key itself for something unrecognised. */
export const goalLabel = key => GOALS.find(([k]) => k === key)?.[1] || key

/** The icon name for a key, matching what the choice rows have always used. */
export const goalIcon = key => GOALS.find(([k]) => k === key)?.[3] || 'barbell'
