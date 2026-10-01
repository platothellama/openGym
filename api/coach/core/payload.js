/* What actually leaves this server.
 *
 * The consent screen makes a promise about which categories of data reach the provider, and
 * this file is where that promise is either kept or quietly broken. So it is built as an
 * allowlist: every field is copied in by name. Nothing is spread, nothing is passed through,
 * and a field added to the state blob next year cannot ride along by accident — which is the
 * property the FR-11 test actually asserts.
 *
 * Excluded on purpose and permanently: the profile's display name and user id (an opaque
 * handle stands in), passkey and credential material, push subscriptions, invite data, theme
 * and appearance settings, and every other profile's everything.
 */
import { glyphStr } from './glyphs.js';
import { LIBRARY, LIB_BY_ID, libraryHas, libraryName, librarySlice, isStretch, MAX_LIBRARY } from './library.js';

export const CONTRACT = 1;
// Bounds from FR-22. A review reads a training block, not a training career: more history
// makes the payload bigger and the reading vaguer, not better.
export const MAX_WEEKS = 12;
export const MAX_SESSIONS = 60;
// Last-resort ceiling for a free-text note/refine (issue #267). The real limit is the admin's
// `maxMessageLen`, enforced in jobs.js before a message ever reaches this module — this module
// stays a pure allowlist with no config import of its own, so it keeps its own constant instead.
// It has to stay >= config.js's MAX_MESSAGE_LEN_CEILING, or a raised admin limit would still get
// clipped back down here.
export const MAX_NOTE_CHARS = 4000;
// The ceiling on a whole payload, as JSON characters, which the server checks before a job
// leaves (jobs.js). Every field below is bounded on its own; this is the backstop for how many
// of them there are, and for a field added later that nobody bounded. A deliberately extreme
// history (30 routines of 12 exercises, 200 custom exercises, 60 twelve-exercise sessions in
// the review window) builds a review of about 240k; ordinary ones stay under 50k.
export const MAX_PAYLOAD_CHARS = 300_000;

/* ---------- what a person typed, bounded ----------
   Every free-text field below rides into the prompt, and the prompt is paid for by whoever runs
   the instance: the Coach spends one instance-wide key. The intake screen caps what it lets you
   type, but this module never sees that screen. It reads the profile from a POST body or from
   the synced state, and a client can fill either with megabytes (the only server limit is the
   5 MB body cap). So the text is cut here, the one place both the server and the phone build a
   payload, to the limits the intake screen shows (CoachIntake.jsx). The system prompt already
   reads this text as data rather than instruction (common rule 3); the bound is about size.
   A field of the wrong type reads as absent rather than as "[object Object]". */
export const PROFILE_TEXT_MAX = { limitations: 600, likes: 300, dislikes: 300, notes: 600, equipmentOther: 300 };
// Goal and experience are enum words today (strength, returning, ...); 40 leaves room for new
// ones without letting either carry a paragraph.
export const PROFILE_WORD_MAX = 40;
// How many goals one profile may carry. Three is what the app can rank and show a position for;
// past that the tail is beyond what anyone could act on, and the extra words would only dilute the
// instruction to build for the first.
export const PROFILE_MAX_OBJECTIVES = 3;
// The equipment taxonomy has 28 values, the longest 20 characters.
export const PROFILE_EQUIPMENT_MAX = 40;
// Routine, workout and custom-exercise names have no length limit in the app. The Coach writes
// its own names at 40 (validate.js); twice that keeps any name a person would really type.
export const NAME_MAX = 80;
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const word = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);

/** A language tag's shape ('de', 'pt-BR', 'zh_Hant'), or null — for a language that arrives with
 *  a request or from the environment rather than from the state (#303). */
