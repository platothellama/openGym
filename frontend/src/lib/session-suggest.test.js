import { describe, test, expect } from 'vitest'
import { exerciseHistory, readinessOf, adjustPrescription, applySessionTargets, restBaseOf } from './session-suggest.js'

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
})
