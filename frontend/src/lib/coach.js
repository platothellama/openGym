// The AI Coach, on the client side: everything that decides what a proposal *does* to a plan.
//
// The server produces proposals; it never writes into your state. Applying one is ordinary
// local editing — snapshot, mutate the draft, log — which is what makes it work offline, sync
// like every other change, and stay reversible without the server knowing anything about it.
//
// Every function here is pure over a draft state `s` (call them inside store.update), so the
// interesting parts are testable without a browser, a server or an AI account. That matters
// more here than elsewhere in the app: this is the code that edits a plan on the strength of
// something a language model said, and "it looked right on my phone" is not a standard.
//
// The screens that call it arrive in PR 4. Nothing in this file needs one to be tested, which
// is the point of it being separate from them.

import { EXIDX } from './exercises.js'
import { modeOf, isBw, isPerSide, cleanupSg } from './history.js'
import { applySessionTargets as applyTargets } from './session-suggest.js'
import { uid, todayISO, DAYN } from './format.js'
import { mergePlan } from './plan-share.js'
import { deleteRoutine } from './routines.js'
import { optionalDaysOf, emptyRequiredOf, slotNumber } from './week-plan.js'
import { normalizeObjectives, goalLabel } from './coach-goals.js'
import { POLICIES } from './progression.js'
import { t } from './i18n.js'

// Bumping this re-prompts everyone: it means what we share, or who we share it with, changed.
export const CONSENT_VERSION = 1

// Bounds. The whole state has to stay inside the server's 5 MB body limit, and a Coach log
// that grows forever is exactly the kind of thing that eats it invisibly. Worst case here is
// ~75 KB; the namespace guard is the backstop for the case nobody predicted.
export const SNAPSHOT_MAX = 3
export const LOG_MAX = 50
export const CHAT_MAX = 40
export const TIMINGS_MAX = 5
const NAMESPACE_MAX = 256 * 1024

export const emptyCoach = () => ({
  consent: null, profile: null, cadence: 'off', lastReview: null, log: [], snapshots: [],
  // The conversation as the user saw it (views/CoachChat.jsx): their messages, and what the
  // Coach did with them. Short, synced, and trimmed with the log — the proposal itself lives
  // server-side (or in the phone's device file) until it is applied or dismissed.
  chat: [],
  // How long the last few jobs took, so the typing bubble can say "usually about 2 minutes".
  timings: []
})
const coachOf = s => (s.coach = s.coach || emptyCoach())

/* ============================ gating ============================ */

// One predicate, one place. Every Coach entry point in the UI is behind it, which is what
// makes "an instance with no provider is byte-identical to before" a claim worth testing.
//
// The demo build is the one exception, and it is deliberate: it has no backend and no
// account, but it does have a canned provider, and hiding the app's most interesting feature
// from the page people are sent to look at it on would be a strange choice.
//
// The mobile build has two ways in, both chosen in Settings (views/CoachSetup.jsx): a phone
// paired to a self-hosted server is an ordinary signed-in profile and takes the web rule; a
// phone that brought its own API key runs the Coach itself (lib/coach-local.js). Nothing
// chosen means nothing shown — the same "invisible unless configured" promise the web keeps.
export const coachAvailable = (config, user, { demo, mobile, coachMode } = {}) =>
  mobile ? (coachMode === 'byok' || !!(config?.coach?.enabled && user))
    : demo ? true : !!(config?.coach?.enabled && user)

// What each data category means, in the user's words. Rendered from the same list the payload
// builder uses (api/coach/core/categories.js), so the screen cannot promise less than leaves.
export const CATEGORY_TEXT = {
  plan: ['Your plan', 'Routines, exercises, sets and reps, your weekly schedule and progression settings.'],
  training: ['Your logged training', 'Sets you logged in the review window — weights, reps, times, effort ratings and how long sessions took.'],
  bodyweight: ['Body weight', 'Weigh-ins from the same window, and your goal weight if you set one.'],
  profile: ['What you tell the Coach', 'Your intake answers, including any limitations or injuries you describe.'],
  prefs: ['A few preferences', 'Your unit, your language and which effort scale you log.'],
  // The last five only ever travel for a profile that has linked FitAI — the payload carries no
  // fuel block at all without one, so the wording says "only if you linked FitAI" rather than
  // letting the row imply these are always sent.
  nutrition: ['Your food and drink', 'Only if you linked FitAI: your calorie and protein targets, and what you logged eating this week.'],
  glucose: ['Your blood sugar', 'Only if you linked FitAI: fasting and after-meal readings from this week.'],
  fasting: ['Your fasts', 'Only if you linked FitAI: the fasting protocols you started and finished, and any one in progress.'],
  health: ['Your health data', 'Only if you linked FitAI: your body weight and scan, lab results that were out of range, and any condition you recorded.'],
  activity: ['Your daily activity', 'Only if you linked FitAI: steps, active calories, sleep and resting heart rate.']
}
export const hasConsent = S => !!S?.coach?.consent?.agreedAt && S.coach.consent.version === CONSENT_VERSION

/* ============================ plan fingerprint ============================ */

/**
 * Optional days, appended as a suffix and only when there are any. Mirror of `optSuffix` in
 * api/coach/core/plan-hash.js.
 *
 * A suffix rather than a key in the object above: adding a key changes the bytes for *every*
 * plan, which changes every fingerprint, which marks every in-flight proposal `planMoved` the
 * next time a phone opens — for plans nobody edited. A suffix leaves a plan with no optional
 * days hashing exactly as it did before the field existed.
 */
const optSuffix = plan => {
  const opt = plan?.weekOptional || []
  return opt.length ? '|opt=' + opt.slice().sort((a, b) => a - b).join('+') : ''
}

/**
 * Required days that have nothing planned on them, appended after the optional ones. Mirror of
 * `reqSuffix` in api/coach/core/plan-hash.js.
 *
 * Only the *empty* required days, and only when there are some. A required day that holds a
 * routine is already in the hashed `week`, so listing it again would change every fingerprint
 * for a plan nobody edited; and when every required day is planned the key is absent entirely.
 * What is left is a day the person has said they train but has not planned yet, which moves the
 * weekly shape a proposal was computed against, so it has to be in the fingerprint.
 */