export const langTag = v => (typeof v === 'string' && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(v.trim()) ? v.trim() : null);
// Zero reads as absent, as `|| null` always made it; anything else is clamped into range.
const count = (v, lo, hi) => {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
// A weekday is 0-6, as a number or a one-digit string; null must not turn into Sunday.
const weekday = d => (typeof d === 'number' ? d : typeof d === 'string' && /^\d$/.test(d) ? Number(d) : NaN);
// The optional days of a plan: weekday indices, de-duplicated, ascending. Mirrors
// `optionalDaysOf` in frontend/src/lib/week-plan.js; kept local because core/ is framework-free
// and must not reach into the app bundle. Both sides normalise the same way because the
// fingerprint in plan-hash.js is computed from this.
const optionalDaysOf = S => [...new Set(
  (Array.isArray(S?.weekOptional) ? S.weekOptional : [])
    .map(weekday)
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
)].sort((a, b) => a - b);
// The required days with nothing planned on them, and the required days themselves. Mirrors
// `emptyRequiredOf`/`requiredDaysOf` in frontend/src/lib/week-plan.js — the same normalisation
// reason as above, and the same two rules: a union (the days with routines *and* the days without,
// because `weekRequired` only ever holds the empty ones) and optional winning a conflict, which
// is how the two are read in order and loses the fewest slots.
const requiredDaysOf = S => {
  const opt = new Set(optionalDaysOf(S));
  const planned = Object.keys(S?.week || {}).map(weekday)
    .filter(d => Number.isInteger(d) && !opt.has(d) && S.week?.[d]?.length);
  const empty = (Array.isArray(S?.weekRequired) ? S.weekRequired : [])
    .map(weekday)
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    .filter(d => !opt.has(d) && !S?.week?.[d]?.length);
  return [...new Set([...planned, ...empty])].sort((a, b) => a - b);
};
const emptyRequiredOf = S => requiredDaysOf(S).filter(d => !S?.week?.[d]?.length);

/* ---------- what the plan and the log hold, bounded by type ----------
   The plan, the logged sets, the body-weight series and the exercise ids come from the same
   client-written state as the profile, and PUT /api/data checks no more than that workouts and
   routines are arrays. A field copied as it came is a field that can carry a megabyte of text
   into the prompt, so each one is read by what it is meant to be. Anything else reads as
   absent, as a wrong-typed profile field does. */
// The app's own ids are uid() (13 characters) or a four-digit catalogue number; 64 is room for
// any id an import or an older build ever wrote, and no room for a paragraph.
export const ID_MAX = 64;
// The progression engine's policies (frontend/src/lib/progression.js POLICIES, validate.js).
const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time'];
const ident = v => (typeof v === 'string' ? v.slice(0, ID_MAX) : typeof v === 'number' && Number.isFinite(v) ? v : null);
const policy = v => (POLICIES.includes(v) ? v : null);
// A finite number, or a number written as a short string (the app writes numbers, but a
// hand-made import may not, and the model reads "20" as well as 20). Kept as given rather than
// converted, so a Coach change's `before` still equals what the plan holds.
const NUMERIC = /^-?\d{1,9}(\.\d{1,6})?$/;
const num = v => ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && NUMERIC.test(v)) ? v : undefined);
// A date is the ISO day every screen writes; anything else is not a date.
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const list = v => (Array.isArray(v) ? v : []);
function cleanProfile(profile) {
  const days = Array.isArray(profile.preferredDays) ? profile.preferredDays : [];
  const equipment = Array.isArray(profile.equipment) ? profile.equipment : [];
  const daysPerWeek = count(profile.daysPerWeek, 1, 7);
  const optionalDays = count(profile.optionalDays, 0, 4);
  // The goals this person picked, most important first. The order is the answer - it is how the
  // prompts read "build for the first, keep the rest in mind" - so nothing here sorts it, and a
  // duplicate is dropped rather than making the model programme for the same thing twice.
  //
  // Not enum-checked, deliberately, and for the same reason `goal` is not: these are words the app
  // owns, and a goal it adds next month should reach the model rather than be dropped as unknown.
  // Each entry gets the word bound, and the length is bounded, which is what this file guards.
  // The allowlist that the app applies - a key it has no label for cannot be shown or ranked -
  // lives in frontend/src/lib/coach-goals.js and runs on the way in.
  const picked = list(profile.objectives).map(v => word(v, PROFILE_WORD_MAX));
  // An old client sends only `goal`, so the single word is promoted to a one-item list. Doing it
  // here rather than only in the app is what lets the prompts mention `objectives` unconditionally
  // without breaking anyone who has not taken the new build.
  const objectives = [...new Set(picked.filter(Boolean))].slice(0, PROFILE_MAX_OBJECTIVES);
  return {
    // The top objective, kept as its own field: debrief.md, the consent copy and any older prompt
    // read one word, and the two are written together so they cannot drift.
    goal: objectives[0] ?? word(profile.goal, PROFILE_WORD_MAX),
    objectives: objectives.length ? objectives : (word(profile.goal, PROFILE_WORD_MAX) ? [word(profile.goal, PROFILE_WORD_MAX)] : []),
    experience: word(profile.experience, PROFILE_WORD_MAX),
    daysPerWeek,
    // How many of those days are optional - a bonus the person trains when they can. 0 reads as
    // absent (see `count`), which is the same thing: no optional days.
    //
    // Bounded by the room the required days leave in a seven-day week, not just by 4. The two
    // lists are disjoint by the time validate.js sees them, so "7 required, 4 optional" asks for
    // eleven slots and no plan can satisfy it - and an unsatisfiable request comes back rejected
    // rather than adjusted, so the person gets a failure instead of a plan. Clamped here as well
    // as in the app because a profile stored by a build that asked the two questions
    // independently still carries such a pair.
    //
    // An absent answer stays absent: `Math.min(null, x)` is 0, and 0 is a number where null is
    // not, which is the difference between "not asked" and "asked for none" to the validator. With
    // no required count to bound it, the full bonus stands - nothing says the week is full.
    optionalDays: optionalDays == null ? null : Math.min(optionalDays, daysPerWeek == null ? 4 : Math.max(0, 7 - daysPerWeek)),
    // Weekdays 0-6, each once: seven entries is the whole week, so anything past that is noise.
    // No intake screen collects these any more — a plan is set by frequency, and the app lays
    // the week out — but a profile written before that still carries them, and a hint the person
    // once gave is better than no hint at all.
    preferredDays: [...new Set(days.map(weekday).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))],
    sessionMin: count(profile.sessionMin, 1, 24 * 60),
    equipment: equipment.filter(e => typeof e === 'string' && e).slice(0, PROFILE_EQUIPMENT_MAX).map(e => e.slice(0, PROFILE_WORD_MAX)),
    limitations: text(profile.limitations, PROFILE_TEXT_MAX.limitations),
    likes: text(profile.likes, PROFILE_TEXT_MAX.likes),
    dislikes: text(profile.dislikes, PROFILE_TEXT_MAX.dislikes),
    notes: text(profile.notes, PROFILE_TEXT_MAX.notes),
    // Free-text equipment ("pull-up bar, rower"): sent so the model respects kit the
    // taxonomy has no chip for. Library filtering still runs on `equipment` only — an
    // unknown string must not empty the candidate pool (see librarySlice fallback).
    ...(typeof profile.equipmentOther === 'string' && profile.equipmentOther.trim()
      ? { equipmentOther: text(profile.equipmentOther.trim(), PROFILE_TEXT_MAX.equipmentOther) }
      : {})
  };
}

/* ---------- the data categories the consent screen names (FR-09/10) ----------
   Kept here, next to the code that acts on it, and rendered by the consent UI from the same
   list — a screen that drifts from the payload is worse than no screen. */
export { DATA_CATEGORIES } from './categories.js';

/* ---------- reading a session the way the engine reads it ----------
   Duplicated from frontend/src/lib/history.js rather than shared: the two runtimes have no
   build step in common, and this is the same trade-off server.js already made for
   effectiveRoutineId. frontend/src/lib/coach-parity.test.js pins modeOf, isBw and isPerSide
   against the frontend's own copies over a shared table of configs, so the duplicate cannot
   drift silently — which it otherwise would have, quietly, when v1.2.4 taught the app about
   bodyweight work. isWarmupSet and readSession are duplicated the same way but were pinned by
   nothing; api/test/payload-parity.test.js pins them now. It has to be a separate file: that
   test imports the frontend's own readSession, and a vitest test cannot import into a
   node:test file or back. */
export const modeOf = (cfg, ex) => {
  const m = cfg && cfg.mode;
  if (m === 'reps' || m === 'time' || m === 'cardio') return m;
  return ex && ex.bp === 'cardio' ? 'cardio' : 'reps';
};

/* Two flags that ride on top of a mode rather than making new ones (upstream #31/#32), and
   both matter to the Coach for the same reason: on a bodyweight exercise `w` is *added* load,
   so it is 0 on a perfectly good session, and every load-shaped signal — volume, e1RM, "is it
   going up" — reads as a flat zero. A Coach that could not see this would look at a push-up
   progression that is working and propose adding weight to a push-up.

   Absent reads as false on every plan written before these existed, exactly as upstream. */
export const isBw = (cfg, ex) =>
  (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : (ex && ex.eq) === 'body weight');
