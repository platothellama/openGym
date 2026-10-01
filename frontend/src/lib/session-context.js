// The context the LLM Coach needs to tune one session, built from state the app already has.
//
// The server cannot build this. api/coach/core/ is framework-free on purpose — it never
// imports the app's progression engine — so a `session` job is sent the routine it is about to
// train, the last few times each of its exercises was trained, and the app's own deterministic
// prescription, and is told to adjust the prescription rather than reinvent it. That is also why
// this lives here and is pure: whatever the Coach is shown has to be the numbers the bar is
// actually holding, read on the spot rather than reconstructed from what was saved.
//
// Three blocks, three sources:
//   routine - the live entries, which are the session as built (progression, training system,
//             muscle ledger and the readiness overlay already applied). Not the routine: the
//             session may have been edited, and the Coach tunes what is on the screen.
//   history - the last few counting sessions per exercise, from the log, in the shape
//             session-suggest.exerciseHistory already builds for a "why this number" line.
//   base    - the prescription the app itself arrived at, per exercise. `kind` is the
//             progression verdict, which is the one thing the model cannot guess: an 'up' the
//             engine earned and a 'hold' mean the same weight and opposite days.
//
// Bounds live on the server (payload.js) and are re-applied client-side before anything is
// written into a live session (coach.js validateSessionTargets), so a wider value here is
// harmless: it is dropped rather than obeyed.

import { exerciseHistory, restBaseOf, DEFAULT_REST_SEC } from './session-suggest.js'
import { modeOf, isPerSide } from './history.js'
import { t } from './i18n.js'

// Mirrors SESSION_MAX_EX / SESSION_HISTORY_PER_EX in api/coach/core/payload.js. Sent smaller
// than the ceiling so the builder and the server agree on what a session looks like.
const MAX_EX = 20
const HISTORY_PER_EX = 5

// The prescription vocabulary (progression.js), the same five payload.js accepts.
const KINDS = ['first', 'up', 'hold', 'deload', 'off']
const POLICY_POLICIES = ['off', 'linear', 'greyskull', 'double', 'time']

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** A number that is really there, for a field the payload will drop otherwise. */
const put = (o, k, v) => {
  const n = num(v)
  if (n !== null) o[k] = n
  return o
}

/** One exercise as the Coach reads it: what mode it is, and the numbers in play. */
function exerciseOf(entry) {
  const t = entry?.target || {}
  const mode = modeOf(t)
  const ex = { id: entry?.id, mode }
  put(ex, 'sets', t.sets)
  // A timed exercise carries its own duration, a rep set its own count; only the one the mode
  // reads is sent, so the model is not left choosing between a 45s hold and 45 reps.
  if (mode === 'time') put(ex, 'sec', t.sec)
  else if (mode === 'cardio') { put(ex, 'min', t.min); put(ex, 'speed', t.speed) }
  else put(ex, 'reps', t.reps)
  put(ex, 'weight', t.weight)
  put(ex, 'restSec', t.restSec)
  if (POLICY_POLICIES.includes(t.prog)) ex.prog = t.prog
  put(ex, 'inc', t.inc)
  put(ex, 'repsMin', t.repsMin)
  put(ex, 'repsMax', t.repsMax)
  // Two flags that decide what progress is allowed to look like at all: a bodyweight exercise
  // progresses in reps and sets and must never gain an invented load, and a per-side one moves
  // in pairs so an odd total would put a rep on one side and not the other.
  if (t.bodyweight != null) ex.bodyweight = !!t.bodyweight
  if (isPerSide(t)) ex.side = true
  return ex
}

/** One exercise's recent sessions, in the shape the payload reads.
 *
 * `exerciseHistory` keeps the per-set reps as an array, because it was written for the "why this
 * number" line a person reads. Here it becomes the payload's row: `summary` already carries the
 * set-by-set detail, so `reps` is the total across those sets — the figure a "did this climb"
 * read rests on — and a row with no date is left out, because a session that cannot be placed in
 * the sequence is not evidence of anything.
 */
function historyOf(S, id) {
  return exerciseHistory(S, id, HISTORY_PER_EX)
    .filter(r => r && r.d)
    .map(r => ({
      d: r.d,
      summary: r.summary,
      weight: r.weight,
      reps: (Array.isArray(r.reps) ? r.reps : [r.reps]).reduce((a, b) => a + (Number(b) || 0), 0),
    }))
}

