/* eslint-env vitest */
import { describe, it, expect } from 'vitest'
import {
  SYSTEMS,
  SYSTEM_LIST,
  systemOf,
  isSystemOn,
  systemIdOf,
  policyOf,
  muscleTargetFor,
  volumeClassOf,
  applySystemToRoutine,
  repBandFor,
  restSecFor,
  presetInc,
  isCompoundLift
} from './training-systems.js'
import { EXDB } from './exercises.js'

const PROF = { trainSystem: 'hypertrophy' }
const OFF_PROF = { trainSystem: 'off' }
const EMPTY = {}

describe('training-systems', () => {
  it('reads the body parts that get real rest as the compound ones', () => {
    expect(isCompoundLift(EXDB.find(e => e.bp === 'upper legs').id)).toBe(true)
    expect(isCompoundLift(EXDB.find(e => e.bp === 'chest').id)).toBe(true)
    expect(isCompoundLift(EXDB.find(e => e.bp === 'lower arms').id)).toBe(false)
    expect(isCompoundLift('not-an-exercise')).toBe(false)
  })

  it('has the known systems in order', () => {
    expect(SYSTEM_LIST).toEqual(['off', 'linear', 'greyskull', 'double', 'hypertrophy', 'strength'])
    expect(SYSTEMS.hypertrophy.policy).toBe('double')
    expect(SYSTEMS.strength.policy).toBe('linear')
  })

  it('systemOf resolves off and invalid to null, known to the object', () => {
    expect(systemOf(EMPTY)).toBeNull()
    expect(systemOf(OFF_PROF)).toBeNull()
    expect(systemOf({ trainSystem: 'unknown' })).toBeNull()
    expect(systemOf(PROF)).toBe(SYSTEMS.hypertrophy)
    expect(systemIdOf(PROF)).toBe('hypertrophy')
    expect(systemIdOf(EMPTY)).toBeNull()
    expect(isSystemOn(PROF)).toBe(true)
    expect(isSystemOn(EMPTY)).toBe(false)
  })

  it('policyOf picks per mode and returns null when mode not allowed', () => {
    const hyp = SYSTEMS.hypertrophy
    const str = SYSTEMS.strength
    expect(policyOf(hyp, 'reps')).toBe('double')
    expect(policyOf(hyp, 'time')).toBeNull()
    expect(policyOf(hyp, 'cardio')).toBeNull()
    expect(policyOf(str, 'reps')).toBe('linear')
    expect(policyOf(null, 'reps')).toBeNull()
  })

  it('volumeClassOf has sensible defaults', () => {
    expect(volumeClassOf('quadriceps')).toBe('large')
    expect(volumeClassOf('deltoids')).toBe('medium')
    expect(volumeClassOf('forearm')).toBe('small')
    expect(volumeClassOf('nonexistent')).toBe('medium')
  })

  it('muscleTargetFor returns per-class numbers or null', () => {
    const hyp = SYSTEMS.hypertrophy
    expect(muscleTargetFor(hyp, 'quadriceps')).toBe(22)
    expect(muscleTargetFor(hyp, 'deltoids')).toBe(16)
    expect(muscleTargetFor(hyp, 'forearm')).toBe(10)
    expect(muscleTargetFor(null, 'quadriceps')).toBeNull()
    expect(muscleTargetFor(SYSTEMS.off, 'quadriceps')).toBeNull()
  })

  it('repBandFor returns null when unset or nonsense', () => {
    expect(repBandFor(SYSTEMS.hypertrophy)).toEqual([10, 15])
    expect(repBandFor(SYSTEMS.linear)).toBeNull()
    expect(repBandFor(SYSTEMS.off)).toBeNull()
    expect(repBandFor({ repBand: [10] })).toBeNull()
    expect(repBandFor({ repBand: [12, 8] })).toBeNull()
    expect(repBandFor({ repBand: [0, 8] })).toBeNull()
  })

  it('restSecFor splits on the exercise being a big lift, and is null with no system', () => {
    const squat = EXDB.find(e => e.bp === 'upper legs').id
    const curl = EXDB.find(e => e.bp === 'lower arms').id
    expect(restSecFor(SYSTEMS.strength, squat)).toBe(180)
    expect(restSecFor(SYSTEMS.strength, curl)).toBe(90)
    expect(restSecFor(SYSTEMS.off, squat)).toBeNull()
    // linear does name rests; what it leaves unset is the band and the cap.
    expect(restSecFor(SYSTEMS.linear, curl)).toBe(75)
    // An exercise the dataset does not know is treated as isolation: the shorter rest.
    expect(restSecFor(SYSTEMS.strength, 'not-an-exercise')).toBe(90)
  })

  it('presetInc prefers exercise own inc, scales heavy lifts, and follows the unit', () => {
    const hyp = SYSTEMS.hypertrophy
    const light = { id: '0001' }        // a press
    const heavy = { id: '0020' }        // a lower-body lift
    expect(presetInc(light, hyp, 'kg')).toBe(2.5)
    expect(presetInc(light, hyp, 'lb')).toBe(5)
    expect(presetInc(heavy, hyp, 'kg')).toBe(5)
    expect(presetInc(heavy, hyp, 'lb')).toBe(10)
    expect(presetInc({ ...light, inc: 1.25 }, hyp, 'kg')).toBe(1.25)
    expect(presetInc(light, SYSTEMS.off, 'kg')).toBeNull()
  })

  it('applySystemToRoutine writes conservatively and clears on null', () => {
    const r1 = { id: 'r1', ex: [] }
    const { routine: w1 } = applySystemToRoutine(r1, SYSTEMS.hypertrophy)
    expect(w1.prog).toBe('double')
    expect(w1.systemApplied).toBe('hypertrophy')

    const r2 = { id: 'r2', ex: [], prog: 'linear' }
    const res2 = applySystemToRoutine(r2, SYSTEMS.hypertrophy)
    expect(res2.routine.prog).toBe('linear') // different policy, skipped
    expect(res2.skipped).toContain('linear')

    const r3 = { id: 'r3', ex: [], prog: 'double', systemApplied: 'hypertrophy' }
    const res3 = applySystemToRoutine(r3, null)
    expect(res3.routine.prog).toBeUndefined()
    expect(res3.routine.systemApplied).toBeUndefined()
  })
})
