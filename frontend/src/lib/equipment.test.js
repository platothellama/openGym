import { describe, expect, it } from 'vitest'
import {
  ALL_EQUIPMENT, parseCustomEquipment, matchKnownEquipment,
  splitKnownCustom, mergeCustomEquipment,
} from './equipment.js'

describe('equipment custom entries', () => {
  it('lists the full catalogue taxonomy, not a truncated top-N', () => {
    // 28 values in the dataset; the Coach intake used to slice the top 14.
    expect(ALL_EQUIPMENT.length).toBeGreaterThan(20)
    for (const tail of ['rope', 'bosu ball', 'olympic barbell', 'tire', 'trap bar']) {
      expect(ALL_EQUIPMENT).toContain(tail)
    }
  })

  it('parses a textarea on newlines, commas and semicolons', () => {
    expect(parseCustomEquipment('pull-up bar\nTRX, dip station; sled\n\npull-up bar'))
      .toEqual(['pull-up bar', 'TRX', 'dip station', 'sled'])
  })

  it('drops empties, over-long lines and case-duplicates', () => {
    expect(parseCustomEquipment(' , , ok, OK, ' + 'x'.repeat(41))).toEqual(['ok'])
  })

  it('matches exact taxonomy, aliases and plurals', () => {
    expect(matchKnownEquipment('Dumbbell')).toBe('dumbbell')
    expect(matchKnownEquipment('dbs')).toBe('dumbbell')
    expect(matchKnownEquipment('kettlebells')).toBe('kettlebell')
    expect(matchKnownEquipment('cables')).toBe('cable')
    expect(matchKnownEquipment('hex bar')).toBe('trap bar')
  })

  it('leaves genuinely custom gear unmatched', () => {
    expect(matchKnownEquipment('pull-up bar')).toBe(null)
    expect(matchKnownEquipment('TRX')).toBe(null)
    expect(matchKnownEquipment('sandbag')).toBe(null)
  })

  it('splits a stored list into chips vs. customs', () => {
    // "DBs" maps onto dumbbell when typed, but it is not the taxonomy value — once
    // stored it renders as a custom chip of its own, never as a chip that is not there.
    expect(splitKnownCustom(['dumbbell', 'DUMBBELL', 'TRX', 'DBs', 'pull-up bar']))
      .toEqual({ known: ['dumbbell', 'DUMBBELL'], custom: ['TRX', 'DBs', 'pull-up bar'] })
  })

  it('merges customs: known folds in, the rest appends, no duplicates', () => {
    // "dbs" folds onto the taxonomy value; the pull-up bar rides verbatim.
    expect(mergeCustomEquipment(['dumbbell'], ['dbs', 'pull-up bar', 'Pull-Up Bar']))
      .toEqual(['dumbbell', 'pull-up bar'])
  })

  it('caps the merged list at the server bound', () => {
    const many = Array.from({ length: 60 }, (_, i) => 'thing ' + i)
    expect(mergeCustomEquipment([], many)).toHaveLength(40)
  })
})
