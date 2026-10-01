// The Coach, in the demo build.
//
// The GitHub Pages demo has no backend at all, so there is nothing to run a CLI and nothing
// to poll. Rather than hide the feature there — it is the most interesting thing the app
// does — the demo answers the same calls locally with a canned proposal.
//
// It is built from the demo profile's actual routines rather than hard-coded, so every id
// resolves, the before/after values are real, and applying it exercises exactly the same
// code path as a live instance: validate, snapshot, apply, log, revert. What is faked is the
// provider, not the feature.
//
// Nothing here ships in a self-hosted bundle: every entry point is behind DEMO, which Vite
// replaces at build time.

import { EXIDX, EXDB } from './exercises.js'
import { modeOf, workoutVolume } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { best1RM } from './onerm.js'
import { fmtNum } from './format.js'
import { planHash } from './coach.js'
import { ALL_DAYS, defaultDays } from './week-plan.js'
import { weekStartOf } from './format.js'
import { t } from './i18n.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'

const DELAY = 2200      // long enough to see "the Coach is thinking…", short enough to forgive

let pending = null
let job = null
let timer = null
let lastError = null    // the last job that ended without a proposal, in the server's shape

const iso = d => d.toISOString().slice(0, 10)

/** The routine the canned review aims at: the first with two exercises, one to swap and one to cut a set from. */
const reviewable = S => (S.routines || []).find(r => (r.ex || []).length >= 2)

/** A change-set that reads like a real one, aimed at whatever the demo profile actually has. */
function buildReview(S) {
  const routine = reviewable(S)
  if (!routine) return null
  const reps = (routine.ex || []).filter(e => modeOf(e) === 'reps')
  const first = reps[0] || routine.ex[0]
  // Anything but `first`: the two changes below swap `first` away and re-set `second`, so the
  // same entry in both aborts the whole change-set on apply (`missing target`). `reps[1]` was
  // not enough — a routine whose only rep-mode exercise sits at index 1 landed on it twice.
  const second = reps.find(e => e !== first) || routine.ex.find(e => e !== first)
  const other = (S.routines || []).find(r => r.id !== routine.id)

  // Something plausible that is *not* in this routine, from the same body part as the first
  // exercise — a swap the reader can believe rather than a random pick out of 1,324.
  const bp = EXIDX[first.id]?.bp
  const swapTo = EXDB.find(e => e.bp === bp && e.eq === 'dumbbell' && !(routine.ex || []).some(x => x.id === e.id))
    || EXDB.find(e => e.bp === bp && !(routine.ex || []).some(x => x.id === e.id))

  const sessions = (S.workouts || []).slice(-9)
  const changes = []
  if (swapTo) changes.push({
    id: 'd1', type: 'swap-exercise', target: { routineId: routine.id, exId: first.id },
    before: EXIDX[first.id]?.n || first.id, after: { id: swapTo.id, name: swapTo.n },
    why: t('Every top set on this one came in at RPE 9.5 or above for three sessions and the weight has not moved. Swapping the movement for four weeks usually breaks that stall faster than grinding the same one.')
  })
  if (second) changes.push({
    id: 'd2', type: 'sets', target: { routineId: routine.id, exId: second.id },
    before: second.sets ?? 3, after: Math.max(1, (second.sets ?? 3) - 1),
    why: t('Sessions have been running about fifteen minutes over. This is the accessory with the least to lose from one set fewer.')
  })
  if (other) changes.push({
    id: 'd3', type: 'week', target: { weekday: 6 }, before: null, after: other.id,
    why: t('You have moved this session to Saturday three weeks running. Better the plan says so than that you keep overriding it.')
  })

  return {
    id: 'demo-review', kind: 'review', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
    planHash: planHash(S), iteration: 1,
    summary: t('Three things worth changing, and one worth knowing about. Everything else is working — the squat and the pulls are both progressing on schedule.'),
    evidence: { from: sessions[0]?.d || iso(new Date(Date.now() - 28 * 864e5)), to: sessions.at(-1)?.d || iso(new Date()), sessions: sessions.length || 9 },
    changes,
    notes: [t('Body weight has been flat for four weeks while the goal is to gain. That is a kitchen problem rather than a training one — the plan is not what is holding it back.')]
  }
}

