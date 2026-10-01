/* eslint-env vitest */
import { describe, it, expect } from 'vitest'
import { muscleLedger, muscleVerdict, ledgerSummary, OVER_FATIGUE, LEDGER_WEEKS } from './muscle-ledger.js'

// A fixed clock keeps "this week" stable no matter when the suite runs. Built in local time and
// formatted locally, because the ledger reads dates as local calendar days — a UTC slice here
// would put a session on the wrong day (or the wrong week) in half the world's timezones.
const NOW = (() => { const d = new Date(2026, 5, 17, 12, 0, 0); return d.getTime() })() // Wed 17 Jun 2026
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

function day(offset) {
  return iso(new Date(NOW + offset * 86400000))
}

const BENCH = {
  id: 'bench',
  n: 'Barbell bench press',
  bp: 'chest',
  tg: 'pectorals',
  mg: 'triceps',
  sm: 'deltoids'
}
const SQUAT = { id: 'squat', n: 'Back squat', bp: 'upper legs', tg: 'quadriceps', mg: 'hamstrings', sm: 'glutes' }
const CURL = { id: 'curl', n: 'Barbell curl', bp: 'arms', tg: 'biceps' }

// The stored row shape is { w, r, done }, and a set only counts as hard when it is rated within
// HARD_RIR of failure (effort.js:185 — unrated is neither hard nor easy).
const hardSet = (w = 60, r = 8) => ({ done: true, w, r, rir: 2 })
const easySet = (w = 60, r = 8) => ({ done: true, w, r, rir: 5 })
const unratedSet = (w = 60, r = 8) => ({ done: true, w, r })

function session(daysAgo, entries) {
  const at = new Date(NOW - daysAgo * 86400000)
  return { d: iso(at), start: at.getTime(), entries }
}

const profile = (over = {}) => ({ trainSystem: 'hypertrophy', weekStart: 1, workouts: [], ...over })

