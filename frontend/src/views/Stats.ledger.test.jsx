// @vitest-environment happy-dom
// The weekly-targets panel on Stats: why a weight was held or given back this week. It reads the
// same ledger rules the workout card does, so a held week can be understood before the next session
// rather than only being explained on the day.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import Stats from './Stats.jsx'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CHEST = '1254' // bench: full chest, plus shoulders, triceps and biceps at 0.4
const STRENGTH = { chest: 10, aux: 6 } // the strength system's weekly hard-set caps

// A session of `count` hard bench sets. Bench feeds four muscles at once, which is the point of
// the ledger — the numbers below are all four of them, not just the chest.
const session = (id, count) => ({
  id, d: todayISO(), start: Date.now() - 3600000, end: Date.now(),
  entries: [{ id: CHEST, sets: Array.from({ length: count }, () => ({ done: true, w: 60, r: 8, rir: 1 })) }],
})

const lastWeek = () => {
  const when = new Date()
  when.setDate(when.getDate() - 7)
  return when.toISOString().slice(0, 10)
}

const mocks = vi.hoisted(() => ({
  S: {
    unit: 'kg', body: 'male', effort: 'none', targetW: null, lang: 'en', weekStart: 1,
    bodyweight: [], routines: [], customEx: [], exWeights: [],
    workouts: [], week: {}, dayPlan: {}, active: null, fitaiUserId: null, trainSystem: 'strength',
  },
}))

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
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
vi.mock('../lib/fitai.js', async importOriginal => ({ ...(await importOriginal()), getFitaiSummary: vi.fn() }))

let host, root
beforeEach(() => {
  // Reset the whole profile: the no-system test deletes the key, and the next test needs it back.
  mocks.S.trainSystem = 'strength'
  mocks.S.workouts = [session('w1', 5), session('w2', 5)]
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const text = () => host.textContent

describe('Stats weekly targets', () => {
  it('names the muscle that is over its target, and says the weight is being held', async () => {
    act(() => root.render(<Stats />))
    await settle()
    expect(text()).toContain('Weekly targets')
    expect(text()).toContain('Chest is at its weekly target of 10 hard sets - holding.')
    expect(text()).toContain('10/10')
  })

  it('the caps are per muscle, so the bench counts for every muscle it trains', async () => {
    act(() => root.render(<Stats />))
    await settle()
    // Ten bench sets are chest's cap but two thirds of the way past triceps', biceps' and
    // shoulders' — which is the whole reason the ledger exists: they are all held this week.
    expect(text()).toContain('Triceps is at its weekly target of 6 hard sets - holding.')
    expect(text()).toContain('10/6')
  })

  it('a week under every cap says so instead of listing muscles', async () => {
    mocks.S.workouts = [session('w1', 2)]
    act(() => root.render(<Stats />))
    await settle()
    expect(text()).toContain('Weekly targets')
    expect(text()).toContain('Nothing is over its weekly target this week.')
    expect(text()).not.toContain('- holding.')
  })

  it('says nothing without a training system, because there is no cap to be over', async () => {
    delete mocks.S.trainSystem
    act(() => root.render(<Stats />))
    await settle()
    expect(text()).not.toContain('Weekly targets')
  })

  it('two over-cap weeks running say the weight is coming back down', async () => {
    mocks.S.workouts = [
      session('w1', 5), session('w2', 5),
      { ...session('w3', 5), d: lastWeek() }, { ...session('w4', 5), d: lastWeek() },
    ]
    act(() => root.render(<Stats />))
    await settle()
    expect(text()).toContain('Chest has been over its weekly target for 2 weeks running - back off a step.')
  })
})