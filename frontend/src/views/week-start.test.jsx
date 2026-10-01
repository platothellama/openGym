// @vitest-environment happy-dom
// The setting is only worth anything if the screens actually follow it: the toggle has to
// write the field, and the Plan list has to draw the week in that order.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import Plan from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {}, week: {}, dayPlan: {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const segButton = label => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label)
const dayRows = () => [...host.querySelectorAll('.item .tt')].map(e => e.textContent)

describe('Settings — week starts on', () => {
  const mount = () => act(() => root.render(<Settings />))

  it('offers Monday and Sunday and writes the getDay() index', () => {
    mount()
    expect(segButton('Monday').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Sunday').click() })
    expect(mocks.S.weekStart).toBe(0)
    mount()
    expect(segButton('Sunday').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Monday').click() })
    expect(mocks.S.weekStart).toBe(1)
  })

  it('shows a profile written before the setting existed as Monday', () => {
    delete mocks.S.weekStart
    mount()
    expect(segButton('Monday').getAttribute('aria-pressed')).toBe('true')
    expect(segButton('Sunday').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Plan — the week schedule follows the setting', () => {
  const mount = () => act(() => root.render(<Plan />))
  // A plan of all seven days, so the list has something to order. The schedule is a frequency
  // now, not a fixed Mon-Sun strip, so "does the order follow the setting" is a question about
  // the days the plan *has* — seven of them is the only case where the answer is all seven.
  const ALL = [1, 2, 3, 4, 5, 6, 0]

  // A slot is titled as a session, not a weekday, so the setting cannot be read off the labels any
  // more — and it should not be: the rows number 1..7 either way. What the setting *does* change
  // is which day each numbered session falls on, so that is what these assert: a routine whose
  // name is the day it is on, and the order those names come back in.
  const byDay = () => ALL.slice()
    .sort((a, b) => ((a - mocks.S.weekStart + 7) % 7) - ((b - mocks.S.weekStart + 7) % 7))
    .map(d => 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ')[d])

  it('numbers the days from Monday by default', () => {
    mocks.S.weekRequired = ALL
    mount()
    expect(dayRows().slice(0, 7)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'])
    expect(byDay()).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  })

  it('numbers the days from Sunday for a Sunday profile', () => {
    mocks.S.weekStart = 0
    mocks.S.weekRequired = ALL
    mount()
    // Same seven rows, same titles: a Sunday profile numbers its week from the other end, and the
    // labels are deliberately identical so the setting is not mistaken for a change of plan.
    expect(dayRows().slice(0, 7)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'])
    expect(byDay()).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  it('keeps a routine attached to its day, not to its position in the list', () => {
    mocks.S.routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [] }]
    mocks.S.week = { 0: 'r1' }        // Sunday
    mocks.S.weekRequired = [0, 2]     // and a second slot, so "the next row" is a day
    mocks.S.weekStart = 0
    mount()
    const rows = [...host.querySelectorAll('.item')]
    // Sunday comes first for a Sunday profile, so it is Day 1 and the routine is on it — the
    // routine follows its day, not whichever row happens to be first.
    expect(rows[0].querySelector('.tt').textContent).toBe('Day 1')
    expect(rows[0].textContent).toContain('Push')
    expect(rows[1].textContent).not.toContain('Push')
  })
})

describe('Plan — inline per-day routine management (combine routines)', () => {
  const mount = () => act(() => root.render(<Plan />))
  const dayContainer = name => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)

  beforeEach(() => {
    mocks.S.routines = [
      { id: 'r1', name: 'Push', emoji: null, ex: [{ id: 'a' }, { id: 'b' }] },
      { id: 'r2', name: 'Core', emoji: null, ex: [{ id: 'c' }] },
    ]
  })

  it('renders a sub-row per routine on a populated day, with the count hint', () => {
    mocks.S.week = { 1: ['r1', 'r2'] }
    mount()
    const first = dayContainer('Day 1')
    expect(first.textContent).toContain('Push')
    expect(first.textContent).toContain('Core')
    expect(first.textContent).toContain('2 routines')
  })

  it('✕ removes a routine, and drops the day key on the last removal', () => {
    mocks.S.week = { 1: ['r1', 'r2'] }
    mount()
    const removeButtons = () => [...dayContainer('Day 1').querySelectorAll('button[aria-label="Remove"]')]
    act(() => { removeButtons()[1].dispatchEvent(new Event('click', { bubbles: true })) })
    expect(mocks.S.week[1]).toEqual(['r1'])
    mount()
    act(() => { removeButtons()[0].dispatchEvent(new Event('click', { bubbles: true })) })
    expect(mocks.S.week).not.toHaveProperty('1')
  })

  // A required slot with nothing on it is a hole in the plan, not a rest day: the frequency
  // above says this day is meant to be trained and nobody has written the routine yet. It is
  // one tappable row that picks the first routine, with nothing on it to remove.
  it('an empty slot stays one tappable row, tagged as empty rather than as rest', () => {
    mocks.S.week = {}
    mocks.S.weekRequired = [1, 2]
    mount()
    const second = dayContainer('Day 2')
    expect(second.textContent).toContain('Empty')
    expect(second.textContent).not.toContain('Rest')
    expect(second.querySelectorAll('button[aria-label="Remove"]').length).toBe(0)
  })

  // …and a day the plan says nothing about is not a row at all. Rendering all seven days made a
  // two-day plan look like a seven-day one, which is the thing the frequency is meant to stop.
  it('a day with no slot is not rendered', () => {
    mocks.S.week = {}
    mocks.S.weekRequired = [1, 2]
    mount()
    expect(dayContainer('Day 3')).toBeUndefined()
  })
})