const reqSuffix = plan => {
  const req = plan?.weekRequired || []
  return req.length ? '|req=' + req.slice().sort((a, b) => a - b).join('+') : ''
}

/**
 * Mirror of `canonicalPlan` in api/coach/payload.js — field for field, including the rule
 * that every absent value is written out as a zero so "no weight" and "0 kg" cannot hash
 * apart, and that `bodyweight`/`side` are *resolved* against the catalogue rather than copied,
 * so a plan that says nothing and an exercise the dataset already calls bodyweight hash the
 * same. If you change one, change both; coach.test.js checks them against shared fixtures.
 */
export function canonicalPlan(S) {
  return {
    routines: (S.routines || []).map(r => ({
      id: r.id, name: r.name || '', prog: r.prog || '',
      ex: (r.ex || []).map(e => {
        const mode = modeOf(e)
        return {
          id: e.id, mode, sets: e.sets || 0,
          reps: mode === 'reps' ? (e.reps || 0) : 0,
          sec: mode === 'time' ? (e.sec || 0) : 0,
          min: mode === 'cardio' ? (e.min || 0) : 0,
          speed: mode === 'cardio' ? (e.speed || 0) : 0,
          weight: mode === 'cardio' ? 0 : (e.weight || 0),
          prog: e.prog || '', inc: e.inc || 0, repsMin: e.repsMin || 0, repsMax: e.repsMax || 0,
          bodyweight: isBw(e), side: isPerSide(e),
          sg: e.sg || ''
        }
      })
    })),
    // A weekday holds a routine-id list now. `[].concat` folds a legacy bare string and a
    // one-element list to the same shape, so their fingerprint is identical — no false-stale
    // storm on the first load after the upgrade. `?.length` keeps a stray `[]` out. Insertion
    // order is preserved and never sorted (it is the merge order).
    week: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].filter(d => S.week?.[d]?.length).map(d => [d, [].concat(S.week[d])])),
    // The optional days are hashed, not just the required ones: an optional day is a real slot
    // in the plan, and a proposal computed without knowing which days were optional is stale the
    // moment one is added. Sorted so the fingerprint does not depend on who wrote them down in
    // what order, and read from `week` so a day listed as optional but never filled in still
    // counts — that empty slot is the thing being proposed against.
    weekOptional: [...new Set(optionalDaysOf(S))].sort((a, b) => a - b),
    // The required days nothing is planned on yet. Absent key means "none": a plan the Coach
    // wrote always has a routine on every required day, and an empty list is not what a fully
    // planned week stores (see week-plan.js) — so this is empty for every such plan and its
    // fingerprint is unchanged by the field existing.
    weekRequired: emptyRequiredOf(S)
  }
}

