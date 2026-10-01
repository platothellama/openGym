// @vitest-environment happy-dom
// #276: a full-width "＋ Add routine" under every planned weekday made the week read as a list of
// buttons. A populated day now offers the same action as a small ＋ in its header; an empty slot
// is still one tappable row that picks its first routine.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { dayAddRoutineSheet, dayAssignSheet } from '../sheets.jsx'
import { DAYN } from '../lib/format.js'

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
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  // `weekRequired: [1, 2]` is the frequency, not a weekday choice: the person said two days a
  // week, Monday is planned and Tuesday is not yet. That is what makes Tuesday an empty *slot*
  // rather than a rest day, and it is the case the row below is about.
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: { 1: ['r1'] }, weekRequired: [1, 2], weekOptional: [], dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }, { id: 'r2', name: 'Pull', emoji: null, ex: [] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Plan />))
// The screen has two `.item` lists — the routines themselves, then the week schedule — and a
// routine row has a name where a slot row is titled as a session. A slot row is the one whose
// title is "Day 3" or "Optional day 1", which is also what `dayItem` matches on.
const SLOT = /^(?:Day|Optional day) \d+$/
const dayItem = label => [...host.querySelectorAll('.item')]
  .find(el => el.querySelector('.tt')?.textContent === label)
const dayItems = () => [...host.querySelectorAll('.item')]
  .map(el => el.querySelector('.tt')?.textContent || '')
  .filter(t => SLOT.test(t))

describe('Plan — adding a routine to a slot that already has one (#276)', () => {
  it('offers a compact ＋ in the slot header instead of a full-width text button', () => {
    mount()
    const first = dayItem('Day 1')
    expect(first.textContent).not.toContain('Add routine')
    const plus = first.querySelector('button[aria-label="Add routine"]')
    expect(plus).toBeTruthy()
    // It sits in the header row with the count, not under the routine rows.
    expect(plus.closest('.row.between')?.querySelector('.tt')?.textContent).toBe('Day 1')
    act(() => plus.click())
    expect(dayAddRoutineSheet).toHaveBeenCalledWith(1)
  })

  it('leaves an empty slot as one row that picks its first routine', () => {
    mount()
    const second = dayItem('Day 2')
    expect(second.querySelector('button[aria-label="Add routine"]')).toBeNull()
    act(() => second.click())
    expect(dayAssignSheet).toHaveBeenCalledWith(2)
  })

  // The slot is not in the plan at all, so there is no row for it: the frequency is what puts a
  // row on the screen, and a plan of one day is one row. This is the case that used to be an
  // empty day and rendered a row anyway, which is how a two-day plan read as a seven-day one.
  it('does not render a row for a slot the frequency never asked for', () => {
    mocks.S.weekRequired = []
    mount()
    expect(dayItems()).toEqual(['Day 1'])
  })

  it('renders every slot the frequency asked for, numbered in week order', () => {
    mocks.S.week = { 1: ['r1'], 5: ['r2'] }
    mocks.S.weekRequired = [1, 3, 5]
    mount()
    expect(dayItems()).toEqual(['Day 1', 'Day 2', 'Day 3'])
  })

  // A weekday named a day the spread table happened to land on, and kept saying so after a stepper
  // had moved it. The number is the thing the person set, so it is the thing the week is listed as.
  it('titles a slot as a session, never as a weekday', () => {
    mocks.S.week = { 1: ['r1'] }
    mocks.S.weekRequired = [1]
    mocks.S.weekOptional = [4]
    mount()
    for (const title of dayItems()) expect(DAYN.some(d => title.startsWith(d))).toBe(false)
  })

  it('an optional slot renders like any other, titled so it is not mistaken for required', () => {
    mocks.S.week = { 1: ['r1'] }
    mocks.S.weekRequired = [1]
    mocks.S.weekOptional = [4]                                   // 4 is Thursday
    mount()
    // The optional day numbers within itself, so the required session stays "Day 1" whatever the
    // optional dial is set to — counting all slots together would let Day 2 be the optional one.
    expect(dayItems()).toEqual(['Day 1', 'Optional day 1'])
    expect(dayItem('Optional day 1')).toBeTruthy()
    expect(dayItem('Day 1').textContent).not.toContain('Optional')
  })
})
