// @vitest-environment happy-dom
// The intake questionnaire: the eight-screen state machine the Coach opens with, and the same
// eight screens again as the profile editor behind `?edit=1`.
//
// What is worth pinning here is not that the screens render — it is the order they run in, the
// two answers that gate Continue, what reaches the store when the last button is pressed, and
// the two paths that are awkward to reach by hand: a plan request that fails after the answers
// are already saved, and the editor's rule about not opening a second conversation.
//
// coach.js is deliberately NOT mocked: `hasConsent`, `emptyCoach`, `appendChat` and
// `coachAvailable` are the contract this screen is written against, so the tests run the real
// ones. MOBILE and DEMO are both false in a test build, which is the web gate.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachIntake from './CoachIntake.jsx'
import { requestPlan, disclosure } from '../lib/coach-api.js'
import { CONSENT_VERSION } from '../lib/coach.js'
import { MAX_OPTIONAL } from '../lib/week-plan.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
}))
vi.mock('../coach.css', () => ({}))

let host, root
const fresh = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [], week: {},
})

beforeEach(() => {
  mocks.S = fresh()
  mocks.user = { uid: 'u1', name: 'Ana' }
  mocks.config = { coach: { enabled: true } }
  mocks.search = ''
  mocks.nav.mockReset(); mocks.toast.mockReset()
  vi.mocked(requestPlan).mockReset().mockResolvedValue({})
  vi.mocked(disclosure).mockReset().mockResolvedValue(null)
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
const footBtn = () => host.querySelector('.ob-foot .btn')
const cont = () => act(() => footBtn().click())
const Continue = footBtn
// The goal screen's five cards, in the order they are offered. A card is a div holding a toggle
// button and, once chosen, the rank and its two arrows.
const choices = () => all('.ob-choice')
const chosen = () => choices().filter(c => c.classList.contains('on'))
const label = c => c.querySelector('.ob-choice-t').childNodes[0].textContent.trim()
const rankNo = c => Number(c.querySelector('.ob-rank b').textContent.split('/')[0])
// The chosen objectives in *priority* order, as the labels the screen shows. The cards themselves
// stay in catalogue order on purpose - a ranked list that re-sorts itself under your finger is
// worse to use than one where the rank is a number on a row that has not moved - so the priority
// order has to be read off the ranks rather than off the DOM order.
const ranks = () => [...chosen()].sort((a, b) => rankNo(a) - rankNo(b)).map(label)
const rankNumbers = () => [...chosen()].sort((a, b) => rankNo(a) - rankNo(b)).map(rankNo)
// The card sitting at a given place in the priority order. A test wants this and not
// `chosen()[n]`, because that is catalogue order and means something else entirely.
const byRank = n => chosen().find(c => rankNo(c) === n)
const arrow = (choice, dir) => choice.querySelector(`.ob-rank-arrows button[aria-label="${dir}"]`)
const tapArrow = (choice, dir) => { const b = arrow(choice, dir); expect(b, `no ${dir} arrow`).toBeTruthy(); act(() => b.click()) }
// The Schedule screen is two `.ob-days` grids — seven required buttons, then MAX_OPTIONAL+1
// optional ones — and both rows have a '2' and a '4' in them. A test names the row it means.
const dayRow = which => all('.ob-days')[which]
const picked = which => [...dayRow(which).querySelectorAll('.ob-day.on')].map(b => b.textContent)
const tapDay = (which, n) => {
  const el = [...dayRow(which).querySelectorAll('.ob-day')].find(b => b.textContent.trim() === String(n))
  expect(el, `no day button "${n}" in row ${which}`).toBeTruthy()
  act(() => el.click())
}
// A <select> is driven the same way an <input> is: React tracks the value through the
// prototype setter, so a bare el.value never reaches onChange.
const pick = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, String(value))
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
const typeIn = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

// Walk the flow to a named screen, answering only what Continue is actually waiting for — so
// a test that already made its own choice keeps it.
const walkTo = target => {
  for (let i = 0; i < 12 && eyebrow() !== target; i++) {
    if (eyebrow() === 'Before we start') { tap('button', 'I understand'); continue }
    if (footBtn().disabled) {
      if (eyebrow() === 'Your goal') tap('.ob-choice-main', 'Build muscle')
      else if (eyebrow() === 'Experience') tap('.ob-choice-main', 'Training regularly')
    }
    cont()
  }
  expect(eyebrow()).toBe(target)
}

describe('CoachIntake — who gets in', () => {
  it('sends you home and renders nothing when the Coach is not available', () => {
    mocks.config = { coach: { enabled: false } }
    mount()
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
    expect(host.textContent).toBe('')
  })

  it('needs a signed-in user as well as a server with the Coach on', () => {
    mocks.user = null
    mount()
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
  })
})

describe('CoachIntake — the consent screen', () => {
  it('is the first screen on a fresh profile, and is not one of the progress dots', () => {
    mount()
    expect(eyebrow()).toBe('Before we start')
    expect(all('.ob-dot')).toHaveLength(0)
    expect(host.querySelector('.ob-foot .btn').textContent).toContain('I understand')
  })

  it('agreeing records the version the app checks for, and opens the first question', () => {
    mount()
    tap('button', 'I understand')
    expect(mocks.S.coach.consent.version).toBe(CONSENT_VERSION)
    expect(Date.parse(mocks.S.coach.consent.agreedAt)).not.toBeNaN()
    expect(mocks.S.coach.profile).toBe(null)          // nothing else written yet
    expect(eyebrow()).toBe('Your goal')
    expect(all('.ob-dot')).toHaveLength(7)
  })

  it('"Not now" writes nothing at all and goes back to the plan', () => {
    mount()
    tap('button', 'Not now')
    expect(mocks.S.coach).toBeUndefined()
    expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })

  it('lists the built-in categories first, then whatever the server says actually goes', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan', 'prefs'], providerLabel: 'Anthropic', payer: 'you', host: 'api.anthropic.com' })
    mount()
    expect(all('.ob-consent-row')).toHaveLength(10)                      // CATEGORY_TEXT, before the call lands
    await settle()
    expect(all('.ob-consent-row')).toHaveLength(2)
    expect(host.textContent).toContain('Sent straight to api.anthropic.com with your own API key')
  })

  it('names the instance owner as the payer when the server is the one calling', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan'], providerLabel: 'Anthropic', payer: 'instance' })
    mount(); await settle()
    expect(host.textContent).toContain('Sent to Anthropic, running on this server under the instance owner')
  })

  it('names the provider when the phone pays but there is no host to name', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan'], providerLabel: 'Anthropic API', payer: 'you' })
    mount(); await settle()
    expect(host.textContent).toContain('Sent straight to Anthropic API with your own API key')
  })

  it('falls back to the server’s own label, then to a generic one, when the call fails', async () => {
    vi.mocked(disclosure).mockRejectedValue(new Error('offline'))
    mocks.config = { coach: { enabled: true, providerLabel: 'Claude Agent SDK' } }
    mount(); await settle()
    expect(host.textContent).toContain('Sent to Claude Agent SDK, running on this server')
    expect(all('.ob-consent-row')).toHaveLength(10)     // and the built-in list stands in

    act(() => root.unmount())
    mocks.config = { coach: { enabled: true } }
    root = createRoot(host)
    mount(); await settle()
    expect(host.textContent).toContain('Sent to the configured AI provider, running on this server')
  })

  it('shows a category the app has no copy for under its own key', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan', 'sleep'], providerLabel: 'x', payer: 'instance' })
    mount(); await settle()
    expect(all('.ob-consent-row').map(r => r.querySelector('b').textContent)).toEqual(['Your plan', 'sleep'])
  })

  it('is skipped entirely once consent is on file', () => {
    mocks.S.coach = { consent: { agreedAt: '2026-09-01T00:00:00Z', version: CONSENT_VERSION }, profile: null, chat: [] }
    mount()
    expect(eyebrow()).toBe('Your goal')
  })
})