/** FNV-1a-ish 64-bit fingerprint. Mirror of hashPlan in api/coach/core/plan-hash.js. */
export function hashPlan(plan) {
  const canon = JSON.stringify({
    routines: (plan?.routines || []).map(r => [r.id, r.name, r.prog, (r.ex || []).map(e =>
      [e.id, e.mode, e.sets, e.reps, e.sec, e.min, e.speed, e.weight, e.prog, e.inc,
        e.repsMin, e.repsMax, e.bodyweight, e.side, e.sg].join(':')
    )]),
    // `plan` is a canonicalPlan output, so each day is already an array. `{1:['r1']}` → "1=r1",
    // byte-identical to the pre-upgrade fingerprint; `{3:['r2','r3']}` → "3=r2+r3". Weekday
    // keys still sorted; the routine list within a day never is.
    week: Object.keys(plan?.week || {}).sort().map(k => k + '=' + [].concat(plan.week[k]).join('+'))
  }) + optSuffix(plan) + reqSuffix(plan)
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < canon.length; i++) {
    const c = canon.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((c << 3) | i & 7), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
export const planHash = S => hashPlan(canonicalPlan(S))

/* ============================ staleness ============================ */

const findRoutine = (S, id) => (S.routines || []).find(r => r.id === id) || null
const findEx = (routine, id) => (routine?.ex || []).find(e => e.id === id) || null

// The Coach reads a routine's name cut at 80 characters (NAME_MAX in api/coach/core/payload.js),
// and the server copies that cut name into a rename's `before`. Compared whole, a longer name
// never matched, and every rename of it was shown as already overtaken by an edit. Not imported
// from payload.js, which would pull the exercise catalogue into the main bundle; coach.test.js
// pins the two together.
export const ROUTINE_NAME_SEEN = 80

/** The plan's current value for whatever a change is about — what `before` is checked against. */
export function currentValue(S, change) {
  const r = findRoutine(S, change.target?.routineId)
  const e = change.target?.exId ? findEx(r, change.target.exId) : null
  switch (change.type) {
    case 'sets': return e?.sets ?? null
    case 'reps': return e?.reps ?? null
    case 'repsMin': return e?.repsMin ?? null
    case 'repsMax': return e?.repsMax ?? null
    case 'sec': return e?.sec ?? null
    case 'inc': return e?.inc ?? null
    case 'exercise-prog': return e?.prog ?? null
    case 'routine-prog': return r?.prog ?? null
    case 'rename-routine': return r?.name == null ? null : String(r.name).slice(0, ROUTINE_NAME_SEEN)
    case 'week': return [].concat(S.week?.[change.target?.weekday] ?? [])   // routine-id list; [] = rest
    default: return undefined            // structural changes have no single scalar to compare
  }
}

/**
 * Mark what can no longer be applied. Two independent checks, because they fail differently:
 * the whole proposal is stale when the plan has moved since it was computed, and an individual
 * change is stale when the thing it names is gone or has already been changed by hand.
 *
 * A stale change is disabled, never silently skipped — someone who edited their plan on
 * another device should be told why the suggestion is greyed out.
 */
export function markStale(proposal, S) {
  if (!proposal) return proposal
  const planMoved = !!proposal.planHash && proposal.planHash !== planHash(S)
  const changes = (proposal.changes || []).map(c => {
    const r = c.target?.routineId ? findRoutine(S, c.target.routineId) : null
    let stale = false
    if (c.type !== 'add-routine' && c.type !== 'week' && !r) stale = true
    else if (c.target?.exId && !findEx(r, c.target.exId)) stale = true
    else if (c.type === 'week') {
      // The day's value is a routine-id list; `before` may be a list (a combined day) or a
      // legacy bare string. Compare by canonical join so order matters but shape does not.
      const join = v => [].concat(v ?? []).join('+')
      if (c.before != null && join(currentValue(S, c)) !== join(c.before)) stale = true
    }
    else {
      const cur = currentValue(S, c)
      // `before` is what the Coach saw. If the live plan disagrees, someone has already
      // changed it — applying would silently overwrite their edit with a stale premise.
      if (cur !== undefined && c.before != null && cur !== c.before && cur !== null) stale = true
    }
    return { ...c, status: stale ? 'stale' : (c.status === 'stale' ? 'proposed' : c.status || 'proposed') }
  })
  return { ...proposal, planMoved, changes }
}
export const applicable = proposal => (proposal?.changes || []).filter(c => c.status !== 'stale')

/* ============================ validation ============================ */

/** Client-side mirror of the server's gate — the plan must survive a bad day at either end. */
export function validateProposal(p) {
  if (!p || typeof p !== 'object') throw new Error(t('That proposal can’t be read.'))
  if (p.bundle) {
    if (!Array.isArray(p.bundle.routines) || !p.bundle.routines.length) throw new Error(t('That proposal can’t be read.'))
    // The server rejects a routine with no exercises; so must this, or an empty one is appended,
    // gets scheduled, and "start today's session" opens a workout with nothing in it.
    for (const r of p.bundle.routines) {
      if (!Array.isArray(r.ex) || !r.ex.length) throw new Error(t('That proposal can’t be read.'))
    }
    return true
  }
  if (!Array.isArray(p.changes)) throw new Error(t('That proposal can’t be read.'))
  for (const c of p.changes) {
    if (!CHANGE_APPLY[c.type]) throw new Error(t('That proposal can’t be read.'))
  }
  return true
}

/* ============================ snapshots & revert ============================ */

const clone = o => JSON.parse(JSON.stringify(o))

/**
 * Remember the `dayPlan` entries an apply step deleted, on the snapshot that will undo it.
 *
 * A patch, not a clone: `dayPlan` holds every date the user ever rescheduled, and three copies
 * of it in the snapshot ring would crowd real snapshots out of the 256 KB namespace budget that
 * `trim()` enforces. The first value recorded for a date wins — that is the pre-apply one.
 */
function recordDayPlanDrops(s, dropped) {
  if (!Object.keys(dropped).length) return
  const snaps = coachOf(s).snapshots || []
  const snap = snaps[snaps.length - 1]
  if (!snap) return
  snap.dayPlanRestore = { ...dropped, ...(snap.dayPlanRestore || {}) }
}

/**
 * Drop per-date reschedules from `iso` onwards.
 *
 * A created plan replaces the whole week, so overrides made against the old one are no longer
 * about anything: `'rest'` would hide a session the new plan schedules, and a routine id wins
 * over the new week on that day. Past dates stay — those are history, not intent.
 */
function sweepDayPlan(s, fromIso) {
  const dropped = {}
  Object.keys(s.dayPlan || {}).forEach(iso => {
    if (iso >= fromIso) { dropped[iso] = s.dayPlan[iso]; delete s.dayPlan[iso] }
  })
  recordDayPlanDrops(s, dropped)
}

/** Snapshot `{routines, week, weekOptional, weekRequired}` before touching any of them. The unit of revert (FR-30/31). */
export function pushSnapshot(s, proposalId, label) {
  const c = coachOf(s)
  c.snapshots = [...(c.snapshots || []), {
    at: Date.now(), proposalId: proposalId || null, label: label || '',
    routines: clone(s.routines || []), week: clone(s.week || {}),
    // A snapshot from before optional days existed has no key here; revert treats that as none,
    // which is what it was.
    weekOptional: clone(s.weekOptional || []),
    // The empty required slots, for the same reason — and because a revert that restored `week`
    // but not this would leave slots behind that the plan the person had before did not have.
    weekRequired: clone(s.weekRequired || [])
  }].slice(-SNAPSHOT_MAX)
  trim(s)
}

/**
 * Put the plan back the way it was before the last applied change-set.
 *
 * Workouts are untouched, and that is not an oversight: the log is what happened. Reverting a
 * plan re-derives every future target from that same history, which is exactly what the
 * progression engine does anyway.
 */
export function revertLast(s) {
  const c = coachOf(s)
  // The ring is shared with a session apply (see `pushActiveSnapshot`): that snapshot has `active`
  // and no `routines` in it. Step over those rather than restoring a plan out of one, which
  // would empty the plan rather than undo anything.
  const snaps = c.snapshots || []
  const at = snaps.map((sn, i) => (sn && !sn.active && sn.routines ? i : -1)).filter(i => i >= 0).pop()
  if (at == null) return false
  const snap = snaps[at]
  c.snapshots = snaps.filter((_, i) => i !== at)
  s.routines = clone(snap.routines)
  s.week = clone(snap.week)
  s.weekOptional = clone(snap.weekOptional || [])
  s.weekRequired = clone(snap.weekRequired || [])
  // Snapshots taken before this field existed have nothing to put back.
  if (snap.dayPlanRestore) Object.assign(s.dayPlan, snap.dayPlanRestore)
  appendLog(s, { kind: 'revert', at: Date.now(), proposalId: snap.proposalId, summary: t('Reverted the last Coach changes.') })
  return true
}
export const canRevert = S => (S?.coach?.snapshots || []).some(sn => sn && !sn.active && sn.routines)

/* ============================ the log ============================ */

export function appendLog(s, entry) {
  const c = coachOf(s)
  const e = { id: entry.id || uid(), ...entry }
  c.log = [...(c.log || []), e].slice(-LOG_MAX)
  trim(s)
  return e.id
}
export const logEntry = (S, id) => (S?.coach?.log || []).find(e => e.id === id) || null

/**
 * What a created plan looked like, small enough to keep: names, days and prescriptions, no
 * rationale text. The full bundle was merged into the plan already; this is what the chat
 * shows back when someone opens an old proposal months later.
 */
export function lightBundle(b) {
  if (!b) return null
  return {
    name: b.name || '', summary: b.summary || '', week: { ...(b.week || {}) },
    // Kept so the chat can still say "and Tuesday and Thursday are open if you want them" when
    // an old proposal is opened months later. Omitted when empty, as it is everywhere else.
    ...(b.weekOptional?.length ? { weekOptional: [...b.weekOptional] } : {}),
    // The empty required slots, same reason: without them a re-opened plan reads as a smaller
    // frequency than the one it was proposed against.
    ...(b.weekRequired?.length ? { weekRequired: [...b.weekRequired] } : {}),
    routines: (b.routines || []).map(r => ({
      id: r.id, name: r.name, emoji: r.emoji || '', why: r.why || '',
      ex: (r.ex || []).map(e => ({
        id: e.id, sets: e.sets, mode: e.mode || 'reps',
        ...(e.reps != null ? { reps: e.reps } : {}), ...(e.sec != null ? { sec: e.sec } : {}),
        ...(e.min != null ? { min: e.min } : {}), ...(e.weight ? { weight: e.weight } : {}),
        ...(e.why ? { why: String(e.why).slice(0, 200) } : {})
      }))
    }))
  }
}
const decisionOf = (c, status) => ({ id: c.id, type: c.type, target: c.target || null, before: c.before ?? null, after: c.after ?? null, why: c.why, routineName: c.routineName || null, status })


/**
 * Last line of defence for the 5 MB sync body: if the Coach namespace ever outgrows its
 * budget, drop the oldest history rather than let a PUT start failing for reasons nobody
 * would connect to this feature.
 */
function trim(s) {
  const c = coachOf(s)
  let guard = 0
  while (JSON.stringify(c).length > NAMESPACE_MAX && guard++ < 60) {
    if ((c.chat || []).length > 8) c.chat.shift()
    else if ((c.snapshots || []).length > 1) c.snapshots.shift()
    else if ((c.log || []).length > 1) c.log.shift()
    else break
  }
}

/* ============================ the conversation ============================ */

/**
 * One line of the chat: `{ id, role: 'user'|'coach', kind, text?, at, ref? }`.
 * kinds — user: 'intake' (the questionnaire, rendered from the live profile), 'text';
 *         coach: 'text', 'applied', 'dismissed', 'reverted', 'error', 'nochange'.
 */
export function appendChat(s, entry) {
  const c = coachOf(s)
  c.chat = [...(c.chat || []), { id: entry.id || uid(), at: entry.at || Date.now(), ...entry }].slice(-CHAT_MAX)
  trim(s)
}

/** A job just finished: remember how long it took, for the next typing bubble. */
export function recordTiming(s, ms) {
  if (!(ms > 0)) return
  const c = coachOf(s)
  c.timings = [...(c.timings || []), Math.round(ms)].slice(-TIMINGS_MAX)
}
/**
 * What to promise in the typing bubble. Median of the observed runs, but never slower than
 * the most recent one: after a speed-up (a faster model, a warmed cache) the median drags
 * three old 8-minute runs along, and telling someone "about 8 min" for a one-minute job is
 * worse than being briefly optimistic. A slow outlier still cannot scare anyone — the median
 * wins in that direction.
 */
export function estimateMs(S) {
  const raw = (S?.coach?.timings || []).filter(n => n > 0)
  if (!raw.length) return null
  const sorted = [...raw].sort((a, b) => a - b)
  return Math.min(sorted[Math.floor(sorted.length / 2)], raw[raw.length - 1])
}

/** The questionnaire, as the lines the chat shows back to the user. */
export function profileLines(p) {
  if (!p) return []
  // In priority order, not catalogue order, and numbered while there is more than one — a ranked
  // list shown unnumbered reads as a set, and the order is the part that is doing the work.
  // normalizeObjectives reads a profile written before this screen as one objective.
  const objectives = normalizeObjectives(p)
  const exp = { new: 'New to lifting', returning: 'Coming back after a break', regular: 'Training regularly' }[p.experience]
  const lines = []
  if (objectives.length > 1) objectives.forEach((o, i) => lines.push(t('{0}. {1}', i + 1, t(goalLabel(o)))))
  else if (objectives.length) lines.push(t(goalLabel(objectives[0])))
  if (exp) lines.push(t(exp))
  if (p.daysPerWeek) lines.push(p.daysPerWeek === 1 ? t('1 day a week') : t('{0} days a week', p.daysPerWeek))
  // Only when there are some. A profile saved before optional days existed has no key here, and
  // `0` is the same as `null` on the way into the payload — both mean none.
  if (p.optionalDays) lines.push(p.optionalDays === 1 ? t('1 optional day') : t('{0} optional days', p.optionalDays))
  if (p.sessionMin) lines.push(t('{0} min per session', p.sessionMin))
  if (p.equipment?.length) lines.push(p.equipment.join(', '))
  if (typeof p.equipmentOther === 'string' && p.equipmentOther.trim()) lines.push(p.equipmentOther.trim())
  if (p.limitations) lines.push(t('Limits: {0}', p.limitations))
  if (p.likes) lines.push(t('Likes: {0}', p.likes))
  if (p.dislikes) lines.push(t('Avoid: {0}', p.dislikes))
  if (p.notes) lines.push(p.notes)
  return lines
}

/* ============================ applying a created plan ============================ */

/**
 * Accepting a created plan is exactly importing a plan file (FR-18): routines arrive as new
 * ones with fresh ids, existing routines and history are never touched, and the week schedule
 * only moves if you asked it to.
 */
export function applyCreatedPlan(s, proposal, { schedule } = {}) {
  validateProposal(proposal)
  pushSnapshot(s, proposal.id, t('Before the Coach’s plan'))
  const bundle = proposal.bundle
  // The Coach's `why` texts are for the review screen; they have no place in the routine data.
  // A link is never the Coach's to write: validatePlan already drops one from the model's plan,
  // and this drops it again on the way into mergePlan, which would otherwise carry a `url` on a
  // plan's own exercises through to the profile (cleanCustom keeps links for shared plans).
  const stripped = {
    ...bundle,
    routines: bundle.routines.map(r => ({ ...r, why: undefined, ex: r.ex.map(e => ({ ...e, why: undefined, name: undefined })) })),
    customEx: (bundle.customEx || []).map(c => { const { url, media, ...rest } = c || {}; return rest })
  }
  const res = mergePlan(s, stripped, { schedule })
  // Only when the week actually moved — with the switch off the old schedule still stands, and
  // so do the reschedules made against it.
  if (schedule) sweepDayPlan(s, todayISO())
  res.logId = appendLog(s, {
    kind: 'create', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', routines: res.routines, iteration: proposal.iteration || 1,
    bundle: lightBundle(bundle), scheduled: !!schedule
  })
  return res
}

/* ============================ applying a change-set ============================ */

// One implementation per allowed type. The object is the closed list on this side of the
// wire: a type with no entry here cannot be applied, whatever the server let through.
const CHANGE_APPLY = {
  'add-exercise': (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const a = c.after || {}
    const e = { id: a.id, sets: a.sets || 3, mode: a.mode || 'reps' }
    if (e.mode === 'cardio') { e.min = a.min || 20; e.speed = a.speed || 8 }
    else if (e.mode === 'time') e.sec = a.sec || 45
    else e.reps = a.reps || 10
    if (a.weight > 0) e.weight = a.weight
    if (POLICIES.includes(a.prog)) e.prog = a.prog
    if (Number.isInteger(a.repsMin)) e.repsMin = a.repsMin
    if (Number.isInteger(a.repsMax)) e.repsMax = a.repsMax
    // Only when the Coach disagreed with the catalogue: an absent flag has always meant
    // "whatever the exercise says", and writing one out would freeze today's dataset into
    // the plan.
    if (a.bodyweight != null) e.bodyweight = !!a.bodyweight
    if (a.side) e.side = true
    const at = Number.isInteger(a.position) ? Math.min(a.position, r.ex.length) : r.ex.length
    r.ex.splice(at, 0, e)
    cleanupSg(r.ex)
  },
  'remove-exercise': (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    r.ex = r.ex.filter(e => e.id !== c.target.exId)
    cleanupSg(r.ex)
  },
  'swap-exercise': (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const i = r.ex.findIndex(e => e.id === c.target.exId)
    if (i < 0) throw new Error('missing exercise')
    const old = r.ex[i], a = c.after || {}
    // Keep the old prescription unless the Coach deliberately changed it: a swap is about the
    // movement, and silently resetting sets and reps would be a second change nobody approved.
    //
    // The two v1.2.4 flags are the exception, and they have to be: they describe the *movement*,
    // not the prescription. Carrying `side: true` from a lunge onto a leg press would make the
    // app halve a rep count that was never per-side, so an explicit flag is dropped and the new
    // exercise goes back to whatever the catalogue says about it.
    const { bodyweight, side, ...keep } = old
    r.ex[i] = { ...keep, id: a.id, ...(a.sets ? { sets: a.sets } : {}), ...(a.reps ? { reps: a.reps } : {}), ...(a.weight > 0 ? { weight: a.weight } : {}) }
  },
  sets: (s, c) => { need(findExIn(s, c)).sets = c.after },
  reps: (s, c) => { need(findExIn(s, c)).reps = c.after },
  repsMin: (s, c) => { need(findExIn(s, c)).repsMin = c.after },
  repsMax: (s, c) => { need(findExIn(s, c)).repsMax = c.after },
  sec: (s, c) => { need(findExIn(s, c)).sec = c.after },
  cardio: (s, c) => {
    const e = need(findExIn(s, c))
    if (c.after?.min != null) e.min = c.after.min
    if (c.after?.speed != null) e.speed = c.after.speed
  },
  inc: (s, c) => { need(findExIn(s, c)).inc = c.after },
  'exercise-prog': (s, c) => { need(findExIn(s, c)).prog = c.after },
  'routine-prog': (s, c) => { need(findRoutine(s, c.target.routineId)).prog = c.after },
  reorder: (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const by = new Map(r.ex.map(e => [e.id, e]))
    const next = c.after.map(id => by.get(id)).filter(Boolean)
    // Distinct exercises, not just the right count: an order naming one id twice maps to the
    // same object twice and still counts right, which drops an exercise and leaves the
    // survivor aliased into two slots that then edit each other.
    if (next.length !== r.ex.length || new Set(next).size !== r.ex.length) throw new Error('incomplete reorder')
    r.ex = next
    cleanupSg(r.ex)
  },
  superset: (s, c) => {
    const r = need(findRoutine(s, c.target.routineId))
    const i = r.ex.findIndex(e => e.id === c.target.exId)
    if (i < 0) throw new Error('missing exercise')
    if (!c.after?.link) { delete r.ex[i].sg; cleanupSg(r.ex); return }
    // Splicing the partner out from under the anchor when they are the same exercise leaves
    // nothing to tag; refuse rather than reorder the routine on the way to a TypeError.
    if (c.after.with === c.target.exId) throw new Error('superset with itself')
    const j = r.ex.findIndex(e => e.id === c.after.with)
    if (j < 0) throw new Error('missing partner')
    // Supersets are a property of adjacency in this app; move the partner next to it first.
    const [partner] = r.ex.splice(j, 1)
    const at = r.ex.findIndex(e => e.id === c.target.exId)
    r.ex.splice(at + 1, 0, partner)
    const tag = uid().slice(0, 6)
    r.ex[at].sg = tag
    r.ex[at + 1].sg = tag
  },
  'add-routine': (s, c) => {
    const a = c.after
    s.routines.push({
      id: uid(), name: a.name, emoji: a.emoji || '🏋️',
      ...(POLICIES.includes(a.prog) ? { prog: a.prog } : {}),
      ex: a.ex.map(e => ({
        id: e.id, sets: e.sets || 3, mode: e.mode || 'reps',
        ...(e.mode === 'time' ? { sec: e.sec || 45 } : { reps: e.reps || 10 }),
        ...(Number.isInteger(e.repsMax) ? { repsMax: e.repsMax } : {}),
        ...(e.bodyweight != null ? { bodyweight: !!e.bodyweight } : {}),
        ...(e.side ? { side: true } : {})
      }))
    })
  },
  'remove-routine': (s, c) => {
    // The same delete as Plan and RoutineEdit. It used to compare each weekday with ===, which
    // missed a combined day (a list) and left the deleted id on it. The week comes back from the
    // snapshot on a revert; the dropped reschedules are not in the snapshot, so they are recorded.
    recordDayPlanDrops(s, deleteRoutine(s, c.target.routineId))
  },
  'rename-routine': (s, c) => { need(findRoutine(s, c.target.routineId)).name = c.after },
  week: (s, c) => {
    // A single-routine op: the slot is a list, but the Coach only ever names one routine (or
    // rest), and it replaces the day. This collapses a combined day to one routine — the same
    // stated limitation as a DayOverride (see docs/COMBINE_ROUTINES.md §8).
    const d = c.target.weekday
    if (c.after == null || c.after === 'rest') delete s.week[d]
    else s.week[d] = [c.after]
  }
}
export const CHANGE_TYPES = Object.keys(CHANGE_APPLY)

function findExIn(s, c) { return findEx(findRoutine(s, c.target.routineId), c.target.exId) }
function need(x) { if (!x) throw new Error('missing target'); return x }

/**
 * Apply the accepted subset, atomically (FR-30).
 *
 * Atomic comes free from how the store works: `update()` hands us a throwaway clone and only
 * keeps it if we return normally. Throwing part-way through therefore discards every change
 * this function already made, which is precisely the transaction we want — no half-applied
 * change-set, ever.
 */
export function applyChangeSet(s, proposal, acceptedIds) {
  validateProposal(proposal)
  const accepted = new Set(acceptedIds || [])
  const changes = (proposal.changes || []).filter(c => accepted.has(c.id) && c.status !== 'stale')
  if (!changes.length) return { applied: 0 }

  pushSnapshot(s, proposal.id, t('Before the Coach’s changes'))
  const applied = []
  for (const c of changes) {
    CHANGE_APPLY[c.type](s, c)
    applied.push(decisionOf(c, 'accepted'))
  }
  // Turned-down changes keep their before/after too: the chat shows the whole proposal back
  // later, and "you declined something about sets" is not a memory anyone can use.
  const rejected = (proposal.changes || [])
    .filter(c => !accepted.has(c.id))
    .map(c => decisionOf(c, c.status === 'stale' ? 'stale' : 'rejected'))

  const logId = appendLog(s, {
    kind: 'review', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', evidence: proposal.evidence || null,
    notes: proposal.notes || [], decisions: [...applied, ...rejected]
  })
  coachOf(s).lastReview = { at: Date.now() }
  return { applied: applied.length, rejected: rejected.length, logId }
}

/** Turned down whole, or expired: recorded so a later review knows not to re-propose it. */
export function recordDismissal(s, proposal) {
  const logId = appendLog(s, {
    kind: proposal.kind === 'create' ? 'create' : 'review', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', dismissed: true,
    evidence: proposal.evidence || null, notes: proposal.notes || [],
    ...(proposal.bundle ? { bundle: lightBundle(proposal.bundle), iteration: proposal.iteration || 1 } : {}),
    decisions: (proposal.changes || []).map(c => decisionOf(c, 'rejected'))
  })
  if (proposal.kind !== 'create') coachOf(s).lastReview = { at: Date.now() }
  return logId
}

/** A debrief has no decision to make: it is read, kept, and shown again on request. */
export function recordDebrief(s, proposal) {
  return appendLog(s, {
    kind: 'debrief', at: Date.now(), proposalId: proposal.id,
    workout: proposal.workout || null,
    summary: proposal.summary || '', score: proposal.score ?? null,
    highlights: proposal.highlights || [], watch: proposal.watch || [], nextTime: proposal.nextTime || []
  })
}

/* ============================ today's targets (a `session` job) ============================
 *
 * The other three kinds write to the plan, which is a draft that can be snapshotted whole. This
 * one writes into a workout that is already open and already has sets in it, so it gets its own
 * rules rather than being forced through `applyChangeSet`:
 *
 *   - The bounds are re-applied here. The server checked them too, but the answer has already
 *     crossed a network and a phone may have answered it locally; this is the last gate before a
 *     number a language model produced is written onto a barbell. `coach-parity.test.js` pins
 *     this table against the server's so the two copies cannot drift.
 *   - A target is checked against *this* session's entries rather than the routine it was sent
 *     for: an exercise can be added, swapped or removed while a job is running, and a target
 *     naming an exercise that is not on the screen has nowhere to go.
 *   - Reverting restores exactly what was replaced, per entry, and only for the session it was
 *     applied to. A plan snapshot holds routines and the week — copying that per session would
 *     be both expensive and the wrong unit — and a session apply has to survive the person
 *     logging a set afterwards, which is why the rows are restored one by one rather than by
 *     swapping the whole array back.
 */

/** The prompt's bounds (api/coach/prompts/session.md) and the server's mirror of them. */
export const SESSION_TARGET_BOUNDS = Object.freeze({
  weight: [0, 1000], reps: [1, 100], sets: [1, 10], sec: [5, 3600],
})
export const SESSION_REST_MIN = 15
export const SESSION_REST_MAX = 300
export const SESSION_TARGET_MAX = 20

const inBounds = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

/**
 * Turn a session proposal into the keyed targets `applySessionTargets` takes.
 *
 * Returns `{ targets, dropped }`: what would change, and what was asked for and will not be.
 * A refusal throws, the same way `validateProposal` does — an id naming an exercise that is not
 * on the screen means the answer is about a different session than the one running, and writing
 * the rest of it anyway would be writing numbers into a workout nobody asked about.
 *
 * Dropped rather than refused: a suggestion that changes nothing (the numbers are already what
 * the app had), and an invented load on a bodyweight exercise that carries none. Both are the
 * model saying something the app must not act on, not a reason to throw the other 19 away.
 */
export function validateSessionTargets(proposal, entries) {
  if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.targets)) throw new Error(t('That proposal can’t be read.'))
  const byId = new Map((entries || []).filter(e => e && e.id).map(e => [e.id, e]))
  const dropped = []
  const targets = {}
  const seen = new Set()
  if (proposal.targets.length > SESSION_TARGET_MAX) throw new Error(t('That proposal can’t be read.'))

  for (const raw of proposal.targets) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') throw new Error(t('That proposal can’t be read.'))
    const entry = byId.get(raw.id)
    if (!entry) throw new Error(t('That proposal can’t be read.'))
    if (seen.has(raw.id)) throw new Error(t('That proposal can’t be read.'))
    seen.add(raw.id)
    if (!raw.why || typeof raw.why !== 'string') throw new Error(t('That proposal can’t be read.'))

    const cur = entry.target || {}
    const t2 = { why: raw.why }
    const bad = []
    for (const key of Object.keys(SESSION_TARGET_BOUNDS)) {
      const v = raw[key]
      if (v == null) continue
      // A number, not something that reads as one, and whole where the app counts whole things —
      // the same test the server applies (validate.js), because a rounded 10.5 reps is a rep
      // nobody did. This is the last gate before a barbell, so an answer the server would have
      // refused is refused here too rather than half-applied.
      const [lo, hi] = SESSION_TARGET_BOUNDS[key]
      const ok = typeof v === 'number' && (key === 'weight' ? inBounds(v, [lo, hi]) : whole(v, lo, hi))
      if (ok) t2[key] = v
      else bad.push(key)
    }
    if (raw.restSec != null) {
      // 0 is a real answer (no rest at all) and 15-300 is the range; anything between is a number
      // that was never a rest period.
      if (whole(raw.restSec, SESSION_REST_MIN, SESSION_REST_MAX) || raw.restSec === 0) t2.restSec = raw.restSec
      else bad.push('restSec')
    }
    if (bad.length) throw new Error(t('That proposal can’t be read.'))
    // A per-side exercise's reps are the total across both sides, so an odd one would put a rep on
    // one side and not the other. Read off the entry, never off the answer.
    if (t2.reps != null && isPerSide(cur) && t2.reps % 2) throw new Error(t('That proposal can’t be read.'))
    // Bodyweight work progresses in reps and sets. A load on an exercise that carries none is not
    // a conservative adjustment, it is a different exercise — but the rest of the answer is still
    // about this session, so that one field goes and the rep climb with it stands.
    if (t2.weight != null && isBw(cur) && !(Number(cur.weight) > 0)) {
      delete t2.weight
      dropped.push({ id: raw.id, field: 'weight' })
    }
    // Cardio numbers are bounds the prompt states and the app cannot act on: a session's min and
    // speed come from the exercise, not from a suggestion. Said out loud rather than ignored.
    const fixed = ['min', 'speed'].filter(k => raw[k] != null)
    if (fixed.length) dropped.push({ id: raw.id, fields: fixed })

    // A target whose numbers are the ones already on the entry is not a change. Left in, the
    // card would offer to apply a row that reads the same either side of the arrow.
    const changed = Object.keys(SESSION_TARGET_BOUNDS).some(k => t2[k] != null && t2[k] !== cur[k]) || (t2.restSec != null && t2.restSec !== cur.restSec)
    if (!changed) { dropped.push({ id: raw.id, unchanged: true }); continue }
    targets[raw.id] = t2
  }
  return { targets, dropped }
}

