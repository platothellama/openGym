import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeFitaiUserId, isFitaiUserId, fitaiStatusLine, fuelLineText, fitaiChatLines } from './fitai.js'

const ID = 'fc8647ef-81bb-443c-8ecd-c4d138c81f84'

describe('normalizeFitaiUserId', () => {
  it('trims pasted ids and keeps non-strings empty', () => {
    expect(normalizeFitaiUserId('  ' + ID + '\n')).toBe(ID)
    expect(normalizeFitaiUserId(null)).toBe('')
    expect(normalizeFitaiUserId(42)).toBe('')
  })
})

describe('isFitaiUserId', () => {
  it('accepts uuids, refuses typos', () => {
    expect(isFitaiUserId(ID)).toBe(true)
    expect(isFitaiUserId('not-an-id')).toBe(false)
    expect(isFitaiUserId('')).toBe(false)
    expect(isFitaiUserId(null)).toBe(false)
  })
})

describe('fitaiStatusLine', () => {
  it('summarises targets, freshness and feature flags', () => {
    expect(fitaiStatusLine({
      targets: { calories: 2000, protein: 150, tdee: 2400 },
      lastFoodDate: '2026-09-28', hasGlucose: true, hasFasting: false
    })).toBe('2000 kcal · 150g protein · last log 2026-09-28 · glucose')
  })

  it('says plainly when nothing is logged yet', () => {
    expect(fitaiStatusLine({ targets: {}, lastFoodDate: null, hasGlucose: false, hasFasting: false }))
      .toBe('no food logs yet')
    expect(fitaiStatusLine(null)).toBe(null)
  })
})

describe('fitaiChatLines', () => {
  const FULL = {
    nutrition: { daysLogged: 5, kcalAvg: 2100, proteinAvg: 120 },
    targets: { calories: 2500, protein: 150 },
    body: { weightKg: 80, scan: { bodyFatPct: 20, leanKg: 64 } },
    glucose: { n: 8, fastingAvg: 95, latest: { value: 110 } },
    fasting: { sessions: 3, completed: 2, active: { protocol: '16:8' } },
    activity: { stepsAvg: 8000 }
  }
  it('names food averages vs targets, body comp, glucose, fasting and steps', () => {
    const lines = fitaiChatLines(FULL)
    expect(lines.join('\n')).toContain('2100')
    expect(lines.join('\n')).toContain('2500')
    expect(lines.join('\n')).toContain('120')
    expect(lines.join('\n')).toContain('80')
    expect(lines.join('\n')).toContain('20')
    expect(lines.join('\n')).toContain('8')
    expect(lines.join('\n')).toContain('16:8')
    expect(lines.join('\n')).toContain('8000')
  })
  it('reads empty or missing blocks as absent, never as zeros', () => {
    expect(fitaiChatLines(null)).toEqual([])
    expect(fitaiChatLines({})).toEqual([])
    expect(fitaiChatLines({ nutrition: { daysLogged: 0 } })).toEqual([])
  })
  it('still names what exists when only part of the window is logged', () => {
    const lines = fitaiChatLines({ nutrition: { daysLogged: 2, kcalAvg: 1800 }, targets: {} })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('1800')
  })
})

describe('fuelLineText', () => {
  it('words each readiness kind in one line', () => {
    expect(fuelLineText({ kind: 'fasted', hours: 13 })).toContain('13')
    expect(fuelLineText({ kind: 'deficit', kcal: 900 })).toContain('900')
    expect(fuelLineText({ kind: 'protein', grams: 62 })).toContain('62')
  })
})

describe('fitaiStatus', () => {
  it('asks our own server, never Supabase directly', async () => {
    vi.resetModules()
    const seen = []
    vi.doMock('./api.js', () => ({ api: path => { seen.push(path); return Promise.resolve({ ok: true }) } }))
    const { fitaiStatus } = await import('./fitai.js')
    await fitaiStatus('  ' + ID + ' ')
    expect(seen).toEqual(['/api/fitai/status?user_id=' + ID])
    vi.doUnmock('./api.js')
  })
})

describe('fitaiSummary / fitaiDay', () => {
  it('builds windowed proxy URLs with the id encoded', async () => {
    vi.resetModules()
    const seen = []
    vi.doMock('./api.js', () => ({ api: path => { seen.push(path); return Promise.resolve({ ok: true }) } }))
    const { fitaiSummary, fitaiDay } = await import('./fitai.js')
    await fitaiSummary(ID, 7)
    await fitaiDay(ID, '2026-09-28')
    await fitaiDay(ID)
    expect(seen).toEqual([
      '/api/fitai/summary?user_id=' + ID + '&days=7',
      '/api/fitai/day?user_id=' + ID + '&date=2026-09-28',
      '/api/fitai/day?user_id=' + ID
    ])
    vi.doUnmock('./api.js')
  })
})

describe('getFitaiSummary / getFitaiDay', () => {
  const setup = async (impl) => {
    vi.resetModules()
    const seen = []
    vi.doMock('./api.js', () => ({
      api: path => { seen.push(path); return impl ? impl(path) : Promise.resolve({ ok: true }) }
    }))
    const m = await import('./fitai.js')
    m._resetFitaiCache()
    return { m, seen }
  }
  afterEach(() => { vi.doUnmock('./api.js') })

  it('returns null without asking when unlinked', async () => {
    const { m, seen } = await setup()
    expect(await m.getFitaiSummary(null)).toBe(null)
    expect(await m.getFitaiSummary('nope')).toBe(null)
    expect(await m.getFitaiDay('', '2026-09-28')).toBe(null)
    expect(seen).toEqual([])
  })

  it('shares one in-flight request and caches the answer', async () => {
    const { m, seen } = await setup()
    const a = m.getFitaiSummary(ID, 7, 1000)
    const b = m.getFitaiSummary(ID, 7, 1000)
    expect(await a).toEqual({ ok: true })
    expect(await b).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    await m.getFitaiSummary(ID, 7, 1000 + 60 * 1000)
    expect(seen).toHaveLength(1)
    await m.getFitaiSummary(ID, 7, 1000 + 3 * 60 * 1000)
    expect(seen).toHaveLength(2)
  })

  it('a failure resolves null and does not poison the cache', async () => {
    let fail = true
    const { m, seen } = await setup(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ ok: true })))
    expect(await m.getFitaiDay(ID, '2026-09-28', 1000)).toBe(null)
    fail = false
    expect(await m.getFitaiDay(ID, '2026-09-28', 1000)).toEqual({ ok: true })
    expect(seen).toHaveLength(2)
  })
})
