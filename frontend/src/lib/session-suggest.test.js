import { describe, test, expect } from 'vitest'
import { exerciseHistory, readinessOf, adjustPrescription, applySessionTargets, restBaseOf, suggestTargets, readinessLevelOf } from './session-suggest.js'

const ex = (id, sets) => ({ id, sets })
const done = (w, r) => ({ w, r, done: true })

describe('exerciseHistory', () => {
  test('reads last sessions oldest-first as lifter shorthand', () => {
    const S = {
      workouts: [
        { d: '2026-09-20', entries: [ex('bench', [done(50, 10), done(50, 10), done(50, 10)])] },
        { d: '2026-09-23', entries: [ex('bench', [done(55, 10), done(55, 10)])] },
        { d: '2026-09-27', entries: [ex('bench', [done(65, 12), done(65, 10)])] },
      ]
    }
    expect(exerciseHistory(S, 'bench', 5)).toEqual([
      { d: '2026-09-20', summary: '50×10,10,10', weight: 50, reps: [10, 10, 10] },
      { d: '2026-09-23', summary: '55×10,10', weight: 55, reps: [10, 10] },
      { d: '2026-09-27', summary: '65×12,10', weight: 65, reps: [12, 10] },
    ])
  })
  test('skips warm-ups and undone sets', () => {
    const S = {
      workouts: [{ d: '2026-09-27', entries: [ex('squat', [{ w: 20, r: 5, done: true, phase: 'warmup' }, done(80, 5), { w: 80, r: 5, done: false }])] }]
    }
    expect(exerciseHistory(S, 'squat')).toEqual([{ d: '2026-09-27', summary: '80×5', weight: 80, reps: [5] }])
  })
})

describe('readinessOf', () => {
  test('a recovered week reads ready with no penalty', () => {
    const r = readinessOf({
      summary: { nutrition: { deficitVsTarget: 50, proteinVsTarget: 5, daysLogged: 7 }, targets: { calories: 2600 }, activity: { sleepAvgH: 7.5, restingHrAvg: 58 } },
      today: { totals: { kcal: 1800 }, meals: [{}, {}], activity: { sleepH: 7.5, restingHr: 58 }, fasting: null },
      yesterday: { activity: { steps: 8000 } },
    })
    expect(r.level).toBe('ready')
    expect(r.score).toBeGreaterThanOrEqual(80)
  })
  test('short sleep + deep deficit + fasted + high RHR stack into down', () => {
    const r = readinessOf({
      summary: { nutrition: { deficitVsTarget: 650, proteinVsTarget: 35, daysLogged: 7 }, targets: { calories: 2600 }, activity: { sleepAvgH: 6.2, restingHrAvg: 58 } },
      today: { totals: { kcal: 400 }, meals: [{}], activity: { sleepH: 4.5, restingHr: 67 }, fasting: { status: 'active', elapsedMin: 15 * 60 } },
      yesterday: { activity: { steps: 26000 } },
    })
    expect(r.level).toBe('down')
    expect(r.reasons.join(' ')).toMatch(/sleep|kcal|protein|fasted|HR|steps/)
  })
})

describe('adjustPrescription', () => {
  const base = { weight: 67.5, reps: 10, sets: 3, restSec: 90, kind: 'up', prevWeight: 65 }
  test('ready keeps the progression jump', () => {
    const out = adjustPrescription(base, { score: 95, level: 'ready', reasons: [] }, { inc: 2.5 })
    expect(out.weight).toBe(67.5)
    expect(out.restSec).toBe(90)
  })
  test('cautious holds the jump and adds rest', () => {
    const out = adjustPrescription(base, { score: 65, level: 'cautious', reasons: ['short night'] }, { inc: 2.5 })
    expect(out.weight).toBe(65)
    expect(out.kind).toBe('hold')
    expect(out.restSec).toBe(120)
  })
  test('down backs off one step even on a hold', () => {
    const out = adjustPrescription({ ...base, kind: 'hold', weight: 65 }, { score: 30, level: 'down', reasons: ['ill'] }, { inc: 2.5 })
    expect(out.weight).toBe(62.5)
    expect(out.restSec).toBe(150)
  })
  test('per-side reps stay even', () => {
    const out = adjustPrescription({ weight: 20, reps: 11, kind: 'hold' }, { score: 20, level: 'down', reasons: [] }, { inc: 2.5, perSide: true })
    expect(out.reps % 2).toBe(0)
  })
})