export const isPerSide = cfg => !!(cfg && cfg.side);
// Mirror of frontend/src/lib/workout-model.js isWarmupRow: an explicit phase wins, else the
// legacy boolean. A warm-up row is prep, not the session: it is filtered out of the stall
// count exactly as progression.js filters it, it never counts as a done set or a top set,
// and where it does travel (the last few sessions in full) it is flagged so the model reads
// "0x12 warm-up" as what it is rather than as a failed set.
export const isWarmupSet = s => {
  const ph = typeof s?.phase === 'string' ? s.phase.trim().toLowerCase() : '';
  if (ph) return ph === 'warmup' || ph === 'warm-up' || ph === 'warm_up';
  return s?.warmup === true;
};
function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {};
  const ex = LIB_BY_ID.get(entry?.id);
  const mode = modeOf(target, ex);
  const bw = isBw(target, ex);
  const logged = ((entry && entry.sets) || []).filter(s => !isWarmupSet(s));
  const planned = target.sets || logged.length;
  const enough = logged.length >= planned;
  // Only the sets the plan asked for decide whether the session was hit, exactly as
  // frontend/src/lib/progression.js readSession has done since issue #233. This copy graded
  // every logged set, so a fourth set taken short of the goal on a clean 3x10 was a hit in the
  // app and a miss here — and stallCount, reading only this copy, reported a stall the athlete
  // never had. `count` below stays the real total: extra sets are exactly how bodyweight work
  // is meant to grow (#33), they just do not decide whether the prescription was met.
  const sets = logged.slice(0, Math.max(1, planned));
  if (mode === 'time') {
    const goal = target.sec || 0;
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0));
    return { mode, bw, goal, ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal) };
  }
  const goal = target.reps || 0;
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0));
  // Set count is the dimension bodyweight work grows once reps hit their ceiling (upstream
  // #33), so it travels alongside the reps rather than being inferred from them downstream.
  const done = logged.filter(s => s.done).length;
  return { mode, bw, goal, count: done, ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal) };
}
/** Consecutive misses counting back from the most recent session. */
export function stallCount(sessions) {
  let n = 0;
  for (let i = sessions.length - 1; i >= 0; i--) { if (sessions[i].ok) break; n++; }
  return n;
}

/* ---------- plan cleaning (mirrors plan-share.js cleanEx) ---------- */
function cleanEx(e) {
  const o = { id: ident(e.id), name: LIB_BY_ID.get(e.id)?.n || null, sets: num(e.sets) };
  const mode = modeOf(e, LIB_BY_ID.get(e.id));
  o.mode = mode;
  const put = (k, v) => { if (num(v) !== undefined) o[k] = v; };
  if (mode === 'cardio') { put('min', e.min); put('speed', e.speed); }
  else if (mode === 'time') { put('sec', e.sec); if (e.weight) put('weight', e.weight); }
  else { put('reps', e.reps); if (e.weight) put('weight', e.weight); }
  if (policy(e.prog)) o.prog = e.prog;
  if (e.inc > 0) put('inc', e.inc);
  put('repsMin', e.repsMin);
  // repsMax is the ceiling that turns "+1 rep forever" into "add a set and start over"; without
  // it the Coach cannot see, or propose, how a bodyweight exercise is meant to progress.
  put('repsMax', e.repsMax);
  // Written out only when they disagree with the catalogue, matching plan-share.js — an
  // absent flag has always meant "whatever the exercise says", and still does.
  if (e.bodyweight != null) o.bodyweight = !!e.bodyweight;
  if (e.side) o.side = true;
  // A superset tag is an id the app mints (sg-0-1, hs + uid()), so it is bounded like one.
  if (e.sg) o.sg = ident(e.sg);
  return o;
}
/**
 * The plan reduced to exactly the fields that decide whether it has *changed* — mode-aware,
 * with every absent value written out as a zero so "no weight" and "0 kg" cannot hash apart.
 *
 * frontend/src/lib/coach.js mirrors this function field for field. That duplication is the
 * price of the two runtimes sharing no build step, and it is load-bearing: if the two ever
 * disagree, every proposal reads as stale and the feature quietly stops working. coach.test.js
 * pins them together against shared fixtures.
 */
export function canonicalPlan(S) {
  const custom = new Map((S.customEx || []).map(c => [c.id, c]));
  const exOf = id => LIB_BY_ID.get(id) || custom.get(id);
  return {
    routines: (S.routines || []).map(r => ({
      id: r.id, name: r.name || '', prog: r.prog || '',
      ex: (r.ex || []).map(e => {
        const mode = modeOf(e, exOf(e.id));
        return {
          id: e.id, mode, sets: e.sets || 0,
          reps: mode === 'reps' ? (e.reps || 0) : 0,
          sec: mode === 'time' ? (e.sec || 0) : 0,
          min: mode === 'cardio' ? (e.min || 0) : 0,
          speed: mode === 'cardio' ? (e.speed || 0) : 0,
          weight: mode === 'cardio' ? 0 : (e.weight || 0),
          prog: e.prog || '', inc: e.inc || 0, repsMin: e.repsMin || 0, repsMax: e.repsMax || 0,
          // Resolved rather than copied: the fingerprint has to change when a plan starts
          // disagreeing with the catalogue, and `bodyweight: undefined` and an exercise the
          // dataset already calls bodyweight are the same plan and must hash the same.
          bodyweight: isBw(e, exOf(e.id)), side: isPerSide(e),
          sg: e.sg || ''
        };
      })
    })),
    // A weekday holds a routine-id list. `[].concat` folds a legacy bare string and a
    // one-element list to the same shape (so their fingerprint is identical); `?.length` keeps
    // a stray `[]` out; insertion order is preserved and never sorted (it is the merge order).
    week: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].filter(d => S.week?.[d]?.length).map(d => [d, [].concat(S.week[d])])),
    // Mirror of the client's `weekOptional`: sorted weekday indices, so the fingerprint does not
    // depend on the order the days were written down in. A day listed as optional but never
    // filled in still counts — that empty slot is what a proposal is computed against.
    weekOptional: optionalDaysOf(S),
    // Mirror of the client's `weekRequired`: the required days with nothing planned on them, so
    // the same reason — a slot the person trains but has not planned yet is part of the shape.
    weekRequired: emptyRequiredOf(S)
  };
}

