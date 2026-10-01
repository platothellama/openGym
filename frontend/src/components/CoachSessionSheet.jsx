// Today's numbers, from the Coach, while the workout is open.
//
// One question, asked in one place: given the last few sessions and what this morning's recovery
// signals say, what should this session be? The answer is a set of working targets per exercise -
// shown as before → after, applied on a tap, and undoable for the exercises it touched.
//
// It lives in a sheet off the workout's own menu because that is the only place it means anything:
// "today" is the session on the screen. Everything it sends is read off that session as built (the
// readiness overlay, the training system's rest, whatever the user changed by hand), because the
// prescription the Coach is asked to adjust is the one the bar is actually holding.
//
// The answer is rendered in the chat too when it is still pending there. A pending slot is one
// slot per profile and a job outlives the sheet that started it, so an answer asked from here and
// walked away from still has to be somewhere a person can read it and say no to it.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { exLine, fmtSec } from '../lib/history.js'
import { speedUnitOf } from '../lib/speed.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { getFitaiSummary, getFitaiDay } from '../lib/fitai.js'
import {
  coachAvailable, hasConsent, exName, estimateMs, appendChat,
  validateSessionTargets, applySessionProposal, revertSessionTargets, canRevertSession,
} from '../lib/coach.js'
import { buildSessionContext, fitaiDayBlock } from '../lib/session-context.js'
import { useCoachStatus, requestSession, resolvePending, jobErrorText } from '../lib/coach-api.js'
import { Button, Check } from './ui.jsx'
import Icon from './Icon.jsx'
import '../coach.css'

const ui = () => useUI.getState()

/** Open it from the workout's ⋮ menu. */
export const coachSessionSheet = () => ui().openSheet(close => <Sheet close={close} />)

/* ---------------------------------- the sheet ---------------------------------- */

export default function CoachSessionSheet() {
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachLocal = useStore(s => s.coachLocal)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  // The poll runs while this sheet is mounted, which is while the person is in the workout: a
  // session job is minutes long and nobody should be kept on a screen to hear about it.
  const { job, pending, lastError, last, refresh } = useCoachStatus(true)

  const ok = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode: coachLocal?.mode })
  const ready = ok && hasConsent(S) && !!S.coach?.profile
  const answer = pending?.kind === 'session' ? pending : null
  // One pending slot per profile. A suggestion about the plan waiting in the chat is not this
  // sheet's to overwrite, so the ask is held back until it has been decided.
  const waiting = !!pending && !answer

  // The recovery half of the question. Fetched here rather than read off state: it is the bridge's
  // data, the fetch is cached, and a session ask without it still works - it just reasons about
  // the training alone, which the card says out loud rather than hiding.
  const [fuel, setFuel] = useState(undefined)
  const id = S.fitaiUserId
  useEffect(() => {
    if (!id) { setFuel(null); return }
    let live = true
    getFitaiSummary(id, 7).then(s => { if (live) setFuel(s || null) }).catch(() => { if (live) setFuel(null) })
    return () => { live = false }
  }, [id])

  const ask = async () => {
    if (busy) return
    setBusy(true)
    try {
      const s = useStore.getState().S
      const entries = s.active?.entries || []
      // The two single days are what "slept four hours" and "trained fasted" actually rest on; the
      // window's averages do not carry either. Fetched only once a person asks, because a phone on
      // a metered connection should not pay for them by opening a menu.
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const [y, d] = id ? await Promise.all([getFitaiDay(id, yesterday), getFitaiDay(id, today)]) : [null, null]
      const ctx = buildSessionContext(entries, s, {
        routineId: s.active?.routineId || null,
        routineName: s.active?.name || null,
        fitai: fuel || undefined,
        yesterday: fitaiDayBlock(y) || undefined,
        today: fitaiDayBlock(d) || undefined,
      })
      if (!ctx) throw new Error(t('There is nothing to tune yet — start a workout with some exercises in it.'))
      await requestSession(ctx)
      refresh()
    } catch (e) {
      toast(e.message || t('Could not ask the Coach'))
    }
    setBusy(false)
  }

  if (!ready) return null
  const ms = estimateMs(S)
  const outcome = !answer && last?.kind === 'session' ? last : null

  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Today’s numbers')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t('The Coach reads the last few sessions and this morning’s recovery, then sets the targets for this session. It never changes the plan.')}
    </div>

    {answer && <SessionCard p={answer} S={S} update={update} toast={toast} refresh={refresh} />}

    {job && <div className="typing-eta" style={{ padding: '2px 0 10px' }}>
      {t('Reading your training…')}
      {ms ? ' ' + (Math.round(ms / 60000) < 1 ? t('Usually under a minute.') : t('Usually about {0} min.', Math.round(ms / 60000))) : ' ' + t('This usually takes a minute or two.')}
      {' ' + t('You can leave — it keeps going.')}
    </div>}

    {!answer && !job && !!lastError && <div className="pcard-note" style={{ color: 'var(--red)' }}>
      {jobErrorText(lastError.errorClass || outcome?.errorClass, lastError.detail || outcome?.detail)}
    </div>}

    {!answer && !job && outcome?.outcome === 'nochange' && <div className="pcard-note">
      {outcome.reading || t('Nothing to change today — this session runs exactly as the plan built it.')}
    </div>}

    {waiting && !job && <div className="pcard-note">
      {t('The Coach has a suggestion about your plan waiting in the chat. Answer that first, then ask about today.')}
    </div>}

    {!answer && !job && <div className="row" style={{ marginTop: 10 }}>
      <Button variant="primary" icon="lightbulb" onClick={ask} disabled={busy || waiting}>
        {t('Ask the Coach')}
      </Button>
    </div>}

    <Undone S={S} update={update} />
  </>
}

