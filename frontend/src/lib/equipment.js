import { t } from './i18n.js'
import { EXDB } from './exercises-data.js'

// Every equipment value present in the catalogue, most common first — this becomes the
// checklist Settings shows when you build a profile.
export const ALL_EQUIPMENT = (() => {
  const c = {}
  EXDB.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
})()

// Body weight is never gated by a profile — no gym or home setup can take it away from you,
// and every profile should be able to see bodyweight exercises regardless of what's checked.
const ALWAYS_AVAILABLE = 'body weight'

export function activeProfile(S) {
  if (!S.equipFilterOn) return null
  const profiles = S.equipProfiles || []
  return profiles.find(p => p.id === S.activeEquipId) || null
}

// Whether an exercise is usable under the active profile. With filtering off, or no profile
// selected, everything is available — this is purely additive, never a trap that hides your
// whole library because you haven't set anything up yet.
export function exAvailable(S, ex) {
  const p = activeProfile(S)
  if (!p) return true
  if (!ex.eq || ex.eq === ALWAYS_AVAILABLE) return true
  return (p.equipment || []).includes(ex.eq)
}

export function newProfile(name) {
  return { id: 'eq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, equipment: [] }
}

// Custom equipment entries: what people type beyond the catalogue checklist. Matching
// against the taxonomy is case-insensitive and alias-aware, so "DBs" folds onto
// "dumbbell" instead of living beside it as a near-duplicate. The server stores the
// merged list as plain strings, capped at CUSTOM_EQUIPMENT_MAX.

/** Longest single custom entry; longest a stored equipment list may grow. */
export const CUSTOM_EQUIPMENT_MAX_LEN = 40
export const CUSTOM_EQUIPMENT_MAX = 40

// Short hands and renamed gear the dataset never lists under these names. Values are
// canonical taxonomy spellings (checked against ALL_EQUIPMENT at match time).
const EQUIPMENT_ALIASES = {
  db: 'dumbbell', dbs: 'dumbbell',
  kb: 'kettlebell', kbs: 'kettlebell',
  'hex bar': 'trap bar', hexbar: 'trap bar', 'trapbar': 'trap bar',
}

const TAXONOMY = new Map(ALL_EQUIPMENT.map(v => [String(v).toLowerCase(), v]))

/** The taxonomy value a free-typed entry means, or null when it is genuinely custom. */
export function matchKnownEquipment(raw) {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  if (TAXONOMY.has(key)) return TAXONOMY.get(key)
  const alias = EQUIPMENT_ALIASES[key]
  if (alias && TAXONOMY.has(alias)) return TAXONOMY.get(alias)
  // Plain plurals the taxonomy lists singly: cables → cable, boxes → box.
  if (key.endsWith('s')) {
    const singular = key.slice(0, -1)
    if (TAXONOMY.has(singular)) return TAXONOMY.get(singular)
    if (key.endsWith('es')) {
      const esSingular = key.slice(0, -2)
      if (TAXONOMY.has(esSingular)) return TAXONOMY.get(esSingular)
    }
  }
  return null
}

/** Split a textarea into entries on newlines, commas and semicolons — trimmed, no
 * empties, nothing over CUSTOM_EQUIPMENT_MAX_LEN, no case-duplicates (first wins). */
export function parseCustomEquipment(text) {
  if (typeof text !== 'string') return []
  const seen = new Set()
  const out = []
  for (const part of text.split(/[\n,;]+/)) {
    const v = part.trim()
    if (!v || v.length > CUSTOM_EQUIPMENT_MAX_LEN) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** Split a stored list into taxonomy chips vs. custom chips. Alias spellings ("DBs")
 * are not taxonomy values, so once stored they render as custom chips of their own. */
export function splitKnownCustom(list) {
  const known = [], custom = []
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v !== 'string') continue
    ;(TAXONOMY.has(v.trim().toLowerCase()) ? known : custom).push(v)
  }
  return { known, custom }
}

/** Fold typed customs into a stored list: known gear folds onto its taxonomy value,
 * the rest appends verbatim, case-duplicates dropped, capped at CUSTOM_EQUIPMENT_MAX. */
export function mergeCustomEquipment(existing, customs) {
  const out = []
  const seen = new Set()
  const push = v => {
    if (typeof v !== 'string') return
    const entry = v.trim()
    if (!entry) return
    const k = entry.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(entry)
  }
  for (const v of Array.isArray(existing) ? existing : []) push(v)
  for (const v of Array.isArray(customs) ? customs : []) {
    if (out.length >= CUSTOM_EQUIPMENT_MAX) break
    push(typeof v === 'string' && matchKnownEquipment(v) ? matchKnownEquipment(v) : v)
  }
  return out.slice(0, CUSTOM_EQUIPMENT_MAX)
}