describe('muscleLedger', () => {
  it('is all-fresh and targetless with no system and no log', () => {
    const l = muscleLedger(profile({ trainSystem: 'off' }), NOW)
    expect(l.on).toBe(false)
    expect(l.muscles.chest.target).toBeNull()
    expect(l.muscles.chest.state).toBe('fresh')
    expect(l.muscles.chest.weekHard).toBe(0)
  })

  it('reads the system weekly target per muscle', () => {
    const l = muscleLedger(profile(), NOW)
    expect(l.on).toBe(true)
    expect(l.systemId).toBe('hypertrophy')
    expect(l.muscles.chest.target).toBe(22)   // large
    expect(l.muscles.deltoids.target).toBe(16) // medium
    expect(l.muscles.forearm.target).toBe(10)  // small
  })

  it('counts hard sets this week and reports the state ladder', () => {
    const st = profile({ workouts: [session(1, [{ exercise: BENCH, sets: [hardSet(), hardSet(), hardSet()] }])] })
    const l = muscleLedger(st, NOW)
    expect(l.muscles.chest.weekHard).toBe(3)
    expect(l.muscles.chest.sessionsWeek).toBe(1)
    expect(l.muscles.chest.state).toBe('under')
    expect(l.muscles.chest.daysSince).toBe(1)
  })

  it('counts a superset of two chest exercises as one chest session, and four hard sets', () => {
    const FLY = { id: 'fly', n: 'Cable fly', bp: 'chest', tg: 'pectorals' }
    const st = profile({ workouts: [session(1, [
      { exercise: BENCH, sets: [hardSet(), hardSet()] },
      { exercise: FLY, sets: [hardSet(), hardSet()] }
    ])] })
    const l = muscleLedger(st, NOW)
    expect(l.muscles.chest.weekHard).toBe(4)
    expect(l.muscles.chest.sessionsWeek).toBe(1)
  })

  it('goes near at one under the cap and over at the cap', () => {
    const sets = n => Array.from({ length: n }, () => hardSet())
    const near = muscleLedger(profile({ workouts: [session(2, [{ exercise: SQUAT, sets: sets(21) }])] }), NOW)
    expect(near.muscles.quadriceps.weekHard).toBe(21)
    expect(near.muscles.quadriceps.state).toBe('near')

    const over = muscleLedger(profile({ workouts: [session(2, [{ exercise: SQUAT, sets: sets(22) }])] }), NOW)
    expect(over.muscles.quadriceps.state).toBe('over')
  })

  it('ignores sets that are not hard, and unrated ones', () => {
    const easy = profile({ workouts: [session(1, [{ exercise: BENCH, sets: [easySet(), easySet()] }])] })
    expect(muscleLedger(easy, NOW).muscles.chest.weekHard).toBe(0)

    const unrated = profile({ workouts: [session(1, [{ exercise: BENCH, sets: [unratedSet(), unratedSet()] }])] })
    expect(muscleLedger(unrated, NOW).muscles.chest.weekHard).toBe(0)

    const notDone = profile({ workouts: [session(1, [{ exercise: BENCH, sets: [{ ...hardSet(), done: false }] }])] })
    expect(muscleLedger(notDone, NOW).muscles.chest.weekHard).toBe(0)
  })

  it('counts a set into every muscle the exercise trains', () => {
    const st = profile({ workouts: [session(1, [{ exercise: BENCH, sets: [hardSet()] }])] })
    const l = muscleLedger(st, NOW)
    expect(l.muscles.chest.weekHard).toBe(1)
    expect(l.muscles.triceps.weekHard).toBe(1)
    expect(l.muscles.deltoids.weekHard).toBe(1)
  })

  it('skips warmup rows', () => {
    const st = profile({ workouts: [session(1, [{ exercise: BENCH, sets: [{ ...hardSet(), warmup: true }, hardSet()] }])] })
    expect(muscleLedger(st, NOW).muscles.chest.weekHard).toBe(1)
  })

  it('keeps each week separate and reads the last LEDGER_WEEKS', () => {
    const sets = n => Array.from({ length: n }, () => hardSet())
    const st = profile({
      workouts: [
        session(1, [{ exercise: CHEST_ONLY(), sets: sets(4) }]),
        session(8, [{ exercise: CHEST_ONLY(), sets: sets(6) }]),
        session(15, [{ exercise: CHEST_ONLY(), sets: sets(2) }])
      ]
    })
    const l = muscleLedger(st, NOW)
    expect(l.weeks).toHaveLength(LEDGER_WEEKS)
    expect(l.muscles.chest.hardSets[l.weeks.length - 1]).toBe(4)
    expect(l.muscles.chest.hardSets[l.weeks.length - 2]).toBe(6)
    expect(l.muscles.chest.hardSets[l.weeks.length - 3]).toBe(2)
    expect(l.weekHard).toBeUndefined() // the ledger exposes no shorthand; rows carry the numbers
    expect(l.muscles.chest.weekHard).toBe(4)
  })

  it('reads a workout filed under a past date into that week, not today', () => {
    const sets = n => Array.from({ length: n }, () => hardSet())
    // 10 days back lands before this week's start, so it must not count toward this week.
    const lastWeek = profile({ workouts: [session(10, [{ exercise: CURL, sets: sets(3) }])] })
    const l = muscleLedger(lastWeek, NOW)
    expect(l.muscles.biceps.weekHard).toBe(0)
    expect(l.muscles.biceps.hardSets.reduce((a, b) => a + b, 0)).toBe(3)

    // One day back is inside this week (Mon 15 - Sun 21 Jun), so it counts now. Note 3 days back
    // would NOT: Wed 17 minus 3 is Sun 14, which a Monday-start week files under the week before.
    const thisWeek = profile({ workouts: [session(1, [{ exercise: CURL, sets: [hardSet()] }])] })
    expect(muscleLedger(thisWeek, NOW).muscles.biceps.weekHard).toBe(1)
  })

  it('drops workouts outside the ledger horizon', () => {
    const st = profile({ workouts: [session(LEDGER_WEEKS * 7 + 3, [{ exercise: CURL, sets: [hardSet()] }])] })
    expect(muscleLedger(st, NOW).muscles.biceps.weekHard).toBe(0)
  })

  it('reports overWeeks for consecutive over-cap weeks', () => {
    const sets = n => Array.from({ length: n }, () => hardSet())
    const st = profile({
      workouts: [
        session(1, [{ exercise: CHEST_ONLY(), sets: sets(25) }]),
        session(8, [{ exercise: CHEST_ONLY(), sets: sets(24) }]),
        session(15, [{ exercise: CHEST_ONLY(), sets: sets(1) }])
      ]
    })
    const l = muscleLedger(st, NOW)
    expect(l.muscles.chest.overWeeks).toBe(2)
  })

  it('an exercise with no recognised muscle is left alone', () => {
    expect(muscleVerdict(muscleLedger(profile(), NOW), { id: 'zz', n: 'Mystery' }).action).toBe('progress')
  })
})

function CHEST_ONLY() {
  return { id: 'c', n: 'Cable fly', bp: 'chest', tg: 'pectorals' }
}