/* ---------------------------------- the undo ---------------------------------- */

/**
 * The take-back, offered for as long as this session still has one.
 *
 * Its own button rather than the chat's: the chat's undo puts the *plan* back, and this one puts
 * the numbers on the screen back. They share a ring, not a meaning.
 */
function Undone({ S, update }) {
  const sessionId = S.active?.id
  if (!canRevertSession(S, sessionId)) return null
  return <div className="row" style={{ marginTop: 10 }}>
    <Button onClick={() => update(s => { revertSessionTargets(s, sessionId) })}>
      {t('Put the old numbers back')}
    </Button>
  </div>
}

/* ---------------------------------- the answer ---------------------------------- */

/**
 * One exercise: what it is now, what the Coach says, and the reason in its own words.
 *
 * The `why` is not decoration - it is the only thing that makes a changed number reviewable
 * instead of arbitrary, so it is the same sentence the model wrote, never a restatement of the
 * arrow beside it.
 */
export function SessionCard({ p, S, update, toast, refresh }) {
  const entries = S.active?.entries || []
  const speedUnit = speedUnitOf(S)
  // Validated against the entries on the screen right now, not against what was sent: a set added
  // or removed while the job ran is why the client is the last gate. A refusal is shown as one,
  // with only the way out that is still true - dismissing it.
  const view = useMemo(() => {
    try { return { ...validateSessionTargets(p, entries) } }
    catch (e) { return { targets: {}, dropped: [], error: e.message || t('That proposal can’t be read.') } }
  }, [p, entries])
  const ids = Object.keys(view.targets)
  const [checked, setChecked] = useState(() => new Set(ids))
  // A different answer replaces the ticks: nobody ticks a check on one proposal and then applies
  // the next one they never saw.
  useEffect(() => { setChecked(new Set(ids)) }, [p?.id])
  const toggle = id => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const apply = () => {
    const take = ids.filter(id => checked.has(id))
    if (!take.length) return discard()
    try {
      update(s => {
        const res = applySessionProposal(s, { ...p, targets: (p.targets || []).filter(tg => take.includes(tg.id)) })
        // The thread keeps the record and the log keeps the numbers, like every other apply.
        if (res.logId) appendChat(s, { role: 'coach', kind: 'applied', ref: res.logId, text: t('Adjusted {0} of today’s exercises.', res.applied) })
      })
      resolvePending({ accepted: take }).catch(() => {})
      toast(t('Updated today’s workout'))
      refresh()
    } catch (e) { toast(e.message || t('Could not apply those changes')) }
  }
  const discard = () => {
    resolvePending({ dismissed: true }).catch(() => {})
    refresh()
  }

  const byId = id => entries.find(e => e && e.id === id) || null

  return <div className="pcard">
    <div className="pcard-hd">
      <div className="pcard-eyebrow">{t('Today’s targets')}</div>
      {!!p.summary && <p className="pcard-sum">{p.summary}</p>}
    </div>

    {view.error && <div className="pcard-note" style={{ color: 'var(--red)' }}>{view.error}</div>}
    {!view.error && !ids.length && <div className="pcard-note">
      {t('Nothing here to change — this session runs exactly as the plan built it.')}
    </div>}

    {ids.map(id => {
      const entry = byId(id)
      const cur = entry?.target || {}
      const next = view.targets[id]
      const fields = Object.keys(next).filter(k => k !== 'why' && next[k] !== undefined)
      return <div key={id} className="pcard-chg">
        <div className="grow">
          <div className="pcard-chg-t">{exName(id)}</div>
          <div className="pcard-chg-v">
            <span className="tag">{exLine(cur, S.unit, speedUnit)}</span>
            <Icon name="chevronRight" style={{ fontSize: 12, color: 'var(--label-3)' }} />
            <span className="tag acc">{exLine({ ...cur, ...pick(next, fields) }, S.unit, speedUnit)}</span>
            {next.restSec != null && cur.restSec !== next.restSec && <span className="tag acc">
              {t('rest')} {next.restSec === 0 ? t('none') : fmtSec(next.restSec)}
            </span>}
          </div>
          <div className="pcard-chg-w">{next.why}</div>
        </div>
        <Check checked={checked.has(id)} onChange={() => toggle(id)} />
      </div>
    })}

    {view.dropped.length > 0 && <div className="pcard-notes">
      {view.dropped.map((d, i) => <div key={i}><Icon name="info" />{droppedText(d)}</div>)}
    </div>}

    <div className="pcard-note">{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
    <div className="pcard-ft">
      {!!ids.length && <Button variant="primary" icon="check" onClick={apply}>
        {checked.size === 1 ? t('Apply 1 exercise') : t('Apply {0} exercises', checked.size)}
      </Button>}
      <Button onClick={discard}>{view.error ? t('Dismiss') : t('Leave it')}</Button>
    </div>
  </div>
}

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]))

/** What was asked for and will not be done, in words. Never silently: a dropped field reads as "the Coach said that" until it is said otherwise. */
function droppedText(d) {
  const who = d.id ? exName(d.id) : t('One exercise')
  if (d.unchanged) return t('{0}: already where the Coach wants it.', who)
  if (d.field === 'weight') return t('{0}: the load was dropped — that exercise carries none today.', who)
  // In the words the app uses for those fields, not the keys the validator counts in.
  if (d.fields?.length) {
    const names = d.fields.map(k => k === 'min' ? t('Minutes') : t('Speed')).join(' & ')
    return t('{0}: {1} come from the exercise, so they stay as they are.', who, names)
  }
  return t('{0}: nothing the app could use.', who)
}