/** A small, honest starter plan for the demo's creation flow. */
function buildPlan(S, intake) {
  const pick = (bp, eq) => EXDB.find(e => e.bp === bp && (!eq || e.eq === eq)) || EXDB.find(e => e.bp === bp)
  // The week is built from the two answers the intake actually collects now — how many days, and
  // how many of those are optional — rather than from named weekdays, because there are none left
  // in the profile. A demo that ignored them would show a fixed Mon/Wed/Fri and no optional slots
  // to somebody who just said "four days, one of them optional", which is the model the rest of
  // the app now runs on.
  //
  // `preferredDays` is read first and only for its *count*: a profile written before the frequency
  // picker has that key and no `daysPerWeek`, and its days are the best evidence of how often this
  // person actually trains.
  const preferred = intake?.preferredDays?.length ? intake.preferredDays : null
  const wantDays = Number(intake?.daysPerWeek) || preferred?.length || 3
  const nDays = Math.min(ALL_DAYS.length, Math.max(1, Math.round(wantDays)))
  // The spread, in the order the person's week starts on, as everywhere else in the app.
  const days = preferred ? preferred.slice(0, nDays) : defaultDays(nDays, weekStartOf(S))
  // Bounded by the room the required days leave, exactly as the intake screen and the Plan
  // steppers bound it — a week cannot hold eleven days. The free days are the ones `days` did not
  // take, not the ones past a count: `days` comes from the spread table or the profile's own list,
  // and either can land anywhere in the week, so filtering on anything else can hand out a day the
  // plan already schedules and leave the two lists claiming the same slot.
  const wantOpt = Math.min(Number(intake?.optionalDays) || 0, ALL_DAYS.length - days.length)
  const optional = ALL_DAYS.filter(d => !days.includes(d)).slice(0, Math.max(0, wantOpt))
  const eq = (intake?.equipment || [])[0] || null
  const mk = (id, name, sets, reps, why) => ({ id, sets, reps, mode: 'reps', why })
  const routines = [
    {
      id: 'dr1', name: t('Full body A'), emoji: '💪', prog: 'linear',
      why: t('The two big lower-body and pressing patterns first, while you are fresh.'),
      ex: [
        mk(pick('upper legs', eq)?.id, null, 3, 8, t('The main lower-body driver — where most of the strength comes from.')),
        mk(pick('chest', eq)?.id, null, 3, 10, t('Horizontal pressing, the other half of the session.')),
        mk(pick('back', eq)?.id, null, 3, 10, t('A pull for every press, so the shoulders stay balanced.'))
      ].filter(e => e.id)
    },
    {
      id: 'dr2', name: t('Full body B'), emoji: '🏋️', prog: 'linear',
      why: t('The same patterns, different variations — enough overlap to progress, enough difference to stay fresh.'),
      ex: [
        mk(pick('upper legs', eq)?.id, null, 3, 10, t('Same pattern, higher reps than day A.')),
        mk(pick('shoulders', eq)?.id, null, 3, 10, t('Vertical pressing.')),
        mk(pick('upper arms', eq)?.id, null, 3, 12, t('Direct arm work, since you asked for it.'))
      ].filter(e => e.id)
    }
  ]
  const week = {}
  days.forEach((d, i) => { week[d] = routines[i % routines.length].id })
  // The optional slots, each with the easy session on it and named in `weekOptional` —
  // the same contract a real plan answers under, so the card and the merge treat the demo
  // exactly as they treat the Coach's. Omitted rather than `[]` when there are none, as
  // everywhere else. A library too small to fill even an easy day leaves the slots named
  // but unscheduled rather than answering with an empty routine the apply step would refuse.
  const easyEx = [
    mk(pick('upper legs', eq)?.id, null, 2, 10, t('Light legs at an easy pace — movement, not training.')),
    mk(pick('back', eq)?.id, null, 2, 12, t('Easy pulling to balance the week out.'))
  ].filter(e => e.id)
  const weekOptional = optional.length ? optional : undefined
  if (easyEx.length && weekOptional) {
    routines.push({
      id: 'dr-opt', name: t('Easy day'), emoji: '🚶', prog: 'off',
      why: t('An easy session for the optional days — show up or skip it, it never progresses.'),
      ex: easyEx
    })
    weekOptional.forEach(d => { week[d] = 'dr-opt' })
  }
  return {
    id: 'demo-plan', kind: 'create', createdAt: Date.now(), expiresAt: Date.now() + 864e5, iteration: 1,
    planHash: planHash(S),
    summary: t('A two-day rotation across {0} sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.', days.length),
    bundle: {
      opengym_plan: 1, name: t('Coach plan'),
      summary: t('A two-day rotation across {0} sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.', days.length),
      basedOn: (S.workouts || []).length ? t('Based on the training already in this demo profile.') : t('No training history yet — starting conservatively.'),
      week, routines, customEx: [], ...(weekOptional ? { weekOptional } : {})
    }
  }
}