/**
 * Write today's targets into the open session, remembering exactly what they replaced.
 *
 * Pure over the draft `s`, like everything else here: call it inside `store.update`, and a throw
 * leaves the session untouched because the store only keeps a clone that returns normally.
 * Returns `{ applied, targets, dropped, sessionId }`, and `{ applied: 0 }` when the answer held
 * nothing the app could act on — nothing written, and nothing to undo.
 */
export function applySessionProposal(s, proposal, entries) {
  const live = entries || s.active?.entries || null
  if (!live) throw new Error(t('That proposal can’t be read.'))
  const { targets, dropped } = validateSessionTargets(proposal, live)
  const ids = Object.keys(targets)
  if (!ids.length) return { applied: 0, targets, dropped, sessionId: s.active?.id || null }

  // The session's own unit of undo: the affected entries only, before they were touched. Bound
  // by the same ring as a plan snapshot, so the newest three are kept and an older one ages out.
  pushActiveSnapshot(s, s.active?.id || null, proposal.id, ids, live)

  const next = applyTargets(live, targets)
  if (s.active?.entries === live) s.active.entries = next
  const logId = appendLog(s, {
    kind: 'session', at: Date.now(), proposalId: proposal.id,
    summary: proposal.summary || '', ids, skipped: dropped
  })
  return { applied: ids.length, targets, dropped, logId, sessionId: s.active?.id || null }
}

