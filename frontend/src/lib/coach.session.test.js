/* Today's targets, written into a workout that is already open.
 *
 * This is the one place the app acts on numbers a language model produced and puts them on the
 * bar, so the file asserts the two things that make that safe: the answer is bounded again here
 * after crossing the network, and undo puts back exactly what was replaced — nothing more, and
 * nothing that has since been logged. `applySessionTargets` itself (which does the row-level
 * writing) is tested in session-suggest.test.js; what is under test here is the gate in front of
 * it and the snapshot behind it.
 */
import { describe, it, expect } from 'vitest'
import {
  SESSION_TARGET_BOUNDS, SESSION_REST_MAX, validateSessionTargets, applySessionProposal,
  revertSessionTargets, canRevertSession, pushActiveSnapshot, SNAPSHOT_MAX, logEntry
} from './coach.js'

const session = (over = {}) => ({
  id: 'w-live',
  cur: 0,
  entries: [
    {
      id: '0001',
      target: { id: '0001', sets: 3, reps: 10, weight: 20, mode: 'reps', inc: 2.5 },
      plan: { policy: 'linear', kind: 'up' },
      sets: [{ w: 20, r: 10 }, { w: 20, r: 10 }, { w: 20, r: 10 }],
    },
    {
      id: '0007',
      target: { id: '0007', sets: 3, sec: 45, mode: 'time', weight: 30, restSec: 60 },
      plan: { policy: 'off', kind: 'hold' },
      sets: [{ sec: 45, w: 30 }, { sec: 45, w: 30 }, { sec: 45, w: 30 }],
    },
  ],
  ...over,
})

const state = (active = session()) => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], routines: [], week: {},
  coach: { log: [], snapshots: [] },
  active,
})

const proposal = (targets, over = {}) => ({
  id: 'p-session', kind: 'session', summary: 'Holding the jump — short night.',
  targets, ...over,
})
// A target that actually changes something: the entry sits at 20, so a default at 20 would be
// the "changes nothing" case that every other assertion here would trip over instead.
const target = (over = {}) => ({ id: '0001', weight: 22.5, why: 'Held: sleep was 5.5h.', ...over })

