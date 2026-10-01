/* The server's copies of three tiny reading rules, pinned against the frontend's originals.
 *
 * api/coach/payload.js re-implements modeOf, isBw and isPerSide because the api container has
 * no build step in common with the frontend and does not copy frontend/ into its image. That
 * trade-off is fine; what is not fine is the copy drifting, which is exactly what happened
 * when v1.2.4 taught the app about bodyweight work and per-side reps: the server kept reading
 * every set as a loaded rep set, so a push-up progression that was working would have looked
 * like a stalled bench press with the weight left at zero.
 *
 * This test only runs under vitest, which can load both runtimes. It compares behaviour over a
 * table of configs rather than comparing source, so the two are free to be written differently
 * as long as they answer the same.
 */
import { describe, it, expect } from 'vitest'
import { modeOf as uiModeOf, isBw as uiIsBw, isPerSide as uiIsPerSide } from './history.js'
import { modeOf as srvModeOf, isBw as srvIsBw, isPerSide as srvIsPerSide } from '../../../api/coach/core/payload.js'
import { exOr } from './exercises.js'

// Real ids from the catalogue, so `eq`/`bp` are whatever the dataset actually says rather than
// whatever this test assumed. 0001 is a bodyweight sit-up; the others are looked up the same way.
const IDS = ['0001', '0025', '0043', 'no-such-exercise']

const CONFIGS = [
  {},
  { mode: 'reps' },
  { mode: 'time' },
  { mode: 'cardio' },
  { mode: 'nonsense' },
  { mode: '' },
  { bodyweight: true },
  { bodyweight: false },
  { bodyweight: true, mode: 'time' },
  { side: true },
  { side: false },
  { side: true, bodyweight: true, mode: 'reps' },
  { reps: 8, sets: 3 },
  { repsMax: 20, reps: 12 }
]

describe('server/client reading rules agree', () => {
  for (const id of IDS) {
    const ex = exOr(id)
    for (const base of CONFIGS) {
      const cfg = { ...base, id }
      const label = `${id} ${JSON.stringify(base)}`

      it(`modeOf — ${label}`, () => {
        expect(srvModeOf(cfg, ex)).toBe(uiModeOf(cfg))
      })

      it(`isBw — ${label}`, () => {
        expect(srvIsBw(cfg, ex)).toBe(uiIsBw(cfg))
      })

      it(`isPerSide — ${label}`, () => {
        expect(srvIsPerSide(cfg)).toBe(uiIsPerSide(cfg))
      })
    }
  }

  it('an explicit flag beats the catalogue, on both sides', () => {
    const bodyweightEx = exOr('0001')
    expect(uiIsBw({ id: '0001' })).toBe(true)
    expect(srvIsBw({ id: '0001' }, bodyweightEx)).toBe(true)
    // A dip done with a belt turns it off; the server must agree, or it keeps reading the
    // added load as no load.
    expect(uiIsBw({ id: '0001', bodyweight: false })).toBe(false)
    expect(srvIsBw({ id: '0001', bodyweight: false }, bodyweightEx)).toBe(false)
  })
})

// #311: the validator keeps a routine glyph only when it is one a routine can hold (or a legacy
// emoji), and the payload sends the plan's icons through the same filter. A glyph the app shows
// and the server does not know would be reset by every plan.
import { GLYPHS, KNOWN_GLYPHS, glyphOf } from './glyphs.js'
import { ICON_NAMES } from '../components/Icon.jsx'
import { ROUTINE_GLYPHS, LEGACY_ROUTINE_GLYPHS, glyphStr } from '../../../api/coach/core/glyphs.js'

describe('routine glyphs', () => {
  it('the server offers exactly the glyphs the picker offers, each a real icon', () => {
    expect([...ROUTINE_GLYPHS].sort()).toEqual([...GLYPHS].sort())
    ROUTINE_GLYPHS.forEach(g => expect(ICON_NAMES).toContain(g))
  })
  it('the server keeps every icon key a routine can hold, and the app shows each as itself', () => {
    expect([...ROUTINE_GLYPHS, ...LEGACY_ROUTINE_GLYPHS].sort()).toEqual([...KNOWN_GLYPHS].sort())
    KNOWN_GLYPHS.forEach(g => {
      expect(glyphStr(g)).toBe(g)
      expect(glyphOf(g)).toBe(g)
    })
  })
})
/* The session answer's bounds, pinned the same way: two copies, one rule.
 *
 * api/coach/core/validate.js holds the server's and lib/coach.js the app's. They answer the same
 * question about the same answer from two ends, and on a phone that brought its own key the
 * client's copy is the only gate there is — so they have to agree. Compared as behaviour over a
 * table, like the reading rules above: if one side widens a bound or starts accepting a string,
 * this fails.
 *
 * The one thing they answer differently is on purpose. The server was sent a routine and owes an
 * answer for every exercise in it, so a partial answer is a refusal it can make. The client only
 * knows the exercises on the screen, which a swap or an added exercise has changed underneath the
 * job, so it applies what it was given.
 */