describe('CoachIntake — the two answers that gate the flow', () => {
  it('will not leave the goal screen until one is picked', () => {
    mount(); tap('button', 'I understand')
    expect(footBtn().disabled).toBe(true)
    expect(host.querySelector('.ob-hint').textContent).toBe('Pick at least one to continue.')
    cont()
    expect(eyebrow()).toBe('Your goal')

    tap('.ob-choice-main', 'Lose fat')
    expect(footBtn().disabled).toBe(false)
    expect(host.querySelector('.ob-hint')).toBe(null)
    cont()
    expect(eyebrow()).toBe('Experience')
  })

  it('will not leave the experience screen until one is picked', () => {
    mount(); walkTo('Experience')
    expect(footBtn().disabled).toBe(true)
    cont()
    expect(eyebrow()).toBe('Experience')
    tap('.ob-choice-main', 'New to lifting')
    cont()
    expect(eyebrow()).toBe('Schedule')
  })

  it('refuses a session shorter than ten minutes', () => {
    mount(); walkTo('Session length')
    const [hours, minutes] = all('.ob-wheel')
    expect(footBtn().disabled).toBe(false)

    // 00:00 is not a session, so the screen snaps it to five minutes — and five is still refused.
    pick(hours, 0)
    expect(footBtn().disabled).toBe(true)
    expect(minutes.value).toBe('5')

    pick(minutes, 0)                      // both wheels at nought snaps back to five, not zero
    expect(minutes.value).toBe('5')
    expect(footBtn().disabled).toBe(true)

    pick(minutes, 15)
    expect(footBtn().disabled).toBe(false)
    cont()
    expect(eyebrow()).toBe('Equipment')
  })
})

