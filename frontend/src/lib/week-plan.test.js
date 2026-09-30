import { describe, it, expect } from 'vitest'
import {
  defaultDays, syncFrequency, slotsOf, requiredDaysOf, optionalDaysOf, emptyRequiredOf,
  requiredCount, optionalCount, trainedDays, describeWeek, MAX_OPTIONAL, ALL_DAYS, maxOptionalFor
} from './week-plan.js'
import { MONDAY, SUNDAY } from './format.js'

// A plan is a frequency, not a list of named days. These are the two things that must never be
// wrong: the week it lays out has to be a real, non-overlapping set of weekdays, and no routine
// assignment may be destroyed by a count change the person made on purpose.
const S = (week = {}, weekOptional = [], extra = {}) => ({ week, weekOptional, weekStart: MONDAY, ...extra })
const names = s => slotsOf(s).map(({ day }) => day)

describe('defaultDays', () => {
  it('spreads N days across the week the way people actually train', () => {
    expect(defaultDays(3, MONDAY)).toEqual([1, 3, 5])   // Mon/Wed/Fri
    expect(defaultDays(4, MONDAY)).toEqual([1, 2, 4, 6]) // Mon/Tue/Thu/Sat
    expect(defaultDays(2, MONDAY)).toEqual([1, 4])
    expect(defaultDays(1, MONDAY)).toEqual([1])
    expect(defaultDays(7, MONDAY)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('follows the profile’s week start', () => {
    expect(defaultDays(3, SUNDAY)).toEqual([0, 2, 4])  // Sun/Tue/Thu
    expect(defaultDays(2, SUNDAY)).toEqual([0, 3])
  })

  it('clamps a nonsense count to one day rather than laying out nothing', () => {
    for (const n of [0, -3, null, undefined, 'three', NaN, Infinity, {}]) {
      expect(defaultDays(n, MONDAY)).toEqual([1])
    }
    expect(defaultDays(99, MONDAY)).toHaveLength(7)
  })

  it('never repeats a day, for any count', () => {
    for (let n = 1; n <= 7; n++) {
      for (const ws of [MONDAY, SUNDAY]) {
        const days = defaultDays(n, ws)
        expect(new Set(days).size).toBe(days.length)
        expect(days.every(d => ALL_DAYS.includes(d))).toBe(true)
      }
    }
  })
})

describe('reading the plan', () => {
  it('splits a week into required and optional, with no overlap', () => {
    const s = S({ 1: ['r1'], 3: ['r2'], 2: ['r3'] }, [2, 4])
    expect(requiredDaysOf(s)).toEqual([1, 3])
    expect(optionalDaysOf(s)).toEqual([2, 4])
    // Week order, not required-then-optional: the slots are days of one week and the strip the
    // user reads them off has to run the same way the calendar does.
    expect(names(s)).toEqual([1, 2, 3, 4])
    expect(slotsOf(s).map(x => x.optional)).toEqual([false, true, false, true])
    expect(requiredCount(s)).toBe(2)
    expect(optionalCount(s)).toBe(2)
  })

  it('an optional day with nothing on it is still an optional day', () => {
    // This is the whole point of the feature: the Coach names the slot, the person fills it in
    // or does not. An empty slot must not evaporate, or the count would fall the moment they
    // chose not to train it.
    const s = S({ 1: ['r1'] }, [3, 5])
    expect(optionalDaysOf(s)).toEqual([3, 5])
    expect(requiredDaysOf(s)).toEqual([1])
    expect(names(s)).toEqual([1, 3, 5])
  })
  it('an empty required slot is not a training day', () => {
    // `week` key-absent means "nothing to do", and a slot with no routine on it is exactly that.
    const s = S({ 1: ['r1'], 3: [] })
    expect(requiredDaysOf(s)).toEqual([1])
    expect(trainedDays(s)).toEqual([1])
  })

  it('the required days are the planned ones AND the empty ones, not one or the other', () => {
    // `weekRequired` only ever holds the days with nothing on them, so reading it as the whole
    // answer drops every day that *does* have a routine. Monday planned, three to go: all four.
    const s = S({ 1: ['r1'] }, [], { weekRequired: [1, 3, 5] })
    expect(requiredDaysOf(s)).toEqual([1, 3, 5])
    expect(slotsOf(s)).toEqual([
      { day: 1, optional: false }, { day: 3, optional: false }, { day: 5, optional: false }
    ])
    expect(requiredCount(s)).toBe(3)
    expect(trainedDays(s)).toEqual([1])
    expect(emptyRequiredOf(s)).toEqual([3, 5])
  })

  it('a day named in weekRequired that already has a routine is not an empty slot', () => {
    // syncFrequency never writes one, but a hand-edited state can, and it must not be counted
    // twice: Monday is one required day, not two.
    const s = S({ 1: ['r1'] }, [], { weekRequired: [1] })
    expect(requiredCount(s)).toBe(1)
    expect(emptyRequiredOf(s)).toEqual([])
  })

  it('counts a filled optional day as trained, without it becoming required', () => {
    const s = S({ 1: ['r1'], 3: ['r2'] }, [3])
    expect(trainedDays(s)).toEqual([1, 3])
    expect(requiredDaysOf(s)).toEqual([1])
  })

  it('normalises a hand-edited or synced list', () => {
    expect(optionalDaysOf(S({}, ['5', 2, '2', 9, -1, null, 2.5, 'Monday']))).toEqual([2, 5])
    expect(optionalDaysOf(S({}, 'nope'))).toEqual([])
    expect(optionalDaysOf(S({}, undefined))).toEqual([])
    expect(optionalDaysOf({})).toEqual([])
    expect(requiredDaysOf({})).toEqual([])
  })

  it('orders days by the profile’s week start, not by getDay()', () => {
    const s = S({ 0: ['r1'], 3: ['r2'] }, [6], { weekStart: SUNDAY })
    expect(requiredDaysOf(s)).toEqual([0, 3])
    expect(optionalDaysOf(s)).toEqual([6])
  })

  it('describeWeek reports nothing for an empty plan rather than a week of zeroes', () => {
    expect(describeWeek(S({}))).toBeNull()
    expect(describeWeek(S({ 1: ['r1'], 3: [] }, [3]))).toEqual({ required: [1], optional: [3], scheduled: 1 })
  })
})

describe('syncFrequency — growing', () => {
  it('lays out a fresh week from the count alone, with no routines to preserve', () => {
    const s = S({})
    const out = syncFrequency(s, { days: 3, optional: 1 })
    expect(out.required).toEqual([1, 3, 5])
    expect(out.optional).toEqual([2])
    expect(names(s)).toEqual([1, 2, 3, 5])
    expect(s.week, 'a slot with nothing on it stores nothing').toEqual({})
    // ...but the four slots the person asked for are still on the books, or the dial would read
    // "0 days a week" the moment they tapped it.
    expect(s.weekRequired).toEqual([1, 3, 5])
  })

  it('keeps the days a plan already trains and only adds what is missing', () => {
    const s = S({ 2: ['r1'], 4: ['r2'] })
    const out = syncFrequency(s, { days: 3, optional: 0 })
    // Tue and Thu stay; the third comes off the spread table's first free day, Monday.
    expect(out.required).toEqual([1, 2, 4])
    expect(s.week[2]).toEqual(['r1'])
    expect(s.week[4]).toEqual(['r2'])
  })

  it('an added optional day never takes a day the required count already holds', () => {
    const s = S({ 1: ['r1'], 3: ['r2'], 5: ['r3'] })
    const out = syncFrequency(s, { days: 3, optional: 2 })
    expect(out.required).toEqual([1, 3, 5])
    expect(out.optional).toEqual([2, 4])
    expect(new Set([...out.required, ...out.optional]).size).toBe(5)
  })

  it('cannot run out of days to give', () => {
    // 7 required + 4 optional is 11 slots in a 7-day week. The required count wins, because it
    // is the one the person actually trains against; the optional budget gets what is left.
    const s = S({})
    const out = syncFrequency(s, { days: 7, optional: MAX_OPTIONAL })
    expect(out.required).toHaveLength(7)
    expect(out.optional).toEqual([])
    expect(new Set([...out.required, ...out.optional]).size).toBe(7)
  })
})

describe('syncFrequency — shrinking', () => {
  it('turns a surplus required day into an optional day rather than deleting its routine', () => {
    // The one rule that makes the steppers safe to press: 4 → 3 must not silently unhook Friday
    // and leave the person wondering where their routine went.
    const s = S({ 1: ['r1'], 3: ['r2'], 5: ['r3'], 6: ['r4'] })
    const out = syncFrequency(s, { days: 3, optional: 1 })
    expect(out.required).toEqual([1, 3, 5])
    expect(out.optional).toEqual([6])
    expect(s.week[6]).toEqual(['r4']), 'the routine is still there, just optional'
    expect(s.weekOptional).toEqual([6])
  })

  it('drops a surplus day only when the optional budget cannot hold it', () => {
    // Already 3 optional days, so the 4th has nowhere to go. That is a day the person has
    // disowned in writing twice, and deleting it is the answer they asked for twice.
    const s = S({ 1: ['r1'], 3: ['r2'], 5: ['r3'], 6: ['r4'] }, [2, 4, 0])
    const out = syncFrequency(s, { days: 3, optional: 3 })
    expect(out.required).toEqual([1, 3, 5])
    expect(out.optional).toEqual([2, 4, 0])
    expect(s.week[6]).toBeUndefined()
    expect(Object.keys(s.week)).toHaveLength(3)
  })

  it('removing the last optional day clears the key rather than storing []', () => {
    // The rest of the plan model has one rule about emptiness and this obeys it: key-absent is
    // rest, `[]` is never written. An empty list here would fingerprint differently from none.
    const s = S({ 1: ['r1'] }, [3])
    expect(s.weekOptional).toEqual([3])
    syncFrequency(s, { days: 1, optional: 0 })
    expect('weekOptional' in s).toBe(false)
  })

  it('never lets a day end up in both lists, at any count', () => {
    for (let days = 1; days <= 7; days++) {
      for (let optional = 0; optional <= MAX_OPTIONAL; optional++) {
        const s = S({ 1: ['a'], 2: ['b'], 3: ['c'], 4: ['d'], 5: ['e'], 6: ['f'], 0: ['g'] }, [3, 4])
        const out = syncFrequency(s, { days, optional })
        expect(out.required).toHaveLength(days)
        expect(out.optional.length).toBeLessThanOrEqual(optional)
        expect(new Set([...out.required, ...out.optional]).size)
          .toBe(out.required.length + out.optional.length)
        for (const d of out.optional) expect(out.required).not.toContain(d)
        expect(slotsOf(s)).toHaveLength(days + out.optional.length)
      }
    }
  })

  it('never drops a routine that a day still holds, at any count', () => {
    const ids = { 1: ['a'], 3: ['b'], 5: ['c'], 6: ['d'] }
    for (let days = 1; days <= 7; days++) {
      for (let optional = 0; optional <= MAX_OPTIONAL; optional++) {
        const s = S({ ...ids }, [2])
        const out = syncFrequency(s, { days, optional })
        // The invariant that matters: a day that survives still holds exactly the routine it held,
        // and no day is ever left as a stray empty list (key-absent is rest, `[]` is never written).
        for (const [d, list] of Object.entries(s.week)) {
          expect(list, `day ${d} is never an empty list`).toEqual(ids[d])
        }
        // ...and the required count is always reachable, even when it has to displace optional days.
        expect(out.required).toHaveLength(days)
      }
    }
  })
})

describe('syncFrequency — idempotence and round-trips', () => {
  it('setting the frequency it already has changes nothing', () => {
    const s = S({ 1: ['r1'], 3: ['r2'], 5: ['r3'], 2: ['r4'] }, [2, 4])
    const before = JSON.stringify([s.week, s.weekOptional])
    syncFrequency(s, { days: 3, optional: 2 })
    expect(JSON.stringify([s.week, s.weekOptional])).toBe(before)
  })

  it('fills an optional day in without reshaping the week', () => {
    // Assigning a routine to an optional day is an ordinary assignment (the sheets do exactly
    // `s.week[d] = [id]`), so syncFrequency has to leave the shape alone on the next tap.
    const s = S({ 1: ['r1'], 3: ['r2'], 5: ['r3'] }, [2])
    s.week[2] = ['r4']
    const out = syncFrequency(s, { days: 3, optional: 1 })
    expect(out.required).toEqual([1, 3, 5])
    expect(out.optional).toEqual([2])
    expect(requiredCount(s)).toBe(3), 'filling an optional day in does not raise the weekly target'
  })

  it('clamps a count outside the range instead of laying out an impossible week', () => {
    expect(syncFrequency(S({}), { days: 0, optional: 0 }).required).toHaveLength(1)
    expect(syncFrequency(S({}), { days: 99, optional: 99 }).required).toHaveLength(7)
    expect(syncFrequency(S({}, [1, 2, 3, 4]), { days: 1, optional: 99 }).optional.length)
      .toBeLessThanOrEqual(MAX_OPTIONAL)
    expect(syncFrequency(S({}), { days: -5, optional: -5 }).optional).toEqual([])
  })
})

// A week is seven days and the two lists are disjoint, so "how many days" and "how many of those
// are optional" are not two independent questions. Left independent they produce a request no
// answer can satisfy — and the server rejects the plan rather than adjusting it, so the person
// gets a failure instead of a plan.
describe('maxOptionalFor', () => {
  it('leaves room in a seven-day week for every count', () => {
    for (let days = 1; days <= 7; days++) {
      expect(days + maxOptionalFor(days)).toBeLessThanOrEqual(7)
    }
  })

  it('offers the full bonus while there is room, and nothing once there is not', () => {
    expect(maxOptionalFor(1)).toBe(MAX_OPTIONAL)
    expect(maxOptionalFor(2)).toBe(MAX_OPTIONAL)
    expect(maxOptionalFor(3)).toBe(4)
    expect(maxOptionalFor(4)).toBe(3)
    expect(maxOptionalFor(5)).toBe(2)
    expect(maxOptionalFor(6)).toBe(1)
    expect(maxOptionalFor(7)).toBe(0)     // a seven-day week is every day
  })

  it('reads a nonsense count as the clamped one, not as a negative budget', () => {
    expect(maxOptionalFor(99)).toBe(0)
    expect(maxOptionalFor(0)).toBe(MAX_OPTIONAL)   // 0 clamps up to 1 day, so 6 are free
    expect(maxOptionalFor(-3)).toBe(MAX_OPTIONAL)
  })
})

describe('syncFrequency never produces a week with more days than there are', () => {
  // Every combination a client build could have let through, including the impossible ones the
  // intake screen used to offer independently.
  it('holds for every required/optional pair, even the impossible ones', () => {
    for (let days = 1; days <= 7; days++) {
      for (let optional = 0; optional <= MAX_OPTIONAL; optional++) {
        const s = S({})
        const out = syncFrequency(s, { days, optional })
        expect(out.required.length).toBe(days)
        expect(out.optional.length).toBeLessThanOrEqual(maxOptionalFor(days))
        // Disjoint, and inside the week.
        expect(out.required.length + out.optional.length).toBeLessThanOrEqual(7)
        expect(out.required.filter(d => out.optional.includes(d))).toEqual([])
        expect([...out.required, ...out.optional].every(d => ALL_DAYS.includes(d))).toBe(true)
      }
    }
  })

  it('narrows an over-committed request rather than failing on it', () => {
    // What a profile stored on the build with two independent dials can still say.
    const s = S({ 1: ['a'], 2: ['b'] })
    const out = syncFrequency(s, { days: 7, optional: 4 })
    expect(out.required).toHaveLength(7)
    expect(out.optional).toEqual([])        // no room, so no optional days
    // And nothing was thrown away doing it.
    expect(s.week[1]).toEqual(['a'])
    expect(s.week[2]).toEqual(['b'])
  })

  it('keeps what room there is, rather than dropping the whole optional ask', () => {
    const out = syncFrequency(S({ 1: ['a'] }), { days: 5, optional: 4 })
    expect(out.required).toHaveLength(5)
    expect(out.optional).toHaveLength(2)    // 5 + 2 = 7, the room that was left
  })
})
