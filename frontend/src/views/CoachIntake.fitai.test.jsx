// @vitest-environment happy-dom
// FitAI autofill in the intake: a linked profile's goal and conditions seed
// the answers still at their defaults, and a choice made while the check is
// in flight always wins.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachIntake from './CoachIntake.jsx'
import { requestPlan, disclosure } from '../lib/coach-api.js'
import { getFitaiSummary } from '../lib/fitai.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ID = 'fc8647ef-81bb-443c-8ecd-c4d138c81f84'
const SUMMARY = {
  profile: { goal: 'cut', gender: 'male', activityLevel: 'moderate' },
  conditions: [{ label: 'Type 2 diabetes' }, { label: 'Obesity / overweight' }]
}

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, config: null, search: '', nav: vi.fn(), toast: vi.fn() }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    config: state.config,
    coachLocal: null,
    update: mut => mut(state.S),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useSearchParams: () => [new URLSearchParams(mocks.search), vi.fn()],
}))
vi.mock('../lib/coach-api.js', () => ({
  requestPlan: vi.fn(() => Promise.resolve({})),
  disclosure: vi.fn(() => Promise.resolve(null)),
  scanEquipment: vi.fn(() => Promise.resolve({ equipment: [], other: [] })),
  scanAvailable: vi.fn(() => true),
}))
vi.mock('../lib/fitai.js', async importOriginal => {
  const m = await importOriginal()
  return { ...m, getFitaiSummary: vi.fn() }
})
vi.mock('../coach.css', () => ({}))

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
    dayPlan: {}, routines: [], week: {}, fitaiUserId: ID,
  }
  mocks.user = { uid: 'u1', name: 'Ana' }
  mocks.config = { coach: { enabled: true } }
  mocks.search = ''
  mocks.nav.mockReset(); mocks.toast.mockReset()
  vi.mocked(disclosure).mockReset().mockResolvedValue(null)
  vi.mocked(getFitaiSummary).mockReset().mockResolvedValue(SUMMARY)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<CoachIntake />))
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const eyebrow = () => host.querySelector('.ob-eyebrow')?.textContent
const all = sel => [...host.querySelectorAll(sel)]
const find = (sel, text) => all(sel).find(el => el.textContent.trim().startsWith(text))
const tap = (sel, text) => {
  const el = find(sel, text)
  expect(el, `no ${sel} starting with "${text}"`).toBeTruthy()
  act(() => el.click())
}
const agree = () => tap('button', 'I understand')
const cont = () => act(() => host.querySelector('.ob-foot .btn').click())
const goalOn = text => find('.ob-choice', text)?.classList.contains('on')
// Goal and experience gate Continue; the rest carry defaults.
const walkToLimits = () => {
  for (let i = 0; i < 8 && eyebrow() !== 'Limits'; i++) {
    if (eyebrow() === 'Experience' && !goalOn('Training regularly')) tap('.ob-choice', 'Training regularly')
    cont()
  }
  expect(eyebrow()).toBe('Limits')
}

describe('CoachIntake FitAI autofill', () => {
  it('prefills the goal and the limitations, and says so', async () => {
    mount()
    agree()
    await settle()
    expect(eyebrow()).toBe('Your goal')
    expect(getFitaiSummary).toHaveBeenCalledWith(ID, 7)
    expect(goalOn('Lose fat')).toBe(true)
    expect(host.textContent).toContain('Prefilled from FitAI')
  })

  it('a choice made before the fetch lands wins over the suggestion', async () => {
    let resolve
    vi.mocked(getFitaiSummary).mockReturnValue(new Promise(r => { resolve = r }))
    mount()
    agree()
    tap('.ob-choice', 'Build muscle')
    expect(goalOn('Build muscle')).toBe(true)
    await act(async () => { resolve(SUMMARY) })
    await settle()
    // The user's goal stands, while the still-empty limitations take the suggestion.
    expect(goalOn('Build muscle')).toBe(true)
    expect(goalOn('Lose fat')).toBe(false)
    walkToLimits()
    expect(host.querySelector('textarea').value).toContain('Type 2 diabetes')
  })

  it('asks nothing and suggests nothing when unlinked', async () => {
    mocks.S.fitaiUserId = null
    mount()
    agree()
    await settle()
    expect(getFitaiSummary).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Prefilled from FitAI')
  })

  it('leaves the editor’s own answers alone', async () => {
    mocks.search = '?edit=1'
    mocks.S.coach = { profile: { goal: 'muscle', experience: 'regular', limitations: 'bad knee' } }
    mount()
    await settle()
    expect(getFitaiSummary).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Prefilled from FitAI')
  })
})
