// @vitest-environment happy-dom
// The start chooser's training-day tag: which plan day a new session covers, and — for the
// optional day — which routine runs as the optional session. startFlow is the boundary:
// the tag it receives is what beginWorkout files onto the session.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { startFlow } from '../sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector({ S: mocks.S, update: mut => mut(mocks.S) })
  useStore.getState = () => ({ S: mocks.S, update: mut => mut(mocks.S) })
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = () => ({})
  useUI.getState = () => ({})
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn() }))

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', workouts: [], bodyweight: [], exWeights: {}, dayPlan: {}, week: {},
    active: null, coach: { profile: { daysPerWeek: 3, optionalDay: true } },
    routines: [
      { id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [{ id: '0001' }, { id: '0002' }] },
      { id: 'r2', name: 'Easy cardio', emoji: 'heart', ex: [{ id: '0003' }] },
    ],
  }
  vi.mocked(startFlow).mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Workout />))
const chips = () => [...host.querySelectorAll('.chips .chip')].map(b => b.textContent)
const tapChip = text => {
  const el = [...host.querySelectorAll('.chips .chip')].find(b => b.textContent === text)
  expect(el, `no chip "${text}"`).toBeTruthy()
  act(() => el.click())
}
const startRow = name => {
  const row = [...host.querySelectorAll('.list .item')].find(el => el.textContent.includes(name))
  expect(row, `no routine row "${name}"`).toBeTruthy()
  act(() => row.click())
}

describe('StartChooser — the training-day tag', () => {
  it('offers Day 1..N plus Optional, with no weekday names', () => {
    mount()
    expect(chips()).toEqual(['Day 1', 'Day 2', 'Day 3', 'Optional'])
    expect(host.textContent).not.toMatch(/Monday|Wednesday|Friday/)
  })

  it('starts a routine tagged with the chosen day', () => {
    mount()
    tapChip('Day 2')
    startRow('Push')
    expect(startFlow).toHaveBeenCalledWith(['r1'], { kind: 'day', n: 2 })
  })

  it('tapping the day again untags, and freestyle never carries a tag', () => {
    mount()
    tapChip('Day 2')
    tapChip('Day 2')
    startRow('Push')
    expect(startFlow).toHaveBeenCalledWith(['r1'], null)
  })

  it('the optional day asks which plan to run and tags the session optional', () => {
    mount()
    tapChip('Optional')
    expect(host.textContent).toContain('Optional day — pick the plan')
    startRow('Easy cardio')
    expect(startFlow).toHaveBeenCalledWith(['r2'], { kind: 'optional' })
  })

  it('hides the tag picker when there is no plan to tag against', () => {
    mocks.S.coach = null
    mount()
    expect(host.textContent).not.toContain('Training day')
    startRow('Push')
    expect(startFlow).toHaveBeenCalledWith(['r1'], null)
  })
})
