import { describe, expect, it } from 'vitest'
import { parseOther, splitKnownUnknown, mergeScan, KNOWN_EQUIPMENT } from './coach-equipment.js'

describe('coach-equipment — free-text parsing', () => {
  it('splits on commas, semicolons and newlines and trims', () => {
    expect(parseOther('trx,  pull-up bar\nrower; bike')).toEqual(['trx', 'pull-up bar', 'rower', 'bike'])
  })
  it('drops empties and duplicates case-insensitively', () => {
    expect(parseOther('TRX, trx ,,  Trx ')).toEqual(['TRX'])
  })
  it('skips values the taxonomy already covers', () => {
    expect(parseOther('dumbbell, trx')).toEqual(['trx'])
  })
  it('bounds count and cuts long items', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'item' + i).join(', ')
    expect(parseOther(many)).toHaveLength(10)
    expect(parseOther('x'.repeat(100))).toEqual(['x'.repeat(40)])
  })
  it('reads non-strings as empty', () => {
    expect(parseOther(null)).toEqual([])
    expect(parseOther(42)).toEqual([])
  })
})

describe('coach-equipment — stored profiles stay editable', () => {
  it('keeps known chips and returns unknown ones as custom', () => {
    const { known, custom } = splitKnownUnknown(['dumbbell', 'TRX', 'dumbbell', null, 42])
    expect(known).toEqual(['dumbbell'])
    expect(custom).toEqual(['TRX'])
  })
  it('exposes the full taxonomy, not a top-N slice', () => {
    expect(KNOWN_EQUIPMENT.length).toBeGreaterThan(14)
    expect(KNOWN_EQUIPMENT).toContain('dumbbell')
  })
})

describe('coach-equipment — merging a photo-scan suggestion', () => {
  it('ticks known chips and appends unknown ones to the free text', () => {
    const patch = mergeScan({ equipment: ['dumbbell'], equipmentOther: 'trx' }, { equipment: ['barbell', 'dumbbell'], other: ['TRX', 'rower'] })
    expect(patch.equipment).toEqual(['dumbbell', 'barbell'])
    expect(patch.equipmentOther).toBe('trx, rower')
  })
  it('never drops what was already chosen', () => {
    const patch = mergeScan({ equipment: ['cable'], equipmentOther: '' }, { equipment: [], other: [] })
    expect(patch).toEqual({ equipment: ['cable'], equipmentOther: '' })
  })
})
