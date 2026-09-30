import { describe, expect, it } from 'vitest'
import { trainingDays, cleanPlanDay, planDayLabel } from './plan-day.js'

describe('training-day tags', () => {
  it('counts the coach plan: committed days plus the optional one', () => {
    expect(trainingDays({ coach: { profile: { daysPerWeek: 3, optionalDay: true } } }))
      .toEqual({ committed: 3, optional: true, total: 4 })
    expect(trainingDays({ coach: { profile: { daysPerWeek: 5 } } }))
      .toEqual({ committed: 5, optional: false, total: 5 })
  })

  it('an optional day on a seven-day plan has nowhere to go', () => {
    expect(trainingDays({ coach: { profile: { daysPerWeek: 7, optionalDay: true } } }))
      .toEqual({ committed: 7, optional: false, total: 7 })
  })

  it('falls back to the scheduled week without a coach profile, else null', () => {
    expect(trainingDays({ week: { 1: ['a'], 3: ['b'] } }))
      .toEqual({ committed: 2, optional: false, total: 2 })
    expect(trainingDays({ week: {} })).toBe(null)
    expect(trainingDays({})).toBe(null)
  })

  it('keeps a valid tag and drops everything else', () => {
    const days = { committed: 3, optional: true, total: 4 }
    expect(cleanPlanDay({ kind: 'day', n: 2 }, days)).toEqual({ kind: 'day', n: 2 })
    expect(cleanPlanDay({ kind: 'optional' }, days)).toEqual({ kind: 'optional' })
    // Day 4 is the optional session's slot — numbered tags stop at the committed days.
    expect(cleanPlanDay({ kind: 'day', n: 4 }, days)).toBe(null)
    expect(cleanPlanDay({ kind: 'day', n: 5 }, days)).toBe(null)
    expect(cleanPlanDay({ kind: 'day', n: 0 }, days)).toBe(null)
    expect(cleanPlanDay({ kind: 'optional' }, { committed: 3, optional: false, total: 3 })).toBe(null)
    expect(cleanPlanDay({ kind: 'freestyle' }, days)).toBe(null)
    expect(cleanPlanDay(null, days)).toBe(null)
    expect(cleanPlanDay({ kind: 'day', n: 1 }, null)).toBe(null)
  })

  it('labels a filed tag for history and the header', () => {
    expect(planDayLabel({ kind: 'day', n: 2 })).toBe('Day 2')
    expect(planDayLabel({ kind: 'optional' })).toBe('Optional')
    expect(planDayLabel(null)).toBe(null)
    expect(planDayLabel({ kind: 'day', n: 0 })).toBe(null)
  })
})
