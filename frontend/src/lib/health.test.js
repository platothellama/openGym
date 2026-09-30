import { describe, expect, it } from 'vitest'
import { summarizeHr, decimateCurve, buildHealthSummary, sanitizeHealth, healthLabel, extractPoints, extractTotal, HEALTH_CURVE_MAX } from './health.js'

describe('summarizeHr', () => {
  it('averages valid BPM samples, ignoring junk', () => {
    expect(summarizeHr([{ t: 1, y: 120 }, { t: 2, y: 140 }, { t: 3, y: 160 }])).toEqual({ avgHr: 140, maxHr: 160, minHr: 120, count: 3 })
    expect(summarizeHr([{ y: 0 }, { y: 999 }, { y: 'x' }, null])).toEqual({ avgHr: null, maxHr: null, minHr: null, count: 0 })
    expect(summarizeHr([])).toEqual({ avgHr: null, maxHr: null, minHr: null, count: 0 })
  })
})

describe('decimateCurve', () => {
  it('passes short curves through sorted', () => {
    expect(decimateCurve([{ t: 3, y: 130 }, { t: 1, y: 120 }])).toEqual([{ t: 1, y: 120 }, { t: 3, y: 130 }])
  })
  it('caps long sessions at HEALTH_CURVE_MAX, keeping endpoints', () => {
    const pts = Array.from({ length: 600 }, (_, i) => ({ t: i * 1000, y: 120 + (i % 40) }))
    const out = decimateCurve(pts)
    expect(out.length).toBe(HEALTH_CURVE_MAX)
    expect(out[0].t).toBe(0)
    expect(out[out.length - 1].t).toBe(599000)
  })
})

describe('buildHealthSummary', () => {
  it('returns null when there is nothing worth keeping (legacy shape preserved)', () => {
    expect(buildHealthSummary({})).toBe(null)
    expect(buildHealthSummary({ samples: [] })).toBe(null)
  })
  it('builds avg/max/min + decimated curve + totals', () => {
    const samples = [{ t: 1000, y: 120 }, { t: 2000, y: 160 }]
    const s = buildHealthSummary({ samples, kcal: 210.4, steps: 1500, spo2Avg: 97.86 })
    expect(s).toMatchObject({ avgHr: 140, maxHr: 160, minHr: 120, kcal: 210, steps: 1500, spo2Avg: 97.9, src: 'health-connect' })
    expect(s.hrCurve).toEqual([{ t: 1000, y: 120 }, { t: 2000, y: 160 }])
  })
})

describe('sanitizeHealth', () => {
  it('drops junk, rounds, and caps the curve', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ t: i, y: 120 }))
    expect(sanitizeHealth({ avgHr: '142.2', maxHr: 168, kcal: 'x', hrCurve: big, src: 'health-connect' })).toMatchObject({
      avgHr: 142, maxHr: 168, src: 'health-connect',
    })
    expect(sanitizeHealth({ avgHr: 140 }).hrCurve).toBe(undefined)
    expect(sanitizeHealth(null)).toBe(null)
    expect(sanitizeHealth([])).toBe(null)
    expect(sanitizeHealth({})).toBe(null)
  })
})

describe('healthLabel', () => {
  it('renders a one-line summary or null', () => {
    expect(healthLabel({ avgHr: 142, maxHr: 168, kcal: 210 })).toBe('⌀142 bpm · max 168 · 210 kcal')
    expect(healthLabel({})).toBe(null)
    expect(healthLabel(null)).toBe(null)
  })
})

describe('extractPoints', () => {
  const d1 = '2026-09-28T10:00:00Z', d2 = '2026-09-28T10:01:00Z'
  it('reads bucketed aggregates', () => {
    expect(extractPoints({ buckets: [{ startDate: d1, value: 120 }, { startDate: d2, value: 140 }] }))
      .toEqual([{ t: Date.parse(d1), y: 120 }, { t: Date.parse(d2), y: 140 }])
  })
  it('reads raw record lists', () => {
    expect(extractPoints({ records: [{ startTime: d1, bpm: 130 }] }))
      .toEqual([{ t: Date.parse(d1), y: 130 }])
  })
  it('reads chart-ready points and bare arrays', () => {
    expect(extractPoints({ points: [{ x: d1, y: 125 }] })).toEqual([{ t: Date.parse(d1), y: 125 }])
    expect(extractPoints([{ t: Date.parse(d1), y: 125 }])).toEqual([{ t: Date.parse(d1), y: 125 }])
  })
  it('tolerates junk', () => {
    expect(extractPoints(null)).toEqual([])
    expect(extractPoints({ buckets: [{ startDate: 'not-a-date', value: 120 }] })).toEqual([])
    expect(extractPoints('junk')).toEqual([])
  })
})

describe('extractTotal', () => {
  it('sums SUM buckets, null when empty', () => {
    const d1 = '2026-09-28T10:00:00Z', d2 = '2026-09-28T10:01:00Z'
    expect(extractTotal({ buckets: [{ startDate: d1, value: 100 }, { startDate: d2, value: 50 }] })).toBe(150)
    expect(extractTotal({ buckets: [] })).toBe(null)
    expect(extractTotal(null)).toBe(null)
  })
})
