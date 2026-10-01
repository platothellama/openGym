// @vitest-environment happy-dom
// Settings → Training system, against the real training-systems catalogue: what a profile that
// never chose reads as, which switches exist for it, and what each one writes. The point of
// the default is that nothing here changes a profile that has not asked for a change.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

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
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
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
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings />))
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const switchIn = title => rowTitled(title)?.querySelector('[role="switch"]')
const sectionTitled = title => [...host.querySelectorAll('h3, h2')].find(h => h.textContent === title)
const pick = () => rowTitled('System')?.querySelector('.lrow-v')?.textContent

describe('Settings — training system', () => {
  it('a profile that never chose reads as no training system', () => {
    mount()
    expect(sectionTitled('Training system')).toBeTruthy()
    expect(pick()).toBe('No training system')
    expect(mocks.S.trainSystem).toBeUndefined()
  })

  it('an unknown value is not a system either', () => {
    mocks.S.trainSystem = 'arnold-split'
    mount()
    expect(pick()).toBe('No training system')
    // The set switch is the ledger's, so it only exists with a system behind it.
    expect(switchIn('Let it add or drop a set')).toBeFalsy()
  })

  it('offers the ledger\'s set switch only once a system is on', () => {
    mocks.S.trainSystem = 'double'
    mount()
    expect(pick()).toBe('Double progression')
    expect(switchIn('Let it add or drop a set')).toBeTruthy()
    expect(switchIn('Let it add or drop a set').getAttribute('aria-checked')).toBe('false')
    act(() => switchIn('Let it add or drop a set').click())
    expect(mocks.S.muscleAutoSets).toBe(true)
    expect(mocks.S.trainSystem).toBe('double')
  })

  it('the recovery switch works with no system at all, and says what it needs', () => {
    mount()
    const row = rowTitled('Hold on recovery')
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toContain('Needs FitAI connected')
    expect(switchIn('Hold on recovery').getAttribute('aria-checked')).toBe('false')
    act(() => switchIn('Hold on recovery').click())
    expect(mocks.S.readinessAuto).toBe(true)
    mount()
    expect(switchIn('Hold on recovery').getAttribute('aria-checked')).toBe('true')
    act(() => switchIn('Hold on recovery').click())
    expect(mocks.S.readinessAuto).toBe(false)
  })

  it('explains that a system only fills gaps', () => {
    mount()
    const footer = sectionTitled('Training system').parentElement.textContent
    expect(footer).toContain('Anything you have already set stays as you set it.')
  })
})