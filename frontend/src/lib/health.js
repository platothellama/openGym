// Wearable health data via Health Connect (Android Capacitor build only).
//
// Google Fit APIs are deprecated end-2026 with no new signups — the supported on-device
// path is Health Connect, bridged by @capacitor/health-fitness (HealthKit on iOS later).
// The browser PWA cannot reach Health Connect at all, so every native entry point here
// no-ops off the mobile Android build and the UI shows an "Android app only" fallback.
//
// Design rules (repo constraints):
// - Dependency-light: the plugin is only ever dynamically imported behind MOBILE, like
//   every other Capacitor import in lib/mobile.js, so the web bundle never carries it.
// - Privacy/opt-in: nothing is read unless S.health.on is true (Settings toggle).
// - Sync-safe: only the decimated summary is persisted onto w.health. Raw per-second
//   samples would bloat state-<uid>.json past proxy upload limits (413 path in useStore).
// - Pure + tested: summarize/decimate/sanitize are framework-free; the plugin calls are
//   the thin async edge around them.
import { MOBILE } from './mobile.js'

// Max HR curve points kept on a finished workout. One point per ~minute of even a long
// session keeps the record under a few KB.
export const HEALTH_CURVE_MAX = 60
// Live poll cadence while a session runs. Wearables sync to Health Connect with latency,
// so "live" means the recent window, not beat-to-beat.
export const HEALTH_POLL_MS = 30000
// Health Connect requires a real, publicly-reachable https:// privacy-policy URL on its
// permissions screen. It lives in android/healthfitness.config.json (privacyPolicyUrl),
// baked into the APK by the plugin's cap-sync hook — not passed at runtime. This const
// only documents which URL that is, so forks repointing their app identity find it.
export const HEALTH_PRIVACY_URL = 'https://opengym.duarte-santos.ch'

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---- pure: summarize -------------------------------------------------------

/** Average / max / min of BPM samples. Nulls when there is nothing usable. */
export function summarizeHr(samples) {
  const vals = (Array.isArray(samples) ? samples : [])
    .map(s => num(s?.y ?? s?.bpm ?? s?.value))
    .filter(v => v != null && v > 20 && v < 250)
  if (!vals.length) return { avgHr: null, maxHr: null, minHr: null, count: 0 }
  let sum = 0, mx = -Infinity, mn = Infinity
  for (const v of vals) { sum += v; if (v > mx) mx = v; if (v < mn) mn = v }
  return { avgHr: Math.round(sum / vals.length), maxHr: Math.round(mx), minHr: Math.round(mn), count: vals.length }
}

/** Evenly decimate a {t, y} curve to at most maxPts points. Pure, order-preserving. */
export function decimateCurve(samples, maxPts = HEALTH_CURVE_MAX) {
  const pts = (Array.isArray(samples) ? samples : [])
    .filter(s => num(s?.t) != null && num(s?.y ?? s?.bpm ?? s?.value) != null)
    .map(s => ({ t: num(s.t), y: Math.round(num(s.y ?? s.bpm ?? s.value)) }))
    .sort((a, b) => a.t - b.t)
  if (pts.length <= maxPts || maxPts < 1) return maxPts < 1 ? [] : pts
  const step = (pts.length - 1) / (maxPts - 1)
  const out = []
  for (let i = 0; i < maxPts; i++) out.push(pts[Math.round(i * step)])
  return out
}

/**
 * Build the persisted w.health record from live-accumulated samples plus session totals.
 * Returns null when there is nothing worth keeping, so old-shape equality holds.
 */
export function buildHealthSummary({ samples, kcal, steps, spo2Avg, src = 'health-connect' } = {}) {
  const { avgHr, maxHr, minHr, count } = summarizeHr(samples)
  const kcalN = num(kcal), stepsN = num(steps), spo2N = num(spo2Avg)
  if (avgHr == null && kcalN == null && stepsN == null && spo2N == null) return null
  const summary = { src }
  if (avgHr != null) { summary.avgHr = avgHr; summary.maxHr = maxHr; summary.minHr = minHr }
  if (kcalN != null) summary.kcal = Math.round(kcalN)
  if (stepsN != null) summary.steps = Math.round(stepsN)
  if (spo2N != null) summary.spo2Avg = Math.round(spo2N * 10) / 10
  if (count > 0) summary.hrCurve = decimateCurve(samples)
  return summary
}

