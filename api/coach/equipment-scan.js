/* Gym-photo equipment scan: photos in, suggested equipment out.
 *
 * The intake's photo button sends up to 3 client-downscaled JPEG data URLs; this module
 * validates them, asks the configured provider's vision model what gym equipment is visible,
 * and returns taxonomy hits plus free-text extras. Human-in-the-loop by design: the client
 * merges the answer into chips the person reviews — nothing here writes to any profile.
 *
 * Privacy: images are held in memory for the one provider call and never written to disk,
 * the job log, or the synced state. Spending is bounded like any other Coach call: the
 * route checks the daily caps before invoking this.
 */
import { LIBRARY } from './core/library.js';
import { extractJSON } from './core/parse.js';

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_TOTAL_BYTES = 4_000_000;

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

// The taxonomy the intake shows, derived from the catalogue rather than copied — the two
// cannot drift. Most common first, like the intake chips.
export function taxonomy() {
  const count = new Map();
  for (const e of LIBRARY) {
    if (!e || !e.eq) continue;
    count.set(e.eq, (count.get(e.eq) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
}

/** Validate data URLs into { mime, b64, bytes }. Throws with a user-readable message. */
export function parseImages(images) {
  if (!Array.isArray(images) || !images.length) throw new Error('send up to 3 gym photos');
  if (images.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} photos per scan`);
  let total = 0;
  return images.map(raw => {
    if (typeof raw !== 'string') throw new Error('each photo must be an image data URL');
    const m = raw.trim().match(DATA_URL);
    if (!m) throw new Error('each photo must be a JPEG, PNG or WebP data URL');
    const mime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
    const b64 = m[2].replace(/\s+/g, '');
    let bytes;
    try { bytes = Buffer.from(b64, 'base64').length; }
    catch { throw new Error('a photo could not be read'); }
    if (!bytes || bytes > MAX_IMAGE_BYTES) throw new Error('a photo is too large — the app downscales before sending');
    total += bytes;
    if (total > MAX_TOTAL_BYTES) throw new Error('the photos together are too large');
    return { mime, b64, bytes };
  });
}

const SCAN_SYSTEM = 'You identify gym equipment from photos. Output is JSON and nothing else.';

export function scanPrompt(tax, lang) {
  return 'Look at the gym photos and list the training equipment clearly visible in them.\n\n' +
    `Known equipment taxonomy (return matches under exactly these names): ${tax.join(' | ')}.\n\n` +
    'Rules:\n' +
    '- Only name equipment you can actually see (machines, racks, benches, free weights, cardio machines, rigs, cables, platforms). If unsure, omit it — a missing item is better than an invented one.\n' +
    '- `equipment`: matches from the taxonomy above, verbatim, most confident first. Omit anything you cannot see. Never guess a brand, model, weight, or use.\n' +
    '- `other`: visible training gear with no taxonomy match (e.g. "pull-up bar", "rower", "climbing rope"), 1-3 words each, at most 10. Empty when everything visible is covered or nothing is clearly visible.\n' +
    '- People, clothing, brand logos and wall posters are never equipment.\n' +
    `- Write nothing in a language: names stay in English exactly as listed${lang ? ` (the app shows ${lang})` : ''}.\n\n` +
    '```json\n{"equipment": ["dumbbell", "barbell"], "other": ["pull-up bar"]}\n```';
}

/** Validate a model's answer against the taxonomy. Unknown equipment strings move to `other`. */
export function cleanScanAnswer(value, tax) {
  const byLower = new Map(tax.map(t => [String(t).toLowerCase(), t]));
  const seen = new Set();
  const equipment = [];
  for (const raw of Array.isArray(value?.equipment) ? value.equipment : []) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim().toLowerCase();
    const canonical = byLower.get(key);
    if (!canonical || seen.has('eq:' + key)) continue;
    seen.add('eq:' + key);
    equipment.push(canonical);
  }
  const other = [];
  const pushOther = raw => {
    if (typeof raw !== 'string') return;
    const item = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!item || item.length < 2) return;
    const key = item.toLowerCase();
    if (byLower.has(key) || seen.has('ot:' + key)) return;
    seen.add('ot:' + key);
    if (other.length < 10) other.push(item);
  };
  for (const raw of Array.isArray(value?.other) ? value.other : []) pushOther(raw);
  // A model that "helpfully" puts an unknown string in `equipment` still reaches the user.
  for (const raw of Array.isArray(value?.equipment) ? value.equipment : []) {
    if (typeof raw !== 'string') continue;
    if (!byLower.has(raw.trim().toLowerCase())) pushOther(raw);
  }
  return { equipment: equipment.slice(0, tax.length), other };
}

/**
 * Run the scan against the configured provider.
 * Returns { ok:true, equipment, other } or { ok:false, errorClass, detail }.
 */
export async function scan({ adapter, cfg, env, model, fetch, images, lang, timeoutMs = 60000 }) {
  if (!adapter || adapter.spawns !== false) return { ok: false, errorClass: 'unsupported' };
  const tax = taxonomy();
  const prompt = scanPrompt(tax, lang);
  let r;
  try {
    r = await adapter.invoke({
      cfg, prompt, system: SCAN_SYSTEM, images,
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          equipment: { type: 'array', items: { type: 'string' } },
          other: { type: 'array', items: { type: 'string' } }
        }
      },
      env, model: model || null, timeoutMs, fetch
    });
  } catch (e) {
    return { ok: false, errorClass: 'provider', detail: String(e?.message || e).slice(0, 200) };
  }
  if (r.timedOut) return { ok: false, errorClass: 'timeout' };
  if (r.spawnError) return { ok: false, errorClass: 'missing', detail: r.stderr?.slice(0, 200) };
  if (r.code !== 0) {
    const err = (r.stderr || r.text || '').toLowerCase();
    const authish = /auth|unauthor|api key|credential|token|401|403|login/.test(err);
    // A model without vision answers 400 ("invalid image", "unsupported") — surfaced as
    // unusable rather than a provider outage, so the UI offers chips instead of retrying.
    if (/image|vision|multimodal|unsupported|invalid.*content/i.test(err)) {
      return { ok: false, errorClass: 'unsupported', detail: (r.stderr || r.text || '').slice(0, 200) };
    }
    return { ok: false, errorClass: authish ? 'auth' : 'provider', detail: (r.stderr || r.text || '').slice(0, 200) };
  }
  const parsed = extractJSON(r.text);
  if (parsed.error) return { ok: false, errorClass: 'unusable' };
  return { ok: true, ...cleanScanAnswer(parsed.value, tax) };
}
