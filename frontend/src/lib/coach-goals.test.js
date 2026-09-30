import { describe, it, expect } from 'vitest';
import {
  GOALS, GOAL_KEYS, MAX_OBJECTIVES,
  normalizeObjectives, toggleObjective, moveObjective, primaryObjective, goalLabel, goalIcon
} from './coach-goals.js';

// Somebody who wants to get stronger and put on muscle is not a person with two goals, they are a
// person with one goal and a second thing they would not mind getting. The whole model is that the
// list is ordered, and that the order has to survive every trip through the app intact.
describe('normalizeObjectives', () => {
  it('keeps the order the person chose - that order is the priority', () => {
    expect(normalizeObjectives({ objectives: ['fatloss', 'strength', 'muscle'] }))
      .toEqual(['fatloss', 'strength', 'muscle'])
  })

  it('reads a profile written before this screen as a single objective', () => {
    expect(normalizeObjectives({ goal: 'muscle' })).toEqual(['muscle'])
    expect(primaryObjective({ goal: 'muscle' })).toBe('muscle')
  })

  it('does not let the derived goal re-append itself to a profile that has both', () => {
    // Every new profile writes both. Reading the list and then the goal must not produce ['muscle', 'muscle'].
    expect(normalizeObjectives({ objectives: ['muscle', 'fatloss'], goal: 'muscle' }))
      .toEqual(['muscle', 'fatloss'])
  })

  it('falls back to the goal when the list is empty or not a list', () => {
    expect(normalizeObjectives({ objectives: [], goal: 'strength' })).toEqual(['strength'])
    expect(normalizeObjectives({ objectives: 'muscle', goal: 'strength' })).toEqual(['strength'])
  })

  it('is empty when nothing was chosen, rather than inventing a default', () => {
    expect(normalizeObjectives({})).toEqual([])
    expect(normalizeObjectives({ goal: null })).toEqual([])
    expect(normalizeObjectives({ objectives: ['nonsense'] })).toEqual([])
    expect(primaryObjective({})).toBeNull()
  })

  it('drops a duplicate rather than programming for the same goal twice', () => {
    expect(normalizeObjectives({ objectives: ['muscle', 'muscle', 'fatloss'] })).toEqual(['muscle', 'fatloss'])
  })

  it('drops a key it has no copy for, since the model could not programme for it', () => {
    expect(normalizeObjectives({ objectives: ['muscle', 'powerlifting', 'fatloss'] }))
      .toEqual(['muscle', 'fatloss'])
  })

  it('caps the list, keeping the ones that were ranked highest', () => {
    const all = GOAL_KEYS.slice(0, 5)
    expect(normalizeObjectives({ objectives: all })).toHaveLength(MAX_OBJECTIVES)
    expect(normalizeObjectives({ objectives: all })).toEqual(all.slice(0, MAX_OBJECTIVES))
  })

  it('never returns more than the cap, however many are sent', () => {
    expect(normalizeObjectives({ objectives: [...GOAL_KEYS, ...GOAL_KEYS] }).length)
      .toBeLessThanOrEqual(MAX_OBJECTIVES)
  })
});

describe('toggleObjective', () => {
  it('adds on the end, so tapping in priority order is the whole interaction', () => {
    let l = []
    l = toggleObjective(l, 'fatloss')
    l = toggleObjective(l, 'strength')
    l = toggleObjective(l, 'muscle')
    expect(l).toEqual(['fatloss', 'strength', 'muscle'])
  })

  it('removes one that is unticked, rather than demoting it to the bottom', () => {
    expect(toggleObjective(['fatloss', 'strength', 'muscle'], 'strength'))
      .toEqual(['fatloss', 'muscle'])
  })

  it('refuses to go past the cap, and leaves the list as it was', () => {
    let l = []
    for (const k of GOAL_KEYS) l = toggleObjective(l, k)
    expect(l).toHaveLength(MAX_OBJECTIVES)
    expect(l).toEqual(GOAL_KEYS.slice(0, MAX_OBJECTIVES))
  })

  it('frees a slot when one is removed, so the cap is not a one-way ratchet', () => {
    let l = ['muscle', 'fatloss', 'strength']
    l = toggleObjective(l, 'fatloss')
    l = toggleObjective(l, 'endurance')
    expect(l).toEqual(['muscle', 'strength', 'endurance'])
  })

  it('ignores a key it does not know', () => {
    expect(toggleObjective(['muscle'], 'nonsense')).toEqual(['muscle'])
    expect(toggleObjective(undefined, 'muscle')).toEqual(['muscle'])
  })

  it('does not mutate what it was given', () => {
    const before = ['muscle']
    toggleObjective(before, 'fatloss')
    expect(before).toEqual(['muscle'])
  })
});

describe('moveObjective', () => {
  const four = ['a', 'b', 'c', 'd'].map((_, i) => GOAL_KEYS[i])

  it('moves an objective up towards the front', () => {
    expect(moveObjective(four, 2, -1)).toEqual([four[0], four[2], four[1], four[3]])
  })

  it('moves an objective down away from the front', () => {
    expect(moveObjective(four, 0, 1)).toEqual([four[1], four[0], four[2], four[3]])
  })

  it('will not step past either end, so the arrow can be disabled instead', () => {
    expect(moveObjective(four, 0, -1)).toBe(four)
    expect(moveObjective(four, 3, 1)).toBe(four)
  })

  it('ignores an index that is not in the list', () => {
    expect(moveObjective(four, -1, -1)).toBe(four)
    expect(moveObjective(four, 9, -1)).toBe(four)
  })

  it('leaves the original alone, so a re-render cannot undo the move', () => {
    const before = [...four]
    moveObjective(before, 0, 1)
    expect(before).toEqual(four)
  })

  it('can make any objective the top one', () => {
    // The last of three, walked up to the front: bottom -> middle -> top.
    let l = GOAL_KEYS.slice(0, 3)
    const bottom = l[2]
    while (l.indexOf(bottom) > 0) l = moveObjective(l, l.indexOf(bottom), -1)
    expect(l[0]).toBe(bottom)
    expect(l).toHaveLength(3)
  })
});

describe('the objective list itself', () => {
  it('gives every key a label and an icon, and no key twice', () => {
    const keys = GOALS.map(([k]) => k)
    expect(new Set(keys).size).toBe(keys.length)
    keys.forEach(k => {
      expect(goalLabel(k)).toBeTruthy()
      expect(goalLabel(k)).not.toBe(k)     // every key has copy of its own
      expect(goalIcon(k)).toBeTruthy()
    })
  })

  it('offers more objectives than one person may pick, so the cap is a choice', () => {
    expect(GOAL_KEYS.length).toBeGreaterThan(MAX_OBJECTIVES)
  })

  it('labels an unknown key with itself rather than with nothing', () => {
    expect(goalLabel('nonsense')).toBe('nonsense')
  })
});
