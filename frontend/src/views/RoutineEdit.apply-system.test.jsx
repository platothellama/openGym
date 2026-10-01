// @vitest-environment happy-dom
// The explicit half of a training system: writing its progression rule into one routine, so the
// rule is visible in the editor and travels with the routine. Settings resolves a system
// implicitly; nothing is written to a routine until it is asked for here, and what it writes is
// deliberately conservative.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { confirmSheet } from '../sheets.jsx'
import { systemOf } from '../lib/training-systems.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root, container

function renderRoutine(routine, over = {}) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [], ...routine }]
  Object.assign(S, over)
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(
    <MemoryRouter initialEntries={['/routine/r1']}>
      <Routes><Route path="/routine/:id" element={<RoutineEdit />} /></Routes>
    </MemoryRouter>
  ))
}

const applyButton = text => [...container.querySelectorAll('button')].find(b => b.textContent === text)
const confirmText = () => vi.mocked(confirmSheet).mock.calls.at(-1)[0]

beforeEach(() => { localStorage.clear(); vi.mocked(confirmSheet).mockClear() })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('apply a training system to one routine', () => {
  it('offers nothing without a system, because there is no rule to write', () => {
    renderRoutine({})
    expect(container.textContent).not.toContain('to this routine')
    expect(confirmSheet).not.toHaveBeenCalled()
  })

  it('names the system it would write, and confirms before writing anything', () => {
    renderRoutine({}, { trainSystem: 'hypertrophy' })
    expect(applyButton('Apply Hypertrophy to this routine')).toBeTruthy()
    act(() => applyButton('Apply Hypertrophy to this routine').click())
    const asked = confirmText()
    expect(asked.title).toBe('Apply training system?')
    expect(asked.message).toBe('Hypertrophy will set the progression rule for this routine. Anything you have set by hand stays as it is.')
    expect(asked.confirmText).toBe('Apply')
    // Nothing is written until the sheet is confirmed.
    expect(useStore.getState().S.routines[0].prog).toBeUndefined()
    act(() => asked.onConfirm())
    const routine = useStore.getState().S.routines[0]
    expect(routine.prog).toBe(systemOf(useStore.getState().S).policy)
    expect(routine.systemApplied).toBe('hypertrophy')
  })

  it('says so, rather than offering it again, once the routine is on that system', () => {
    renderRoutine({ prog: 'double', systemApplied: 'hypertrophy' }, { trainSystem: 'hypertrophy' })
    expect(container.textContent).toContain('This routine already uses Hypertrophy.')
    expect(applyButton('Apply Hypertrophy to this routine')).toBeUndefined()
  })

  it('a routine deliberately on another policy is left alone, and still offered', () => {
    // 'greyskull' brings its own policy, which is the user's choice and not the system's to overwrite.
    renderRoutine({ prog: 'greyskull' }, { trainSystem: 'hypertrophy' })
    act(() => applyButton('Apply Hypertrophy to this routine').click())
    act(() => confirmText().onConfirm())
    const routine = useStore.getState().S.routines[0]
    expect(routine.prog).toBe('greyskull')
    expect(container.textContent).not.toContain('This routine already uses')
  })

  it('with the system switched off, offers to take back what was written here', () => {
    renderRoutine({ prog: 'double', systemApplied: 'hypertrophy' })
    const remove = applyButton('Remove Hypertrophy from this routine')
    expect(remove).toBeTruthy()
    act(() => remove.click())
    const asked = confirmText()
    expect(asked.title).toBe('Remove training system?')
    expect(asked.message).toBe('This routine stops using Hypertrophy and goes back to the progression rule above.')
    act(() => asked.onConfirm())
    const routine = useStore.getState().S.routines[0]
    expect(routine.systemApplied).toBeUndefined()
    expect(routine.prog).toBeUndefined()
  })

  it('a routine that never had a system applied has nothing to take back', () => {
    renderRoutine({ prog: 'linear' })
    expect(container.textContent).not.toContain('from this routine')
    expect(confirmSheet).not.toHaveBeenCalled()
  })
})