describe('muscleVerdict', () => {
  const over = sets => profile({ workouts: [session(1, [{ exercise: CHEST_ONLY(), sets }])] })
  const many = n => Array.from({ length: n }, () => hardSet())

  it('progresses under the cap with no reason of its own', () => {
    const l = muscleLedger(over(many(3)), NOW)
    const v = muscleVerdict(l, CHEST_ONLY())
    expect(v.action).toBe('progress')
    expect(v.why).toBeNull()
  })

  it('holds at the cap and says which muscle and what the target is', () => {
    const l = muscleLedger(over(many(22)), NOW)
    const v = muscleVerdict(l, CHEST_ONLY())
    expect(v.action).toBe('hold')
    expect(v.muscles).toContain('chest')
    // `why` is ONE [template, ...args] tuple, the shape progression.js emits for t(...why)
    expect(v.why[0]).toContain('{1}')
    expect(v.why[1]).toBe('Chest')
    expect(v.why[2]).toBe(22)
  })

  it('names the secondary that escalated the verdict, not the lead muscle', () => {
    const triceps = { id: 'ext', n: 'Triceps pushdown', bp: 'arms', tg: 'triceps' }
    const st = profile({
      workouts: [
        session(1, [{ exercise: triceps, sets: many(12) }]),
        session(2, [{ exercise: triceps, sets: many(12) }])
      ]
    })
    const v = muscleVerdict(muscleLedger(st, NOW), BENCH)
    expect(v.action).toBe('hold')
    expect(v.muscles).toEqual(['triceps'])
    expect(v.why[1]).toBe('Triceps')
  })

  it('deloads only on sustained overload, not a single hard week', () => {
    // Two consecutive over-cap weeks.
    const st = profile({
      workouts: [
        session(1, [{ exercise: CHEST_ONLY(), sets: many(25) }]),
        session(8, [{ exercise: CHEST_ONLY(), sets: many(25) }])
      ]
    })
    expect(muscleVerdict(muscleLedger(st, NOW), CHEST_ONLY()).action).toBe('deload')
  })

  it('an over-cap secondary muscle holds the exercise', () => {
    // Triceps (a 0.4 secondary on a bench press) well over its cap; chest untouched.
    const triceps = { id: 'ext', n: 'Triceps pushdown', bp: 'arms', tg: 'triceps' }
    const st = profile({
      workouts: [
        session(1, [{ exercise: triceps, sets: many(12) }]),
        session(2, [{ exercise: triceps, sets: many(12) }])
      ]
    })
    const v = muscleVerdict(muscleLedger(st, NOW), BENCH)
    expect(v.action).toBe('hold')
    expect(v.muscles).toEqual(['triceps'])
  })

  it('a secondary muscle alone cannot deload the exercise', () => {
    // Triceps over cap for two weeks running, chest still under: the lead muscle decides.
    const triceps = { id: 'ext', n: 'Triceps pushdown', bp: 'arms', tg: 'triceps' }
    const st = profile({
      workouts: [
        session(1, [{ exercise: triceps, sets: many(14) }]),
        session(8, [{ exercise: triceps, sets: many(14) }])
      ]
    })
    expect(muscleVerdict(muscleLedger(st, NOW), BENCH).action).toBe('progress')
  })

  it('does not auto-set unless asked, then only by one set', () => {
    const under = profile({ workouts: [session(1, [{ exercise: CHEST_ONLY(), sets: many(1) }])] })
    const l = muscleLedger(under, NOW)
    expect(muscleVerdict(l, CHEST_ONLY()).setDelta).toBe(0)
    expect(muscleVerdict(l, CHEST_ONLY(), { autoSets: true }).setDelta).toBe(1)
  })

  it('does not auto-add a set when the muscle is only near its cap', () => {
    const l = muscleLedger(over(many(21)), NOW)
    expect(muscleVerdict(l, CHEST_ONLY(), { autoSets: true }).setDelta).toBe(0)
  })

  it('drops a set when far over cap', () => {
    const l = muscleLedger(over(many(26)), NOW)
    expect(muscleVerdict(l, CHEST_ONLY(), { autoSets: true }).setDelta).toBe(-1)
  })

  it('holds on fatigue alone when no system sets a cap to judge against', () => {
    // Recovery needs a real tonnage, so this logs a barbell bench, not a synthetic entry.
    const sets = Array.from({ length: 14 }, () => hardSet(60, 8))
    const at = new Date(NOW - 86400000)
    const st = {
      trainSystem: 'off', weekStart: 1, bw: 80,
      workouts: [{ d: iso(at), start: at.getTime(), bw: 80, entries: [{ id: '0025', target: { sets: 14, reps: 8, weight: 60 }, sets }] }]
    }
    const l = muscleLedger(st, NOW, { bodyweightKg: 80 })
    expect(l.muscles.chest.target).toBeNull()
    expect(l.muscles.chest.fatigue).toBeGreaterThan(OVER_FATIGUE)
    const v = muscleVerdict(l, BENCH)
    expect(v.action).toBe('hold')
    expect(v.why[0]).toContain('has not recovered')
  })
})

describe('ledgerSummary', () => {
  it('summarises headline state per muscle list', () => {
    const many = n => Array.from({ length: n }, () => hardSet())
    const st = profile({ workouts: [session(1, [{ exercise: CHEST_ONLY(), sets: many(25) }])] })
    const s = ledgerSummary(st, NOW)
    expect(s.on).toBe(true)
    expect(s.headline).toBe('over')
    expect(s.over).toContain('chest')
    expect(s.rows.length).toBeGreaterThan(10)
  })

  it('with no system it reports fresh and no over list', () => {
    const s = ledgerSummary(profile({ trainSystem: 'off' }), NOW)
    expect(s.on).toBe(false)
    expect(s.headline).toBe('fresh')
    expect(s.over).toEqual([])
  })

  it('exposes the fatigue threshold it uses', () => {
    expect(typeof OVER_FATIGUE).toBe('number')
  })
})