describe('applySessionTargets + restBaseOf', () => {
  test('exercise rest wins, else the profile default', () => {
    expect(restBaseOf({ restSec: 180 }, { restSec: 90 })).toBe(180)
    expect(restBaseOf({}, { restSec: 90 })).toBe(90)
  })
  test('auto-fills undone rows and grows sets, never touching logged ones', () => {
    const entries = [{ id: 'bench', target: { weight: 60, reps: 10, sets: 3 }, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: false }, { w: 60, r: 10, done: false }] }]
    const out = applySessionTargets(entries, { bench: { weight: 62.5, reps: 10, sets: 4, restSec: 120, readiness: 'ready', score: 90, why: ['progression'] } })
    expect(out[0].sets[0]).toEqual({ w: 60, r: 10, done: true })
    expect(out[0].sets[1].w).toBe(62.5)
    expect(out[0].sets.filter(s => !s.done).length).toBe(3)
    expect(out[0].target.restSec).toBe(120)
  })
  test('keeps the reason on the entry, a fuel line unworded', () => {
    const entries = [{ id: 'bench', target: { weight: 60, reps: 10, sets: 3 }, sets: [{ w: 60, r: 10, done: false }] }]
    const out = applySessionTargets(entries, { bench: { weight: 57.5, readiness: 'down', score: 55, line: { kind: 'deficit', kcal: 600 } } })
    expect(out[0].suggestion).toEqual({ readiness: 'down', score: 55, line: { kind: 'deficit', kcal: 600 } })
  })
})

