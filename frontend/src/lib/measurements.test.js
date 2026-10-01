import { describe, expect, it } from 'vitest'
import {
  MIN_GAP_DAYS, NOISE_CM, SITE_IDS, compareEntry, compositionRead, daysApart,
  latestBySite, latestComparison, latestMeasurements, normalizeMeasurements, siteSeries, upsertMeasurements,
} from './measurements.js'

// Girths: one entry per tape session, read month-against-month and only when a site has moved
// further than the tape can be trusted to say it has.
describe('normalizeMeasurements', () => {
  it('keeps the sites that were measured, drops the rest, and sorts by day', () => {
    const list = normalizeMeasurements([
      { d: '2026-09-01', v: { waist: 82, arm: 36.5 } },
      { d: '2026-07-01', v: { thigh: 58 } },
      { d: '2026-08-01', v: { waist: 0, chest: -3, hip: 95 } },
    ])
    expect(list.map(e => e.d)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    // A 0, a negative and a key that is not a site all read as "not measured", never as a value.
    expect(list[1].v).toEqual({ hip: 95 })
  })

  it('drops an entry it cannot place, one with no sites, and non-arrays', () => {
    const list = normalizeMeasurements([{ v: { waist: 80 } }, { d: 'not-a-date', v: { waist: 80 } }, { d: '2026-09-01', v: {} }, null, 'x'])
    expect(list).toEqual([])
    expect(normalizeMeasurements(undefined)).toEqual([])
  })

  it('does not rely on the stored order', () => {
    expect(normalizeMeasurements([{ d: '2026-09-01', v: { waist: 80 } }, { d: '2026-01-01', v: { waist: 85 } }]).map(e => e.d))
      .toEqual(['2026-01-01', '2026-09-01'])
  })
})

describe('daysApart', () => {
  it('counts whole days either way round, and gives up on a day that does not parse', () => {
    expect(daysApart('2026-01-01', '2026-02-01')).toBe(31)
    expect(daysApart('2026-02-01', '2026-01-01')).toBe(-31)
    expect(daysApart('2026-01-01', '2026-01-01')).toBe(0)
    expect(daysApart('nope', '2026-01-01')).toBeNull()
  })
})

describe('upsertMeasurements', () => {
  const one = [{ d: '2026-08-01', t: 1, v: { waist: 82, arm: 36 } }]

  it('appends a new day, oldest first', () => {
    const out = upsertMeasurements(one, '2026-09-01', { chest: 100 }, 500)
    expect(out.map(e => e.d)).toEqual(['2026-08-01', '2026-09-01'])
    expect(out[1]).toEqual({ d: '2026-09-01', t: 500, v: { chest: 100 } })
  })

  it('merges into the day already there, overwriting only the sites given', () => {
    const out = upsertMeasurements(one, '2026-08-01', { arm: 37.5 }, 500)
    expect(out).toHaveLength(1)
    expect(out[0].v).toEqual({ waist: 82, arm: 37.5 })
    expect(out[0].t).toBe(500)
  })

  it('leaves the edit stamp alone when the numbers are unchanged, so it cannot win a sync', () => {
    expect(upsertMeasurements(one, '2026-08-01', { waist: 82 }, 500)).toEqual(one)
  })

  it('ignores sites that were not measured and writes nothing when none were', () => {
    expect(upsertMeasurements(one, '2026-09-01', { waist: 0, nope: 5 }, 500).map(e => e.d)).toEqual(['2026-08-01'])
    expect(upsertMeasurements(one, '2026-09-01', {}, 500)).toEqual(one)
  })

  it('does not mutate what it was given', () => {
    const src = [{ d: '2026-08-01', t: 1, v: { waist: 82 } }]
    upsertMeasurements(src, '2026-08-01', { waist: 80 }, 500)
    expect(src[0].v.waist).toBe(82)
  })
})

describe('compareEntry', () => {
  it('compares against the newest entry far enough back, skipping ones that are too recent', () => {
    // 10 and 20 days back are both too close to read a trend from; 2026-06-01 is not.
    const log = [
      { d: '2026-06-01', v: { waist: 85 } },
      { d: '2026-09-05', v: { waist: 84 } },
      { d: '2026-09-15', v: { waist: 84.5 } },
      { d: '2026-09-25', v: { waist: 83 } },
    ]
    const cmp = compareEntry(log, log[3])
    expect(cmp.from).toBe('2026-06-01')
    expect(cmp.sites.waist).toMatchObject({ current: 83, previous: 85, change: -2, changed: true })
    // The 0.5 cm from ten days ago is not the comparison — a fortnight is not a trend.
    expect(cmp.sites.waist.change).toBe(-2)
  })

  it('reports a change only past the noise floor, but keeps the real numbers either way', () => {
    const log = [{ d: '2026-06-01', v: { arm: 36 } }, { d: '2026-09-01', v: { arm: 36.5 } }]
    const cmp = compareEntry(log, log[1])
    expect(cmp.sites.arm.change).toBeCloseTo(0.5, 5)
    expect(cmp.sites.arm.changed).toBe(false)
    const loud = compareEntry([{ d: '2026-06-01', v: { arm: 36 } }, { d: '2026-09-01', v: { arm: 38 } }], { d: '2026-09-01' })
    expect(loud.sites.arm.changed).toBe(true)
  })

  it('leaves an unmeasured site out rather than showing it as no change', () => {
    const cmp = compareEntry([{ d: '2026-06-01', v: { waist: 85, arm: 36 } }, { d: '2026-09-01', v: { waist: 84 } }], { d: '2026-09-01' })
    expect(Object.keys(cmp.sites)).toEqual(['waist'])
  })

  it('has a null change when the baseline did not measure that site', () => {
    const cmp = compareEntry([{ d: '2026-06-01', v: { waist: 85 } }, { d: '2026-09-01', v: { waist: 84, arm: 36 } }], { d: '2026-09-01' })
    expect(cmp.sites.arm).toMatchObject({ current: 36, previous: null, change: null, changed: false })
  })

  it('has no baseline when every earlier entry is too recent', () => {
    const cmp = compareEntry([{ d: '2026-09-01', v: { waist: 85 } }, { d: '2026-09-20', v: { waist: 84 } }], { d: '2026-09-20' })
    expect(cmp.from).toBeNull()
    expect(cmp.sites.waist).toMatchObject({ current: 84, previous: null, change: null, changed: false })
  })

  it('is null for a day that is not in the log at all', () => {
    expect(compareEntry([{ d: '2026-09-01', v: { waist: 85 } }], { d: '2026-01-01' })).toBeNull()
  })
})

describe('latestComparison', () => {
  it('needs two entries and a baseline far enough back before it will say anything', () => {
    expect(latestComparison([])).toBeNull()
    expect(latestComparison([{ d: '2026-09-01', v: { waist: 85 } }])).toBeNull()
    expect(latestComparison([{ d: '2026-09-01', v: { waist: 85 } }, { d: '2026-09-10', v: { waist: 84 } }])).toBeNull()
    expect(latestComparison([{ d: '2026-07-01', v: { waist: 85 } }, { d: '2026-09-01', v: { waist: 84 } }])).not.toBeNull()
  })
})

describe('compositionRead', () => {
  const log = (first, last) => [{ d: '2026-06-01', v: first }, { d: '2026-09-01', v: last }]

  it('reads a recomp when the limbs grew and the waist went down', () => {
    const r = compositionRead(log({ waist: 85, arm: 36, chest: 98 }, { waist: 82, arm: 38, chest: 101 }))
    expect(r.value).toBe('recomp')
  })

  it('reads a bulk as the limbs growing with the waist holding or growing too', () => {
    expect(compositionRead(log({ arm: 36, chest: 98, thigh: 56 }, { arm: 38, chest: 101, thigh: 59 })).value).toBe('gaining')
    expect(compositionRead(log({ arm: 36, waist: 85 }, { arm: 38, waist: 87 })).value).toBe('gaining')
  })

  it('reads a cut as the reverse', () => {
    expect(compositionRead(log({ arm: 38, waist: 85, thigh: 59 }, { arm: 36, waist: 82, thigh: 56 })).value).toBe('cutting')
  })

  it('reads limbs shrinking against a rising waist, rather than calling it a bulk', () => {
    expect(compositionRead(log({ arm: 38, waist: 82 }, { arm: 36, waist: 85 })).value).toBe('reverse')
  })

  it('says stable only when nothing cleared the noise floor, and mixed when the sites disagree', () => {
    expect(compositionRead(log({ arm: 36, waist: 85 }, { arm: 36.5, waist: 85.4 })).value).toBe('stable')
    expect(compositionRead(log({ arm: 36, thigh: 56 }, { arm: 38, thigh: 54 })).value).toBe('mixed')
  })

  it('is null with nothing to read yet, which is not a finding of no change', () => {
    expect(compositionRead([])).toBeNull()
    expect(compositionRead([{ d: '2026-09-01', v: { waist: 85 } }])).toBeNull()
    // One number is not a composition reading: a waist alone cannot say the body lost or gained,
    // because nothing was measured to say what happened to the rest of it.
    expect(compositionRead(log({ waist: 85 }, { waist: 84 })).value).toBe('mixed')
  })

  it('reads a cut from the waist and hips down with the limbs measured and flat', () => {
    expect(compositionRead(log({ waist: 85, hip: 98, arm: 36 }, { waist: 82, hip: 95, arm: 36.3 })).value).toBe('cutting')
  })
})

describe('reading helpers', () => {
  const log = [{ d: '2026-06-01', v: { waist: 85, arm: 36 } }, { d: '2026-09-01', v: { waist: 82 } }]

  it('finds the newest entry and its sites in the sheet order', () => {
    expect(latestMeasurements(log).d).toBe('2026-09-01')
    expect(Object.keys(latestBySite(log))).toEqual(['waist'])
  })

  it('plots one site across every entry, oldest first', () => {
    const pts = siteSeries(log, 'waist')
    expect(pts.map(p => p.y)).toEqual([85, 82])
    expect(pts[0].t).toBeLessThan(pts[1].t)
  })

  it('plots nothing for a site that was never measured or is not a site', () => {
    expect(siteSeries(log, 'chest')).toEqual([])
    expect(siteSeries(log, 'nope')).toEqual([])
  })

  it('has a noise floor and a gap wide enough to be worth reading', () => {
    expect(NOISE_CM).toBeGreaterThan(0.5)
    expect(MIN_GAP_DAYS).toBeGreaterThanOrEqual(28)
  })

  it('names every site once, in a fixed order', () => {
    expect(SITE_IDS).toEqual(['neck', 'shoulder', 'chest', 'arm', 'waist', 'hip', 'thigh', 'calf'])
  })
})