/**
 * Sanitize a health record read back (sync, backup import, older build). Drops anything
 * non-numeric and caps the curve, so a hand-edited file cannot bloat the state.
 */
export function sanitizeHealth(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null
  const out = {}
  for (const k of ['avgHr', 'maxHr', 'minHr', 'kcal', 'steps']) {
    const n = num(h[k])
    if (n != null) out[k] = Math.round(n)
  }
  const spo2 = num(h.spo2Avg)
  if (spo2 != null) out.spo2Avg = Math.round(spo2 * 10) / 10
  if (typeof h.src === 'string' && h.src) out.src = h.src.slice(0, 32)
  if (Array.isArray(h.hrCurve)) {
    const curve = decimateCurve(h.hrCurve)
    if (curve.length) out.hrCurve = curve
  }
  return Object.keys(out).length ? out : null
}

/** One-line label for lists: "⌀142 · max 168 · 210 kcal", or null when empty. */
export function healthLabel(h) {
  const s = sanitizeHealth(h)
  if (!s) return null
  const parts = []
  if (s.avgHr != null) parts.push(`\u2300142`.replace('142', s.avgHr) + ' bpm')
  if (s.maxHr != null && s.maxHr !== s.avgHr) parts.push(`max ${s.maxHr}`)
  if (s.kcal != null) parts.push(`${s.kcal} kcal`)
  if (s.steps != null) parts.push(`${s.steps} steps`)
  return parts.length ? parts.join(' · ') : null
}

// ---- native edge (dynamic import, Android mobile only) ---------------------
// Shapes follow @capacitor/health-fitness v1: every call takes JSON-encoded strings and
// returns JSON-encoded strings. getData's native date parser only accepts
// "yyyy-MM-dd'T'HH:mm:ssZ" — toISOString()'s fractional seconds must be trimmed.

const isoDate = d => {
  try { return new Date(d).toISOString().split('.')[0] + 'Z' } catch { return null }
}

// Least-privilege read set, mirroring android/healthfitness.config.json.
const READ_PERMS = ['HEART_RATE', 'CALORIES_BURNED', 'STEPS', 'SLEEP', 'OXYGEN_SATURATION', 'WEIGHT']
  .map(Variable => ({ Variable, AccessType: 'READ' }))

/**
 * Walk a parsed getData payload of unknown exact shape and pull out {t, y} points.
 * Handles bucketed aggregates ({ buckets: [{ startDate, value }] }), raw record lists
 * ({ records/data/values: [{ startTime/startDate/date/t, value/bpm/y }] }), and the
 * chart-ready `resultDataPoints` ({ points: [{ x/t, y }] }). Pure, so it is unit-tested
 * against several shapes — the native format only has to match one of them.
 */
export function extractPoints(parsed) {
  const pts = []
  const push = (tRaw, yRaw) => {
    const t = new Date(tRaw).getTime()
    const y = num(yRaw)
    if (Number.isFinite(t) && y != null) pts.push({ t, y })
  }
  const walk = node => {
    if (node == null) return
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (typeof node !== 'object') {
      const y = num(node)
      if (y != null) pts.push({ t: NaN, y })
      return
    }
    // A point-like object: one date-ish key + one value-ish key.
    const tRaw = node.startDate ?? node.startTime ?? node.date ?? node.t ?? node.x ?? node.time
    const yRaw = node.value ?? node.bpm ?? node.y ?? node.average ?? node.avg ?? node.sum ?? node.count
    if (tRaw !== undefined && yRaw !== undefined && (typeof yRaw !== 'object')) {
      push(tRaw, typeof yRaw === 'object' ? null : yRaw)
    }
    for (const key of ['buckets', 'records', 'data', 'values', 'points', 'results', 'samples']) {
      if (node[key] !== undefined) walk(node[key])
    }
  }
  walk(parsed)
  return pts.filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t)
}

