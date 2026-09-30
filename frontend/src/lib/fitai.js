import { api } from './api.js'
import { t } from './i18n.js'

// Client side of the FitAI bridge. Everything here is presentation-shaped:
// the user_id check mirrors the server's (api/fitai.js) so a typo is caught
// before a request, and the status call goes to our own server — the Supabase
// key never reaches the browser.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A pasted FitAI user id, trimmed — or '' when there is nothing usable. */
export const normalizeFitaiUserId = v => (typeof v === 'string' ? v.trim() : '')

export const isFitaiUserId = v => UUID_RE.test(normalizeFitaiUserId(v))

/** Ask our server whether this FitAI id resolves and what it holds. */
export const fitaiStatus = userId => api('/api/fitai/status?user_id=' + encodeURIComponent(normalizeFitaiUserId(userId)))

/** N-day aggregates for the linked id (api/fitai.js summaryFor). */
export const fitaiSummary = (userId, days = 7) =>
  api('/api/fitai/summary?user_id=' + encodeURIComponent(normalizeFitaiUserId(userId)) + '&days=' + encodeURIComponent(days))

/** One day of fuel + glucose + fasting + activity incl. sleep/HR (api/fitai.js dayFor). */
export const fitaiDay = (userId, date) =>
  api('/api/fitai/day?user_id=' + encodeURIComponent(normalizeFitaiUserId(userId)) + (date ? '&date=' + encodeURIComponent(date) : ''))

/** One readiness line in the lifter's language — shared by the Home fuel card
 * and the Stats fatigue note so the two never word the same flag differently. */
export const fuelLineText = l => l.kind === 'fasted'
  ? t('Fasted {0}h — heavy sets will feel harder', l.hours)
  : l.kind === 'deficit'
    ? t('{0} kcal under target this week', l.kcal)
    : t('{0}g short of your protein target', l.grams)

/** Chat lines for the Coach intake bubble: the same fuel block the plan job
 * sends (api/fitai.js summaryFor, bounded by cleanFitai), in the lifter's
 * words. Pure over the summary so it stays testable without a server.
 * Empty summary (or no logs at all) reads as [] — the caller renders its
 * own "linked but empty" note instead of an empty list. */
export function fitaiChatLines(s) {
  if (!s || typeof s !== 'object') return []
  const lines = []
  const nut = s.nutrition || {}
  const targets = s.targets || {}
  if (nut.daysLogged > 0) {
    const avg = nut.kcalAvg ?? null
    const tgt = targets.calories ?? null
    if (avg != null && tgt != null) lines.push(t('FitAI food: {0} kcal/day avg vs {1} target ({2} days logged)', avg, tgt, nut.daysLogged))
    else if (avg != null) lines.push(t('FitAI food: {0} kcal/day avg ({1} days logged)', avg, nut.daysLogged))
    else lines.push(t('FitAI food: {0} days logged', nut.daysLogged))
    if (nut.proteinAvg != null) {
      lines.push(targets.protein != null
        ? t('Protein: {0}g/day avg vs {1}g target', nut.proteinAvg, targets.protein)
        : t('Protein: {0}g/day avg', nut.proteinAvg))
    }
  }
  const weight = s.body?.weightKg ?? s.profile?.weight ?? null
  const scan = s.body?.scan || null
  const comp = []
  if (weight != null) comp.push(t('{0} kg', weight))
  if (scan?.bodyFatPct != null) comp.push(t('{0}% body fat', scan.bodyFatPct))
  if (scan?.leanKg != null) comp.push(t('{0} kg lean', scan.leanKg))
  if (comp.length) lines.push(t('Body: {0}', comp.join(' · ')))
  const glu = s.glucose || {}
  if (glu.n > 0) {
    const bits = []
    if (glu.fastingAvg != null) bits.push(t('fasting avg {0}', glu.fastingAvg))
    if (glu.latest?.value != null) bits.push(t('latest {0}', glu.latest.value))
    lines.push(t('Glucose: {0} readings', glu.n) + (bits.length ? ' (' + bits.join(', ') + ')' : ''))
  }
  const fst = s.fasting || {}
  if (fst.sessions > 0 || fst.active) {
    const done = fst.completed ?? 0
    lines.push(fst.active?.protocol
      ? t('Fasting: {0}/{1} done, {2} running', done, fst.sessions, fst.active.protocol)
      : t('Fasting: {0}/{1} done', done, fst.sessions))
  }
  const act = s.activity || {}
  if (act.stepsAvg != null) lines.push(t('Steps: {0}/day avg', act.stepsAvg))
  return lines
}

/** One line for the Settings row: what the last check found. */
export function fitaiStatusLine(s) {
  if (!s) return null
  const bits = []
  if (s.targets?.calories) bits.push(s.targets.calories + ' kcal')
  if (s.targets?.protein) bits.push(s.targets.protein + 'g protein')
  if (s.lastFoodDate) bits.push('last log ' + s.lastFoodDate)
  else bits.push('no food logs yet')
  if (s.hasGlucose) bits.push('glucose')
  if (s.hasFasting) bits.push('fasting')
  return bits.join(' · ')
}

/* ---------- session cache for screens ----------
 * The server already caches for 5 minutes; this keeps a screen from asking
 * twice (mount + effect re-run) and from asking at all when unlinked. In-flight
 * requests are shared, so three cards mounting at once make one call. Test-only
 * reset via _resetFitaiCache. */
const CACHE_MS = 2 * 60 * 1000
const memo = new Map()
export const _resetFitaiCache = () => memo.clear()

const cached = (key, now, run) => {
  const hit = memo.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.p
  // Neither a rejection nor a null answer may stick: the next try re-asks.
  const p = run().then(
    v => (v == null ? (memo.delete(key), v) : v),
    () => { memo.delete(key); return null }
  )
  memo.set(key, { at: now, p })
  return p
}

/** The linked id's N-day summary, or null when unlinked. Never throws for a
 * missing link — screens render nothing instead of an error. */
export const getFitaiSummary = (userId, days = 7, now = Date.now()) => {
  const id = normalizeFitaiUserId(userId)
  if (!isFitaiUserId(id)) return Promise.resolve(null)
  return cached(`summary:${id}:${days}`, now, () => fitaiSummary(id, days))
}

/** One linked day, or null when unlinked or unreachable. */
export const getFitaiDay = (userId, date, now = Date.now()) => {
  const id = normalizeFitaiUserId(userId)
  if (!isFitaiUserId(id)) return Promise.resolve(null)
  return cached(`day:${id}:${date || ''}`, now, () => fitaiDay(id, date))
}