/** One session, read back with its own numbers — no plan changes, just what a coach would say after. */
function buildDebrief(S, workoutId) {
  const all = (S.workouts || []).filter(w => w && w.d)
  const w = all.find(x => x.id === workoutId) || all[all.length - 1]
  if (!w) return null
  // workoutVolume() reads `w.entries` and `e.sets` without a guard; every other line here
  // tolerates both being absent. A workout carrying a date and nothing else therefore threw
  // inside the timer below, where at the time nothing caught it — the job stayed 'running'
  // for ever and every later request answered 409.
  const entries = (w.entries || []).map(en => ({ ...en, sets: en.sets || [] }))
  const done = entries.reduce((n, en) => n + en.sets.filter(s => s.done && !isWarmupRow(s)).length, 0)
  const planned = entries.reduce((n, en) => n + en.sets.filter(s => !isWarmupRow(s)).length, 0)
  const vol = Math.round(Number.isFinite(w.vol) ? w.vol : workoutVolume({ ...w, entries }))
  const prs = (w.prs || []).length
  const minutes = w.end && w.start ? Math.round((w.end - w.start) / 60000) : null
  const complete = planned > 0 && done >= planned
  const score = complete ? (prs ? 9 : 8) : 7
  const highlights = [
    complete ? t('Every planned set done — {0} of {1}.', done, planned) : t('{0} of {1} planned sets done.', done, planned),
    t('{0} {1} moved in total.', fmtNum(vol), S.unit)
  ]
  if (prs) highlights.push(t('{0} new personal records.', prs))
  const watch = minutes && minutes > 80 ? [t('{0} minutes is long — rest periods may be creeping up.', minutes)] : [t('Top sets logged without an effort rating; add RIR so the next review can read how hard they were.')]
  const nextTime = [complete ? t('Add the next load step on the main lift.') : t('Repeat the same loads and get every set.'), t('Keep the session under an hour and a quarter.')]
  return {
    id: 'demo-debrief', kind: 'debrief', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
    planHash: planHash(S), iteration: 1,
    workout: { id: w.id, d: w.d, name: w.name || null, minutes, vol, sets: done, prs },
    summary: complete
      ? t('A clean session: everything on the sheet got done and the loads held. This is exactly what progress looks like from the inside — unremarkable, repeated.')
      : t('Most of the work got done. One or two sets fell short, which is fine once — it becomes a signal if the same sets miss next time.'),
    score, highlights, watch, nextTime
  }
}

/**
 * Today's targets for the session about to be trained.
 *
 * Unlike the other two builders this one reads the context the app sent (lib/session-context.js)
 * rather than the profile: a session is not in the state yet, so the routine, the recent
 * sessions and the prescription all travel with the request. Everything below is therefore read
 * out of `context`, and the same rules the prompt states are applied to it — the numbers that
 * come back are inside the bounds the app's validator holds, so applying one here exercises the
 * same code path a live instance would.
 */
function buildSession(S, context) {
  const ex = (context?.routine?.ex || []).slice(0, 20)
  if (!ex.length) return null
  const shortSleep = [context.today?.sleepH, context.yesterday?.sleepH]
    .some(h => Number.isFinite(Number(h)) && Number(h) < 6)
  const fasted = !!(context.today?.fasted || context.yesterday?.fasted)

  const targets = ex.map(e => {
    const b = context.base?.[e.id] || {}
    const t2 = { id: e.id }
    const rows = context.history?.[e.id] || []
    const last = rows.at(-1) || null
    const prev = rows.at(-2) || null
    // The one signal the demo can always read: did the last session reach the plan it was
    // opened with. `reps` on a history row is the total across its sets.
    const wanted = Number(b.reps) > 0 && Number(b.sets) > 0 ? Number(b.reps) * Number(b.sets) : null
    const missed = !!(wanted != null && last && Number(last.reps) < wanted)

    // A day that is short on sleep or trained fasted holds the jump and takes the extra rest —
    // the prompt's own cautious-day rule, in the order it states them.
    if (b.kind === 'up' && (shortSleep || fasted)) {
      if (prev && Number(prev.weight) > 0) t2.weight = Number(prev.weight)
      if (b.restSec > 0) t2.restSec = Math.min(300, Math.round(b.restSec) + 30)
      t2.why = shortSleep
        ? t('Short sleep — repeating the weight you lifted before this step and taking a little longer between sets.')
        : t('Training fasted — holding the last weight and resting a little longer rather than climbing.')
    } else if (b.kind === 'up' && missed) {
      if (prev && Number(prev.weight) > 0) t2.weight = Number(prev.weight)
      if (b.restSec > 0) t2.restSec = Math.min(300, Math.round(b.restSec) + 30)
      t2.why = t('Last session came in under the plan — repeating the previous weight and adding rest before climbing again.')
    } else if (b.kind === 'deload') {
      t2.why = t('This is a deload week — the numbers stay where the plan put them so the fatigue has somewhere to go.')
    } else {
      t2.why = t('Nothing in the last few sessions argues for a change, so today runs exactly as planned.')
    }
    return t2
  })

  const held = targets.filter(x => Object.keys(x).length > 2).length
  return {
    id: 'demo-session', kind: 'session', createdAt: Date.now(), expiresAt: Date.now() + 864e5, iteration: 1,
    planHash: planHash(S),
    summary: held
      ? t('Tuned {0} of {1} exercises against the last few sessions — the rest run exactly as the plan built them.', held, targets.length)
      : t('Every exercise runs exactly as the plan built it: nothing in the last few sessions argues for a change today.'),
    targets
  }
}

