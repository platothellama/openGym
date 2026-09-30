// @vitest-environment happy-dom
// Fuel note under the fatigue map: a linked profile with a deep deficit sees
// the note on the Fatigue view; unlinked profiles and quiet weeks see nothing.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import Stats from './Stats.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ID = 'fc8647ef-81bb-443c-8ecd-c4d138c81f84'
const SUMMARY = {
  targets: { calories: 2000, protein: 150 },
  nutrition: { daysLogged: 6, kcalAvg: 1433, proteinAvg: 119, deficitVsTarget: 900, proteinVsTarget: 31 },
  activity: { stepsAvg: 18593, stepsDays: 6 }
}

const mocks = vi.hoisted(() => ({
  S: {
    unit: 'kg', body: 'male', effort: 'none', targetW: null, lang: 'en',
    bodyweight: [], routines: [],
    workouts: [{
      id: 'w1', d: '2026-09-20', start: Date.UTC(2026, 8, 20, 10), end: Date.UTC(2026, 8, 20, 11),
      entries: [{ id: '1254', sets: [{ done: true, w: 60, r: 8 }] }]
    }],
    customEx: [], exWeights: {},
    week: {}, dayPlan: {}, active: null, fitaiUserId: 'fc8647ef-81bb-443c-8ecd-c4d138c81f84',
  },
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: mocks.S }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {},
  exerciseHistorySheet: () => {}, WorkoutRow: () => React.createElement('div'),
  bwDeltaColor: () => 'inherit', weighInsSheet: () => {},
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Icon.jsx', () => ({ default: () => React.createElement('span') }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: () => React.createElement('div'),
  BodyMapLegend: () => React.createElement('div'),
}))
vi.mock('../lib/fitai.js', async importOriginal => {
  const m = await importOriginal()
  return { ...m, getFitaiSummary: vi.fn() }
})
import { getFitaiSummary } from '../lib/fitai.js'

let host, root
beforeEach(() => {
  mocks.S.fitaiUserId = ID
  vi.mocked(getFitaiSummary).mockReset().mockResolvedValue(SUMMARY)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const fatigueButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fatigue')
const toFatigue = async () => {
  act(() => root.render(<Stats />))
  await settle()
  act(() => fatigueButton().click())
  await settle()
}

describe('Stats fatigue fuel note', () => {
  it('shows the deficit line on the Fatigue view when linked', async () => {
    await toFatigue()
    expect(host.textContent).toContain('Fuel')
    expect(host.textContent).toContain('900 kcal under target')
  })

  it('asks nothing and shows nothing when unlinked', async () => {
    mocks.S.fitaiUserId = null
    await toFatigue()
    expect(getFitaiSummary).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Fuel:')
  })

  it('stays quiet on a fueled week', async () => {
    vi.mocked(getFitaiSummary).mockResolvedValue({
      targets: {}, nutrition: { daysLogged: 6, kcalAvg: 2000, proteinAvg: 150, deficitVsTarget: 0, proteinVsTarget: 0 }, activity: {}
    })
    await toFatigue()
    expect(host.textContent).not.toContain('Fuel:')
  })
})
