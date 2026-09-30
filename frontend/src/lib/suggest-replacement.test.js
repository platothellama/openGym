import { describe, expect, it } from 'vitest'
import { suggestReplacements, muscleOverlap } from './suggest-replacement.js'
import { EXIDX } from './exercises.js'

const base = () => ({
  unit: 'kg',
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 10, weight: 60 }] }],
  workouts: [],
  customEx: [],
  favEx: [],
  equipFilterOn: false,
})

describe('suggestReplacements (single-slot replace)', () => {
  it('suggests same-target work and never the slot itself', () => {
    const out = suggestReplacements(base(), 'r1', 0)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(3)
    expect(out.some(s => s.id === '0025')).toBe(false)
    // Barbell bench target is pectorals — the top pick keeps it.
    expect(out[0].reasons).toContain('same-target')
    expect(EXIDX[out[0].id]).toBeTruthy()
  })

  it('skips exercises already in the routine and ones you cannot do', () => {
    const S = base()
    S.routines[0].ex.push({ id: '0033', sets: 3, mode: 'reps', reps: 10 })
    S.equipFilterOn = true
    S.equipProfiles = [{ id: 'p1', name: 'Home', equipment: ['barbell'] }]
    S.activeEquipId = 'p1'
    const out = suggestReplacements(S, 'r1', 0, { limit: 10 })
    expect(out.some(s => s.id === '0033')).toBe(false)
    expect(out.some(s => s.id === '0025')).toBe(false)
    for (const s of out) {
      const ex = EXIDX[s.id]
      expect(['barbell', 'body weight'].includes(ex.eq) || !ex.eq).toBe(true)
    }
  })

  it('respects coach dislikes and marks trained-before picks', () => {
    const S = base()
    S.workouts = [{ d: '2026-09-01', entries: [{ id: '0033', sets: [{ done: true, r: 10, w: 60 }] }] }]
    S.coach = { profile: { dislikes: 'decline' } }
    const out = suggestReplacements(S, 'r1', 0, { limit: 10 })
    // 0033 is a decline bench — disliked, so it must not be suggested.
    expect(out.some(s => s.id === '0033')).toBe(false)
    // Another trained exercise keeps its TRAINED reason.
    S.coach = {}
    S.workouts = [{ d: '2026-09-01', entries: [{ id: '0045', sets: [{ done: true, r: 10, w: 60 }] }] }]
    const out2 = suggestReplacements(S, 'r1', 0, { limit: 10 })
    const guillotine = out2.find(s => s.id === '0045')
    expect(guillotine?.reasons).toContain('trained')
  })

  it('keeps a cardio slot cardio', () => {
    const S = base()
    const cardio = Object.values(EXIDX).find(e => e.bp === 'cardio')
    expect(cardio).toBeTruthy()
    S.routines[0].ex = [{ id: cardio.id, sets: 1, mode: 'cardio', min: 20, speed: 8 }]
    const out = suggestReplacements(S, 'r1', 0, { limit: 10 })
    for (const s of out) expect(EXIDX[s.id].bp).toBe('cardio')
  })

  it('returns [] for an unknown routine or slot', () => {
    expect(suggestReplacements(base(), 'nope', 0)).toEqual([])
    expect(suggestReplacements(base(), 'r1', 9)).toEqual([])
  })

  it('muscleOverlap is 1 for an exercise with itself', () => {
    expect(muscleOverlap(EXIDX['0025'], EXIDX['0025'])).toBeCloseTo(1)
  })
})