export function cleanPlan(S) {
  // Names are typed by the person, so they are cut like the profile's text. The icon is held to
  // what the validator lets a plan carry (an icon key or a legacy emoji, core/glyphs.js): it is
  // the client's state, and free text in it would ride into every prompt.
  const routines = list(S.routines).filter(r => r && typeof r === 'object').map(r => ({
    id: ident(r.id), name: r.name == null ? r.name : text(String(r.name), NAME_MAX),
    emoji: r.emoji == null ? r.emoji : glyphStr(String(r.emoji)),
    ...(policy(r.prog) ? { prog: r.prog } : {}),
    ex: list(r.ex).filter(e => e && typeof e === 'object').map(cleanEx)
  }));
  // A weekday holds routine ids, so each entry is bounded like one.
  const week = {};
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { if (S.week?.[d]?.length) week[d] = [].concat(S.week[d]).map(ident); });
  // The optional days, and the required days nothing is planned on, so the model can be told
  // *which* days are open rather than only how many — the difference between "you train three
  // days and Thursday is up for grabs" and "you train three days". Both are omitted when empty:
  // a key that is absent reads as absent, which is the truth for a plan the Coach itself wrote.
  const weekOptional = optionalDaysOf(S);
  const weekRequired = emptyRequiredOf(S);
  return {
    routines, week,
    ...(weekOptional.length ? { weekOptional } : {}),
    ...(weekRequired.length ? { weekRequired } : {})
  };
}

// The catalogue lives in library.js; re-exported so older imports keep resolving.
export { LIBRARY, MAX_LIBRARY, libraryHas, libraryName, librarySlice, isStretch };

/* ---------- effort scale (mirrors history.js effortOf) ---------- */
const effortOf = S => {
  const e = S && S.effort;
  return e === 'none' || e === 'rir' || e === 'rpe' ? e : (S && S.showRir ? 'rir' : 'none');
};

/* ---------- window + aggregates ---------- */
const iso = d => d.toISOString().slice(0, 10);

export function reviewWindow(S, since) {
  const all = (S.workouts || []).filter(w => w && w.d);
  const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - MAX_WEEKS * 7);
  const cutoff = iso(cutoffDate);
  const from = since && since > cutoff ? since : cutoff;
  return all.filter(w => w.d >= from).slice(-MAX_SESSIONS);
}

function aggregates(S, workouts) {
  // Per-exercise stall/deload picture, computed over the same sessions the engine would see.
  const byEx = new Map();
  const planCfg = new Map();
  (S.routines || []).forEach(r => (r.ex || []).forEach(e => planCfg.set(e.id, e)));
  (S.workouts || []).forEach(w => (w.entries || []).forEach(en => {
    if (!en.sets?.some(s => s.done)) return;
    if (!byEx.has(en.id)) byEx.set(en.id, []);
    byEx.get(en.id).push(readSession(en, planCfg.get(en.id)));
  }));
  const exercises = [];
  for (const [id, sessions] of byEx) {
    const stalls = stallCount(sessions);
    if (stalls > 0 || sessions.length >= 3) {
      exercises.push({ id: ident(id), name: libraryName(id), sessions: sessions.length, stalls, lastOk: !!sessions[sessions.length - 1]?.ok });
    }
  }

  // Adherence: what the week asked for against what actually happened.
  const trained = new Set(workouts.map(w => w.d));
  // A combined day already counts as 1 — this counts days scheduled, not routines.
  const plannedDays = Object.keys(S.week || {}).filter(k => S.week[k]?.length).length;
  // Which of those are the "train it if you can" days. Without this the Coach reads a missed
  // optional day as a missed session and coaches someone for it — the single most misleading
  // thing it could say about adherence.
  const optionalPerWeek = optionalDaysOf(S).filter(d => S.week?.[d]?.length).length;
  const reschedules = Object.entries(S.dayPlan || {}).filter(([d]) => workouts.some(w => w.d === d) || d >= (workouts[0]?.d || '')).length;

  // Muscle coverage in the window, by body part — the "not trained" gap the Stats screen shows.
  const hit = {};
  workouts.forEach(w => (w.entries || []).forEach(en => {
    const work = (en.sets || []).filter(s => s.done && !isWarmupSet(s));
    if (!work.length) return;
    const bp = LIB_BY_ID.get(en.id)?.bp;
    if (bp) hit[bp] = (hit[bp] || 0) + work.length;
  }));

  const durations = workouts.map(w => (w.end && w.start ? Math.round((w.end - w.start) / 60000) : null)).filter(Boolean);
  return {
    exercises,
    adherence: { plannedPerWeek: plannedDays, optionalPerWeek, sessionsInWindow: workouts.length, distinctDays: trained.size, dayOverrides: reschedules },
    setsByBodyPart: hit,
    sessionMinutes: durations.length
      ? { median: durations.slice().sort((a, b) => a - b)[Math.floor(durations.length / 2)], min: Math.min(...durations), max: Math.max(...durations) }
      : null
  };
}

/** Every exercise id the plan names or the given workouts logged — the ones a proposal has to
 *  be able to refer to, so they ride in the library slice whatever the cap or the filter. */
function trainedIds(S, workouts) {
  const ids = new Set();
  (S.routines || []).forEach(r => (r.ex || []).forEach(e => ids.add(e.id)));
  (workouts || []).forEach(w => (w.entries || []).forEach(en => ids.add(en.id)));
  return [...ids];
}

// Only the most recent sessions carry full set-by-set detail; everything older in the window
// arrives as one line per exercise. The old payload sent every set of up to 60 sessions —
// 10k+ tokens a small local model cannot hold and a metered API should not be billed for —
// while stalls and trends already live in `aggregates`, computed over the full window.
export const FULL_DETAIL_SESSIONS = 3;

const fmtSet = s => {
  const eff = s.rir != null ? '@RIR' + s.rir : s.rpe != null ? '@RPE' + s.rpe : '';
  if (s.sec != null) return s.sec + 's' + eff;
  if (s.min != null) return s.min + 'min' + (s.speed != null ? '/' + s.speed : '') + eff;
  return (s.w != null ? s.w + 'x' : '') + (s.r != null ? s.r : '?') + eff;
};

