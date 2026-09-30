/* FitAI (Supabase) read-only bridge — status probe (Phase 1) + aggregates (Phase 2).
 *
 * openGym never writes to the FitAI project and never stores its key in a
 * profile: the key lives in the environment and every query is filtered by
 * the per-profile `user_id` the person pasted into Settings. The browser never
 * sees the key — it talks to /api/fitai/* on this server, which forwards with
 * the key attached.
 *
 * Dependency-light on purpose: plain fetch, no supabase-js. `fetch` is
 * injectable so the tests never touch the network.
 */

// Supabase auth ids are uuids. Anything else is a typo worth a 400, not a
// round-trip that logs somebody else's prefix on the way out.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFitaiUserId = v => typeof v === 'string' && UUID_RE.test(v.trim());

// Read at call time, not import time, so tests can set env per case and a
// container that gains the variables on restart needs no code change.
// FITAI_* wins; the NEXT_PUBLIC_SUPABASE_* names from the FitAI app itself are
// accepted as fallback so one .env serves both projects.
export function fitaiConfig(over = {}) {
  const env = over.env || process.env;
  const url = String(over.url ?? env.FITAI_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = String(over.key ?? env.FITAI_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '');
  return { url, key };
}
export const fitaiConfigured = (over = {}) => {
  const { url, key } = fitaiConfig(over);
  return !!(url && key);
};

class FitaiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TIMEOUT_MS = 12000;

async function restGet({ url, key }, table, params, fetchFn) {
  const fetchImpl = fetchFn || fetch;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  let r;
  try {
    r = await fetchImpl(`${url}/rest/v1/${table}?${params}`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      ...(ctl ? { signal: ctl.signal } : {})
    });
  } catch (e) {
    throw new FitaiError(502, 'FitAI did not answer in time.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  let body = null;
  try { body = await r.json(); } catch { /* a non-JSON answer is still an upstream failure */ }
  if (!r.ok) {
    // 404 here means "no such table" (instance mispointed), never "unknown user".
    throw new FitaiError(502, 'FitAI answered with an error.');
  }
  return Array.isArray(body) ? body : [];
}

/**
 * Probe one FitAI profile: does the id exist, and what does it hold?
 * @param {string} userId the Supabase auth id pasted into Settings
 * @param {object} opts { url, key, fetch } — fetch is the injectable transport
 */
export async function statusFor(userId, opts = {}) {
  const id = String(userId || '').trim();
  if (!isFitaiUserId(id)) throw new FitaiError(400, 'That does not look like a FitAI user id.');
  const cfg = fitaiConfig(opts);
  if (!cfg.url || !cfg.key) throw new FitaiError(503, 'This instance is not connected to FitAI (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).');
  const fetchFn = opts.fetch || undefined;
  const [profile, latestFood, glucose, fasting] = await Promise.all([
    // profiles is keyed by the auth id itself (no user_id column there).
    restGet(cfg, 'profiles', `select=id,targets_calories,targets_protein,tdee&id=eq.${id}&limit=1`, fetchFn),
    restGet(cfg, 'food_log', `select=date&user_id=eq.${id}&order=date.desc&limit=1`, fetchFn),
    restGet(cfg, 'glucose_logs', `select=id&user_id=eq.${id}&limit=1`, fetchFn),
    restGet(cfg, 'fasting_logs', `select=id&user_id=eq.${id}&limit=1`, fetchFn)
  ]);
  // Profiles are created on first FitAI launch, so a missing row means the id was
  // never used there — say so plainly rather than reporting an empty account.
  if (!profile.length) throw new FitaiError(404, 'No FitAI profile uses that id yet.');
  return {
    ok: true,
    user_id: id,
    targets: {
      calories: profile[0]?.targets_calories ?? null,
      protein: profile[0]?.targets_protein ?? null,
      tdee: profile[0]?.tdee ?? null
    },
    lastFoodDate: latestFood[0]?.date || null,
    hasGlucose: glucose.length > 0,
    hasFasting: fasting.length > 0
  };
}

export { FitaiError };

/* ============================ Phase 2: aggregates ============================
 * On-demand summaries over a day window. PostgREST caps a response at 1000
 * rows, so everything is windowed by date and aggregated here — the server
 * never asks for "all time". Answers are cached for 5 minutes per id+window:
 * food logs change a few times a day, not a few times a minute.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const SUMMARY_MAX_CHARS = 50 * 1024;
const cache = new Map(); // key -> { at, body }
export function clearFitaiCache() { cache.clear(); }
function cacheGet(key, now = Date.now()) {
  const hit = cache.get(key);
  if (!hit || now - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.body;
}
function cacheSet(key, body, now = Date.now()) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, body });
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isFitaiDay = v => typeof v === 'string' && DAY_RE.test(v);
const n = v => (Number.isFinite(+v) ? +v : 0);
const round1 = v => Math.round(v * 10) / 10;
const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
// Query values ride through URLSearchParams so a timestamp's `+00:00` cannot
// turn into a space on the way out (PostgREST would 400 on the day filter).
const qs = obj => new URLSearchParams(obj).toString();
const uidEq = id => `eq.${id}`;
const dayStamp = (day, end) => `${day}T${end ? '23:59:59' : '00:00:00'}+00:00`;
// health_connect_records.data_json arrives as a parsed object (jsonb); older
// exports may carry it as a Python-repr string ("{'count': 264}"), so both
// read here — the pattern is the fallback, not the rule.
const pickNum = (v, k) => {
  if (v && typeof v === 'object') return n(v[k]);
  const m = typeof v === 'string' && v.match(new RegExp(`'${k}'\\s*:\\s*(-?[\\d.]+)`));
  return m ? +m[1] : 0;
};
// First finite number found under any of the keys — the wearable payloads use
// several names for the same thing across record types and app versions.
const pickFirstNum = (v, keys) => {
  if (v && typeof v === 'object') {
    for (const k of keys) {
      const nv = +v[k];
      if (Number.isFinite(nv) && nv !== 0) return nv;
    }
    return 0;
  }
  if (typeof v === 'string') {
    for (const k of keys) {
      const m = v.match(new RegExp(`['"]?${k}['"]?\\s*[:=]\\s*(-?[\\d.]+)`));
      if (m) return +m[1];
    }
  }
  return 0;
};
const HR_KEYS = ['bpm', 'value', 'heart_rate', 'resting_heart_rate', 'resting', 'average', 'avg', 'beats_per_minute', 'bpm_avg'];
// Plausible resting/active heart-rate bounds: anything outside is a bad sample.
const saneHr = v => (Number.isFinite(v) && v >= 20 && v <= 250 ? v : 0);
// One sleep session as hours. Prefers the row's own start/end span (the
// session record is the source of truth); falls back to duration fields in
// data_json for exports that only carry those.
const sleepHoursOf = row => {
  const start = Date.parse(row?.start_time || '');
  const end = Date.parse(row?.end_time || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const h = (end - start) / 3600000;
    if (h > 0 && h <= 16) return h;
  }
  const dj = row?.data_json;
  const hours = pickFirstNum(dj, ['hours', 'hours_slept', 'sleep_hours', 'duration_hours', 'duration_h', 'total_hours', 'asleep_hours']);
  if (hours > 0 && hours <= 16) return hours;
  const mins = pickFirstNum(dj, ['minutes', 'minutes_slept', 'asleep_minutes', 'duration_min', 'duration_minutes', 'total_minutes']);
  if (mins > 0 && mins <= 960) return mins / 60;
  const secs = pickFirstNum(dj, ['seconds', 'duration_seconds', 'duration_s', 'total_seconds']);
  if (secs > 0 && secs <= 57600) return secs / 3600;
  const ms = pickFirstNum(dj, ['duration_ms', 'duration_millis', 'duration_milliseconds']);
  if (ms > 0 && ms <= 57600000) return ms / 3600000;
  return 0;
};
// A sleep session belongs to the morning it ends on — the night you wake from.
const sleepNightOf = row => {
  const end = typeof row?.end_time === 'string' ? row.end_time.slice(0, 10) : null;
  if (end && DAY_RE.test(end)) return end;
  const start = typeof row?.start_time === 'string' ? row.start_time.slice(0, 10) : null;
  return start;
};

function windowOf(days, nowMs) {
  const end = new Date(nowMs);
  const to = end.toISOString().slice(0, 10);
  const from = new Date(nowMs - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function checkedId(userId) {
  const id = String(userId || '').trim();
  if (!isFitaiUserId(id)) throw new FitaiError(400, 'That does not look like a FitAI user id.');
  return id;
}

function checkedCfg(opts) {
  const cfg = fitaiConfig(opts);
  if (!cfg.url || !cfg.key) throw new FitaiError(503, 'This instance is not connected to FitAI (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).');
  return cfg;
}

/**
 * N-day nutrition + metabolic summary for one FitAI id.
 * @param {string} userId
 * @param {object} opts { days (1..31, default 7), url, key, env, fetch, now }
 */
export async function summaryFor(userId, opts = {}) {
  const id = checkedId(userId);
  const cfg = checkedCfg(opts);
  const days = Math.min(31, Math.max(1, Math.round(opts.days ?? 7) || 7));
  const nowMs = opts.now ?? Date.now();
  const key = `summary:${id}:${days}`;
  const hit = cacheGet(key, nowMs);
  if (hit) return hit;
  const fetchFn = opts.fetch || undefined;
  const { from, to } = windowOf(days, nowMs);

  const [profile, foods, glucose, fasting, scans, labs, conditions, steps, kcal, sleepRows, hrRows, rhrRows] = await Promise.all([
    restGet(cfg, 'profiles', qs({ select: 'targets_calories,targets_protein,targets_carbs,targets_fat,tdee,weight,goal,gender,activity_level', id: uidEq(id), limit: 1 }), fetchFn),
    restGet(cfg, 'food_log', qs({ select: 'date,meal_type,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,glycemic_load', user_id: uidEq(id), date: `gte.${from}`, order: 'date.asc', limit: 1000 }), fetchFn),
    restGet(cfg, 'glucose_logs', qs({ select: 'date,value,meal_context', user_id: uidEq(id), date: `gte.${from}`, order: 'date.desc', limit: 300 }), fetchFn),
    restGet(cfg, 'fasting_logs', qs({ select: 'date,protocol,status,planned_duration_min,actual_duration_min,planned_start_at,actual_start_at,actual_end_at', user_id: uidEq(id), date: `gte.${from}`, order: 'date.desc', limit: 40 }), fetchFn),
    restGet(cfg, 'body_scans', qs({ select: 'scanned_at,body_fat_percentage,lean_mass_kg,fat_mass_kg,body_type', user_id: uidEq(id), order: 'scanned_at.desc', limit: 1 }), fetchFn),
    restGet(cfg, 'lab_results', qs({ select: 'biomarker_key,value,unit,flag', user_id: uidEq(id), limit: 200 }), fetchFn),
    restGet(cfg, 'conditions', qs({ select: 'label,code,status', user_id: uidEq(id), limit: 20 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'start_time,data_json', record_type: 'eq.steps', user_id: uidEq(id), start_time: `gte.${dayStamp(from)}`, order: 'start_time.asc', limit: 1000 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'start_time,data_json', record_type: 'eq.active_calories', user_id: uidEq(id), start_time: `gte.${dayStamp(from)}`, order: 'start_time.asc', limit: 1000 }), fetchFn),
    // Recovery signals: sleep sessions and heart rate from the same wearable
    // stream. `in.(…)` covers the record_type spellings FitAI versions have
    // used; unknown spellings simply return no rows, never an error.
    restGet(cfg, 'health_connect_records', qs({ select: 'start_time,end_time,data_json', record_type: 'in.(sleep_session,sleep)', user_id: uidEq(id), start_time: `gte.${dayStamp(from)}`, order: 'start_time.asc', limit: 500 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'start_time,data_json', record_type: 'in.(heart_rate)', user_id: uidEq(id), start_time: `gte.${dayStamp(from)}`, order: 'start_time.asc', limit: 1000 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'start_time,data_json', record_type: 'in.(resting_heart_rate)', user_id: uidEq(id), start_time: `gte.${dayStamp(from)}`, order: 'start_time.asc', limit: 500 }), fetchFn)
  ]);
  if (!profile.length) throw new FitaiError(404, 'No FitAI profile uses that id yet.');

  const p = profile[0];
  const targetCal = n(p.tdee) || n(p.targets_calories) || null;
  const targetProtein = n(p.targets_protein) || null;

  const byDay = new Map();
  for (const f of foods) {
    const d = typeof f.date === 'string' ? f.date.slice(0, 10) : null;
    if (!d) continue;
    const e = byDay.get(d) || { date: d, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, meals: 0 };
    e.kcal += n(f.calories); e.protein += n(f.protein_g); e.carbs += n(f.carbs_g);
    e.fat += n(f.fat_g); e.fiber += n(f.fiber_g); e.meals += 1;
    byDay.set(d, e);
  }
  const dayList = [...byDay.values()].map(e => ({ ...e, kcal: Math.round(e.kcal), protein: round1(e.protein), carbs: round1(e.carbs), fat: round1(e.fat), fiber: round1(e.fiber) }));
  const kcalAvg = avg(dayList.map(d => d.kcal));
  const proteinAvg = avg(dayList.map(d => d.protein));

  const gVals = glucose.map(g => ({ ...g, v: n(g.value) })).filter(g => g.v > 0);
  const fastingVals = gVals.filter(g => g.meal_context === 'fasting').map(g => g.v);
  const postVals = gVals.filter(g => g.meal_context !== 'fasting').map(g => g.v);

  const done = fasting.filter(f => f.status === 'completed').length;
  const active = fasting.find(f => f.status === 'active') || null;
  const stepsByDay = {};
  for (const s of steps) {
    const d = typeof s.start_time === 'string' ? s.start_time.slice(0, 10) : null;
    if (d) stepsByDay[d] = (stepsByDay[d] || 0) + pickNum(s.data_json, 'count');
  }
  let activeKcal = 0;
  for (const k of kcal) activeKcal += pickNum(k.data_json, 'calories');
  const stepDays = Object.values(stepsByDay);
  // Sleep: hours per night, keyed by the morning the session ends on. Multiple
  // sessions in one night (split sleep, naps recorded separately) sum.
  const sleepByNight = {};
  for (const r of sleepRows) {
    const h = sleepHoursOf(r);
    if (!h) continue;
    const night = sleepNightOf(r);
    if (!night) continue;
    sleepByNight[night] = (sleepByNight[night] || 0) + h;
  }
  const sleepNights = Object.values(sleepByNight).map(h => Math.min(h, 16));
  // Heart rate: resting rows average to recovery; plain heart_rate rows average
  // to a background level (not a workout read — those live on w.health).
  const hrVals = [];
  for (const r of hrRows) {
    const bpm = saneHr(pickFirstNum(r.data_json, HR_KEYS));
    if (bpm) hrVals.push(bpm);
  }
  const rhrByDay = {};
  for (const r of rhrRows) {
    const bpm = saneHr(pickFirstNum(r.data_json, HR_KEYS));
    if (!bpm) continue;
    const d = typeof r.start_time === 'string' ? r.start_time.slice(0, 10) : null;
    if (!d) continue;
    (rhrByDay[d] = rhrByDay[d] || []).push(bpm);
  }
  const rhrDays = Object.values(rhrByDay).map(v => avg(v));
  const sleepAvg = avg(sleepNights);
  const hrAvg = avg(hrVals);
  const rhrAvg = avg(rhrDays);

  const body = {
    ok: true,
    user_id: id,
    window: { from, to, days },
    targets: { calories: targetCal, protein: targetProtein, carbs: n(p.targets_carbs) || null, fat: n(p.targets_fat) || null, tdee: n(p.tdee) || null },
    // Intake autofill reads this (goal → coach goal, conditions → limitations).
    // Deliberately small: no name, age, height — nothing the Coach or the UI
    // needs beyond the mapping, so there is less to leak. The Coach payload
    // cleaner (api/coach/core/payload.js) drops this block on purpose: the
    // intake answers already carry the goal, and the model needs no second one.
    profile: {
      goal: typeof p.goal === 'string' && p.goal ? p.goal.slice(0, 16) : null,
      gender: typeof p.gender === 'string' && p.gender ? p.gender.slice(0, 16) : null,
      activityLevel: typeof p.activity_level === 'string' && p.activity_level ? p.activity_level.slice(0, 16) : null
    },
    nutrition: {
      daysLogged: dayList.length,
      kcalAvg: kcalAvg == null ? null : Math.round(kcalAvg),
      proteinAvg: proteinAvg == null ? null : round1(proteinAvg),
      deficitVsTarget: targetCal != null && kcalAvg != null ? Math.round(targetCal - kcalAvg) : null,
      proteinVsTarget: targetProtein != null && proteinAvg != null ? round1(targetProtein - proteinAvg) : null,
      days: dayList
    },
    glucose: {
      n: gVals.length,
      fastingAvg: avg(fastingVals) == null ? null : round1(avg(fastingVals)),
      postMealAvg: avg(postVals) == null ? null : round1(avg(postVals)),
      max: gVals.length ? Math.max(...gVals.map(g => g.v)) : null,
      latest: gVals.length ? { date: gVals[0].date, value: gVals[0].v, meal_context: gVals[0].meal_context || null } : null
    },
    fasting: {
      sessions: fasting.length,
      completed: done,
      active: active ? { protocol: active.protocol || null, startedAt: active.actual_start_at || active.planned_start_at || null } : null
    },
    body: {
      weightKg: n(p.weight) || null,
      scan: scans.length ? {
        at: scans[0].scanned_at, bodyFatPct: n(scans[0].body_fat_percentage) || null,
        leanKg: n(scans[0].lean_mass_kg) || null, fatKg: n(scans[0].fat_mass_kg) || null,
        type: scans[0].body_type || null
      } : null
    },
    labs: {
      abnormal: labs.filter(l => l.flag && l.flag !== 'normal').map(l => ({ key: l.biomarker_key, value: n(l.value), unit: l.unit || null, flag: l.flag })),
      normalCount: labs.filter(l => l.flag === 'normal').length
    },
    conditions: conditions.map(c => ({ label: c.label, code: c.code || null, status: c.status || null })),
    activity: {
      stepsAvg: avg(stepDays) == null ? null : Math.round(avg(stepDays)),
      stepsDays: stepDays.length,
      activeKcalTotal: round1(activeKcal),
      sleepAvgH: sleepAvg == null ? null : round1(sleepAvg),
      sleepNights: sleepNights.length,
      restingHrAvg: rhrAvg == null ? null : Math.round(rhrAvg),
      restingHrDays: rhrDays.length,
      hrAvg: hrAvg == null ? null : Math.round(hrAvg)
    }
  };

  // Size backstop: the whole state must stay far under the server's 5 MB body
  // cap, and a summary that grows forever eats it invisibly. Queries are
  // already windowed, so this only ever trims pathological days lists.
  while (JSON.stringify(body).length > SUMMARY_MAX_CHARS && body.nutrition.days.length > 1) body.nutrition.days.shift();
  cacheSet(key, body, nowMs);
  return body;
}

/**
 * One day's fuel + glucose + fasting overlap + steps, for the pre-workout line.
 * @param {string} userId
 * @param {object} opts { date (default today UTC), url, key, env, fetch, now }
 */
export async function dayFor(userId, opts = {}) {
  const id = checkedId(userId);
  const cfg = checkedCfg(opts);
  const nowMs = opts.now ?? Date.now();
  const date = opts.date || new Date(nowMs).toISOString().slice(0, 10);
  if (!isFitaiDay(date)) throw new FitaiError(400, 'That is not a day (YYYY-MM-DD).');
  const key = `day:${id}:${date}`;
  const hit = cacheGet(key, nowMs);
  if (hit) return hit;
  const fetchFn = opts.fetch || undefined;

  const [meals, glucose, fasting, steps, kcal, sleepRows, hrRows, rhrRows] = await Promise.all([
    restGet(cfg, 'food_log', qs({ select: 'meal_type,food_name,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,glycemic_load,logged_at', user_id: uidEq(id), date: `eq.${date}`, order: 'logged_at.asc', limit: 100 }), fetchFn),
    restGet(cfg, 'glucose_logs', qs({ select: 'date,value,meal_context', user_id: uidEq(id), date: `eq.${date}`, limit: 50 }), fetchFn),
    restGet(cfg, 'fasting_logs', qs({ select: 'protocol,status,planned_start_at,actual_start_at,actual_end_at,planned_duration_min', user_id: uidEq(id), order: 'planned_start_at.desc', limit: 10 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'data_json', record_type: 'eq.steps', user_id: uidEq(id), start_time: `gte.${dayStamp(date)}`, limit: 500 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'data_json', record_type: 'eq.active_calories', user_id: uidEq(id), start_time: `gte.${dayStamp(date)}`, limit: 500 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'start_time,end_time,data_json', record_type: 'in.(sleep_session,sleep)', user_id: uidEq(id), start_time: `gte.${dayStamp(date)}`, limit: 100 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'data_json', record_type: 'in.(heart_rate)', user_id: uidEq(id), start_time: `gte.${dayStamp(date)}`, limit: 500 }), fetchFn),
    restGet(cfg, 'health_connect_records', qs({ select: 'data_json', record_type: 'in.(resting_heart_rate)', user_id: uidEq(id), start_time: `gte.${dayStamp(date)}`, limit: 100 }), fetchFn)
  ]);

  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const mealRows = meals.map(m => {
    totals.kcal += n(m.calories); totals.protein += n(m.protein_g); totals.carbs += n(m.carbs_g);
    totals.fat += n(m.fat_g); totals.fiber += n(m.fiber_g);
    return {
      meal: m.meal_type || null, food: m.food_name || null,
      kcal: Math.round(n(m.calories)), protein: round1(n(m.protein_g)),
      carbs: round1(n(m.carbs_g)), fat: round1(n(m.fat_g))
    };
  });
  totals.kcal = Math.round(totals.kcal);
  totals.protein = round1(totals.protein); totals.carbs = round1(totals.carbs);
  totals.fat = round1(totals.fat); totals.fiber = round1(totals.fiber);

  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const dayEnd = new Date(`${date}T23:59:59Z`).getTime();
  let activeFast = null;
  for (const f of fasting) {
    const start = Date.parse(f.actual_start_at || f.planned_start_at || '');
    if (!Number.isFinite(start)) continue;
    const end = Date.parse(f.actual_end_at || '') || (f.status === 'active' ? nowMs : NaN);
    if (!Number.isFinite(end) || end < dayStart || start > dayEnd) continue;
    activeFast = { protocol: f.protocol || null, status: f.status || null, elapsedMin: Math.max(0, Math.round((end - start) / 60000)) };
    break;
  }

  let stepCount = 0;
  for (const s of steps) stepCount += pickNum(s.data_json, 'count');
  let activeKcal = 0;
  for (const k of kcal) activeKcal += pickNum(k.data_json, 'calories');
  let sleepH = 0;
  for (const r of sleepRows) sleepH += sleepHoursOf(r);
  const hrDay = [];
  for (const r of hrRows) {
    const bpm = saneHr(pickFirstNum(r.data_json, HR_KEYS));
    if (bpm) hrDay.push(bpm);
  }
  const rhrDay = [];
  for (const r of rhrRows) {
    const bpm = saneHr(pickFirstNum(r.data_json, HR_KEYS));
    if (bpm) rhrDay.push(bpm);
  }

  const body = {
    ok: true, user_id: id, date,
    totals, meals: mealRows,
    glucose: glucose.map(g => ({ value: n(g.value), meal_context: g.meal_context || null })),
    fasting: activeFast,
    activity: {
      steps: Math.round(stepCount), activeKcal: round1(activeKcal),
      sleepH: sleepH ? round1(Math.min(sleepH, 16)) : null,
      hrAvg: hrDay.length ? Math.round(avg(hrDay)) : null,
      restingHr: rhrDay.length ? Math.round(avg(rhrDay)) : null
    }
  };
  cacheSet(key, body, nowMs);
  return body;
}
