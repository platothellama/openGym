// @vitest-environment happy-dom
// The two dials on the Plan screen are two halves of one week: a week has seven days, required and
// optional are disjoint, so the optional dial can only be wound as far as the required dial leaves
// room. Wired independently, the pair describes a week with more days in it than there are days —
// which the Coach's plan validator rejects outright rather than adjusting, so the person gets a
// failure instead of a plan.
import React, { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { maxOptionalFor, requiredCount, optionalCount } from '../lib/week-plan.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A real subscription, not a plain lookup: the steppers read their own current value out of a ref
// that only a re-render refreshes, so a mock that never re-renders makes every click after the
// first compute from the same stale number. The snapshot is cached per state object because
// useSyncExternalStore compares it by reference.
const mocks = vi.hoisted(() => {
  const state = { S: null, snap: null, snapFor: null, listeners: new Set() }
  state.get = () => {
    if (state.snapFor !== state.S) {
      state.snapFor = state.S
      state.snap = {
        S: state.S,
        user: null,
        config: { coach: {} },
        update: mut => {
          const next = structuredClone(state.S)
          mut(next)
          state.S = next
          state.listeners.forEach(fn => fn())
        },
      }
    }
    return state.snap
  }
  state.subscribe = fn => { state.listeners.add(fn); return () => state.listeners.delete(fn) }
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => {
    const snap = useSyncExternalStore(mocks.subscribe, mocks.get, mocks.get)
    return selector ? selector(snap) : snap
  }
  useStore.getState = mocks.get
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, isAndroid: () => Promise.resolve(false),
  shareExport: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  // Three required days a week, all planned, and no optional days yet.
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, dayPlan: {}, weekOptional: [],
    week: { 1: ['r1'], 3: ['r2'], 5: ['r3'] },
    routines: [
      { id: 'r1', name: 'Push', emoji: null, ex: [] },
      { id: 'r2', name: 'Pull', emoji: null, ex: [] },
      { id: 'r3', name: 'Legs', emoji: null, ex: [] },
    ],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))

// The frequency block is two `.freq` rows, each holding a stepper: a − button, a number field and
// a + button. The stepper clamps in JS rather than disabling a button, so "cannot go higher" is
// asserted by the count refusing to move, not by a `disabled` attribute.
const dials = () => [...host.querySelectorAll('.freq')]
const req = () => requiredCount(mocks.S)
const opt = () => optionalCount(mocks.S)
const shown = which => Number(dials()[which].querySelector('input').value)
const step = (which, dir) => {
  const b = dials()[which].querySelector(`button[aria-label="${dir}"]`)
  expect(b, `no ${dir} button on dial ${which}`).toBeTruthy()
  act(() => b.click())
}
const plus = which => step(which, 'Increase')
const minus = which => step(which, 'Decrease')

describe('Plan — the two frequency dials are one week', () => {
  it('shows the two counts the plan is actually set to', () => {
    mount()
    expect(req()).toBe(3)
    expect(opt()).toBe(0)
    expect(shown(0)).toBe(3)
    expect(shown(1)).toBe(0)
  })

  it('will not wind the optional dial past the room the required dial leaves', () => {
    mount()
    // 3 required leaves 4 days, so optional reaches 4 and then stops, however hard it is pushed.
    for (let i = 0; i < 6; i++) plus(1)
    expect(opt()).toBe(4)
    expect(shown(1)).toBe(4)
    expect(mocks.S.weekOptional).toHaveLength(4)
    expect(req() + opt()).toBeLessThanOrEqual(7)
  })

  it('closes the optional dial as the required one is raised past it', () => {
    mount()
    for (let i = 0; i < 4; i++) plus(1)          // 3 + 4 = 7
    expect(opt()).toBe(4)
    plus(0)                                       // 4 + 4 = 8, so one has to go
    expect(req()).toBe(4)
    expect(opt()).toBe(3)
    expect(mocks.S.weekOptional).toHaveLength(3)
  })

  it('leaves no optional day at all on a seven-day week, and says why', () => {
    mount()
    for (let i = 0; i < 4; i++) plus(0)          // 3 -> 7
    expect(req()).toBe(7)
    expect(opt()).toBe(0)
    expect(mocks.S.weekOptional ?? []).toHaveLength(0)
    expect(host.textContent).toContain('No room left in a seven-day week')
  })

  it('reopens the optional dial when the required count comes back down', () => {
    mount()
    for (let i = 0; i < 4; i++) plus(0)          // seven required days
    expect(opt()).toBe(0)
    minus(0)                                      // back to six, which leaves one
    expect(req()).toBe(6)
    plus(1)
    expect(opt()).toBe(1)
  })

  it('keeps a seven-day week and never orphans a routine, whatever the dials do', () => {
    mount()
    for (const [wantReq, wantOpt] of [[7, 0], [1, 4], [4, 2], [2, 4], [5, 1], [3, 3], [6, 1]]) {
      for (let i = 0; i < 8 && req() < wantReq; i++) plus(0)
      for (let i = 0; i < 8 && opt() < wantOpt; i++) plus(1)
      // The pair is still a week, and the optional count is still reachable from the required one.
      expect(req() + opt(), `req ${req()} + opt ${opt()}`).toBeLessThanOrEqual(7)
      expect(opt()).toBeLessThanOrEqual(maxOptionalFor(req()))
      // Nothing is left holding a day the plan has no slot for: an empty list is never stored.
      Object.values(mocks.S.week).forEach(ids => expect(ids.length).toBeGreaterThan(0))
      expect(mocks.S.weekOptional ?? []).toHaveLength(opt())
    }
  })
})