describe('CoachIntake — moving around', () => {
  it('Back walks the steps and then leaves for the plan', () => {
    mount(); walkTo('Schedule')
    act(() => host.querySelector('.iconbtn').click())
    expect(eyebrow()).toBe('Experience')
    act(() => host.querySelector('.iconbtn').click())
    expect(eyebrow()).toBe('Your goal')
    act(() => host.querySelector('.iconbtn').click())
    expect(eyebrow()).toBe('Before we start')
    act(() => host.querySelector('.iconbtn').click())
    expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })

  it('Back from the first screen of the editor goes to the conversation, not the plan', () => {
    mocks.search = 'edit=1'
    mount()
    expect(eyebrow()).toBe('Your goal')
    act(() => host.querySelector('.iconbtn').click())
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('Skip is offered only on the three optional screens, and never on the last one', () => {
    mount(); walkTo('Your goal')
    expect(host.querySelector('.ob-skip')).toBe(null)
    walkTo('Equipment')
    expect(host.querySelector('.ob-skip')).toBeTruthy()
    act(() => host.querySelector('.ob-skip').click())
    expect(eyebrow()).toBe('Limits')
    expect(host.querySelector('.ob-skip')).toBeTruthy()
    act(() => host.querySelector('.ob-skip').click())
    expect(eyebrow()).toBe('Almost there')
    expect(host.querySelector('.ob-skip')).toBe(null)
    expect(footBtn().textContent).toContain('Build my plan')
  })

  it('the dots count the seven questions and follow the one on screen', () => {
    mount(); walkTo('Your goal')
    const at = () => all('.ob-dot').findIndex(d => d.classList.contains('on'))
    expect(all('.ob-dot')).toHaveLength(7)
    expect(at()).toBe(0)
    walkTo('Schedule')
    expect(at()).toBe(2)
    expect(all('.ob-dot').filter(d => d.classList.contains('done'))).toHaveLength(2)
  })
})

describe('CoachIntake — the answers themselves', () => {
  // The weekday picker is gone: the person answers a frequency and the Coach picks the days.
  it('asks for a frequency, not weekdays: three days and none optional by default', () => {
    mount(); walkTo('Schedule')
    expect(picked(0)).toEqual(['3'])
    expect(picked(1)).toEqual(['0'])
    expect(dayRow(1).querySelectorAll('.ob-day')).toHaveLength(5)   // 0-4, never 6 or 7
    expect(all('.ob-wd')).toHaveLength(0)                           // no weekday picker anywhere
  })

  // The two answers are bounded by each other: a week is seven days and the two kinds are
  // disjoint, so "7 days" and "4 optional" asks for eleven slots and the server rejects the plan
  // rather than adjusting it. The screen offers only the optional counts that still fit.
  it('offers only the optional days that still fit in the week', () => {
    mount(); walkTo('Schedule')
    const optCount = () => dayRow(1).querySelectorAll('.ob-day').length
    const maxFor = d => Math.min(4, 7 - d) + 1          // buttons, including 0
    tapDay(0, 3)
    expect(optCount()).toBe(maxFor(3))                  // 0-4
    tapDay(0, 5)
    expect(optCount()).toBe(maxFor(5))                  // 0-2
    tapDay(0, 6)
    expect(optCount()).toBe(maxFor(6))                  // 0-1
    tapDay(0, 7)
    expect(optCount()).toBe(maxFor(7))                  // just 0: a seven-day week is every day
    // And back down again — the budget is the required count, not a one-way door.
    tapDay(0, 2)
    expect(optCount()).toBe(maxFor(2))
  })

  it('narrows the optional answer when the required count is raised past it', () => {
    mount(); walkTo('Schedule')
    tapDay(0, 3)
    tapDay(1, 4)                                        // 3 + 4 = 7, the most that fit
    expect(picked(1)).toEqual(['4'])
    tapDay(0, 4)                                        // 4 + 4 = 8, so one has to go
    expect(picked(0)).toEqual(['4'])
    expect(picked(1)).toEqual(['3'])
  })

  it('says so, rather than quietly dropping the answer, when there is no room', () => {
    mount(); walkTo('Schedule')
    tapDay(0, 7)
    expect(host.textContent).toContain('Seven days leaves no room for an optional one')
  })

  it('never sends a pair that asks for more days than a week has', () => {
    // Keyed per round: the component keeps its `step` across re-renders, so a second round would
    // start on whatever screen the first one finished on.
    for (const [i, [d, o]] of [[7, 4], [6, 4], [5, 4], [4, 4], [7, 1]].entries()) {
      vi.mocked(requestPlan).mockClear()
      act(() => root.render(<CoachIntake key={`sched${i}`} />))
      walkTo('Schedule')
      tapDay(0, d)
      // Only offered where it fits, so an out-of-room count is simply not tapped.
      if (o <= 4 && o <= 7 - d) tapDay(1, o)
      walkTo('Almost there')
      cont()
      const sent = vi.mocked(requestPlan).mock.calls[0][0]
      expect(sent.daysPerWeek + (sent.optionalDays || 0)).toBeLessThanOrEqual(7)
    }
  })

  // A profile stored by the build that asked the two questions independently still carries a pair
  // no week can satisfy. It has to be settled on the way in, or every plan request from it fails.
  it('settles a stored pair that no week can satisfy, rather than resending it', () => {
    mocks.S.coach = { profile: { goal: 'strength', experience: 'regular', daysPerWeek: 6, optionalDays: 4, sessionMin: 60, equipment: [] } }
    mocks.search = 'edit=1'
    mount(); walkTo('Schedule')
    // The screen opens on a question it can answer: 6 required leaves room for one.
    expect(picked(0)).toEqual(['6'])
    expect(picked(1)).toEqual(['1'])
    expect(dayRow(1).querySelectorAll('.ob-day')).toHaveLength(2)
  })

  it('the required count can be walked back to one, and back up to seven', () => {
    mount(); walkTo('Schedule')
    tapDay(0, 1)
    expect(picked(0)).toEqual(['1'])
    tapDay(0, 7)
    expect(picked(0)).toEqual(['7'])
  })

  it('optional days of zero is an answer, not a missing one, and reaches the request', () => {
    mount(); walkTo('Schedule')
    tapDay(0, 2)
    tapDay(1, 2)
    walkTo('Almost there')
    cont()
    const sent = vi.mocked(requestPlan).mock.calls[0][0]
    expect(sent).toMatchObject({ daysPerWeek: 2, optionalDays: 2 })
    expect(mocks.S.coach.profile).toEqual(sent)
  })

  // The picker is gone, so a profile can still arrive carrying one: an old chat, an import, the
  // server's stored copy. It must not be written back out — the Coach no longer reads it, and
  // re-saving it would make a stale weekday list look like a fresh answer.
  it('never writes preferredDays back, whatever the stored profile carried', () => {
    mocks.search = 'edit=1'
    mocks.S.coach = {
      consent: { agreedAt: '2026-09-01T00:00:00Z', version: CONSENT_VERSION },
      chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }],
      profile: { goal: 'strength', experience: 'new', daysPerWeek: 3, optionalDays: 1, preferredDays: [1, 3, 5], sessionMin: 60, equipment: [] }
    }
    mount(); walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.preferredDays).toBeUndefined()
    expect(mocks.S.coach.profile).toMatchObject({ daysPerWeek: 3, optionalDays: 1 })
  })

  it('equipment chips toggle and reach the profile', () => {
    mount(); walkTo('Equipment')
    const chips = all('.ob-chips .chip')
    expect(chips.length).toBeGreaterThan(14)
    act(() => chips[0].click()); act(() => chips[2].click()); act(() => chips[0].click())
    walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.equipment).toEqual([chips[2].textContent])
  })

  it('the equipment free-text field reaches the profile as typed', () => {
    mount(); walkTo('Equipment')
    const area = all('.ob-field textarea')[0]
    expect(area).toBeTruthy()
    typeIn(area, 'pull-up bar, rower')
    walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.equipmentOther).toBe('pull-up bar, rower')
  })

  it('a stored answer the taxonomy never had comes back as a removable chip', () => {
    mocks.search = 'edit=1'
    mocks.S.coach = {
      consent: { agreedAt: '2026-09-01T00:00:00Z', version: CONSENT_VERSION },
      chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }],
      profile: { goal: 'strength', experience: 'new', daysPerWeek: 3, optionalDays: 0, sessionMin: 60, equipment: ['dumbbell', 'TRX'], equipmentOther: '' }
    }
    mount(); walkTo('Equipment')
    const custom = find('.ob-chips .chip', 'TRX')
    expect(custom).toBeTruthy()
    act(() => custom.click())
    walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.equipment).toEqual(['dumbbell'])
  })

  it('the quick length chips and the two wheels write the same field', () => {
    mount(); walkTo('Session length')
    tap('.ob-quick .chip', '90')
    const [hours, minutes] = all('.ob-wheel')
    expect(hours.value).toBe('1')
    expect(minutes.value).toBe('30')
    pick(hours, 2)
    expect(host.querySelector('.ob-quick .chip.on')).toBe(null)
    walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.sessionMin).toBe(150)
  })

  it('the free-text screens land in the profile as typed', () => {
    mount(); walkTo('Limits')
    typeIn(host.querySelector('.ob-field textarea'), 'dodgy left shoulder')
    cont()
    const [likes, dislikes, notes] = all('.ob-field textarea')
    typeIn(likes, 'deadlifts'); typeIn(dislikes, 'lunges'); typeIn(notes, 'arms by spring')
    cont()
    expect(mocks.S.coach.profile).toMatchObject({
      limitations: 'dodgy left shoulder', likes: 'deadlifts', dislikes: 'lunges', notes: 'arms by spring'
    })
  })
})