describe("a session's targets", () => {
  describe('validation', () => {
    it('keeps what it can use and says what it refused', () => {
      const { targets, dropped } = validateSessionTargets(proposal([target()]), session().entries)
      expect(targets['0001']).toEqual({ why: 'Held: sleep was 5.5h.', weight: 22.5 })
      expect(dropped).toEqual([])
    })

    it('refuses an answer that names an exercise not on the screen', () => {
      // It was asked about a two-exercise routine; a third exercise was swapped in while it ran.
      // Writing the rest of it would be writing numbers into a workout nobody asked about.
      const entries = session().entries
      const r = proposal([target(), { id: '0099', weight: 30, why: 'for the one you do not have' }])
      expect(() => validateSessionTargets(r, entries)).toThrow()
    })

    it('refuses a duplicate and a target with no reason behind it', () => {
      expect(() => validateSessionTargets(proposal([target(), target()]), session().entries)).toThrow()
      expect(() => validateSessionTargets(proposal([{ id: '0001', weight: 20 }]), session().entries)).toThrow()
      expect(() => validateSessionTargets({ summary: 'x' }, session().entries)).toThrow()
    })

    it('applies the bounds again, in the client as well as the server', () => {
      const one = over => () => validateSessionTargets(proposal([target(over)]), session().entries)
      expect(one({ weight: 1001 })).toThrow()
      expect(one({ weight: -1 })).toThrow()
      expect(one({ reps: 0 })).toThrow()
      expect(one({ reps: 101 })).toThrow()
      expect(one({ reps: 10.5 })).toThrow()
      expect(one({ sets: 11 })).toThrow()
      expect(one({ sec: 4 })).toThrow()
      expect(one({ sec: 3601 })).toThrow()
      expect(one({ restSec: 10 })).toThrow()
      expect(one({ restSec: SESSION_REST_MAX + 1 })).toThrow()
      // 0 is a real answer — no rest at all — and the range around it is real too.
      expect(one({ restSec: 0 })).not.toThrow()
      expect(one({ restSec: 120 })).not.toThrow()
    })

    it('never lets an odd rep count onto a per-side exercise', () => {
      const entries = [{ ...session().entries[0], target: { ...session().entries[0].target, side: true } }]
      // Refused the way the server refuses it, rather than quietly halved: an odd total is either
      // a miscount or a rep on one side only, and neither belongs on the screen.
      expect(() => validateSessionTargets(proposal([target({ reps: 11 })]), entries)).toThrow()
      expect(validateSessionTargets(proposal([target({ reps: 12 })]), entries).targets['0001'].reps).toBe(12)
    })

    it('refuses an invented load on a bodyweight exercise that carries none', () => {
      const bw = [{ ...session().entries[0], target: { id: '0001', sets: 3, reps: 12, bodyweight: true, mode: 'reps' } }]
      const r = validateSessionTargets(proposal([target({ reps: 14, weight: 20 })]), bw)
      // The rep climb stands — that is how bodyweight work progresses — and the load does not.
      expect(r.targets['0001']).toEqual({ why: 'Held: sleep was 5.5h.', reps: 14 })
      expect(r.dropped).toContainEqual({ id: '0001', field: 'weight' })
      // A bodyweight exercise already loaded today (a dip with a belt) may keep its load.
      const belt = [{ ...bw[0], target: { ...bw[0].target, weight: 10 } }]
      expect(validateSessionTargets(proposal([target({ reps: 14, weight: 12 })]), belt).targets['0001'].weight).toBe(12)
    })

    it('leaves out a target that changes nothing, rather than offering an arrow to nowhere', () => {
      const r = validateSessionTargets(proposal([target(), { id: '0007', sec: 45, why: 'same hold' }]), session().entries)
      expect(Object.keys(r.targets)).toEqual(['0001'])
      expect(r.dropped).toContainEqual({ id: '0007', unchanged: true })
    })

    it('the bounds it re-applies are the ones the server states', () => {
      expect(SESSION_TARGET_BOUNDS).toEqual({ weight: [0, 1000], reps: [1, 100], sets: [1, 10], sec: [5, 3600] })
    })
  })

  describe('applying', () => {
    it('writes the numbers into the entry and the rows waiting to be lifted', () => {
      const s = state()
      const r = applySessionProposal(s, proposal([target({ weight: 22.5, reps: 8 })]))
      expect(r.applied).toBe(1)
      const e = s.active.entries[0]
      expect(e.target).toMatchObject({ weight: 22.5, reps: 8 })
      expect(e.sets.map(x => x.w)).toEqual([22.5, 22.5, 22.5])
      expect(e.sets.map(x => x.r)).toEqual([8, 8, 8])
      // The reason rides with the entry so the workout card can say why, as it does for the
      // readiness overlay.
      expect(e.suggestion.why).toContain('5.5h')
    })

    it('never touches a set that has already been logged', () => {
      const s = state(session({ entries: [{ ...session().entries[0], sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10 }] }] }))
      applySessionProposal(s, proposal([target({ weight: 22.5 })]))
      expect(s.active.entries[0].sets[0]).toEqual({ w: 20, r: 10, done: true })
      expect(s.active.entries[0].sets[1].w).toBe(22.5)
    })

    it('logs it, so the chat can show what was done and when', () => {
      const s = state()
      const r = applySessionProposal(s, proposal([target({ restSec: 90 })]))
      const entry = logEntry(s, r.logId)
      expect(entry).toMatchObject({ kind: 'session', proposalId: 'p-session', ids: ['0001'] })
      expect(entry.summary).toContain('short night')
    })

    it('an answer with nothing to act on writes nothing and leaves nothing to undo', () => {
      const s = state()
      const r = applySessionProposal(s, proposal([{ id: '0007', sec: 45, why: 'same hold' }]))
      expect(r.applied).toBe(0)
      expect(s.coach.snapshots).toEqual([])
      expect(canRevertSession(s, 'w-live')).toBe(false)
    })

    it('refuses outright when there is no session to write into', () => {
      expect(() => applySessionProposal(state(null), proposal([target()]))).toThrow()
    })
  })

  describe('undo', () => {
    const applied = (targets = [target({ weight: 22.5, reps: 8, restSec: 150 })]) => {
      const s = state()
      s.before = JSON.parse(JSON.stringify(s.active.entries))
      applySessionProposal(s, proposal(targets))
      return s
    }

    it('puts the entry and its rows back exactly as they were', () => {
      const s = applied()
      expect(s.active.entries[0].target.weight).toBe(22.5)
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      expect(s.active.entries).toEqual(s.before)
      expect(s.active.entries[0].suggestion).toBeUndefined()
    })

    it('keeps a set logged after the apply — that set happened', () => {
      const s = applied()
      // Lift the first work set, then change the rest timer by hand, then undo.
      s.active.entries[0].sets[0].done = true
      s.active.entries[0].sets[0].r = 8
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      expect(s.active.entries[0].sets[0]).toEqual({ w: 22.5, r: 8, done: true })
      // The rows never lifted are back at the plan's numbers.
      expect(s.active.entries[0].sets.slice(1).map(x => x.w)).toEqual([20, 20])
      expect(s.active.entries[0].target).toMatchObject({ weight: 20, reps: 10 })
    })

    it('removes the rows an added set brought, and keeps one that was logged', () => {
      const s = state()
      applySessionProposal(s, proposal([target({ weight: 22.5, sets: 5 })]))
      expect(s.active.entries[0].sets).toHaveLength(5)
      // Lift the last of the rows the apply added, then undo: that one is history now.
      s.active.entries[0].sets[4].done = true
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      const rows = s.active.entries[0].sets
      expect(rows).toHaveLength(4)
      expect(rows[3]).toEqual({ w: 22.5, r: 10, done: true })
      // And the target goes back to the set count the plan opened with.
      expect(s.active.entries[0].target.sets).toBe(3)
    })

    it('only ever undoes its own session', () => {
      const s = applied()
      // The workout was finished and another one started: the snapshot is still there but it is
      // about a session that no longer exists.
      s.active = session({ id: 'w-next' })
      expect(canRevertSession(s, 'w-next')).toBe(false)
      expect(revertSessionTargets(s, 'w-next')).toBe(false)
      // And the old session's snapshot was not spent trying.
      expect(s.coach.snapshots.some(sn => sn.active?.sessionId === 'w-live')).toBe(true)
    })

    it('undoes once, not repeatedly', () => {
      const s = applied()
      expect(canRevertSession(s, 'w-live')).toBe(true)
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      expect(canRevertSession(s, 'w-live')).toBe(false)
      expect(revertSessionTargets(s, 'w-live')).toBe(false)
    })

    it('takes the last apply first when two are in the ring', () => {
      const s = state()
      applySessionProposal(s, proposal([target({ weight: 22.5 })]))
      applySessionProposal(s, proposal([target({ weight: 25 })]))
      expect(s.active.entries[0].target.weight).toBe(25)
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      expect(s.active.entries[0].target.weight).toBe(22.5)
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      expect(s.active.entries[0].target.weight).toBe(20)
    })

    it('leaves a plan snapshot alone — it puts back a plan, not a session', () => {
      const s = state()
      s.coach.snapshots = [{ at: 1, label: 'plan', routines: [{ id: 'r1' }], week: { 1: 'r1' } }]
      applySessionProposal(s, proposal([target({ weight: 22.5 })]))
      expect(revertSessionTargets(s, 'w-live')).toBe(true)
      // The plan snapshot is still the newest entry, still a plan snapshot, and `revertLast` (the
      // plan undo) is what reads it.
      const top = s.coach.snapshots[s.coach.snapshots.length - 1]
      expect(top.routines).toEqual([{ id: 'r1' }])
      expect(top.active).toBeUndefined()
    })

    it('shares the ring with plan snapshots, so three is three', () => {
      const s = state()
      for (let i = 0; i < SNAPSHOT_MAX + 2; i++) applySessionProposal(s, proposal([target({ weight: 22.5 + i })]))
      expect(s.coach.snapshots).toHaveLength(SNAPSHOT_MAX)
    })

    it('an entry that has since been removed from the session is skipped, not restored onto nothing', () => {
      const s = applied()
      s.active.entries = s.active.entries.filter(e => e.id !== '0001')
      expect(revertSessionTargets(s, 'w-live')).toBe(false)
    })

    it('a snapshot with no entries to restore is never taken', () => {
      const s = state()
      pushActiveSnapshot(s, 'w-live', 'p1', ['0001'], [])
      expect(s.coach.snapshots).toEqual([])
    })
  })
})