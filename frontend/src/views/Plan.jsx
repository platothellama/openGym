import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { uid, exCount, routineCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, dayAddRoutineSheet, starterPlanSheet, planToolsSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Stepper } from '../components/ui.jsx'
import SwipeToDelete from '../components/SwipeToDelete.jsx'
import { deleteRoutine } from '../lib/routines.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { numberedSlotsOf, syncFrequency, requiredDaysOf, optionalDaysOf, maxOptionalFor } from '../lib/week-plan.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)

  /* The Coach's only entry point in the app. Its screens have existed since the UI landed and
     nothing linked to them, so the feature was reachable only by typing the URL — enabled,
     configured, and invisible. The same predicate every other Coach surface uses gates it, so
     an instance without the feature sees exactly the Plan screen it saw before. */
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  // Swap with the neighbour, the way the routine editor moves an exercise. `S.routines` is the
  // one order the whole app reads, so this is all there is to it (#142).
  const moveRoutine = (i, delta) => update(s => {
    const to = i + delta
    if (to < 0 || to >= s.routines.length) return
    const [moved] = s.routines.splice(i, 1)
    s.routines.splice(to, 0, moved)
  })

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  // The week is a frequency, not a list of named days: the steppers above are how it is set, and
  // syncFrequency lays the days out (lib/week-plan.js). Existing assignments are carried across
  // rather than rebuilt, so nudging the count never silently moves a routine. Each stepper passes
  // the *other* count through unchanged — they are two dials on one week, not two.
  const slots = numberedSlotsOf(S)
  // Required days that have something on them — the "3 planned" under the dial, as opposed to
  // the 3 the dial is set to. The two differ whenever a slot is still empty, which is the state
  // that most needs saying out loud.
  const planned = slots.filter(s => !s.optional && S.week[s.day]?.length).length
  const reqCount = slots.filter(s => !s.optional).length
  const optCount = slots.filter(s => s.optional).length
  const setDays = days => update(s => syncFrequency(s, { days, optional: Math.min(optionalDaysOf(s).length, maxOptionalFor(days)) }))
  const setOptional = optional => update(s => syncFrequency(s, { days: requiredDaysOf(s).length, optional }))

  // Pull one routine off a day. The day itself stays a slot — reducing the frequency is what
  // removes a day, and a required slot with nothing on it is a hole in the plan, not a rest day.
  const removeFromDay = (d, rid) => update(s => {
    const next = [].concat(s.week[d] || []).filter(id => id !== rid)
    if (next.length) s.week[d] = next; else delete s.week[d]
  })

  // The same confirmation and the same delete as RoutineEdit's "Delete routine" button, minus
  // its navigation back to /plan, which this screen already is.
  const confirmDelete = r => confirmSheet({
    title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => { deleteRoutine(s, r.id) })
  })

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    {showCoach && <button className="coach-cta" onClick={() => nav('/coach')}>
      <span className="coach-cta-av"><Icon name="sparkles" /></span>
      <span className="coach-cta-t">
        <b>{t('Coach')}</b>
        <span>{t('Plan design and reviews, from your own training')}</span>
      </span>
      <Icon name="chevronRight" className="coach-cta-chev" />
    </button>}

    <div className="cols"><div>
      <h4 className="sec">{t('How often')}</h4>
      <div className="list">
        <div className="freq">
          <div className="grow">
            <div className="tt">{t('Days a week')}</div>
            <div className="ss">{planned
              ? t('{0} planned', routineCount(planned))
              : t('Nothing scheduled on them yet.')}</div>
          </div>
          <Stepper value={reqCount} min={1} max={7} onChange={setDays} />
        </div>
        <div className="freq">
          <div className="grow">
            <div className="tt">{t('Optional days')}</div>
            <div className="ss">{reqCount >= 7
              ? t('No room left in a seven-day week — drop a required day to make one.')
              : t('Train them if you can - skipping one is not a missed session.')}</div>
          </div>
          {/* Bounded by the room the required days leave, so the dial cannot be wound to a week
              with more days in it than there are days. */}
          <Stepper value={optCount} min={0} max={maxOptionalFor(reqCount)} onChange={setOptional} />
        </div>
      </div>

      <h4 className="sec" style={{ marginTop: 22 }}>{t('Week schedule')}</h4>
      {!slots.length && <div className="empty">{t('No days yet.')}<br />{t('Set how often you train above, or load a plan.')}</div>}
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {slots.map(({ day, optional, n }) => {
          const dayRoutines = [].concat(S.week[day] || []).map(id => S.routines.find(x => x.id === id)).filter(Boolean)
          // The row is a session, so it is titled as one. A weekday here said "Monday" for a slot
          // the frequency picked out of a spread table, and it stayed on screen saying "Monday"
          // after a stepper moved it — the one number the person set is the count, so the count is
          // what the week is listed as. Optional days number within themselves, so the required
          // sessions below stay Day 1..Day n whatever the optional dial is set to.
          const dayTitle = <>{optional ? t('Optional day {0}', n) : t('Day {0}', n)}</>
          // An empty day stays one tappable row → pick its routine. It is an empty *slot*, not a
          // rest day: the frequency above is what says this day is meant to be trained.
          if (!dayRoutines.length) return <div key={day} className="item" {...tappable(() => dayAssignSheet(day))}>
            <div className="grow"><div className="tt">{dayTitle}</div></div>
            <span className="tag">{t('Empty')}</span>
            <Icon name="chevronRight" className="chev" /></div>
          // A populated day: always-visible routine sub-rows + inline ✕. Adding a second routine
          // is a small ＋ in the day's header, centred over the ✕ column (#276): a full-width
          // "＋ Add routine" under every planned day made the week read as a list of buttons,
          // when most people train one routine a day. The ＋ keeps the option for those who don't.
          return <div key={day} className="item" style={{ display: 'block', padding: '10px 14px', ...(optional ? { opacity: .78 } : {}) }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="tt">{dayTitle}</div>
              <div className="row" style={{ gap: 8 }}>
                <div className="small dim">{routineCount(dayRoutines.length)}</div>
                <button className="iconbtn sm" aria-label={t('Add routine')} title={t('Add routine')}
                  style={{ width: 30, height: 30, margin: '-5px 3px', fontSize: 15 }}
                  onClick={() => dayAddRoutineSheet(day)}><Icon name="plus" /></button>
              </div>
            </div>
            {dayRoutines.map(r => <div key={r.id} className="row" style={{ gap: 8, padding: '4px 0 4px 8px' }}>
              <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name={glyphOf(r.emoji)} /></span>
              <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
              <button className="iconbtn sm" aria-label={t('Remove')} onClick={() => removeFromDay(day, r.id)}><Icon name="xmark" /></button>
            </div>)}
          </div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map((r, i) => <SwipeToDelete key={r.id} className="item"
        deleteLabel={t('Delete routine')} onDelete={() => confirmDelete(r)} {...tappable(() => nav('/plan/r/' + r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {/* The order of this list is the order of `S.routines`, and every other screen reads the
            same array — the Start screen, the day-assignment sheets, the routine pickers. So
            moving a routine here moves it everywhere, which is what the request asked for (#142). */}
        {S.routines.length > 1 && <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
          <button className="iconbtn" aria-label={t('Move up')} title={t('Move up')} disabled={i === 0}
            style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }}
            onClick={ev => { ev.stopPropagation(); moveRoutine(i, -1) }}><Icon name="chevronUp" /></button>
          <button className="iconbtn" aria-label={t('Move down')} title={t('Move down')} disabled={i === S.routines.length - 1}
            style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }}
            onClick={ev => { ev.stopPropagation(); moveRoutine(i, 1) }}><Icon name="chevronDown" /></button>
        </div>}
        <Icon name="chevronRight" className="chev" /></SwipeToDelete>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
      </>}
    </div></div>
  </>
}