/** The app's prescription for one exercise: the default the Coach is told to adjust. */
function baseOf(entry, S) {
  const t = entry?.target || {}
  const mode = modeOf(t)
  const out = {}
  if (mode === 'time') put(out, 'sec', t.sec)
  else if (mode === 'cardio') { put(out, 'min', t.min); put(out, 'speed', t.speed) }
  else put(out, 'reps', t.reps)
  put(out, 'weight', t.weight)
  put(out, 'sets', t.sets)
  // The rest actually in play: the exercise's own, else the profile default the session falls
  // back to. A base that said something else would have the model arguing with the rest timer.
  // A rest of 0 is an answer the session really gives - two exercises in a circuit, or a warm-up
  // move between heavy sets - so it is sent as 0 rather than replaced by a default it does not
  // have. Only an exercise that states nothing falls back.
  const stated = t.restSec == null ? null : Math.round(num(t.restSec))
  const rest = stated == null ? restBaseOf(t, S) : Math.max(0, stated)
  out.restSec = rest > 0 ? Math.min(300, rest) : (stated === 0 ? 0 : DEFAULT_REST_SEC)
  if (KINDS.includes(entry?.plan?.kind)) out.kind = entry.plan.kind
  return out
}

/**
 * `{ routine, history, base }` for the session about to be trained.
 *
 * `entries` are the live session entries — `buildPlannedEntry`'s output, the same objects
 * `applySessionTargets` writes back into — so what the Coach is asked about and what would be
 * changed are the same objects. `S` is the app state, read for the log (`history`) and the
 * default rest (`base`).
 *
 * `opts.routineId` / `opts.routineName` / `opts.prog` name the routine when the session has one;
 * a merged session (`session-merge`) has no single routine and sends none, which is honest —
 * the exercises are still named and bounded individually.
 *
 * Returns null when there is nothing to tune: no entries, or none of them carrying an id.
 * `yesterday` / `today` / `fitai` are the FitAI bridge's blocks - the two single days and the
 * seven-day window - passed through as given (null when the profile is not linked), never
 * derived here.
 */
export function buildSessionContext(entries, S = {}, opts = {}) {
  const live = (entries || []).filter(e => e && typeof e === 'object' && typeof e.id === 'string' && e.id).slice(0, MAX_EX)
  if (!live.length) return null

  const routine = {
    id: typeof opts.routineId === 'string' ? opts.routineId : null,
    name: typeof opts.routineName === 'string' && opts.routineName ? opts.routineName : null,
    prog: POLICY_POLICIES.includes(opts.prog) ? opts.prog : null,
    ex: live.map(exerciseOf),
  }
  // A null field is not sent at all rather than sent as null: the payload builder reads a value
  // of the wrong shape as absent, and a name the app does not have is better absent than empty.
  for (const k of ['id', 'name', 'prog']) if (!routine[k]) delete routine[k]

  const history = {}
  const base = {}
  for (const entry of live) {
    const rows = historyOf(S, entry.id)
    if (rows.length) history[entry.id] = rows
    base[entry.id] = baseOf(entry, S)
  }

  return { routine, history, base, yesterday: opts.yesterday || null, today: opts.today || null, fitai: opts.fitai || null }
}

/**
 * One FitAI day in the shape the Coach's prompt reads it (`yesterday` / `today`).
 *
 * The bridge hands back a whole day: the meals, the glucose rows, the fasting log, the activity
 * totals. None of that travels - the prompt wants eight numbers and whether a fast touched the
 * day, and a day's worth of meal rows is neither. So this is the one place the bridge's shape is
 * known, and it is where a value that is absent stays absent rather than becoming a zero the
 * Coach would read as "logged nothing".
 *
 * A day with no usable date is not sent at all: the payload builder dates each row against
 * `meta.today`, and an undated one cannot be placed.
 */
export function fitaiDayBlock(day) {
  const d = day && typeof day === 'object' ? day : null
  if (!d) return null
  const date = typeof d.date === 'string' ? d.date.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const out = { date }
  const tot = d.totals || {}
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const v = num(tot[k]); if (v !== undefined) out[k] = v
  }
  const act = d.activity || {}
  for (const k of ['sleepH', 'restingHr', 'steps', 'activeKcal']) {
    const v = num(act[k]); if (v !== undefined) out[k] = v
  }
  // "Trained fasted" is one of the few reasons a session answer can honestly hold a jump, so the
  // protocol is named when the bridge knows it and the fact is carried either way.
  if (d.fasting && typeof d.fasting === 'object') {
    const p = typeof d.fasting.protocol === 'string' ? d.fasting.protocol.slice(0, 24) : ''
    out.fasting = p || t('fasted')
  }
  return out
}