/** One logged set, its numbers only. */
function cleanSet(s) {
  const o = { done: !!s.done };
  if (isWarmupSet(s)) o.warmup = true;
  for (const k of ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe']) if (num(s[k]) !== undefined) o[k] = s[k];
  return o;
}
const entriesOf = w => list(w.entries).filter(en => en && typeof en === 'object');
const setsOf = en => list(en.sets).filter(s => s && typeof s === 'object');
const targetOf = en => (en.target && typeof en.target === 'object'
  ? { sets: num(en.target.sets), reps: num(en.target.reps), sec: num(en.target.sec), weight: num(en.target.weight) }
  : null);

/** One older workout as a summary: what was done, the top set, whether targets were hit. */
function compactWorkout(w) {
  return {
    d: day(w.d),
    name: word(w.name, NAME_MAX),
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    prs: list(w.prs).length,
    compact: true,
    entries: entriesOf(w).map(en => {
      const sets = setsOf(en).filter(s => !isWarmupSet(s)).map(cleanSet);
      const done = sets.filter(s => s.done);
      let top = null;
      done.forEach(s => {
        if (!top || (s.w || 0) * (s.r || 0) + (s.sec || 0) > (top.w || 0) * (top.r || 0) + (top.sec || 0)) top = s;
      });
      const target = targetOf(en);
      return {
        id: ident(en.id),
        name: libraryName(en.id),
        done: done.length + '/' + sets.length,
        ...(target ? { target: fmtSet({ w: target.weight, r: target.reps, sec: target.sec }) } : {}),
        ...(top ? { top: fmtSet(top) } : {})
      };
    })
  };
}

/** One workout, reduced to what a coach reads. */
function cleanWorkout(w) {
  return {
    d: day(w.d),
    name: word(w.name, NAME_MAX),
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    ...(w.rating ? { rating: typeof w.rating === 'number' ? w.rating : text(String(w.rating), 20) } : {}),
    ...(w.note ? { note: String(w.note).slice(0, 300) } : {}),
    prs: list(w.prs).length,
    entries: entriesOf(w).map(en => ({
      id: ident(en.id),
      name: libraryName(en.id),
      target: targetOf(en),
      sets: setsOf(en).map(cleanSet)
    }))
  };
}

/** The body-weight series between two days, each weigh-in a date and a number. */
function weighIns(S, from, to) {
  return list(S.bodyweight)
    .map(b => ({ d: day(b?.d), w: num(b?.w) }))
    .filter(b => b.d && b.w !== undefined && (!from || b.d >= from) && (!to || b.d <= to));
}

/* Girth measurements. Copied site by site, never spread: S.measurements is the client's own state
   and a new key on some future version must not reach a provider by accident. Always centimetres,
   whatever meta.unit says — a girth is not a load (see S.measurements in store/useStore.js) — so
   `unit` is stated here rather than left to be inferred from the profile's weight unit.

   The changes are pre-computed rather than left to the model, and only past the noise floor the
   app itself applies (NOISE_CM in lib/measurements.js). Sending raw series and asking for the
   differences would invite a 0.4 cm tape wobble to be read as a plateau, and a deload to be
   prescribed off it. `changed` is the only thing a rationale may cite; a site in `series` whose
   change is under the floor is context, not evidence. */
const GIRTH_SITES = ['neck', 'shoulder', 'chest', 'arm', 'waist', 'hip', 'thigh', 'calf'];
// Below this a difference is what the tape reads differently this morning, not a change in the body.
const GIRTH_NOISE_CM = 1;
// A body is not a month-over-month photograph, and a series nobody keeps past a year is a person
// who stopped measuring, not a history. Two years of monthly entries is 24 rows.
const GIRTH_MAX_SESSIONS = 24;
// Two tape readings days apart share every error the morning brings: you did not wake up taller, and
// the tape did not get better. Past the noise floor but inside this window, a difference is still
// not a trend, so nothing is offered as `change` until the series spans at least this long. This is
// the app's own MIN_GAP_DAYS in lib/measurements.js, restated for the same reason as GIRTH_NOISE_CM.
const GIRTH_MIN_GAP_DAYS = 28;
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
function cleanMeasurements(S) {
  const rows = list(S.measurements)
    .map(e => {
      const d = day(e?.d);
      const v = e?.v && typeof e.v === 'object' && !Array.isArray(e.v) ? e.v : {};
      const sites = {};
      for (const id of GIRTH_SITES) {
        const cm = num(v[id]);
        if (cm !== undefined && cm > 0) sites[id] = Math.round(cm * 10) / 10;
      }
      return d && Object.keys(sites).length ? { d, sites } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!rows.length) return null;
  const recent = rows.slice(-GIRTH_MAX_SESSIONS);
  const first = recent[0], last = recent[recent.length - 1];
  // The whole window is the baseline, not the nearest pair: a series read end to end is the only
  // way a site measured once and left alone still counts, and the gap check below is what keeps a
  // two-row week from being read as a fortnight of change.
  const change = {};
  if (daysBetween(first.d, last.d) >= GIRTH_MIN_GAP_DAYS) {
    for (const id of GIRTH_SITES) {
      const a = first.sites[id], b = last.sites[id];
      if (!(a > 0) || !(b > 0) || a === b) continue;
      const d = Math.round((b - a) * 10) / 10;
      // The app's own floor, restated: only a difference past it is offered as `changed`, so nothing
      // downstream has to know how big a tape's error is to avoid treating it as a trend.
      if (Math.abs(d) >= GIRTH_NOISE_CM) change[id] = d;
    }
  }
  return {
    unit: 'cm',
    from: first.d,
    to: last.d,
    days: daysBetween(first.d, last.d),
    sessions: recent.length,
    latest: last.sites,
    ...(Object.keys(change).length ? { change } : {}),
    series: recent
  };
}

/* The room's medians are computed on this server, but from other people's synced workouts —
   state their own clients wrote. cohort.js keeps only catalogue exercises; this copy bounds
   every field again, so what reaches one person's prompt never depends on that filter alone. */
function cleanCohort(c) {
  if (!c || typeof c !== 'object') return null;
  const spw = c.sessionsPerWeek && typeof c.sessionsPerWeek === 'object' ? c.sessionsPerWeek : {};
  return {
    unit: word(c.unit, 8),
    people: num(c.people) ?? null,
    sessionsPerWeek: { median: num(spw.median) ?? null, you: num(spw.you) ?? null },
    exercises: list(c.exercises).filter(x => x && typeof x === 'object').map(x => ({
      id: ident(x.id), name: word(x.name, NAME_MAX), median: num(x.median) ?? null, you: num(x.you) ?? null
    }))
  };
}

/* ---------- the FitAI fuel block: the last five consent categories ----------
   The bridge is another service. It hands us whatever FitAI returned and we do not own its
   shape, so every field below is copied in by name like the rest of this file — nothing is
   spread, nothing is passed through. A new column on FitAI's side must not reach the
   provider by accident, and the two fields that must never ride along are named in the test
   that guards this: its `user_id` (the payload carries the opaque handle instead) and its
   `profile` block (the intake answers are already in `coachProfile`, and a second copy would
   be a second source of truth).

   Five flat top-level keys, named exactly as the consent screen names them, so what the
   screen promises and what the payload carries are the same five words. Someone with no
   FitAI link gets none of them, which leaves an unlinked payload byte-identical to a build
   from before any of this existed — test/payload-fitai.test.js asserts that too.

   The bridge's own `window` deliberately does not travel. `p.window` is already the
   *training* window for a review, and the fuel block dates its own rows against `meta.today`,
   so a second range would only invite the model to conflate the two. */
const FITAI_TARGETS = ['calories', 'protein', 'carbs', 'fat', 'tdee'];
// A measurement is a number. Unlike the state fields above, nothing here is a hand-made import
// that wrote "1497" for 1497: this is JSON from a service that owns the type, so a value that
// arrives as a string reads as absent rather than travelling as a string.
const metric = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// How much of the window may travel. The window is seven days; 14 leaves room for a bridge
// that counts differently, and 20 rows is a lab panel, not a history.
const FITAI_MAX_DAYS = 14;
const FITAI_MAX_ROWS = 20;
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
function cleanFitai(f) {
  const tgt = obj(f.targets);
  const nut = obj(f.nutrition);
  const glu = obj(f.glucose);
  const fst = obj(f.fasting);
  const body = obj(f.body);
  const labs = obj(f.labs);
  const act = obj(f.activity);
  const started = obj(fst.active);
  const latest = obj(glu.latest);
  const scan = obj(body.scan);
  const at = day(latest.date);
  const protocol = word(started.protocol, 24);
  return {
    nutrition: {
      // Every target key is always present, null when the bridge has no number for it, so the
      // prompt can name the field without guarding on whether this account set it.
      targets: Object.fromEntries(FITAI_TARGETS.map(k => [k, metric(tgt[k])])),
      daysLogged: count(nut.daysLogged, 0, FITAI_MAX_DAYS),
      kcalAvg: metric(nut.kcalAvg),
      proteinAvg: metric(nut.proteinAvg),
      deficitVsTarget: metric(nut.deficitVsTarget),
      proteinVsTarget: metric(nut.proteinVsTarget),
      // A day with no usable date cannot be placed against the rest of the window, so it is
      // dropped rather than shown as an orphan row; the numbers on a kept day are read as
      // given, and a missing one stays null rather than being invented.
      days: list(nut.days).filter(d => d && typeof d === 'object' && day(d.date)).slice(0, FITAI_MAX_DAYS)
        .map(d => ({ date: day(d.date), kcal: metric(d.kcal), protein: metric(d.protein) }))
    },
    glucose: {
      n: count(glu.n, 0, 1000),
      fastingAvg: metric(glu.fastingAvg),
      postMealAvg: metric(glu.postMealAvg),
      max: metric(glu.max),
      // `meal_context` is the bridge's name for what the prompts call `meal`. An undated
      // reading reads as absent: "the latest reading" with no day is not a reading.
      latest: at ? { date: at, value: metric(latest.value), meal: word(latest.meal_context, 24) } : null
    },
    fasting: {
      sessions: count(fst.sessions, 0, 1000),
      completed: count(fst.completed, 0, 1000),
      // A fast in progress is one of the few things here worth naming exactly — "trained
      // fasted" is a real reason to hold a jump — so the protocol and when it started, and
      // nothing else the bridge knows about the fast.
      active: protocol ? { protocol, startedAt: word(started.startedAt, 40) } : null
    },
    health: {
      weightKg: metric(body.weightKg),
      conditions: list(f.conditions).filter(c => c && typeof c === 'object').slice(0, FITAI_MAX_ROWS)
        .map(c => ({ label: word(c.label, NAME_MAX), code: word(c.code, 40), status: word(c.status, 20) })),
      // Flat, because the only thing a session decision can use is "these were out of range",
      // and the count of the ones that were fine (labsOk) is what keeps that from reading as
      // a crisis on its own.
      labs: list(labs.abnormal).filter(r => r && typeof r === 'object').slice(0, FITAI_MAX_ROWS)
        .map(r => ({ key: word(r.key, 40), value: metric(r.value), unit: word(r.unit, 16), flag: word(r.flag, 20) })),
      labsOk: count(labs.normalCount, 0, 1000),
      // The scan's own fields are the app's, not the bridge's: body-fat percentage and lean
      // mass are what a session decision could use, and nothing else on the scan travels.
      scan: (scan.at || scan.bodyFatPct || scan.leanKg)
        ? { at: word(scan.at, 30), bodyFatPct: metric(scan.bodyFatPct), leanKg: metric(scan.leanKg), type: word(scan.type, 24) }
        : null
    },
    activity: {
      stepsAvg: metric(act.stepsAvg),
      stepsDays: count(act.stepsDays, 0, FITAI_MAX_DAYS),
      activeKcalTotal: metric(act.activeKcalTotal),
      sleepAvgH: metric(act.sleepAvgH),
      sleepNights: count(act.sleepNights, 0, FITAI_MAX_DAYS),
      restingHrAvg: metric(act.restingHrAvg),
      restingHrDays: count(act.restingHrDays, 0, FITAI_MAX_DAYS),
      hrAvg: metric(act.hrAvg)
    }
  };
}

/* ---------- one session being tuned, for a `session` job ----------
   The one task where the model does set day-to-day loads, so the block it reads has to be the
   session rather than the plan: the routine about to be trained, the last few times each of its
   exercises was trained, and the app's own deterministic prescription.

   All three arrive from the client, not from here. `core/` is framework-free and shares no build
   step with the app, and the prescription itself *is* the app's progression engine
   (frontend/src/lib/progression.js) — there is nothing on this side that could recompute it, so
   a server that derived `base` itself would be inventing it. Everything is therefore allowlisted
   here exactly like the rest of the file: the app writes these from client state, and a field
   this module does not name must not reach the provider.

   `yesterday` and `today` are the FitAI bridge's single-day blocks. The seven-day window the
   review and the session both read is the fuel block above; these two are what "trained fasted"
   and "slept four hours" actually rest on, and the window averages do not carry it. */
const SESSION_MAX_EX = 20;
const SESSION_HISTORY_PER_EX = 5;
// The prescription's own vocabulary (frontend/src/lib/progression.js). Anything else is not a
// prescription kind, and a kind the app does not have cannot be reasoned about.
const SESSION_KINDS = ['first', 'up', 'hold', 'deload', 'off'];

function cleanSessionEx(e) {
  // cleanEx already reduces an exercise to the fields that decide whether it has changed, mode
  // aware; the one thing session.md also asks for is the rest the plan gives this exercise.
  const o = cleanEx(e);
  const rest = num(e.restSec ?? e.rest);
  if (rest !== undefined) o.restSec = rest;
  return o;
}
function cleanSessionRoutine(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return {
    id: ident(r.id),
    name: r.name == null ? r.name : text(String(r.name), NAME_MAX),
    ...(policy(r.prog) ? { prog: r.prog } : {}),
    ex: list(r.ex).filter(e => e && typeof e === 'object').slice(0, SESSION_MAX_EX).map(cleanSessionEx)
  };
}
/** Last few times each exercise was trained, oldest-first, as the prompt reads them. */
function cleanSessionHistory(h) {
  const pairs = [];
  if (!h || typeof h !== 'object' || Array.isArray(h)) return pairs;
  for (const [id, sessions] of Object.entries(h)) {
    if (pairs.length >= SESSION_MAX_EX) break;
    const exId = ident(id);
    if (!exId || !Array.isArray(sessions)) continue;
    const rows = sessions
      .filter(s => s && typeof s === 'object' && day(s.d))
      .slice(-SESSION_HISTORY_PER_EX)
      .map(s => ({
        d: day(s.d),
        ...(word(s.summary, 60) ? { summary: word(s.summary, 60) } : {}),
        ...(num(s.weight) !== undefined ? { weight: num(s.weight) } : {}),
        ...(num(s.reps) !== undefined ? { reps: num(s.reps) } : {})
      }))
      .filter(r => r.summary !== undefined || r.weight !== undefined || r.reps !== undefined);
    if (rows.length) pairs.push([exId, rows]);
  }
  return pairs;
}
/** The app's prescription per exercise. The model treats it as the default, not as a suggestion. */
function cleanSessionBase(b) {
  const pairs = [];
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    for (const [id, t] of Object.entries(b)) {
      if (pairs.length >= SESSION_MAX_EX) break;
      const exId = ident(id);
      if (!exId || !t || typeof t !== 'object') continue;
      const clean = {};
      for (const k of ['weight', 'reps', 'sets', 'sec', 'restSec']) if (num(t[k]) !== undefined) clean[k] = num(t[k]);
      if (SESSION_KINDS.includes(t.kind)) clean.kind = t.kind;
      pairs.push([exId, clean]);
    }
  }
  return pairs;
}
// `Object.fromEntries`, not assignment into a literal: a JSON body may carry a key called
// `__proto__`, and assigning it on a plain object is a prototype write rather than a field.
const keyed = pairs => Object.fromEntries(pairs);

/** One FitAI day, for the `yesterday`/`today` blocks. */
function cleanFitaiDay(d) {
  const o = obj(d);
  const at = day(o.date);
  if (!at) return null;
  const out = { date: at };
  for (const k of ['kcal', 'protein', 'carbs', 'fat', 'sleepH', 'restingHr', 'steps', 'activeKcal']) {
    const v = metric(o[k]);
    if (v !== null) out[k] = v;
  }
  if (word(o.fasting, 24)) out.fasting = word(o.fasting, 24);
  return out;
}

/* ---------- one workout, for a debrief ---------- */
export function findWorkout(S, workoutId) {
  const all = (S.workouts || []).filter(w => w && w.d);
  return (workoutId && all.find(w => w.id === workoutId)) || all[all.length - 1] || null;
}
/** The little a debrief's card needs to name the session: id, date, name and four numbers. */
export function workoutMeta(S, workoutId) {
  const w = findWorkout(S, workoutId);
  if (!w) return null;
  let vol = 0;
  let sets = 0;
  (w.entries || []).forEach(en => (en.sets || []).forEach(s => {
    if (!s.done || isWarmupSet(s)) return;
    sets++;
    vol += (s.w || 0) * (s.r || 0);
  }));
  return {
    id: w.id || null, d: w.d, name: w.name || null,
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    vol: Number.isFinite(w.vol) ? Math.round(w.vol) : Math.round(vol),
    sets, prs: (w.prs || []).length
  };
}

/**
 * Build a job payload.
 *
 * @param {object} S      the profile's synced state
 * @param {object} opts   { handle, kind, intake?, note?, refine?, previous?, workoutId?, cohort?, lang?,
 *                          session?, fitai? }
 *
 * `session` is `{ routine, history, base, yesterday, today }` and is only read for
 * `kind: 'session'` — the block the app sends with the session it is about to train (see the
 * cleaners above). `fitai` is the bridge's seven-day summary, added for every kind.
 *
 * `handle` is the opaque per-profile pseudonym the payload carries instead of a uid. It is
 * supplied rather than derived because the two runtimes mint it differently: the server keys
 * an HMAC on its instance secret (api/coach/handle.js), the phone draws a random one once and
 * keeps it. Either way it is 16 characters and never the uid.
 */
export function build(S, opts = {}) {
  if (typeof opts.handle !== 'string' || !opts.handle) throw new Error('payload.build: opts.handle is required');
  const coach = S.coach || {};
  const profile = opts.intake || coach.profile || null;
  const p = {
    coach_contract: CONTRACT,
    task: opts.kind === 'review' ? 'review' : opts.kind === 'debrief' ? 'debrief' : opts.kind === 'session' ? 'session' : 'create',
    meta: {
      profile: opts.handle,
      // Both are short codes in any real state; cut anyway, since the state is the client's.
      // `opts.lang` is the language the app is showing when it asked: a profile that never
      // picked one has it worked out per device and never stored (#303).
      lang: langTag(opts.lang) || word(S.lang, 16) || 'en',
      unit: word(S.unit, 8) || 'kg',
      effortScale: effortOf(S),
      today: iso(new Date())
    },
    coachProfile: profile && typeof profile === 'object' ? cleanProfile(profile) : null,
    plan: cleanPlan(S)
  };

  // What the user already turned down, so the Coach does not re-propose it without new
  // evidence (FR-26). Summaries only — the log's full before/after stays on the device.
  const declined = (coach.log || [])
    // `why` was the Coach's own sentence, but it comes back from the synced state, which the
    // client writes; it is cut at the length the intake allows a note.
    .flatMap(e => (e.decisions || []).filter(d => d.status === 'rejected').map(d => ({ type: word(d.type, PROFILE_WORD_MAX), why: text(d.why, PROFILE_TEXT_MAX.notes) })))
    .slice(-15);
  if (declined.length) p.previouslyDeclined = declined;

  if (opts.kind === 'debrief') {
    // One session, read closely: the workout itself, the last few times the same routine was
    // trained, and the stall picture for the exercises in it. No library — a debrief changes
    // nothing and names nothing new.
    const w = findWorkout(S, opts.workoutId);
    if (w) {
      const all = (S.workouts || []).filter(x => x && x.d);
      const idx = all.indexOf(w);
      const previous = all.slice(0, idx).filter(x => x.name && x.name === w.name).slice(-3);
      p.session = { id: ident(w.id) || null, ...cleanWorkout(w) };
      p.previous = previous.map(cleanWorkout);
      const inSession = new Set(entriesOf(w).map(en => ident(en.id)));
      const agg = aggregates(S, [w]);
      p.aggregates = { ...agg, exercises: agg.exercises.filter(e => inSession.has(e.id)) };
      // The four weeks before the session. A session whose date does not parse has no "before",
      // and used to throw here instead.
      const on = day(w.d);
      const since = new Date(on + 'T12:00:00');
      since.setDate(since.getDate() - 28);
      const dated = !!on && Number.isFinite(since.getTime());
      p.bodyweight = { goal: num(S.targetW) ?? null, series: dated ? weighIns(S, iso(since), on) : [] };
    } else {
      p.session = null;
      p.previous = [];
    }
    if (opts.cohort) p.cohort = cleanCohort(opts.cohort);
  } else if (opts.kind === 'review') {
    const workouts = reviewWindow(S, coach.lastReview?.at ? String(coach.lastReview.at).slice(0, 10) : null);
    const detailFrom = Math.max(0, workouts.length - FULL_DETAIL_SESSIONS);
    p.window = {
      from: day(workouts[0]?.d),
      to: day(workouts[workouts.length - 1]?.d),
      workouts: workouts.map((w, i) => (i >= detailFrom ? cleanWorkout(w) : compactWorkout(w)))
    };
    p.aggregates = aggregates(S, workouts);
    p.bodyweight = { goal: num(S.targetW) ?? null, series: weighIns(S, p.window.from, null) };
    if (opts.note) p.userNote = String(opts.note).slice(0, MAX_NOTE_CHARS);
    if (opts.cohort) p.cohort = cleanCohort(opts.cohort);
    // A review names mostly what is already trained; 60 candidates is plenty for a swap.
    p.library = librarySlice(S, p.coachProfile?.equipment, { keep: trainedIds(S, workouts), max: 60 });
  } else if (opts.kind === 'session') {
    // Today's session, as the app computed it. `routine` is the whole context: no library slice
    // (a session names nothing new), no week (the day is already chosen). The fuel block is
    // added below like every other kind, and the two single days ride with it when sent.
    const session = (opts.session && typeof opts.session === 'object' && !Array.isArray(opts.session)) ? opts.session : {};
    p.routine = cleanSessionRoutine(session.routine);
    p.history = keyed(cleanSessionHistory(session.history));
    p.base = keyed(cleanSessionBase(session.base));
    p.yesterday = cleanFitaiDay(session.yesterday);
    p.today = cleanFitaiDay(session.today);
  } else {
    p.library = librarySlice(S, p.coachProfile?.equipment, { keep: trainedIds(S, S.workouts || []) });
    // Creation for a returning user: what they have actually handled, so proposed baselines
    // start from evidence rather than optimism (B2/FR-20).
    const best = {};
    (S.workouts || []).forEach(w => (w.entries || []).forEach(en => en.sets?.forEach(s => {
      if (s.done && s.w > 0 && !isWarmupSet(s)) best[en.id] = Math.max(best[en.id] || 0, s.w);
    })));
    if (Object.keys(best).length) {
      p.history = {
        sessions: (S.workouts || []).length,
        since: day((S.workouts || [])[0]?.d),
        workingWeights: Object.entries(best).map(([id, w]) => ({ id: ident(id), name: libraryName(id), best: w }))
      };
    }
    if (opts.refine && opts.previous) {
      p.refine = { text: String(opts.refine).slice(0, MAX_NOTE_CHARS), previous: opts.previous };
    } else if (opts.refine) {
      // "Refine" with nothing to refine: the first plan failed, or was dismissed, and the
      // person typed what they want instead. That is a fresh plan with a note, not a
      // revision of a plan that does not exist — refine.md would be reading `previous: null`.
      p.userNote = String(opts.refine).slice(0, MAX_NOTE_CHARS);
    }
  }
  // The fuel block, when there is one to add. After the kind branches on purpose: a review, a
  // debrief and a session job all read the same seven-day window, so the block is built once
  // here and is identical for each of them. Unlinked, none of the keys exist at all.
  if (opts.fitai && typeof opts.fitai === 'object') Object.assign(p, cleanFitai(opts.fitai));
  // Girths ride along with a review, a debrief and a plan change — the three jobs that write a
  // rationale and can therefore cite them — and never with a session job. A `session` job tunes
  // today's targets, and today's targets come from the logged sets, not from a tape: nothing here
  // may reach that output. Same shape as the fuel block above: a person who has never measured
  // gets no key at all, so an untouched profile's payload is byte-identical to a build from before
  // this existed.
  if (opts.kind !== 'session') {
    const girth = cleanMeasurements(S);
    if (girth) p.measurements = girth;
  }
  if (opts.kind !== 'debrief' && opts.kind !== 'session') {
    const said = conversation(coach, [opts.note, opts.refine]);
    if (said.length) p.conversation = said;
  }
  return p;
}

// The last few lines of the chat, so "shorter, like last time" has something to point at.
// The user's own lines (data, never instruction — common.md rule 3) and the Coach's earlier
// verdicts; never proposals, errors or the intake card, which travel in their own fields or
// are noise. Six lines, cut short: enough to resolve a reference, not a transcript to argue
// with. The message being sent right now rides in userNote/refine, so it is left out here.
export const CONVERSATION_LINES = 6;
export const CONVERSATION_CHARS = 240;
function conversation(coach, current) {
  const now = new Set((current || []).filter(Boolean).map(x => String(x).trim()));
  return (coach.chat || [])
    .filter(m => m && typeof m.text === 'string' && m.text.trim()
      && ((m.role === 'user' && m.kind === 'text') || (m.role === 'coach' && (m.kind === 'nochange' || m.kind === 'text'))))
    .filter(m => !(m.role === 'user' && now.has(m.text.trim())))
    .slice(-CONVERSATION_LINES)
    .map(m => ({ who: m.role === 'user' ? 'user' : 'coach', text: m.text.trim().slice(0, CONVERSATION_CHARS) }));
}
