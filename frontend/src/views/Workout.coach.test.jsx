// @vitest-environment happy-dom
// The ⋮ menu on a live workout, against the real store and the real screen: "Ask the Coach" is
// there only where the question means something — a session being trained right now, with the
// Coach actually available, consented to, and holding a profile. Mid-set is the wrong place for
// an intake, so every one of those gates hides the row rather than opening a dead end.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'

const mocks = vi.hoisted(() => ({ menuSheet: vi.fn(), openCoach: vi.fn() }))

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
vi.mock('../components/CoachSessionSheet.jsx', () => ({
  __esModule: true,
  default: () => null,
  coachSessionSheet: mocks.openCoach,
}))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
  finishWorkout: vi.fn(), exitWorkoutEdit: vi.fn(), workoutCompleteSheet: vi.fn(), confirmSheet: vi.fn(),
  exerciseNoteSheet: vi.fn(), sessionNoteSheet: vi.fn(), renameWorkoutSheet: vi.fn(),
  swapActiveWorkoutExercise: vi.fn(), barWeightSheet: vi.fn(), menuSheet: mocks.menuSheet,
  effortPickerSheet: vi.fn(), exerciseHistorySheet: vi.fn(), addRoutineToSessionSheet: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025'
const clone = value => JSON.parse(JSON.stringify(value))

const consented = () => ({
  consent: { agreedAt: '2026-07-01T00:00:00Z', version: 1 },
  profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
})

let root, container

const render = ({ session = {}, coach = consented(), enabled = true, signedIn = true } = {}) => {
  const S = clone(DEF)
  S.routines = [{ id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 100 }] }]
  S.workouts = []
  S.coach = { log: [], snapshots: [], chat: [], timings: [], ...coach }
  S.active = {
    id: 'coach-menu', d: '2026-09-23', start: Date.now(), routineIds: ['main'], name: 'Main', bw: null, cur: 0,
    entries: [{ id: BENCH, plan: { kind: 'up', weight: 100 }, target: { sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5 }] }],
    ...session,
  }
  useStore.setState({ S, user: signedIn ? { id: 'u1' } : null, config: { coach: { enabled } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const openMenu = () => {
  const b = [...container.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Workout view')
  expect(b).toBeTruthy()
  act(() => b.dispatchEvent(new window.Event('click', { bubbles: true })))
  return mocks.menuSheet.mock.calls[0]?.[0]?.items || []
}
const askRow = items => items.filter(Boolean).find(i => i.label === 'Ask the Coach')

afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  root = null
  container = null
  vi.clearAllMocks()
})

describe('asking the Coach from a workout', () => {
  it('is in the menu, and it opens the sheet', () => {
    render()
    const row = askRow(openMenu())
    expect(row).toBeTruthy()
    expect(row.sub).toBe('Today’s targets for this session')
    row.onClick()
    expect(mocks.openCoach).toHaveBeenCalled()
  })

  it('is not there for a past workout being backfilled', () => {
    render({ session: { backfill: true, iso: '2026-09-01' } })
    expect(askRow(openMenu())).toBeFalsy()
  })

  it('is not there in the editor', () => {
    render({ session: { editingWorkoutId: 'w-old' } })
    expect(askRow(openMenu())).toBeFalsy()
  })

  it('is not there without consent, a profile, a signed-in user, or the Coach switched on', () => {
    render({ coach: { ...consented(), consent: null } })
    expect(askRow(openMenu())).toBeFalsy()

    render({ coach: { ...consented(), profile: null } })
    expect(askRow(openMenu())).toBeFalsy()

    render({ signedIn: false })
    expect(askRow(openMenu())).toBeFalsy()

    render({ enabled: false })
    expect(askRow(openMenu())).toBeFalsy()
  })
})