describe('CoachIntake — building the plan', () => {
  it('saves the answers, opens the thread with one intake line, and asks for a plan', async () => {
    mount(); walkTo('Almost there')
    let resolve
    vi.mocked(requestPlan).mockReturnValue(new Promise(r => { resolve = r }))
    cont()

    expect(requestPlan).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(requestPlan).mock.calls[0][0]
    expect(sent).toMatchObject({ goal: 'muscle', experience: 'regular', daysPerWeek: 3, sessionMin: 60 })
    expect(mocks.S.coach.profile).toEqual(sent)
    expect(mocks.S.coach.chat).toHaveLength(1)
    expect(mocks.S.coach.chat[0]).toMatchObject({ role: 'user', kind: 'intake' })
    expect(footBtn().disabled).toBe(true)                 // no second request while one is in flight
    expect(mocks.nav).not.toHaveBeenCalled()

    await act(async () => { resolve({}); await Promise.resolve() })
    expect(mocks.nav).toHaveBeenCalledWith('/coach', { replace: true })
  })

  it('a failed request keeps the answers, says why, and lets you press it again without a second intake line', async () => {
    vi.mocked(requestPlan).mockRejectedValueOnce(new Error('The Coach is already thinking about your training.'))
    mount(); walkTo('Almost there')
    cont(); await settle()

    expect(mocks.toast).toHaveBeenCalledWith('The Coach is already thinking about your training.')
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(mocks.S.coach.profile.goal).toBe('muscle')     // the answers are already saved
    expect(footBtn().disabled).toBe(false)

    cont(); await settle()
    expect(requestPlan).toHaveBeenCalledTimes(2)
    // One intake line however many times the button is pressed. The rule in finish() used to
    // be guarded by `editing`, so a first-time retry opened the thread with the questionnaire twice.
    expect(mocks.S.coach.chat).toHaveLength(1)
    expect(mocks.S.coach.chat[0]).toMatchObject({ role: 'user', kind: 'intake' })
  })

  it('falls back to a generic message when the failure carries none', async () => {
    vi.mocked(requestPlan).mockRejectedValueOnce(new Error())
    mount(); walkTo('Almost there')
    cont(); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Could not ask the Coach')
  })

  // The screen itself only offers 1–7, but a profile carried in from an import, an older
  // build or another device can hold anything, and the editor saves it straight back.
  const savingDayCount = n => {
    mocks.search = 'edit=1'
    mocks.S.coach = { consent: null, chat: [{ id: 'c1', role: 'user', kind: 'intake' }],
      profile: { goal: 'strength', experience: 'new', daysPerWeek: n, optionalDays: 0, sessionMin: 60, equipment: [] } }
    mount(); walkTo('Almost there'); cont()
    return mocks.S.coach.profile.daysPerWeek
  }
  it('clamps a prefilled day count down to the seven a week can hold', () => expect(savingDayCount(99)).toBe(7))
  it('clamps a negative day count up to one', () => expect(savingDayCount(-2)).toBe(1))
  // Nought is an answer, not a missing one: it goes through the clamp like -2 does. It used to
  // fall through `|| 3` and save as three while -1 saved as one.
  it('clamps a zero day count up to one, like any other count below the floor', () => expect(savingDayCount(0)).toBe(1))
  it('reads a missing day count as "not answered" and saves the default three', () => expect(savingDayCount(null)).toBe(3))

  // The optional count is the same clamp against a different ceiling, and the ceiling is real:
  // 4 + 4 = 8 slots in a 7-day week, so optional days are capped at 4. `MAX_OPTIONAL` is the
  // single source of that number, imported here so a change to it breaks this test on purpose.
  const savingOptionalCount = n => {
    mocks.search = 'edit=1'
    mocks.S.coach = { consent: null, chat: [{ id: 'c1', role: 'user', kind: 'intake' }],
      profile: { goal: 'strength', experience: 'new', daysPerWeek: 3, optionalDays: n, sessionMin: 60, equipment: [] } }
    mount(); walkTo('Almost there'); cont()
    return mocks.S.coach.profile.optionalDays
  }
  it('caps an over-large optional count at the ceiling', () => expect(savingOptionalCount(99)).toBe(MAX_OPTIONAL))
  it('reads a negative optional count as none, not as a count below zero', () => expect(savingOptionalCount(-2)).toBe(0))
  it('reads a missing optional count as none', () => expect(savingOptionalCount(null)).toBe(0))
})

