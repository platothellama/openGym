// The context a `session` job is sent with. The server cannot build it (api/coach/core/ never
// imports the app's engine), so this is the only place these numbers are decided, and the thing
// the Coach is asked about has to be the session as it actually stands — not the routine it came
// from, which an edit, the training system or the readiness overlay has already moved.

import { describe, it, expect } from 'vitest'
import { buildSessionContext, fitaiDayBlock } from './session-context.js'

const S = {
  unit: 'kg',
  restSec: 100,
  workouts: [
    {
      id: 'w1', d: '2026-07-13', name: 'Full body A', entries: [
        { id: '0001', sets: [{ w: 17.5, r: 10, done: true }, { w: 17.5, r: 10, done: true }, { w: 17.5, r: 9, done: true }] },
      ],
    },
    {
      id: 'w2', d: '2026-07-17', name: 'Full body A', entries: [
        { id: '0001', sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }] },
        { id: '0007', sets: [{ sec: 45, done: true }, { sec: 45, done: true }] },
      ],
    },
  ],
}

const entry = over => ({
  id: '0001',
  target: { id: '0001', sets: 3, reps: 10, weight: 20, mode: 'reps', inc: 2.5 },
  plan: { policy: 'linear', kind: 'up' },
  sets: [],
  ...over,
})

