// Equipment answers for the Coach intake: the taxonomy chips plus free text.
//
// The exercise catalogue owns 28 `eq` values (lib/equipment.js ALL_EQUIPMENT). The intake
// used to show only the 14 most common, so a home gym with a pull-up bar, a rower or a
// trap bar had no chip to tap and nowhere to write it. This module is the shared parsing
// for the "anything else" textarea and for suggestions coming back from a gym-photo scan:
//
//   - KNOWN is the taxonomy, most common first (imported, not copied).
//   - parseOther(text) splits free text on commas/newlines into clean items.
//   - splitKnownUnknown(list) keeps stored profiles editable: values the taxonomy no
//     longer contains (or never did) come back as removable "custom" chips instead of
//     vanishing.
//   - mergeScan(profile, suggestion) folds an AI suggestion into a profile without ever
//     dropping what the person already chose — a scan only adds, the person removes.
import { ALL_EQUIPMENT } from './equipment.js'

export const KNOWN_EQUIPMENT = ALL_EQUIPMENT
const knownSet = new Set(ALL_EQUIPMENT.map(e => String(e).toLowerCase()))

export const OTHER_MAX_ITEMS = 10
export const OTHER_MAX_CHARS = 300

// "trx,  pull-up bar\nrower" -> ["trx", "pull-up bar", "rower"]. Bounded in count and in
// total characters, because the whole profile rides into an AI prompt the instance pays for.
export function parseOther(text) {
  if (typeof text !== 'string') return []
  const seen = new Set()
  const out = []
  for (const raw of text.split(/[,;\n]+/)) {
    const item = raw.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!item) continue
    const key = item.toLowerCase()
    if (knownSet.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= OTHER_MAX_ITEMS) break
  }
  return out
}

// A stored `equipment` array can hold anything: an older build wrote only taxonomy values,
// but a photo scan or an import can leave anything else in there. Known values stay chips,
// the rest come back as custom chips so they can be removed rather than silently dropped.
export function splitKnownUnknown(list) {
  const known = []
  const custom = []
  for (const e of Array.isArray(list) ? list : []) {
    if (typeof e !== 'string' || !e) continue
    if (knownSet.has(e.toLowerCase())) { if (!known.includes(e)) known.push(e) }
    else if (!custom.includes(e)) custom.push(e)
  }
  return { known, custom }
}

// Fold a scan suggestion into the current answers. Additive only: taxonomy hits tick their
// chips, unknown hits append to the free-text field (deduped, bounded). Returns a patch
// for the intake state, never a whole profile.
export function mergeScan(p, suggestion) {
  const cur = Array.isArray(p?.equipment) ? [...p.equipment] : []
  const have = new Set(cur.map(e => String(e).toLowerCase()))
  const curOther = typeof p?.equipmentOther === 'string' ? p.equipmentOther : ''
  const otherItems = parseOther(curOther)
  const otherHave = new Set(otherItems.map(e => e.toLowerCase()))

  const eq = Array.isArray(suggestion?.equipment) ? suggestion.equipment : []
  const ot = Array.isArray(suggestion?.other) ? suggestion.other : []
  const addOther = []
  for (const raw of [...eq, ...ot]) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const item = raw.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!item) continue
    const key = item.toLowerCase()
    if (have.has(key) || otherHave.has(key)) continue
    if (knownSet.has(key)) {
      // Keep the taxonomy's own casing so chips match.
      const canonical = KNOWN_EQUIPMENT.find(e => e.toLowerCase() === key) || item
      cur.push(canonical)
      have.add(key)
    } else if (otherItems.length + addOther.length < OTHER_MAX_ITEMS) {
      addOther.push(item)
      otherHave.add(key)
    }
  }
  const nextOther = [...otherItems, ...addOther].join(', ').slice(0, OTHER_MAX_CHARS)
  return { equipment: cur, equipmentOther: nextOther }
}
