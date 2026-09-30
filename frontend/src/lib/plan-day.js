// The training-day tag a session can carry.
//
// The intake schedules generic days — Day 1..N plus one lighter optional day — never
// weekdays. When a session starts, the person can say which one this session is: a
// committed day, or the optional day with the routine ("plan") they chose for it. The
// tag rides on `S.active.planDay` while the session runs and is filed onto the finished
// workout next to `routineIds`, so history and the Coach's read-back know what the
// session was *for*, not just what it contained.
//
// A tag is `{ kind: 'day', n }` (1-based into the plan's days) or `{ kind: 'optional' }`.
// Untagged sessions stay exactly the shape they always were — the field is written only
// when there is a valid tag to keep.
import { t } from './i18n.js'

/** How many generic training days the plan holds, or null when there is no plan to tag against. */
export function trainingDays(S) {
  const p = S?.coach?.profile
  if (p && (p.daysPerWeek || p.optionalDay)) {
    const committed = Math.min(7, Math.max(1, Math.round(p.daysPerWeek ?? 3) || 3))
    const optional = p.optionalDay === true && committed < 7
    return { committed, optional, total: optional ? committed + 1 : committed }
  }
  const scheduled = Object.values(S?.week || {}).filter(ids => ids?.length).length
  if (scheduled > 0) return { committed: Math.min(7, scheduled), optional: false, total: Math.min(7, scheduled) }
  return null
}

/** A tag as the UI hands it over, or null — out-of-range days and unknown shapes never stick.
 * Numbered days run to `committed`: the optional session is its own kind, never a number. */
export function cleanPlanDay(v, days) {
  if (!v || typeof v !== 'object' || !days) return null
  if (v.kind === 'optional') return days.optional ? { kind: 'optional' } : null
  if (v.kind === 'day' && Number.isInteger(v.n) && v.n >= 1 && v.n <= days.committed) {
    return { kind: 'day', n: v.n }
  }
  return null
}

/** What history and the session header show for a filed tag. */
export function planDayLabel(tag) {
  if (!tag || typeof tag !== 'object') return null
  if (tag.kind === 'optional') return t('Optional')
  if (tag.kind === 'day' && Number.isInteger(tag.n) && tag.n >= 1) return t('Day {0}', tag.n)
  return null
}