/** Remember the entries a session apply is about to change. See `revertSessionTargets`. */
export function pushActiveSnapshot(s, sessionId, proposalId, ids, entries) {
  const c = coachOf(s)
  const restore = (entries || [])
    .filter(e => e && ids.includes(e.id))
    .map(e => ({ id: e.id, target: clone(e.target || {}), sets: clone(e.sets || []), ...(e.suggestion ? { suggestion: clone(e.suggestion) } : {}) }))
  if (!restore.length) return
  c.snapshots = [...(c.snapshots || []), {
    at: Date.now(), proposalId: proposalId || null, label: t('Before the Coach’s targets'),
    // A plan snapshot has `routines` and no `active`; a session snapshot is the other way round.
    // Which one it is decides what revert puts back, so the two can share the ring.
    active: { sessionId: sessionId || null, entries: restore }
  }].slice(-SNAPSHOT_MAX)
  trim(s)
}

/**
 * Put back exactly what a session apply changed — for this session, and no further.
 *
 * Per row rather than per array: a set logged between applying and undoing is what happened, and
 * replacing the array would delete it. So a row that is still undone goes back to the value it
 * had before the apply, a row that has since been logged is left exactly as it is, and a row the
 * apply appended is removed only while it is still undone. `target` and `suggestion` are whole
 * values and are restored outright.
 *
 * Returns false when there is nothing of this session's to undo, which is the honest answer
 * after the workout has been finished or the ring has rolled on.
 */
