import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { getFitaiSummary, fuelLineText } from '../lib/fitai.js'
import { fuelReadiness } from '../lib/coach-insights.js'

// Home's fuel card: what the linked FitAI food logs say about this week, and
// the one-line readiness read the Coach itself uses. Read-only to the last
// pixel — nothing here writes, to either app. Unlinked profiles render
// nothing at all, so every existing Home test reads exactly what it did.

const dotOf = state => state === 'fueled' ? 'var(--green)' : state === 'fasted' ? 'var(--orange)' : 'var(--yellow)'

export default function FuelCard({ userId }) {
  const [summary, setSummary] = useState(undefined)   // undefined = loading, null = unreachable
  useEffect(() => {
    if (!userId) return
    let live = true
    setSummary(undefined)
    getFitaiSummary(userId, 7).then(s => { if (live) setSummary(s) })
    return () => { live = false }
  }, [userId])
  if (!userId) return null
  if (summary === undefined) return <div className="card"><div className="muted small">{t('Checking fuel…')}</div></div>
  if (!summary) return <div className="card"><div className="dim small">{t('Could not reach FitAI right now.')}</div></div>

  const nut = summary.nutrition || {}
  const ready = fuelReadiness(summary)
  const target = summary.targets?.calories
  return <div className="card">
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Fuel')}</h2>
      <span className="small muted">{t('from FitAI')}</span>
    </div>
    {!nut.daysLogged ? <div className="muted small">{t('No food logs in the last 7 days.')}</div> : <>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <span aria-label={ready ? ready.state : ''} style={{ width: 9, height: 9, borderRadius: '50%', background: dotOf(ready?.state), flexShrink: 0 }} />
        <div className="big">{nut.kcalAvg ?? '–'} <span className="muted" style={{ fontSize: '1rem' }}>/ {target ?? '–'} {t('kcal')}</span></div>
        <span className="dim small" style={{ marginInlineStart: 'auto' }}>{t('{0} days logged', nut.daysLogged)}</span>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {nut.proteinAvg ?? '–'}g / {summary.targets?.protein ?? '–'}g {t('protein')}
        {summary.activity?.sleepAvgH != null ? <> · {summary.activity.sleepAvgH}{t('h sleep')}</> : null}
        {summary.activity?.restingHrAvg ? <> · {t('RHR')} {summary.activity.restingHrAvg}</> : null}
        {summary.activity?.stepsAvg ? <> · {summary.activity.stepsAvg} {t('steps/day')}</> : null}
      </div>
      {(ready?.lines || []).map((l, i) => <div key={i} className="small" style={{ marginTop: 4 }}>{fuelLineText(l)}</div>)}
    </>}
    <div className="dim small" style={{ marginTop: 6 }}>{t('Details live in FitAI — openGym only reads.')}</div>
  </div>
}
