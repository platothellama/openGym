// Girth measurements: what a tape says about a body, as a monthly series of a few sites.
//
// The scale is dominated by water, glycogen and gut contents — from one morning to the next it
// moves more than it moves in a month. Girths are the complement: they do not swing with a glass
// of water, so "waist down, arm up, weight flat" is the reading that separates a recomp from a
// stall, and it is a reading no weight log can produce. It is a reading on a *goal*, though, not a
// direction: the same numbers mean losing fat for one lifter and gaining it for another, so nothing
// here decides which way is progress. `compositionRead` describes the pattern and names both
// readings; the goal, the plan and the lifter decide which one applies.
//
// Stored in **cm**, always, whatever S.unit says. A girth is not a load: S.unit is what the bar is
// weighed in, and switching it to lb must not restate a waist measured in centimetres. The sheet
// converts on the way in and out (CM_PER_IN) and nothing else touches the numbers.

// The tape sites, and where each one is measured. The order is the sheet's own, and the order the
// deltas and charts read, so it is fixed here rather than decided by whoever renders them.
export const SITES = Object.freeze([
  { id: 'neck', label: 'Neck' },
  { id: 'shoulder', label: 'Shoulders' },
  { id: 'chest', label: 'Chest' },
  { id: 'arm', label: 'Biceps' },
  { id: 'waist', label: 'Waist' },
  { id: 'hip', label: 'Hips' },
  { id: 'thigh', label: 'Thigh' },
  { id: 'calf', label: 'Calf' },
])

export const SITE_IDS = Object.freeze(SITES.map(s => s.id))

/**
 * How much a site has to move before the app will call it a change. A tape measure is not a
 * laboratory instrument: the same tape, on the same morning, reads a centimetre either way, and
 * the error is *worse* where the limb moves — the bicep is measured mid-contraction on one pass
 * and relaxed on the next, and a waist read after a meal reads differently again. A threshold
 * under this would show arrows on noise, and a user who sees an arrow on noise learns to ignore
 * the feature.
 */
export const NOISE_CM = 1

/**
 * The shortest gap between two entries before their difference means anything at all — in either
 * direction. Girths are not like the scale: there is no diurnal swing to average out, but there is
 * no reason to believe a site rebuilt 1.5 cm in nine days either, and a comparison drawn across a
 * gap this short is mostly measuring the difference between two measurement sessions. Anything
 * past this is compared against the *nearest entry at least this far back*, not the previous one.
 */
export const MIN_GAP_DAYS = 28

/** Days between two iso dates, or null if either does not parse. */
export function daysApart(a, b) {
  const t = d => { const ms = Date.parse(`${String(d).slice(0, 10)}T12:00:00`); return Number.isFinite(ms) ? ms : NaN }
  const x = t(a), y = t(b)
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400000) : null
}

