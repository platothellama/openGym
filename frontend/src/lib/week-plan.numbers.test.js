// The number a slot is called is the one thing the Plan screen, the sheet that fills a slot, and
// the printout all have to agree on, and none of them can be checked by clicking. `numberedSlotsOf`
// is the one place that decides it, so the ordering rules are pinned here rather than in each view.
import { describe, it, expect } from 'vitest'
import { numberedSlotsOf, slotNumber } from './week-plan.js'

const plan = (week, weekRequired = [], weekOptional = []) => ({
  unit: 'kg', week, weekRequired, weekOptional, routines: [],
})

describe('numberedSlotsOf', () => {
  it('numbers the required sessions 1..n in week order', () => {
    const s = numberedSlotsOf(plan({ 1: ['a'], 3: ['b'], 5: ['c'] }, [1, 3, 5]))
    expect(s).toEqual([
      { day: 1, optional: false, n: 1 },
      { day: 3, optional: false, n: 2 },
      { day: 5, optional: false, n: 3 },
    ])
  })

  // Counting every slot together would let "Day 2" be the optional one and "Day 3" required,
  // which reads as a mistake rather than as two dials on one week.
  it('numbers the optional days within themselves, so the required ones stay 1..n', () => {
    const s = numberedSlotsOf(plan({ 1: ['a'], 3: ['b'], 5: ['c'] }, [1, 3], [2, 4, 6]))
    expect(s.filter(x => !x.optional).map(x => x.n)).toEqual([1, 2, 3])
    expect(s.filter(x => x.optional).map(x => x.n)).toEqual([1, 2, 3])
    // Interleaved in week order, which is the order the rows appear in.
    expect(s.map(x => x.day)).toEqual([1, 2, 3, 4, 5, 6])
    expect(s.map(x => x.n)).toEqual([1, 1, 2, 2, 3, 3])
  })

  // A day both lists claim is corruption — a hand-edited bundle, a stale merge — and optional wins
  // (requiredDaysOf). The numbering has to follow that rule rather than second-guess it, or the two
  // counters would number a day the rest of the app calls required under a different name.
  it('follows the required/optional tie-break for a day both lists claim', () => {
    const s = numberedSlotsOf(plan({ 1: ['a'], 3: ['b'], 5: ['c'] }, [1], [2, 3, 4]))
    // Day 3 is in both lists, so it reads optional: required is 1 and 5, optional 2 and 3.
    expect(s.find(x => x.day === 3).optional).toBe(true)
    expect(s.filter(x => !x.optional).map(x => x.day)).toEqual([1, 5])
    expect(s.filter(x => x.optional).map(x => x.day)).toEqual([2, 3, 4])
    expect(s.map(x => [x.day, x.n])).toEqual([[1, 1], [2, 1], [3, 2], [4, 3], [5, 2]])
  })

  it('follows the week-start setting for a Sunday profile', () => {
    const s = numberedSlotsOf({ ...plan({ 0: ['a'], 2: ['b'] }, [0, 2]), weekStart: 0 })
    expect(s).toEqual([
      { day: 0, optional: false, n: 1 },
      { day: 2, optional: false, n: 2 },
    ])
  })

  it('leaves a required slot with nothing on it numbered, not missing', () => {
    const s = numberedSlotsOf(plan({ 1: ['a'] }, [1, 2, 3]))
    expect(s.map(x => [x.day, x.n])).toEqual([[1, 1], [2, 2], [3, 3]])
  })

  it('is empty for a plan with no frequency set at all', () => {
    expect(numberedSlotsOf(plan({}))).toEqual([])
  })
})

describe('slotNumber', () => {
  it('gives the number one slot is called within its own kind', () => {
    const S = plan({ 1: ['a'], 3: ['b'] }, [1, 3], [2])
    expect(slotNumber(S, 1)).toBe(1)
    expect(slotNumber(S, 3)).toBe(2)
    expect(slotNumber(S, 2)).toBe(1)
  })

  // The sheet that fills a slot reads its title through this. A day the plan does not have has no
  // number, and the sheet is only ever opened for a day it does have.
  it('is 0 for a day the plan has no slot for', () => {
    expect(slotNumber(plan({ 1: ['a'] }, [1]), 4)).toBe(0)
  })
})