/** What "the room" would say on a busy instance — five people, plausible medians, your real bests. */
export function demoCohort(S) {
  const since = Date.now() - 56 * 864e5
  const you = Math.round((S.workouts || []).filter(w => (w.start || new Date(w.d).getTime()) > since).length / 8 * 10) / 10
  const ids = [...new Set((S.routines || []).flatMap(r => (r.ex || []).map(e => e.id)))].slice(0, 5)
  const exercises = ids.map(id => {
    const b = best1RM(S, id)
    const mine = b ? Math.round(b.est * 10) / 10 : null
    return { id, name: EXIDX[id]?.n || id, people: 4, median: mine ? Math.round(mine * 0.92) : 60, you: mine }
  })
  return { ok: true, enabled: true, sharing: true, people: 5, minPeople: 3, unit: S.unit, sessionsPerWeek: { median: 3, you }, exercises, rankPct: 62 }
}

/* ---------------- the API surface the demo stands in for ---------------- */

export const demoStatus = () => ({ job, pending, cap: { used: 0, limit: 0 }, lastError })

function start(kind, make) {
  if (job) throw Object.assign(new Error(t('The Coach is already thinking about your training.')), { status: 409 })
  job = { id: 'demo-' + kind, kind, state: 'running', startedAt: Date.now() }
  lastError = null
  clearTimeout(timer)
  // A builder that throws still has to end the job: left uncaught, one throw kept `job` at
  // 'running' for ever and every later request answered 409 until the page was reloaded. The
  // failure is recorded the way the server and the phone record theirs, so the chat's
  // job-ended effect writes the same error line it would for them. `nostate` because the only
  // thing a builder can trip over is the shape of the profile's own data.
  timer = setTimeout(() => {
    try { pending = make() }
    catch (e) { lastError = { errorClass: 'nostate', detail: String(e && e.message || e) } }
    finally { job = null }
  }, DELAY)
  return { job }
}
export const demoReview = S => {
  // Refused before the job starts, the way demoDebrief refuses with no workout: without a
  // two-exercise routine buildReview has nothing to aim at, and a job that runs the whole wait
  // and ends with neither a proposal nor an error reads as the Coach ignoring you.
  if (!reviewable(S)) throw Object.assign(new Error(t('There is no routine to review yet — build one with at least two exercises first.')), { status: 409, code: 'noroutine' })
  return start('review', () => buildReview(S))
}
export const demoPlan = (S, intake) => start('create', () => buildPlan(S, intake))
// A refine re-reads the saved answers, as the server's payload does when a refine carries no
// intake of its own (`opts.intake || coach.profile`). Built from nothing, every revised plan
// went back to Mon/Wed/Fri whatever days were chosen at intake.
export const demoRefine = S => start('create', () => {
  const p = buildPlan(S, S.coach?.profile || null)
  return { ...p, iteration: (pending?.iteration || 1) + 1, summary: t('Revised as you asked. Everything you did not question is exactly as it was.') + ' ' + p.summary }
})
export const demoDebrief = (S, workoutId) => {
  if (!(S.workouts || []).some(w => w && w.d)) throw Object.assign(new Error(t('There is no workout to look at yet — log one first.')), { status: 409, code: 'noworkout' })
  return start('debrief', () => buildDebrief(S, workoutId))
}
/* Asked from inside a running session, with that session's context. Refused without a routine for
   the same reason the other two refuse: a job that waits and then produces nothing reads as the
   Coach ignoring you. */
export const demoSession = (S, context) => {
  if (!(context?.routine?.ex || []).length) throw Object.assign(new Error(t('There is no routine to tune yet — the Coach needs the session you are about to train.')), { status: 409, code: 'nosession' })
  return start('session', () => buildSession(S, context))
}
export const demoResolve = () => { pending = null; return { ok: true } }
export const demoDisclosure = () => ({
  provider: 'demo', providerLabel: t('the configured AI provider'),
  categories: [...DATA_CATEGORIES], version: 1
})