// The training system and its ledger are applied inside session-start.js already, so this
// overlay must only ever be the readiness pass on top — a second ledger pass here would add
// the set a set and take off a second increment.
describe('suggestTargets', () => {
  const entry = (over = {}) => ({
    id: 'bench_press',
    plan: { policy: 'linear', kind: 'up', weight: 62.5, reps: 5 },
    target: { weight: 62.5, reps: 5, sets: 3, inc: 2.5 },
    sets: [{ w: 62.5, r: 5, done: false }],
    ...over,
  })
  const deficit = { nutrition: { daysLogged: 7, deficitVsTarget: 600, proteinVsTarget: 0 } }

  test('off by default, so a profile that never chose stays untouched', () => {
    expect(suggestTargets([entry()], {}, { summary: deficit })).toEqual({})
    expect(suggestTargets([entry()], { readinessAuto: false }, { summary: deficit })).toEqual({})
  })

  test('a fueled week or nothing logged is a normal day', () => {
    const on = { readinessAuto: true }
    expect(suggestTargets([entry()], on, { summary: null })).toEqual({})
    expect(suggestTargets([entry()], on, { summary: { nutrition: { daysLogged: 7, deficitVsTarget: 0, proteinVsTarget: 0 } } })).toEqual({})
    expect(readinessLevelOf(null).level).toBe('ready')
  })

  test('a deficit holds the earned jump at the weight before it, with the reason', () => {
    const out = suggestTargets([entry()], { readinessAuto: true }, { summary: deficit })
    // 62.5 was the jump; holding means the weight before it, never less.
    expect(out.bench_press.weight).toBe(60)
    expect(out.bench_press.readiness).toBe('down')
    expect(out.bench_press.score).toBe(55)
    // The line is the raw fuel one — the view words it with fuelLineText.
    expect(out.bench_press.line).toEqual({ kind: 'deficit', kcal: 600 })
  })

  test('an active fast is cautious, and holds the jump like any short day', () => {
    const summary = { nutrition: { daysLogged: 7, deficitVsTarget: 0, proteinVsTarget: 0 }, fasting: { active: { elapsedMin: 840 } } }
    const out = suggestTargets([entry()], { readinessAuto: true }, { summary })
    expect(out.bench_press.readiness).toBe('cautious')
    expect(out.bench_press.score).toBe(70)
    expect(out.bench_press.weight).toBe(60)
    expect(out.bench_press.line).toEqual({ kind: 'fasted', hours: 14 })
  })

  test('a down day backs off a hold, but never undoes a deload', () => {
    const held = entry({ plan: { policy: 'linear', kind: 'hold', weight: 60, reps: 5 }, target: { weight: 60, reps: 5, sets: 3, inc: 2.5 } })
    const deloaded = entry({ plan: { policy: 'linear', kind: 'deload', weight: 55, reps: 5 }, target: { weight: 55, reps: 5, sets: 3, inc: 2.5 } })
    expect(suggestTargets([held], { readinessAuto: true }, { summary: deficit }).bench_press.weight).toBe(57.5)
    expect(suggestTargets([deloaded], { readinessAuto: true }, { summary: deficit })).toEqual({})
  })

  test('a first session has no earned jump to spend, so nothing moves', () => {
    const first = entry({ plan: { policy: 'linear', kind: 'first', weight: 60, reps: 5 }, target: { weight: 60, reps: 5, sets: 3, inc: 2.5 } })
    expect(suggestTargets([first], { readinessAuto: true }, { summary: deficit })).toEqual({})
  })

  test('the ledger\'s set count is never restated, and its rest only ever grows', () => {
    // A system's rest and its ±1 set count are already on the entry by this point, so the
    // overlay must leave the set count to the builder; rest is the one number a short
    // day legitimately stretches.
    const built = entry({ target: { weight: 62.5, reps: 5, sets: 4, restSec: 180, inc: 2.5 } })
    const out = suggestTargets([built], { readinessAuto: true }, { summary: deficit })
    expect(out.bench_press).not.toHaveProperty('sets')
    expect(out.bench_press.restSec).toBe(240)
    expect(out.bench_press.weight).toBe(60)
  })

  test('applied through applySessionTargets, it moves undone work rows only', () => {
    const entries = [entry({ sets: [{ w: 62.5, r: 5, done: true }, { w: 62.5, r: 5, done: false }] })]
    const out = applySessionTargets(entries, suggestTargets(entries, { readinessAuto: true }, { summary: deficit }))
    expect(out[0].sets[0].w).toBe(62.5)
    expect(out[0].sets[1].w).toBe(60)
    expect(out[0].suggestion.readiness).toBe('down')
  })

  test('a warm-up keeps its ramp: it is not a work row, only an undone one', () => {
    // A warm-up row is `done: false` like every row waiting to be lifted, so "not done" alone is
    // not the test. Writing the working weight onto it left the ramp at the work weight, which is
    // the one thing a warm-up must not be — and it did so on the readiness path too.
    const warm = { w: 30, r: 10, done: false, phase: 'warmup', warmup: true }
    const entries = [entry({ sets: [warm, { w: 62.5, r: 5, done: false }] })]
    const out = applySessionTargets(entries, suggestTargets(entries, { readinessAuto: true }, { summary: deficit }))
    expect(out[0].sets[0]).toEqual(warm)
    expect(out[0].sets[1].w).toBe(60)
  })

  test('the same holds for a timed warm-up and for a per-side warm-up', () => {
    const held = entry({ sets: [{ sec: 20, w: 20, done: false, phase: 'warmup', warmup: true }, { sec: 45, w: 40, done: false }] })
    const out = applySessionTargets([held], { 'bench_press': { sec: 30, weight: 30, why: 'shorter holds today' } })
    expect(out[0].sets[0]).toMatchObject({ sec: 20, w: 20 })
    expect(out[0].sets[1]).toMatchObject({ sec: 30, w: 30 })
  })
})
