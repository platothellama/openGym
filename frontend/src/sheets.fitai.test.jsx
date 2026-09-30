// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { seedWeight, preWorkoutLine } from './sheets.jsx'

describe('seedWeight', () => {
  it('converts the FitAI kilos into this profile’s unit', () => {
    expect(seedWeight({ body: { weightKg: 103 } }, 'kg')).toBe(103)
    expect(seedWeight({ body: { weightKg: 103 } }, 'lb')).toBe(227.1)
  })
  it('offers nothing when there is no weight to offer', () => {
    expect(seedWeight(null, 'kg')).toBe(null)
    expect(seedWeight({}, 'kg')).toBe(null)
    expect(seedWeight({ body: {} }, 'kg')).toBe(null)
    expect(seedWeight({ body: { weightKg: 0 } }, 'kg')).toBe(null)
  })
})

describe('preWorkoutLine', () => {
  it('stays quiet with no fuel, no day, or an empty day', () => {
    expect(preWorkoutLine(undefined)).toBe(null)
    expect(preWorkoutLine(null)).toBe(null)
    expect(preWorkoutLine({})).toBe(null)
    expect(preWorkoutLine({ day: null, summary: null })).toBe(null)
    expect(preWorkoutLine({ day: { totals: { kcal: 0, protein: 0 }, meals: [] } })).toBe(null)
  })
  it('names the fast and today’s fuel so far', () => {
    const line = preWorkoutLine({
      day: {
        totals: { kcal: 842, protein: 96, carbs: 40, fat: 20 },
        meals: [{ meal: 'lunch' }],
        fasting: { protocol: '16:8', status: 'active', elapsedMin: 810 }
      },
      summary: null
    })
    expect(line).toContain('Fasted 13h')
    expect(line).toContain('842 kcal')
    expect(line).toContain('96g protein')
  })
  it('a short fast is not worth a line on its own', () => {
    expect(preWorkoutLine({ day: { totals: { kcal: 0 }, meals: [], fasting: { elapsedMin: 45 } } })).toBe(null)
  })
  it('adds the weekly deficit underneath when the summary made it', () => {
    const line = preWorkoutLine({
      day: { totals: { kcal: 300, protein: 20 }, meals: [{}], fasting: null },
      summary: { nutrition: { daysLogged: 5, deficitVsTarget: 900, proteinVsTarget: 10 } }
    })
    expect(line).toContain('300 kcal')
    expect(line).toContain('900 kcal under target')
  })
})