export function revertSessionTargets(s, sessionId) {
  const c = coachOf(s)
  const live = s.active?.entries
  if (!sessionId || !Array.isArray(live)) return false
  const idx = (c.snapshots || []).map((sn, i) => (sn?.active ? i : -1)).filter(i => i >= 0).reverse()
    .find(i => (c.snapshots[i].active.sessionId || null) === sessionId)
  if (idx == null) return false
  const snap = c.snapshots[idx]
  c.snapshots = c.snapshots.filter((_, i) => i !== idx)

  let restored = 0
  for (const rec of snap.active.entries || []) {
    const at = live.findIndex(e => e && e.id === rec.id)
    if (at < 0) continue
    const entry = live[at]
    entry.target = clone(rec.target || {})
    const rows = Array.isArray(entry.sets) ? entry.sets : []
    const pre = rec.sets || []
    for (let i = 0; i < pre.length && i < rows.length; i++) {
      if (rows[i]?.done) continue
      rows[i] = clone(pre[i])
    }
    // The rows the apply appended, outermost first, so an index shift never skips one. A row
    // logged since is not removed: it has become a set that was actually done.
    for (let i = rows.length - 1; i >= pre.length; i--) {
      if (rows[i]?.done) continue
      rows.splice(i, 1)
    }
    if (rec.suggestion) entry.suggestion = clone(rec.suggestion)
    else delete entry.suggestion
    restored++
  }
  appendLog(s, { kind: 'revert', at: Date.now(), proposalId: snap.proposalId, scope: 'session', restored })
  return restored > 0
}