describe('CoachIntake — more than one goal, in priority order', () => {
  // The screen used to be a radio group: one goal, and the single word went to the store. It is
  // now a short ranked list, which is a different model rather than a wider radio group, so the
  // order and its consequences are worth pinning here.
  it('keeps goals in the order they were tapped', () => {
    mount(); tap('button', 'I understand')
    expect(ranks()).toEqual([])
    tap('.ob-choice-main', 'Lose fat')
    tap('.ob-choice-main', 'Build muscle')
    tap('.ob-choice-main', 'Get stronger')
    expect(ranks()).toEqual(['Lose fat', 'Build muscle', 'Get stronger'])
  })

  it('moves an objective up and down, and the arrows stop at each end', () => {
    mount(); tap('button', 'I understand')
    tap('.ob-choice-main', 'Lose fat')
    tap('.ob-choice-main', 'Build muscle')
    expect(ranks()).toEqual(['Lose fat', 'Build muscle'])

    tapArrow(byRank(2), 'Move up')
    expect(ranks()).toEqual(['Build muscle', 'Lose fat'])
    // It is at the top now, so there is nothing above it to move to.
    expect(arrow(byRank(1), 'Move up').disabled).toBe(true)
    expect(arrow(byRank(1), 'Move down').disabled).toBe(false)

    tapArrow(byRank(1), 'Move down')
    expect(ranks()).toEqual(['Lose fat', 'Build muscle'])
    expect(arrow(byRank(2), 'Move down').disabled).toBe(true)
    expect(arrow(byRank(2), 'Move up').disabled).toBe(false)
  })

  it('unticking one renumbers the rest, so the rank always reads 1, 2, 3', () => {
    mount(); tap('button', 'I understand')
    tap('.ob-choice-main', 'Lose fat')
    tap('.ob-choice-main', 'Build muscle')
    tap('.ob-choice-main', 'Get stronger')
    expect(all('.ob-rank b').map(b => b.textContent).sort()).toEqual(['1/3', '2/3', '3/3'])
    expect(rankNumbers()).toEqual([1, 2, 3])

    tap('.ob-choice-main', 'Build muscle')
    expect(ranks()).toEqual(['Lose fat', 'Get stronger'])
    expect(all('.ob-rank b').map(b => b.textContent).sort()).toEqual(['1/2', '2/2'])
  })

  it('takes three and no more, and says so instead of quietly ignoring the tap', () => {
    mount(); tap('button', 'I understand')
    for (const g of ['Lose fat', 'Build muscle', 'Get stronger', 'General fitness']) tap('.ob-choice-main', g)
    expect(ranks()).toEqual(['Lose fat', 'Build muscle', 'Get stronger'])
    expect(host.querySelector('.ob-hint').textContent)
      .toBe('That is as many as a plan can serve at once. Untick one to pick another.')
    // The fourth card is still there and still answering - it is the cap that stopped it, not a
    // card that has gone missing.
    expect(choices()).toHaveLength(5)
  })

  it('frees a slot when one is unticked, so the cap is not permanent', () => {
    mount(); tap('button', 'I understand')
    for (const g of ['Lose fat', 'Build muscle', 'Get stronger']) tap('.ob-choice-main', g)
    tap('.ob-choice-main', 'Build muscle')
    expect(host.querySelector('.ob-hint')).toBe(null)
    tap('.ob-choice-main', 'General fitness')
    expect(ranks()).toEqual(['Lose fat', 'Get stronger', 'General fitness'])
  })

  it('shows the rank only on the chosen rows, so an unranked row has nothing to move', () => {
    mount(); tap('button', 'I understand')
    tap('.ob-choice-main', 'Build muscle')
    expect(chosen()).toHaveLength(1)
    expect(chosen()[0].querySelector('.ob-rank')).toBeTruthy()
  })

  it('saves the ranked list, with the top one as the single-word goal', () => {
    mount(); walkTo('Your goal')
    tap('.ob-choice-main', 'Lose fat')
    tap('.ob-choice-main', 'Build muscle')
    tapArrow(byRank(2), 'Move up')
    walkTo('Almost there'); cont()

    expect(mocks.S.coach.profile.objectives).toEqual(['muscle', 'fatloss'])
    expect(mocks.S.coach.profile.goal).toBe('muscle')   // the one the Coach builds for
  })
})

