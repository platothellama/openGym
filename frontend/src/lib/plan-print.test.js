// The printable plan (#149) and one routine on its own page (#282).
import { afterEach, describe, it, expect } from 'vitest'
import { planPrintHTML } from './plan-share.js'
import { CASED_NAME_LANGS, EXERCISE_NAME_LANGS, _setLangState } from './i18n-core.js'

const S = {
  unit: 'kg',
  week: { 1: ['push'], 3: ['pull'] },
  routines: [
    { id: 'push', name: 'Push day', ex: [
      { id: '0025', sets: 3, mode: 'reps', reps: 5, weight: 80, note: 'pause on the chest' },
      { id: '0289', sets: 3, mode: 'reps', reps: 10, weight: 24, sg: 'g' },
      { id: '0662', sets: 3, mode: 'reps', reps: 12, weight: 0, sg: 'g' },
    ] },
    { id: 'pull', name: 'Pull day', ex: [{ id: '0027', sets: 4, mode: 'reps', reps: 8, weight: 60 }] },
  ],
}
const text = html => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('planPrintHTML', () => {
  it('prints the week and every routine by default', () => {
    const html = planPrintHTML(S, 'Ana')
    expect(html).toContain('<title>Weekly Training Plan</title>')
    expect(text(html)).toContain('Week schedule')
    expect(text(html)).toContain('Push day')
    expect(text(html)).toContain('Pull day')
  })

  it('prints one routine on its own: its name as the title, its exercises, sets × reps, weights and notes', () => {
    const html = planPrintHTML(S, 'Ana', { routineId: 'push' })
    expect(html).toContain('<title>Push day</title>')
    expect(html).toMatch(/<h1>Push day<\/h1>/)
    const body = text(html)
    // No week around it, and no other routine.
    expect(body).not.toContain('Week schedule')
    expect(body).not.toContain('Weekly Training Plan')
    expect(body).not.toContain('Pull day')
    expect(body).toContain('3 exercises · Ana ·')
    expect(body).toContain('barbell bench press')
    expect(body).toContain('3 × 5 · 80 kg')
    expect(body).toContain('pause on the chest')
    expect(body).toContain('3 × 10 · 24 kg')
    // The superset is printed as one, as in the weekly printout.
    expect(html.match(/class="ss"/g)).toHaveLength(1)
    // The name is the page heading; the routine's block does not repeat it.
    expect(html.match(/Push day/g)).toHaveLength(2)   // <title> and <h1>
  })

  it('prints nothing it does not have for a routine that is gone', () => {
    const body = text(planPrintHTML(S, '', { routineId: 'nope' }))
    expect(body).toContain('No routines yet.')
    expect(body).not.toContain('Push day')
  })
})

// A plan is a frequency, so an empty day is not automatically rest: a day can be waiting for a
// routine, optional, or genuinely a rest. The sheet is where telling the reader to "Rest" a day
// they said they were training does real damage.
describe('planPrintHTML week schedule when days are still empty', () => {
  const S2 = {
    unit: 'kg',
    week: { 1: ['push'], 3: ['pull'] },
    // Four required days, one of which (Saturday) has nothing on it yet; Tuesday optional.
    weekOptional: [2],
    weekRequired: [6],
    routines: S.routines,
  }
  // The day name and the state of that day, per row.
  const rows = html => [...html.matchAll(/<div class="w-day">([^<]+)<\/div><div class="w-r">([\s\S]*?)<\/div>/g)]
    .map(m => [m[1], m[2].replace(/<[^>]+>/g, '').trim()])

  it('names a planned day, an unplaced required day, an optional day and a rest day differently', () => {
    const r = Object.fromEntries(rows(planPrintHTML(S2, 'Ana')))
    expect(r.Tuesday).toBe('Optional')          // optional, and nothing on it
    expect(r.Saturday).toBe('Not planned yet')   // required, still an empty slot
    expect(r.Monday).toBe('Push day')
    expect(r.Sunday).toBe('Rest')               // neither
  })

  it('prints an optional day as its routine once one is on it, not as optional', () => {
    const filled = { ...S2, week: { ...S2.week, 2: ['push'] } }
    const r = Object.fromEntries(rows(planPrintHTML(filled, 'Ana')))
    expect(r.Tuesday).toBe('Push day')
    // And the empty required slot is still waiting, not rest.
    expect(r.Saturday).toBe('Not planned yet')
  })

  it('leaves a fully planned week with nothing to say but the routines', () => {
    const planned = { ...S2, week: { ...S2.week, 6: ['pull'] } }
    const body = text(planPrintHTML(planned, 'Ana'))
    expect(body).not.toContain('Not planned yet')
    expect(body).toContain('Rest')               // the days that are genuinely free
  })
})

// The printout title-cases a name with the same class the screen uses (exerciseNameClass): the
// lower-case packs get it back, German keeps its own casing.
describe('planPrintHTML exercise-name casing per language', () => {
  const packs = import.meta.glob('../exercise-names/*.js', { eager: true, import: 'default' })
  const nameClass = html => html.match(/<div class="ex-n ([^"]*)">/)?.[1].trim()
  afterEach(() => _setLangState('en', {}, null, null))

  for (const lang of EXERCISE_NAME_LANGS) {
    it(`${lang}: ${CASED_NAME_LANGS.includes(lang) ? 'no title-casing on the translated name' : 'the translated name is title-cased'}`, () => {
      _setLangState(lang, {}, null, packs[`../exercise-names/${lang}.js`])
      const html = planPrintHTML(S, 'Ana', { routineId: 'pull' })
      expect(nameClass(html)).toBe(CASED_NAME_LANGS.includes(lang) ? '' : 'capitalize')
      expect(html).toContain('.ex-n.capitalize { text-transform: capitalize; }')
    })
  }
})

// QA 1.3.9: the printout read "3 × 12" for an 8–12 range, left the drop-set out, and glued an
// untranslated body part onto the name ("…Curlupper Legs").
describe('planPrintHTML prints the exercise as it is prescribed', () => {
  const S2 = {
    unit: 'kg', week: {},
    routines: [{ id: 'r', name: 'Legs', ex: [
      { id: '0025', sets: 3, mode: 'reps', reps: 12, repsMin: 8, weight: 60, intensifier: { type: 'dropset', count: 2, pct: 20 } },
      { id: '0027', sets: 1, mode: 'reps', reps: 8, weight: 40, intensifier: { type: 'restpause', totalReps: 20, restSec: 15 } },
    ] }],
  }
  afterEach(() => _setLangState('en', {}, null, null))

  it('keeps the rep range and names the intensifier', () => {
    const body = text(planPrintHTML(S2, '', { routineId: 'r' }))
    expect(body).toContain('3 × 8–12 · 60 kg · Drop-set 2× −20%')
    expect(body).toContain('1 × 8 · 40 kg · Rest-pause 20 reps')
  })

  it('translates the body part and keeps it a separate word', () => {
    _setLangState('de', { chest: 'Brust', 'Drop-set': 'Dropsatz' }, null, null)
    const html = planPrintHTML(S2, '', { routineId: 'r' })
    expect(html).toContain(' <span class="part">Brust</span>')
    expect(text(html)).toContain('Dropsatz 2×')
  })
})