describe('buildSessionContext', () => {
  it('returns null when there is nothing to tune', () => {
    expect(buildSessionContext([], S)).toBe(null)
    expect(buildSessionContext(null, S)).toBe(null)
    expect(buildSessionContext([{}, { id: '' }], S)).toBe(null)
    // An entry with no id names no exercise, and an answer about it could not be applied.
    expect(buildSessionContext([entry({ id: undefined })], S)).toBe(null)
  })

  it('describes each exercise by the mode it is in, not by every number it has', () => {
    const { routine } = buildSessionContext([
      entry(),
      { id: '0007', target: { id: '0007', sets: 3, sec: 45, weight: 12, mode: 'time' }, plan: { kind: 'hold' }, sets: [] },
    ], S)
    // A timed hold has an optional load, and its sec travels; a rep set has no sec.
    expect(routine.ex[0]).toMatchObject({ id: '0001', mode: 'reps', sets: 3, reps: 10, weight: 20, inc: 2.5 })
    expect(routine.ex[0].sec).toBeUndefined()
    expect(routine.ex[1]).toMatchObject({ id: '0007', mode: 'time', sec: 45, weight: 12 })
    expect(routine.ex[1].reps).toBeUndefined()
  })

  it('sends the bodyweight and per-side flags, because they decide what progress may look like', () => {
    const { routine } = buildSessionContext([
      entry({ target: { id: '0001', sets: 3, reps: 12, bodyweight: true, side: true, repsMin: 8, repsMax: 20, mode: 'reps' } }),
    ], S)
    expect(routine.ex[0]).toMatchObject({ bodyweight: true, side: true, repsMin: 8, repsMax: 20 })
  })

  it('sends the prescription as the default, with the verdict the model cannot guess', () => {
    const { base } = buildSessionContext([
      entry({ plan: { policy: 'linear', kind: 'up' } }),
      { id: '0009', target: { id: '0009', sets: 4, reps: 6, mode: 'reps', restSec: 150 }, plan: { kind: 'deload' }, sets: [] },
      { id: '0011', target: { id: '0011', sets: 3, reps: 10, mode: 'reps' }, plan: { kind: 'something-else' }, sets: [] },
    ], S)
    expect(base['0001']).toEqual({ reps: 10, weight: 20, sets: 3, restSec: 100, kind: 'up' })
    expect(base['0009']).toEqual({ reps: 6, sets: 4, restSec: 150, kind: 'deload' })
    // A rest the exercise does not carry is the profile's, which is what the rest timer uses.
    expect(base['0001'].restSec).toBe(S.restSec)
    // An unknown verdict is not one the app can act on, so it is dropped rather than forwarded.
    expect(base['0011'].kind).toBeUndefined()
  })

it('prefers the rest actually in play over the profile default', () => {
    const { base } = buildSessionContext([entry({ target: { id: '0001', sets: 3, reps: 10, restSec: 120 }, plan: { kind: 'hold' } })], S)
    expect(base['0001'].restSec).toBe(120)
  })

  it('sends a rest of 0 as 0, not as the profile default', () => {
    // Two exercises in a circuit, or a warm-up move between heavy sets: the session really rests
    // for nothing there. Sending the profile's 100s would have the model arguing about a rest
    // nobody is taking - and would make "add a little rest" a suggestion against a number that
    // was never in play.
    const { base } = buildSessionContext([entry({ target: { id: '0001', sets: 3, reps: 10, restSec: 0 }, plan: { kind: 'hold' } })], S)
    expect(base['0001'].restSec).toBe(0)
  })

  it('sends the last few counting sessions per exercise, oldest first', () => {
    const { history } = buildSessionContext([entry(), { id: '0007', target: { id: '0007', sets: 2, sec: 45, mode: 'time' }, plan: {} }], S)
    expect(history['0001'].map(r => r.d)).toEqual(['2026-07-13', '2026-07-17'])
    // summary carries the set-by-set detail; reps is the total, which is the number a "did this
    // climb" read rests on (the payload reads a number, not the display array).
    expect(history['0001'][1]).toEqual({ d: '2026-07-17', summary: '20×10,10,10', weight: 20, reps: 30 })
    expect(history['0001'][0]).toEqual({ d: '2026-07-13', summary: '17.5×10,10,9', weight: 17.5, reps: 29 })
    // A session with no history is absent rather than present and empty: an empty list reads as
    // "this exercise has never been trained" only when it is empty, and here it means nothing.
    expect(history['0007'].map(r => r.d)).toEqual(['2026-07-17'])
    expect(history['0009']).toBeUndefined()
  })

  it('keeps a warm-up or undone row out of the history it reads', () => {
    const warm = { unit: 'kg', workouts: [{ id: 'w', d: '2026-07-20', entries: [{ id: '0001', sets: [{ w: 20, r: 5, warm: true }, { w: 20, r: 10, done: true }] }] }] }
    const { history } = buildSessionContext([entry()], warm)
    expect(history['0001']).toEqual([{ d: '2026-07-20', summary: '20×10', weight: 20, reps: 10 }])
  })

  it('leaves out a session with no date, which cannot be placed in the sequence', () => {
    const undated = { unit: 'kg', workouts: [{ id: 'w', entries: [{ id: '0001', sets: [{ w: 20, r: 10, done: true }] }] }] }
    expect(buildSessionContext([entry()], undated).history['0001']).toBeUndefined()
  })

  it('caps what travels so a huge merged session cannot grow the request without bound', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry({ id: `e${i}` }))
    const { routine, base } = buildSessionContext(many, S)
    expect(routine.ex).toHaveLength(20)
    expect(Object.keys(base)).toHaveLength(20)
  })

  it('names the routine only when the session has one, and never sends an empty string', () => {
    expect(buildSessionContext([entry()], S, { routineId: 'r1', routineName: 'Full body A', prog: 'linear' }).routine)
      .toEqual({ id: 'r1', name: 'Full body A', prog: 'linear', ex: [expect.objectContaining({ id: '0001' })] })
    // A merged session has no single routine and an unknown policy is not a policy.
    const merged = buildSessionContext([entry()], S, { routineId: '', routineName: null, prog: 'pyramid' }).routine
    expect('id' in merged).toBe(false)
    expect('name' in merged).toBe(false)
    expect('prog' in merged).toBe(false)
  })

  it('passes the two FitAI days through untouched and null when unlinked', () => {
    const y = { date: '2026-07-20', kcal: 2400 }
    const withDays = buildSessionContext([entry()], S, { yesterday: y, today: { date: '2026-07-21', kcal: 2300 } })
    expect(withDays.yesterday).toBe(y)
    expect(withDays.today.kcal).toBe(2300)
    const bare = buildSessionContext([entry()], S)
    expect(bare.yesterday).toBe(null)
    expect(bare.today).toBe(null)
  })

  it('reads the session as built, not the routine it came from', () => {
    // The whole point: the entry already carries the readiness overlay and the system's rest, and
    // those are the numbers on the bar. Reading the routine instead would ask the Coach about a
    // session that is not happening.
    const edited = entry({
      target: { id: '0001', sets: 3, reps: 12, weight: 18, restSec: 120, mode: 'reps' },
      plan: { policy: 'linear', kind: 'hold' },
      suggestion: { why: 'held, short night' },
    })
    const { routine, base } = buildSessionContext([edited], S)
    expect(routine.ex[0]).toMatchObject({ reps: 12, weight: 18, restSec: 120 })
    expect(base['0001']).toMatchObject({ reps: 12, weight: 18, restSec: 120, kind: 'hold' })
    // A suggestion the readiness overlay already wrote is the app's own reasoning and is not
    // re-sent: `base.kind` says the same thing in a form the prompt knows.
    expect(JSON.stringify(routine)).not.toContain('short night')
  })
})
/* One FitAI day, flattened for the prompt. The bridge sends a whole day; the Coach is told eight
 * numbers and whether a fast touched it. A value the bridge did not have must not become a zero:
 * "0 kcal logged" is a reading, and it is not what an absent row means. */
