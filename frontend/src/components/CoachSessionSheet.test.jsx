import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachSessionSheet from './CoachSessionSheet.jsx'

// The sheet is the only surface where "today" means something, so these pin the three things that
// make it safe to open mid-workout: the context it asks with is the session as it stands on the
// screen (not the routine it came from), the answer is only ever written through the store's own
// validated apply, and an answer about something that is no longer there is refused rather than
// half-applied.
const mocks = vi.hoisted(() => {
  const state = { S: null, pending: null, job: null, lastError: null, last: null }
  state.storeSnapshot = () => ({
    S: state.S,
    user: { id: 'u1' },
    ready: true,
    config: { coach: { enabled: true } },
    coachLocal: null,
    update: mut => mut(state.S),
  })
  state.uiSnapshot = () => ({ toast: mocks.toast, openSheet: mocks.openSheet })
  // Created here, not in beforeEach: a vi.mock factory is evaluated when the module under test is
  // first imported, which is before any beforeEach has run.
  state.toast = vi.fn()
  state.openSheet = vi.fn()
  state.refresh = vi.fn()
  state.requestSession = vi.fn()
  state.resolvePending = vi.fn()
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('../lib/coach-api.js', () => ({
  useCoachStatus: () => ({ pending: mocks.pending, job: mocks.job, lastError: mocks.lastError, last: mocks.last, refresh: mocks.refresh }),
  requestSession: mocks.requestSession,
  resolvePending: mocks.resolvePending,
  jobErrorText: (cls) => (cls === 'nosession' ? 'Nothing to tune.' : 'The Coach could not answer.'),
}))
vi.mock('../lib/fitai.js', () => ({
  getFitaiSummary: () => Promise.resolve(null),
  getFitaiDay: () => Promise.resolve(null),
}))
vi.mock('../coach.css', () => ({}))

let dom, root, container

const entry = (over = {}) => ({
  id: '0001',
  target: { id: '0001', sets: 3, reps: 10, weight: 20, restSec: 120, mode: 'reps' },
  plan: { kind: 'up' },
  sets: [{ w: 20, r: 10 }, { w: 20, r: 10 }, { w: 20, r: 10 }],
  ...over,
})

const state = (over = {}) => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {}, routines: [], week: {}, dayPlan: {},
  active: { id: 'w-live', entries: [entry()] },
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: 1 },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [], timings: [],
  },
  ...over,
})

const answer = (targets, over = {}) => ({
  id: 'p-session', kind: 'session', summary: 'Holding the jump — short night.',
  targets, ...over,
})

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount({ S = state(), pending = null, job = null, lastError = null, last = null } = {}) {
  Object.assign(mocks, { S, pending, job, lastError, last })
  installDom()
  await act(async () => { root.render(React.createElement(CoachSessionSheet)) })
}

// The store is mocked by mutating in place, the way `update` does in the app, so a re-render is
// what a real subscriber would have caused.
async function rerender() {
  await act(async () => { root.render(React.createElement(CoachSessionSheet)) })
}

const btn = re => [...container.querySelectorAll('button')].find(b => re.test(b.textContent || ''))
async function click(el) {
  expect(el).toBeTruthy()
  await act(async () => { el.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestSession.mockImplementation(() => Promise.resolve({ job: { id: 'j1', kind: 'session' } }))
  mocks.resolvePending.mockImplementation(() => Promise.resolve({ ok: true }))
})
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
  container = null; dom = null
})