import { validateSession as srvValidateSession } from '../../../api/coach/core/validate.js'
import { validateSessionTargets as uiValidateSessionTargets } from './coach.js'

const ROUTINE_EX = [{ id: '0001', mode: 'reps', reps: 10, weight: 20 }, { id: '0007', mode: 'time', sec: 45, weight: 30 }]
const entriesOf = ex => ex.map(e => ({ id: e.id, target: { ...e }, plan: { kind: 'up' }, sets: [] }))

/** The server needs an answer for every exercise it was asked about, so the table fills the rest. */
const withFillers = targets => {
  const named = new Set(targets.map(t => t?.id).filter(Boolean))
  return [...targets, ...ROUTINE_EX.filter(e => !named.has(e.id)).map(e => ({ id: e.id, why: 'held as planned' }))]
}
const serverOk = targets => srvValidateSession(
  { coach_contract: 1, summary: 's', targets },
  { routine: { id: 'r1', ex: ROUTINE_EX }, base: {} },
).ok
const clientOk = (targets, entries = entriesOf(ROUTINE_EX)) => {
  try { uiValidateSessionTargets({ targets }, entries); return true } catch { return false }
}

const CASES = [
  { label: 'a plain target', t: { id: '0001', weight: 22.5, reps: 8, why: 'held' } },
  { label: 'weight at the ceiling', t: { id: '0001', weight: 1000, why: 'held' } },
  { label: 'weight over the ceiling', t: { id: '0001', weight: 1000.5, why: 'held' } },
  { label: 'a negative weight', t: { id: '0001', weight: -1, why: 'held' } },
  { label: 'a weight as a string', t: { id: '0001', weight: '22.5', why: 'held' } },
  { label: 'reps at 1', t: { id: '0001', reps: 1, why: 'held' } },
  { label: 'reps over 100', t: { id: '0001', reps: 101, why: 'held' } },
  { label: 'a fractional rep count', t: { id: '0001', reps: 8.5, why: 'held' } },
  { label: 'sets over 10', t: { id: '0001', sets: 11, why: 'held' } },
  { label: 'a fraction of a set', t: { id: '0001', sets: 3.5, why: 'held' } },
  { label: 'a hold of 4 seconds', t: { id: '0007', sec: 4, why: 'held' } },
  { label: 'a hold of 3601 seconds', t: { id: '0007', sec: 3601, why: 'held' } },
  { label: 'no rest at all', t: { id: '0001', restSec: 0, why: 'held' } },
  { label: 'rest of 14s', t: { id: '0001', restSec: 14, why: 'held' } },
  { label: 'rest of 15s', t: { id: '0001', restSec: 15, why: 'held' } },
  { label: 'rest of 300s', t: { id: '0001', restSec: 300, why: 'held' } },
  { label: 'rest over five minutes', t: { id: '0001', restSec: 301, why: 'held' } },
  { label: 'rest of 90.5s', t: { id: '0001', restSec: 90.5, why: 'held' } },
  { label: 'no reason behind it', t: { id: '0001', weight: 22.5 } },
  { label: 'an id that is not in the routine', t: { id: '9999', weight: 20, why: 'held' } },
  { label: 'no id at all', t: { weight: 20, why: 'held' } },
  { label: 'the same exercise twice', t: { id: '0001', weight: 22.5, why: 'held' }, twice: true },
  { label: 'a cardio number the app does not act on', t: { id: '0001', min: 200, why: 'held' } },
  { label: 'a field that is not a number at all', t: { id: '0001', sets: '3', why: 'held' } },
  { label: 'null where a number belongs', t: { id: '0001', weight: null, reps: 8, why: 'held' } },
]

describe("a session answer's bounds, on both sides", () => {
  for (const { label, t, twice } of CASES) {
    it(label, () => {
      const targets = withFillers(twice ? [t, t] : [t])
      expect(clientOk(targets)).toBe(serverOk(targets))
    })
  }

  it('per-side odd reps are refused on both sides', () => {
    const one = [{ id: '0001', reps: 11, why: 'held' }]
    const perSide = [{ id: '0001', mode: 'reps', side: true, reps: 12 }]
    expect(srvValidateSession({ coach_contract: 1, summary: 's', targets: one }, { routine: { id: 'r1', ex: perSide }, base: {} }).ok).toBe(false)
    expect(clientOk(one, entriesOf(perSide))).toBe(false)
    // And an even count is fine, so it is the parity and not the number.
    expect(clientOk([{ id: '0001', reps: 12, why: 'held' }], entriesOf(perSide))).toBe(true)
  })

  it('a partial answer is the one place the two deliberately differ', () => {
    const partial = [{ id: '0001', weight: 22.5, why: 'held' }]
    expect(serverOk(partial)).toBe(false)
    expect(clientOk(partial)).toBe(true)
  })
})