describe('fitaiDayBlock', () => {
  const day = over => ({
    date: '2026-07-21',
    totals: { kcal: 2300, protein: 150, carbs: 240, fat: 70, fiber: 30 },
    meals: [{ meal: 'lunch', food: 'rice' }],
    glucose: [{ value: 88 }],
    fasting: null,
    activity: { steps: 8000, activeKcal: 420, sleepH: 5.4, hrAvg: 74, restingHr: 61 },
    ...over,
  })

  it('keeps the numbers the prompt reads and leaves the rest of the day behind', () => {
    expect(fitaiDayBlock(day())).toEqual({
      date: '2026-07-21', kcal: 2300, protein: 150, carbs: 240, fat: 70,
      sleepH: 5.4, restingHr: 61, steps: 8000, activeKcal: 420,
    })
    const out = JSON.stringify(fitaiDayBlock(day()))
    expect(out).not.toContain('rice')
    expect(out).not.toContain('fiber')
  })

  it('names the fast, because "trained fasted" is a reason to hold a jump', () => {
    expect(fitaiDayBlock(day({ fasting: { protocol: '16:8', status: 'active', elapsedMin: 700 } })).fasting).toBe('16:8')
    // A fast the bridge logged without a protocol still has to read as fasted.
    expect(fitaiDayBlock(day({ fasting: { status: 'active' } })).fasting).toBe('fasted')
    expect(fitaiDayBlock(day({ fasting: null })).fasting).toBeUndefined()
  })

  it('a missing reading stays missing rather than becoming zero', () => {
    const d = day({ activity: { steps: 0, sleepH: null, restingHr: null } })
    const out = fitaiDayBlock(d)
    expect(out.steps).toBe(0, 'zero steps really were logged')
    expect('sleepH' in out).toBe(false, 'no sleep session is not a night of no sleep')
    expect('restingHr' in out).toBe(false)
  })

  it('a day that cannot be placed is not sent at all', () => {
    // `2026-07-21T00:00:00Z` still places: the first ten characters are the day, which is what
    // the payload builder reads. The rest is not a date at all.
    expect(fitaiDayBlock(day({ date: undefined }))).toBeNull()
    expect(fitaiDayBlock(day({ date: 'yesterday' }))).toBeNull()
    expect(fitaiDayBlock(null)).toBeNull()
    expect(fitaiDayBlock(day({ date: '2026-07-21T00:00:00Z' })).date).toBe('2026-07-21')
  })

  it('builds the context with the bridge blocks passed through as they are', () => {
    const fuel = { nutrition: { kcalAvg: 2100 }, activity: { sleepAvgH: 5.4 } }
    const ctx = buildSessionContext([entry()], S, { yesterday: { date: '2026-07-20' }, today: { date: '2026-07-21' }, fitai: fuel })
    expect(ctx.fitai).toBe(fuel)
    expect(ctx.yesterday).toEqual({ date: '2026-07-20' })
    // Nothing linked, nothing sent - the keys are there and null, which reads as absent.
    const bare = buildSessionContext([entry()], S)
    expect(bare.fitai).toBeNull()
    expect(bare.yesterday).toBeNull()
  })
})

const fastaiDay = day => fitaiDayBlock(day)
const fastaiFast = d => d && d.fasting
