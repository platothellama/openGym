// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

vi.mock('../lib/fitai.js', () => ({ getFitaiSummary: vi.fn() }))
import { getFitaiSummary } from '../lib/fitai.js'
import FuelCard from './FuelCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ID = 'fc8647ef-81bb-443c-8ecd-c4d138c81f84'
const SUMMARY = {
  targets: { calories: 2000, protein: 150 },
  nutrition: { daysLogged: 6, kcalAvg: 1433, proteinAvg: 119, deficitVsTarget: 567, proteinVsTarget: 31 },
  activity: { stepsAvg: 18593, stepsDays: 6, sleepAvgH: 7.2, sleepNights: 6, restingHrAvg: 58, restingHrDays: 6 }
}

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  getFitaiSummary.mockResolvedValue(null)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })

const mount = userId => act(() => root.render(<FuelCard userId={userId} />))
const settle = () => act(async () => {})

describe('FuelCard', () => {
  it('renders nothing when unlinked, without asking', async () => {
    mount(null)
    await settle()
    expect(host.textContent).toBe('')
    expect(getFitaiSummary).not.toHaveBeenCalled()
  })

  it('shows a loading line while the check is in flight', () => {
    getFitaiSummary.mockReturnValue(new Promise(() => {}))   // never settles
    mount(ID)
    expect(host.textContent).toContain('Checking fuel')
  })

  it('renders averages, readiness and the read-only footnote', async () => {
    getFitaiSummary.mockResolvedValue(SUMMARY)
    mount(ID)
    await settle()
    expect(host.textContent).toContain('1433')
    expect(host.textContent).toContain('119')
    expect(host.textContent).toContain('18593')
    expect(host.textContent).toContain('7.2')
    expect(host.textContent).toContain('58')
    expect(host.textContent).toContain('Details live in FitAI')
  })

  it('says plainly when FitAI is unreachable', async () => {
    getFitaiSummary.mockResolvedValue(null)
    mount(ID)
    await settle()
    expect(host.textContent).toContain('Could not reach FitAI')
  })

  it('says plainly when the window holds no food', async () => {
    getFitaiSummary.mockResolvedValue({ targets: {}, nutrition: { daysLogged: 0 }, activity: {} })
    mount(ID)
    await settle()
    expect(host.textContent).toContain('No food logs')
  })
})
