// @vitest-environment happy-dom
// Settings → Training system → "Hold on recovery", against the real store and the real
// workout screen: a deficit week holds the jump progression earned, says why on the card,
// never touches a set already logged or a past workout being backfilled, and never backs off
// a second time when the screen is opened again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { getFitaiSummary } from '../lib/fitai.js'

const SUMMARY = { nutrition: { daysLogged: 7, deficitVsTarget: 600, proteinVsTarget: 0 } }

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))
vi.mock('../lib/fitai.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, getFitaiSummary: vi.fn(() => Promise.resolve(SUMMARY)) }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025'
const clone = value => JSON.parse(JSON.stringify(value))
// An earned jump: progression said up from 95 to 100, so holding it means going back to 95.
const earnedJump = () => ({
  id: BENCH,
  plan: { policy: 'linear', kind: 'up', weight: 100, reps: 5 },
  target: { sets: 1, reps: 5, weight: 100, inc: 5 },
  sets: [{ w: 100, r: 5, done: false }],
})

let root
let container

const render = ({ entries = [earnedJump()], over = {}, session = {} } = {}) => {
  const S = clone(DEF)
  S.routines = [{ id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 100 }] }]
  S.workouts = []
  Object.assign(S, over)
  S.active = { id: 'ready-test', d: '2026-09-23', start: Date.now(), routineIds: ['main'], name: 'Main', bw: null, cur: 0, entries, ...session }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const entryOf = () => useStore.getState().S.active.entries[0]
const target = () => entryOf().target
const screenText = () => container.textContent

afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  root = null
  container = null
  getFitaiSummary.mockClear()
})

describe('hold on recovery', () => {
  it('holds the earned jump and names the deficit on the card', async () => {
    render({ over: { readinessAuto: true, fitaiUserId: 'fit-1' } })
    await flush()
    expect(target().weight).toBe(95)
    expect(entryOf().suggestion).toMatchObject({ readiness: 'down', score: 55, line: { kind: 'deficit', kcal: 600 } })
    expect(screenText()).toContain('600 kcal under target this week')
  })

  it('off is off, even with FitAI linked', async () => {
    render({ over: { readinessAuto: false, fitaiUserId: 'fit-1' } })
    await flush()
    expect(target().weight).toBe(100)
    expect(getFitaiSummary).not.toHaveBeenCalled()
    expect(screenText()).not.toContain('kcal under target')
  })

  it('on with nothing linked leaves the session alone rather than guessing', async () => {
    render({ over: { readinessAuto: true, fitaiUserId: '' } })
    await flush()
    expect(target().weight).toBe(100)
  })

  it('a past workout being logged keeps the weights it was built with', async () => {
    // beginBackfill opens the session already flagged, so this is what the screen sees.
    render({ over: { readinessAuto: true, fitaiUserId: 'fit-1' }, session: { backfill: true, iso: '2026-09-01' } })
    await flush()
    expect(target().weight).toBe(100)
    expect(getFitaiSummary).not.toHaveBeenCalled()
  })

  it('an exercise already started keeps the weight it went up with', async () => {
    const entry = earnedJump()
    entry.sets[0] = { w: 100, r: 5, done: true }
    render({ entries: [entry], over: { readinessAuto: true, fitaiUserId: 'fit-1' } })
    await flush()
    expect(entryOf().sets[0].w).toBe(100)
    expect(target().weight).toBe(95)
  })

  it('reads the day once per session, so coming back does not back off again', async () => {
    render({ over: { readinessAuto: true, fitaiUserId: 'fit-1' } })
    await flush()
    expect(target().weight).toBe(95)

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
    await flush()
    expect(target().weight).toBe(95)
    expect(useStore.getState().S.active.readinessApplied).toBe(true)
  })
})