describe("the Coach's sheet inside a workout", () => {
  it('asks with the session as it stands, not the routine it came from', async () => {
    const S = state()
    // The entry was changed after the plan built it: 12 reps where the routine says 10. Asking
    // about the routine would be asking about a session nobody is doing.
    S.active.entries[0].target.reps = 12
    await mount({ S })
    await click(btn(/Ask the Coach/))
    const ctx = mocks.requestSession.mock.calls[0][0]
    expect(ctx.routine.ex[0]).toMatchObject({ id: '0001', reps: 12, weight: 20, sets: 3, restSec: 120 })
    expect(ctx.base['0001']).toMatchObject({ reps: 12, weight: 20, kind: 'up' })
    expect(ctx.history).toBeTypeOf('object')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows the numbers either side of the arrow, and writes the answer through the store', async () => {
    await mount({ pending: answer([{ id: '0001', weight: 22.5, reps: 12, restSec: 150, why: 'Held: 5.5h of sleep.' }]) })
    const text = container.textContent
    expect(text).toContain('20')          // what it is now
    expect(text).toContain('22.5')        // what the Coach says
    expect(text).toContain('Held: 5.5h of sleep.')
    await click(btn(/Apply 1 exercise/))
    expect(mocks.S.active.entries[0].target).toMatchObject({ weight: 22.5, reps: 12, restSec: 150 })
    // The rows waiting to be lifted are the ones written: a set already done is history.
    expect(mocks.S.active.entries[0].sets.map(r => r.w)).toEqual([22.5, 22.5, 22.5])
    expect(mocks.toast.mock.calls).toEqual([['Updated today’s workout']])
    expect(mocks.resolvePending).toHaveBeenCalledWith({ accepted: ['0001'] })
  })

  it('offers the take-back for as long as this session has one, and it puts the numbers back', async () => {
    await mount({ pending: answer([{ id: '0001', weight: 22.5, why: 'Held.' }]) })
    await click(btn(/Apply 1 exercise/))
    expect(mocks.S.active.entries[0].target.weight).toBe(22.5)
    await rerender()
    await click(btn(/Put the old numbers back/))
    expect(mocks.S.active.entries[0].target).toMatchObject({ weight: 20, reps: 10 })
    expect(mocks.S.active.entries[0].sets.map(r => r.w)).toEqual([20, 20, 20])
    // And nothing is offered twice.
    await rerender()
    expect(btn(/Put the old numbers back/)).toBeFalsy()
  })

  it('leaves out a target that changes nothing instead of offering an arrow to nowhere', async () => {
    await mount({ pending: answer([
      { id: '0001', weight: 22.5, why: 'Held.' },
      { id: '0001', weight: 20, why: 'same' },   // duplicate: refused outright
    ]) })
    expect(container.textContent).toContain('That proposal can’t be read')
    expect(btn(/Apply/)).toBeFalsy()
    expect(btn(/Dismiss/)).toBeTruthy()
  })

  it('names a dropped cardio bound the way the app does, not by the key it counts in', async () => {
    const S = state()
    S.active.entries.push(entry({ id: '0002', target: { id: '0002', sets: 1, mode: 'time', min: 20 } }))
    await mount({ S, pending: answer([
      { id: '0001', weight: 22.5, why: 'Held.' },
      { id: '0002', min: 30, speed: 8, why: 'Steady state.' },
    ]) })
    expect(container.textContent).toContain('Minutes & Speed')
    expect(container.textContent).not.toContain('min & speed')
    expect(container.textContent).toContain('come from the exercise')
  })

  it('a suggestion about the plan waiting in the chat is not overwritten by an ask', async () => {
    await mount({ pending: { id: 'p1', kind: 'review', summary: 'one change', changes: [{ id: 'c1', type: 'sets' }] } })
    expect(container.textContent).toContain('waiting in the chat')
    expect(btn(/Ask the Coach/).disabled).toBe(true)
    await click(btn(/Ask the Coach/))
    expect(mocks.requestSession).not.toHaveBeenCalled()
  })

  it('says so when there is nothing to tune, rather than looking broken', async () => {
    await mount({ last: { id: 'j1', kind: 'session', outcome: 'nochange' } })
    expect(container.textContent).toContain('Nothing to change today')
    expect(btn(/Ask the Coach/)).toBeTruthy()
  })

  it('shows the failure in the Coach\'s own wording', async () => {
    await mount({ lastError: { errorClass: 'nosession' } })
    expect(container.textContent).toContain('Nothing to tune.')
  })

  it('renders nothing at all without consent, so the menu row is the only gate there is', async () => {
    const S = state()
    delete S.coach.consent
    await mount({ S })
    expect(container.textContent).toBe('')
  })
})