describe('CoachIntake — the editor behind ?edit=1', () => {
  const editing = (profile, chat = [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }]) => {
    mocks.search = 'edit=1'
    mocks.S.coach = { consent: { agreedAt: '2026-09-01T00:00:00Z', version: CONSENT_VERSION }, profile, chat }
  }
  const PROFILE = {
    goal: 'strength', experience: 'returning', daysPerWeek: 4, optionalDays: 2,
    sessionMin: 45, equipment: ['barbell'], limitations: 'bad knee', likes: 'x', dislikes: 'y', notes: 'z'
  }

  it('skips consent, prefills every answer, and ends on Save', () => {
    editing(PROFILE)
    mount()
    expect(eyebrow()).toBe('Your goal')
    expect(host.querySelector('.ob-choice.on').textContent).toContain('Get stronger')
    walkTo('Experience')
    expect(host.querySelector('.ob-choice.on').textContent).toContain('Coming back after a break')
    walkTo('Schedule')
    // Both rows come back with what the profile said, not the defaults.
    expect(picked(0)).toEqual(['4'])
    expect(picked(1)).toEqual(['2'])
    walkTo('Limits')
    expect(host.querySelector('.ob-field textarea').value).toBe('bad knee')
    walkTo('Almost there')
    expect(footBtn().textContent).toContain('Save')
  })

  it('skips consent even when none was ever given — the editor is not a second opt-in', () => {
    editing(PROFILE, [])
    mocks.S.coach.consent = null
    mount()
    expect(eyebrow()).toBe('Your goal')
  })

  it('saves without asking for a plan, and never opens a second conversation', () => {
    editing(PROFILE)
    mount(); walkTo('Your goal')
    // PROFILE says `strength`. Tapping Endurance *adds* it rather than replacing the answer -
    // the whole point of the screen is that there is more than one - so it becomes the second
    // objective and `goal` stays the one that outranks it.
    tap('.ob-choice-main', 'Endurance')
    walkTo('Almost there'); cont()

    expect(requestPlan).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Saved')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
    expect(mocks.nav).not.toHaveBeenCalledWith('/coach', { replace: true })
    expect(mocks.S.coach.profile.objectives).toEqual(['strength', 'endurance'])
    expect(mocks.S.coach.profile.goal).toBe('strength')
    expect(mocks.S.coach.chat).toHaveLength(1)
  })

  it('reads a profile saved before this screen as one objective, not as none', () => {
    editing(PROFILE)                       // only `goal`, as an older build wrote it
    mount(); walkTo('Your goal')
    expect(ranks()).toEqual(['Get stronger'])
    expect(Continue().disabled).toBe(false)   // and it is not asking them to answer again
  })

  it('still opens the thread when an edit is the first thing that ever happened', () => {
    editing(PROFILE, [{ id: 'c9', role: 'coach', kind: 'text', text: 'hi', at: 1 }])
    mount(); walkTo('Almost there'); cont()
    expect(mocks.S.coach.chat.map(m => m.kind)).toEqual(['text', 'intake'])
  })
})