/** Whether this session has a Coach apply it could take back. */
export const canRevertSession = (S, sessionId) =>
  !!(sessionId && (S?.active?.entries) && (S?.coach?.snapshots || []).some(sn => sn?.active && (sn.active.sessionId || null) === sessionId))

/* ============================ display helpers ============================ */

export const exName = id => EXIDX[id]?.n || t('Unknown exercise')
// Catalogue names are lower-case; a title reads better with each word capitalised, and doing it
// here rather than with CSS keeps a German sentence around the name from being Title Cased too.
const cap = s => String(s || '').replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase())
export const exTitle = id => cap(exName(id))

/**
 * What one day of the plan is called, for the surfaces that show a change without showing the row
 * it belongs to. The same title the Plan screen gives the slot (`numberedSlotsOf`), falling back to
 * the weekday when the day is not in the plan at all — a change can name a day the person has since
 * dropped, and an unnumbered slot is better described by its weekday than by "Day 0".
 */
const dayName = (S, weekday) => {
  const st = S || {}
  const n = slotNumber(st, weekday)
  if (!n) return t(DAYN[weekday])
  return optionalDaysOf(st).includes(weekday) ? t('Optional day {0}', n) : t('Day {0}', n)
}

/** Human label for a change, used on the review screen and in the log. */
export function changeTitle(c, S) {
  const ex = c.target?.exId ? exTitle(c.target.exId) : null
  switch (c.type) {
    case 'add-exercise': return t('Add {0}', exTitle(c.after?.id))
    case 'remove-exercise': return t('Drop {0}', ex)
    case 'swap-exercise': return t('Swap {0} for {1}', ex, exTitle(c.after?.id))
    case 'sets': return t('{0}: sets', ex)
    case 'reps': return t('{0}: reps', ex)
    case 'repsMin': return t('{0}: rep-range floor', ex)
    case 'repsMax': return t('{0}: rep-range ceiling', ex)
    case 'sec': return t('{0}: hold time', ex)
    case 'cardio': return t('{0}: duration & pace', ex)
    case 'inc': return t('{0}: load step', ex)
    case 'exercise-prog': return t('{0}: progression', ex)
    case 'routine-prog': return t('Routine progression')
    case 'reorder': return t('Reorder exercises')
    case 'superset': return c.after?.link ? t('Superset {0} with {1}', ex, exTitle(c.after.with)) : t('Unlink superset on {0}', ex)
    case 'add-routine': return t('Add routine “{0}”', c.after?.name)
    case 'remove-routine': return t('Remove a routine')
    case 'rename-routine': return t('Rename routine to “{0}”', c.after)
    // A day is titled the way the Plan screen titles it, so a review that moves a session does not
    // point at "Monday" on a screen that no longer has a Monday to point at. The change still
    // carries a weekday index — that is how the slot is identified underneath — but what the person
    // is shown is the number they set with the steppers.
    case 'week': return Number.isInteger(c.target?.weekday)
      ? t('{0}: what’s planned', dayName(S, c.target.weekday))
      : t('Change what’s planned on one day')
    default: return c.type
  }
}

/** Short before/after strings for the diff column. */
export function changeValues(c, S) {
  const routineName = id => (S?.routines || []).find(r => r.id === id)?.name || id
  const fmt = v => {
    // `week` first — its value is a routine-id list (an array is also an object, so it has to
    // win before the generic branches). Render as " + "-joined routine names; null / empty /
    // "rest" all read as Rest.
    if (c.type === 'week') {
      const ids = [].concat(v ?? []).filter(x => x && x !== 'rest')
      return ids.length ? ids.map(routineName).join(' + ') : t('Rest')
    }
    if (v == null) return '—'
    if (typeof v === 'object') return v.id ? exTitle(v.id) : v.name || JSON.stringify(v)
    if (Array.isArray(v)) return v.length + ''
    return String(v)
  }
  if (['add-exercise', 'add-routine', 'reorder'].includes(c.type)) return null
  if (['remove-exercise', 'remove-routine'].includes(c.type)) return null
  return { before: fmt(c.before), after: fmt(c.after) }
}
