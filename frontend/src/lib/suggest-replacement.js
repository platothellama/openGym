// Smart replacement for a single routine slot (#110 follow-up).
//
// When you replace one exercise in a plan, the picker used to be a blank catalogue:
// it knew your equipment profile and nothing else. This ranks the catalogue against
// everything the app already knows about that slot — no server, no AI provider, no
// consent or caps involved — so it works offline, in guest mode, and on a build
// whose Coach was never set up:
//
//   - the slot itself: same cardio-vs-lifting mode, same target muscle first;
//   - the routine around it: the replacement should keep what the session hits,
//     not duplicate a muscle two other exercises already cover;
//   - your history: trained-before beats never-tried, a stalled exercise loses,
//     favourites float;
//   - your profile: equipment availability, coach dislikes.
//
// Pure and framework-free like the rest of lib/: (S, routineId, slotIndex) in,
// [{ id, score, reasons }] out. Reasons are stable codes; the sheet maps them to
// sentences so this stays out of i18n.

import { allExercises, isCardio } from './exercises.js'
import { musclesOf } from './muscles.js'
import { exAvailable } from './equipment.js'
import { modeOf } from './history.js'
import { sessionsFor, stallCount } from './progression.js'
import { isFav } from './favourites.js'

export const SUGGESTION_LIMIT = 3

// Reason codes returned in `reasons`. The picker renders at most two each.
export const REASONS = {
  SAME_TARGET: 'same-target',
  SAME_MUSCLES: 'same-muscles',
  SAME_EQUIPMENT: 'same-equipment',
  TRAINED: 'trained',
  FAVOURITE: 'favourite',
  FRESH: 'fresh',
  STALLED: 'stalled-avoided',
}

const norm = v => String(v || '').toLowerCase().trim()

function catalogueOf(S, id) {
  return allExercises(S).find(e => e && e.id === id) || null
}

function trainedCount(S, id) {
  let n = 0
  for (const w of S?.workouts || []) {
    if ((w?.entries || []).some(e => e && e.id === id)) n++
  }
  return n
}

function isStalled(S, id, slot) {
  try {
    const sessions = sessionsFor(S, id, slot, null)
    return stallCount(sessions, 'linear') >= 2
  } catch {
    return false
  }
}

function disliked(S, ex) {
  const d = norm(S?.coach?.profile?.dislikes)
  if (!d) return false
  const hay = norm(ex.n) + ' ' + norm(ex.eq) + ' ' + norm(ex.bp)
  return d.split(/[,;.\n]+/).map(s => s.trim()).filter(Boolean)
    .some(token => token.length > 2 && hay.includes(token))
}

/** Muscle-overlap 0…1 between two catalogue entries, weighted by primary (1) vs support (0.4). */
export function muscleOverlap(a, b) {
  const ma = musclesOf(a)
  const mb = musclesOf(b)
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)])
  if (!keys.size) return 0
  let same = 0
  let all = 0
  for (const k of keys) {
    const x = Number(ma[k]) || 0
    const y = Number(mb[k]) || 0
    same += Math.min(x, y)
    all += Math.max(x, y)
  }
  return all > 0 ? same / all : 0
}

function targetOf(ex) {
  return norm(ex?.tg) || norm(ex?.primaries?.[0]) || norm((ex?.muscleGroups || [])[0]) || ''
}

export function suggestReplacements(S, routineId, slotIndex, { limit = SUGGESTION_LIMIT } = {}) {
  const routine = (S?.routines || []).find(r => r && r.id === routineId)
  const slot = routine?.ex?.[slotIndex]
  if (!routine || !slot) return []
  const oldCat = catalogueOf(S, slot.id)
  if (!oldCat) return []
  const oldMode = modeOf(slot)
  const oldIsCardio = oldMode === 'cardio' || isCardio(slot.id)
  const oldTarget = targetOf(oldCat)
  const inRoutine = new Set((routine.ex || []).map(e => e?.id))
  // What the rest of the session already hits — a candidate whose target is covered
  // twice over adds a third of the same, not a replacement for what leaves.
  const restTargets = {}
  ;(routine.ex || []).forEach((e, i) => {
    if (i === slotIndex || !e) return
    const c = catalogueOf(S, e.id)
    const tg = c ? targetOf(c) : ''
    if (tg) restTargets[tg] = (restTargets[tg] || 0) + 1
  })

  const out = []
  for (const cand of allExercises(S)) {
    if (!cand || !cand.id || cand.id === slot.id || inRoutine.has(cand.id)) continue
    if ((isCardio(cand.id) || isCardio(cand)) !== oldIsCardio) continue
    if (!exAvailable(S, cand)) continue
    if (disliked(S, cand)) continue

    const overlap = muscleOverlap(oldCat, cand)
    // A different body part with zero shared muscle is not a replacement, it is a
    // different session. Cardio is the exception: any cardio keeps a cardio slot.
    if (!oldIsCardio && overlap <= 0) continue

    let score = overlap * 4
    const reasons = []
    const candTarget = targetOf(cand)
    if (candTarget && candTarget === oldTarget) {
      score += 2
      reasons.push(REASONS.SAME_TARGET)
    } else if (overlap >= 0.5) {
      reasons.push(REASONS.SAME_MUSCLES)
    }
    if (norm(cand.eq) && norm(cand.eq) === norm(oldCat.eq)) {
      score += 1
    }
    const used = trainedCount(S, cand.id)
    if (used > 0) {
      score += 1
      reasons.push(REASONS.TRAINED)
    }
    if (isFav(S, cand.id)) {
      score += 1
      reasons.push(REASONS.FAVOURITE)
    }
    if (norm(cand.eq) && norm(cand.eq) === norm(oldCat.eq)) {
      reasons.push(REASONS.SAME_EQUIPMENT)
    }
    if (used <= 0) {
      reasons.push(REASONS.FRESH)
    }
    if (candTarget && (restTargets[candTarget] || 0) >= 2) score -= 1.5
    if (isStalled(S, cand.id, slot)) score -= 2
    out.push({ id: cand.id, score, reasons: reasons.slice(0, 2) })
  }

  out.sort((a, b) =>
    (b.score - a.score) ||
    (trainedCount(S, b.id) - trainedCount(S, a.id)) ||
    (a.id < b.id ? -1 : 1))
  return out.slice(0, Math.max(0, limit))
}