/** Sum every numeric aggregate in a parsed getData payload (SUM buckets). */
export function extractTotal(parsed) {
  const pts = extractPoints(parsed)
  if (!pts.length) return null
  return pts.reduce((a, p) => a + p.y, 0)
}

async function queryVariable(HF, Variable, startMs, endMs, { OperationType = 'SUM', TimeUnit = 'MINUTE' } = {}) {
  const StartDate = isoDate(startMs), EndDate = isoDate(Math.max(endMs, startMs + 60000))
  if (!StartDate || !EndDate) return null
  try {
    const r = await HF.getData({
      parameters: JSON.stringify({
        Variable, StartDate, EndDate, TimeUnit, OperationType, TimeUnitLength: 1,
        AdvancedQueryReturnType: 'ALL_DATA', AdvancedQueryResultType: 'RAW_DATA',
      }),
    })
    const out = []
    for (const key of ['results', 'resultDataPoints']) {
      if (typeof r?.[key] === 'string' && r[key]) {
        try { out.push(...extractPoints(JSON.parse(r[key]))) } catch { /* one bad blob skips */ }
      }
    }
    return out
  } catch { return null }
}
async function plugin() {
  if (!MOBILE) return null
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.getPlatform() !== 'android') return null
    const { HealthFitness } = await import('@capacitor/health-fitness')
    return HealthFitness || null
  } catch { return null }
}

/** True only where a Health Connect read can even be attempted. */
export async function healthAvailable() {
  return (await plugin()) != null
}

/**
 * Ask Health Connect for the session-relevant read set. Resolves true when granted.
 * The privacy-policy URL Health Connect requires lives in
 * android/healthfitness.config.json (baked into the APK by the cap-sync hook) — nothing
 * is passed at runtime. Uses customPermissions for least privilege instead of the
 * all-variables bundle.
 */
export async function requestHealthPermissions() {
  const HF = await plugin()
  if (!HF) return false
  const off = access => JSON.stringify({ IsActive: false, AccessType: access })
  try {
    await HF.requestHealthPermissions({
      customPermissions: JSON.stringify(READ_PERMS),
      allVariables: off('READ'),
      fitnessVariables: off('READ'),
      healthVariables: off('READ'),
      profileVariables: off('READ'),
      workoutVariables: off('READ'),
    })
    return true
  } catch { return false }
}

/**
 * Read HR samples for [startMs, endMs] as minute buckets averaged by Health Connect
 * (per-second buckets are deprecated there — the query would silently run per-minute
 * anyway). Returns [{t, y}] ascending; [] on any failure (denied, no wearable, no data).
 */
export async function readHrWindow(startMs, endMs) {
  const HF = await plugin()
  if (!HF) return []
  const pts = await queryVariable(HF, 'HEART_RATE', startMs, endMs, { OperationType: 'AVG', TimeUnit: 'MINUTE' })
  return Array.isArray(pts) ? pts : []
}

/** Aggregate calories/steps over a window. Nulls when unreadable. */
export async function readSessionTotals(startMs, endMs) {
  const HF = await plugin()
  if (!HF) return { kcal: null, steps: null }
  const [kcalPts, stepsPts] = await Promise.all([
    queryVariable(HF, 'CALORIES_BURNED', startMs, endMs, { OperationType: 'SUM', TimeUnit: 'MINUTE' }),
    queryVariable(HF, 'STEPS', startMs, endMs, { OperationType: 'SUM', TimeUnit: 'MINUTE' }),
  ])
  const sum = pts => (Array.isArray(pts) && pts.length ? pts.reduce((a, p) => a + p.y, 0) : null)
  return { kcal: sum(kcalPts), steps: sum(stepsPts) }
}

/** Open the Health Connect app/settings screen (Android only). No-op elsewhere. */
export async function openHealthConnect() {
  const HF = await plugin()
  if (!HF) return
  try { await HF.openHealthConnect() } catch { /* nothing to open */ }
}