/** A site's value in cm, or null for anything that is not a plausible girth. */
function cmOf(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const valuesOf = entry => (entry && typeof entry.v === 'object' && entry.v ? entry.v : {})

/**
 * The entries, oldest first, each carrying only the sites it actually measured and a day that
 * parses. The stored order is not relied on (a profile can arrive from a sync, an import or a
 * hand-edited backup in any order) and an entry with no sites is dropped rather than carried as an
 * empty row, since there is nothing to draw it with.
 */
export function normalizeMeasurements(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(e => {
      if (!e || typeof e.d !== 'string' || Number.isNaN(Date.parse(`${e.d.slice(0, 10)}T12:00:00`))) return null
      const v = {}
      for (const id of SITE_IDS) {
        const cm = cmOf(valuesOf(e)[id])
        if (cm !== null) v[id] = cm
      }
      return Object.keys(v).length ? { d: e.d.slice(0, 10), t: Number(e.t) || 0, v } : null
    })
    .filter(Boolean)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
}

/**
 * The value for every site on a given day, merged into the entry that already holds that day: one
 * measurement per day, the fields re-measured today overwriting the ones left blank on an earlier
 * entry of the same day rather than the whole entry being replaced. An entry whose day already
 * holds every site it is given is left where it is, so re-saving the same numbers does not
 * re-stamp it and win a sync it had no reason to win. Returns a new array; `now` is the edit stamp
 * the day's entry is given (default Date.now), matching what S.bodyweight does.
 */
export function upsertMeasurements(entries, d, v, now = Date.now()) {
  const list = normalizeMeasurements(entries)
  const day = String(d).slice(0, 10)
  // Only the sites actually passed are written; a site left out of `v` keeps whatever the day's
  // entry already held, so filling in a bicep a week after the waist does not erase the waist.
  const given = {}
  for (const id of SITE_IDS) {
    const cm = cmOf((v || {})[id])
    if (cm !== null) given[id] = cm
  }
  if (!Object.keys(given).length) return list
  const idx = list.findIndex(e => e.d === day)
  const same = idx >= 0 && Object.entries(given).every(([id, cm]) => list[idx].v[id] === cm)
  if (same) return list
  if (idx < 0) return [...list, { d: day, t: now, v: given }]
  return list.map((e, i) => i === idx ? { ...e, t: now, v: { ...e.v, ...given } } : e)
}

/** The newest entry, or null. */
export function latestMeasurements(entries) {
  const list = normalizeMeasurements(entries)
  return list.length ? list[list.length - 1] : null
}

/**
 * The entry to compare `entry` against: the newest earlier entry at least MIN_GAP_DAYS back, and
 * null when there is none. Walking back past entries that are too recent is the point — comparing
 * against the previous one when that was yesterday would report a fortnight of change as a day's.
 */
function baselineFor(list, index) {
  const from = list[index].d
  for (let i = index - 1; i >= 0; i--) {
    const gap = daysApart(list[i].d, from)
    if (gap !== null && gap >= MIN_GAP_DAYS) return list[i]
  }
  return null
}

/**
 * One entry read against its baseline: for every site, the change in cm (`change`), the entry's own
 * value (`current`) and what it was compared against (`previous`), and the site as changed or not.
 *
 * A change is reported only when it clears NOISE_CM, and `from`/`to` name the two entries it was
 * read between, so a view can say "over 3 months" rather than implying a fortnight. A site the
 * entry did not measure has no reading and is left out entirely rather than shown as 0 — an absent
 * measurement is not a measurement of nothing.
 */
export function compareEntry(entries, entry) {
  const list = normalizeMeasurements(entries)
  const index = list.findIndex(e => e.d === entry?.d)
  if (index < 0) return null
  const cur = list[index]
  const base = baselineFor(list, index)
  const sites = {}
  for (const id of SITE_IDS) {
    const current = cmOf(cur.v[id])
    if (current === null) continue
    const previous = base ? cmOf(base.v[id]) : null
    const change = previous === null ? null : current - previous
    sites[id] = { current, previous, change, changed: change !== null && Math.abs(change) >= NOISE_CM }
  }
  return { d: cur.d, t: cur.t, from: base?.d || null, to: cur.d, sites }
}

/**
 * The newest entry read against its baseline, or null when there is no entry, or when the newest
 * one has no entry far enough back to compare against yet — the first two months of a tape measure
 * can only accumulate entries, and an honest screen says so instead of inventing a trend.
 */
export function latestComparison(entries) {
  const list = normalizeMeasurements(entries)
  if (list.length < 2) return null
  const cmp = compareEntry(list, list[list.length - 1])
  // No baseline far enough back is the same as no comparison to make, and a caller gets one honest
  // null rather than a report whose every change reads "unknown".
  return cmp && cmp.from ? cmp : null
}

/**
 * What the girths say about the body's composition, as a description of the pattern and nothing
 * more. `growing`/`shrinking` are the limb sites, `narrowing`/`widening` the waist-and-hip ones, and
 * the two moving opposite ways is the reading worth surfacing: a stable scale with the waist down
 * and the arm up is a recomp, and a stable scale with both moving the same way is a bulk or a cut
 * that has simply not moved the scale yet.
 *
 * `value` is one of 'recomp' | 'gaining' | 'cutting' | 'reverse' | 'mixed' | 'stable' | null, and it is a
 * *description of the numbers*, not a verdict: 'gaining' is what a bulk looks like and also what a
 * fat gain looks like, and the goal decides which. null is returned when there is nothing to say —
 * too few entries, no baseline, or no site that cleared the noise floor. A caller must not present
 * null as "no change": a recomp in progress and an unmeasured body are both null here, and only
 * the first is a result.
 */
export function compositionRead(entries) {
  const cmp = latestComparison(entries)
  if (!cmp) return null
  const limbs = ['arm', 'chest', 'shoulder', 'thigh', 'calf']
  const core = ['waist', 'hip']
  const sum = ids => ids.reduce((acc, id) => acc + (cmp.sites[id]?.changed ? cmp.sites[id].change : 0), 0)
  const up = limbs.filter(id => cmp.sites[id]?.changed && cmp.sites[id].change > 0)
  const down = limbs.filter(id => cmp.sites[id]?.changed && cmp.sites[id].change < 0)
  const coreUp = core.filter(id => cmp.sites[id]?.changed && cmp.sites[id].change > 0)
  const coreDown = core.filter(id => cmp.sites[id]?.changed && cmp.sites[id].change < 0)
  const limbSum = sum(limbs), coreSum = sum(core)
  const moved = up.length + down.length + coreUp.length + coreDown.length
  if (!moved) return { value: 'stable', cmp, limbs: 0, core: 0, sites: cmp.sites }
  // The core vetoes a direction rather than being required to prove one. Waist-and-hip moving the
  // *opposite* way to the limbs is the reading worth surfacing — that is a recomp, or the reverse.
  // Moving the same way, or not having moved, leaves the limbs to decide: an arm up and a waist up
  // is a gain, and a waist that was not re-measured says nothing that could argue against one.
  if (up.length && !down.length) {
    return coreDown.length
      ? { value: 'recomp', cmp, limbs: up.length, core: coreDown.length, sites: cmp.sites }
      : { value: 'gaining', cmp, limbs: up.length, core: coreUp.length, sites: cmp.sites }
  }
  if (down.length && !up.length) {
    return coreUp.length
      ? { value: 'reverse', cmp, limbs: down.length, core: coreUp.length, sites: cmp.sites }
      : { value: 'cutting', cmp, limbs: down.length, core: coreDown.length, sites: cmp.sites }
  }
  // No limb site moved at all, but the core did, and the limbs *were* measured — the waist and hips
  // down with every limb flat is what a cut looks like from a tape. Guarded on the limbs having
  // been measured at all: a waist-only entry is not a cut, it is one number.
  const limbMeasured = limbs.some(id => cmp.sites[id] != null)
  if (limbMeasured && !up.length && !down.length) {
    if (coreDown.length) return { value: 'cutting', cmp, limbs: 0, core: coreDown.length, sites: cmp.sites }
    if (coreUp.length) return { value: 'gaining', cmp, limbs: 0, core: coreUp.length, sites: cmp.sites }
  }
  return { value: 'mixed', cmp, limbs: 0, core: 0, sites: cmp.sites }
}

/** Chart points for one site across every entry that measured it, oldest first, one decimal. */
export function siteSeries(entries, id) {
  if (!SITE_IDS.includes(id)) return []
  const points = []
  for (const e of normalizeMeasurements(entries)) {
    const cm = cmOf(e.v[id])
    if (cm === null) continue
    const t = Date.parse(`${e.d}T12:00:00`)
    if (!Number.isFinite(t)) continue
    points.push({ t, y: Math.round(cm * 10) / 10, d: e.d })
  }
  return points
}

/** Every site measured on the newest entry, in SITES order — the sheet's last-tape-in values. */
export function latestBySite(entries) {
  const last = latestMeasurements(entries)
  if (!last) return {}
  const out = {}
  for (const id of SITE_IDS) {
    const cm = cmOf(last.v[id])
    if (cm !== null) out[id] = cm
  }
  return out
}
