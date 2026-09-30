/* FitAI bridge status probe — transport is mocked, never the network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isFitaiUserId, fitaiConfigured, statusFor, summaryFor, dayFor, isFitaiDay, clearFitaiCache } from '../fitai.js';

const ID = 'fc8647ef-81bb-443c-8ecd-c4d138c81f84';
const CFG = { url: 'https://example.supabase.co', key: 'k' };

// Table -> rows, keyed the way statusFor asks for them.
const mockFetch = (tables, { status = 200 } = {}) => async url => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    const table = new URL(url).pathname.split('/').pop();
    return tables[table] ?? [];
  }
});

test('isFitaiUserId accepts uuids and refuses typos', () => {
  assert.equal(isFitaiUserId(ID), true);
  assert.equal(isFitaiUserId(' ' + ID + ' '), true);
  assert.equal(isFitaiUserId('not-an-id'), false);
  assert.equal(isFitaiUserId(''), false);
  assert.equal(isFitaiUserId(null), false);
  assert.equal(isFitaiUserId(42), false);
});

test('fitaiConfigured is false unless both env pieces are present', () => {
  assert.equal(fitaiConfigured({ url: '', key: '', env: {} }), false);
  assert.equal(fitaiConfigured({ url: CFG.url, key: '', env: {} }), false);
  assert.equal(fitaiConfigured(CFG), true);
});

test('the FitAI NEXT_PUBLIC_SUPABASE_* names work as fallback', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: CFG.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' };
  assert.equal(fitaiConfigured({ env }), true);
  assert.equal(fitaiConfigured({ url: '', key: '', env: {} }), false);
});

test('a typo id is a 400 with no network traffic', async () => {
  let called = false;
  const fetch = async () => { called = true; throw new Error('must not be called'); };
  await assert.rejects(statusFor('nope', { ...CFG, fetch }), err => {
    assert.equal(err.status, 400);
    return true;
  });
  assert.equal(called, false);
});

test('a missing server key is a 503, not an upstream call', async () => {
  let called = false;
  const fetch = async () => { called = true; throw new Error('must not be called'); };
  await assert.rejects(statusFor(ID, { url: '', key: '', fetch }), err => {
    assert.equal(err.status, 503);
    return true;
  });
  assert.equal(called, false);
});

test('an unknown id is a 404 even when the tables answer', async () => {
  const fetch = mockFetch({ profiles: [], food_log: [], glucose_logs: [], fasting_logs: [] });
  await assert.rejects(statusFor(ID, { ...CFG, fetch }), err => {
    assert.equal(err.status, 404);
    return true;
  });
});

test('a known id returns targets, last food date and feature flags', async () => {
  const fetch = mockFetch({
    profiles: [{ id: ID, targets_calories: 2000, targets_protein: 150, tdee: 2400 }],
    food_log: [{ date: '2026-09-28' }],
    glucose_logs: [{ id: 'g1' }],
    fasting_logs: []
  });
  const s = await statusFor(ID, { ...CFG, fetch });
  assert.deepEqual(s, {
    ok: true,
    user_id: ID,
    targets: { calories: 2000, protein: 150, tdee: 2400 },
    lastFoodDate: '2026-09-28',
    hasGlucose: true,
    hasFasting: false
  });
});

test('an upstream failure surfaces as a 502 without leaking details', async () => {
  const fetch = mockFetch({}, { status: 500 });
  await assert.rejects(statusFor(ID, { ...CFG, fetch }), err => {
    assert.equal(err.status, 502);
    assert.ok(!String(err.message).includes('k'), 'no key material in the message');
    return true;
  });
});

test('a hung upstream surfaces as a 502', async () => {
  const fetch = async () => { throw new Error('socket hang up'); };
  await assert.rejects(statusFor(ID, { ...CFG, fetch }), err => {
    assert.equal(err.status, 502);
    return true;
  });
});

/* ---------- Phase 2: aggregates ---------- */

// Router mock: answers per table (and record_type for the wearable stream),
// recording every URL so the tests can assert the window filters.
const routerFetch = (routes, seen = []) => async url => {
  seen.push(url);
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const key = table + '|' + (u.searchParams.get('record_type') || '');
  return { ok: true, status: 200, json: async () => (routes[key] ?? routes[table] ?? []) };
};

const SUMMARY_ROWS = {
  profiles: [{ targets_calories: 2000, targets_protein: 150, targets_carbs: 200, targets_fat: 65, tdee: 2400, weight: 103, goal: 'cut', gender: 'male', activity_level: 'moderate' }],
  food_log: [
    { date: '2026-09-27', meal_type: 'lunch', calories: 400, protein_g: 40, carbs_g: 30, fat_g: 10, fiber_g: 5, sugar_g: 4, glycemic_load: 8 },
    { date: '2026-09-28', meal_type: 'lunch', calories: 413, protein_g: 78, carbs_g: 0, fat_g: 9, fiber_g: 0, sugar_g: 0, glycemic_load: 0 },
    { date: '2026-09-28', meal_type: 'snack', calories: 180, protein_g: 8, carbs_g: 30, fat_g: 2, fiber_g: 10, sugar_g: 6, glycemic_load: 4.5 }
  ],
  glucose_logs: [
    { date: '2026-09-28', value: 88, meal_context: 'fasting' },
    { date: '2026-09-28', value: 150, meal_context: 'after_meal' }
  ],
  fasting_logs: [
    { date: '2026-09-28', protocol: '16:8', status: 'active', planned_duration_min: 960, actual_duration_min: null, planned_start_at: '2026-09-28T16:45:00+00:00', actual_start_at: '2026-09-28T16:45:00+00:00', actual_end_at: null }
  ],
  body_scans: [{ scanned_at: '2026-05-03T19:30:01.083Z', body_fat_percentage: 35, lean_mass_kg: 66.95, fat_mass_kg: 36.05, body_type: 'endomorph' }],
  lab_results: [
    { biomarker_key: 'ldl_cholesterol', value: 160, unit: 'mg/dl', flag: 'high' },
    { biomarker_key: 'hemoglobin', value: 16.5, unit: 'g/dl', flag: 'normal' }
  ],
  conditions: [{ label: 'Type 2 diabetes', code: 'type_2_diabetes', status: 'confirmed' }],
  'health_connect_records|eq.steps': [
    // data_json arrives parsed (jsonb) — the string form is legacy only.
    { start_time: '2026-09-28T18:10:00+00:00', data_json: { type: 'steps', count: 264 } },
    { start_time: '2026-09-28T18:20:00+00:00', data_json: "{'type': 'steps', 'count': 306}" }
  ],
  'health_connect_records|eq.active_calories': [
    { start_time: '2026-09-28T13:30:00+00:00', data_json: { type: 'active_calories', calories: 5.5 } }
  ],
  'health_connect_records|in.(sleep_session,sleep)': [
    { start_time: '2026-09-27T22:30:00+00:00', end_time: '2026-09-28T06:00:00+00:00', data_json: { type: 'sleep_session' } },
    { start_time: '2026-09-26T23:00:00+00:00', end_time: '2026-09-27T06:30:00+00:00', data_json: { type: 'sleep', hours: 7.5 } }
  ],
  'health_connect_records|in.(heart_rate)': [
    { start_time: '2026-09-28T08:00:00+00:00', data_json: { bpm: 72 } },
    { start_time: '2026-09-28T09:00:00+00:00', data_json: { bpm: 78 } }
  ],
  'health_connect_records|in.(resting_heart_rate)': [
    { start_time: '2026-09-28T06:05:00+00:00', data_json: { bpm: 58 } },
    { start_time: '2026-09-27T06:05:00+00:00', data_json: { bpm: 60 } }
  ]
};

test('summaryFor aggregates a week into targets, days, glucose, fasting, labs and steps', async () => {
  clearFitaiCache();
  const fetch = routerFetch(SUMMARY_ROWS);
  const s = await summaryFor(ID, { ...CFG, fetch, days: 7, now: Date.parse('2026-09-28T20:00:00Z') });
  assert.equal(s.ok, true);
  assert.deepEqual(s.window, { from: '2026-09-22', to: '2026-09-28', days: 7 });
  assert.deepEqual(s.targets, { calories: 2400, protein: 150, carbs: 200, fat: 65, tdee: 2400 });
  assert.deepEqual(s.profile, { goal: 'cut', gender: 'male', activityLevel: 'moderate' });
  assert.equal(s.nutrition.daysLogged, 2);
  assert.equal(s.nutrition.kcalAvg, Math.round((400 + 413 + 180) / 2));
  assert.equal(s.nutrition.proteinAvg, (40 + 78 + 8) / 2);
  assert.equal(s.nutrition.deficitVsTarget, Math.round(2400 - (400 + 413 + 180) / 2));
  assert.deepEqual(s.glucose.latest, { date: '2026-09-28', value: 88, meal_context: 'fasting' });
  assert.equal(s.glucose.fastingAvg, 88);
  assert.equal(s.glucose.postMealAvg, 150);
  assert.equal(s.glucose.max, 150);
  assert.equal(s.fasting.sessions, 1);
  assert.equal(s.fasting.active.protocol, '16:8');
  assert.equal(s.body.weightKg, 103);
  assert.equal(s.body.scan.leanKg, 66.95);
  assert.deepEqual(s.labs.abnormal, [{ key: 'ldl_cholesterol', value: 160, unit: 'mg/dl', flag: 'high' }]);
  assert.equal(s.labs.normalCount, 1);
  assert.deepEqual(s.conditions, [{ label: 'Type 2 diabetes', code: 'type_2_diabetes', status: 'confirmed' }]);
  assert.equal(s.activity.stepsAvg, 570);
  assert.equal(s.activity.stepsDays, 1);
  assert.equal(s.activity.sleepAvgH, 7.5);
  assert.equal(s.activity.sleepNights, 2);
  assert.equal(s.activity.restingHrAvg, 59);
  assert.equal(s.activity.restingHrDays, 2);
  assert.equal(s.activity.hrAvg, 75);
});

test('summaryFor windows its queries and caches the second call', async () => {
  clearFitaiCache();
  const seen = [];
  const fetch = routerFetch(SUMMARY_ROWS, seen);
  const opts = { ...CFG, fetch, days: 7, now: Date.parse('2026-09-28T20:00:00Z') };
  await summaryFor(ID, opts);
  const first = seen.length;
  assert.ok(first >= 12, `expected 12 upstream queries, saw ${first}`);
  assert.ok(seen.some(u => u.includes('date=gte.') && u.includes('2026-09-22')), 'food window starts 7 days back');
  await summaryFor(ID, opts);
  assert.equal(seen.length, first, 'the repeat call serves from cache');
});

test('summaryFor refuses bad ids, bad windows and empty profiles', async () => {
  clearFitaiCache();
  const fetch = routerFetch(SUMMARY_ROWS);
  await assert.rejects(summaryFor('nope', { ...CFG, fetch }), { status: 400 });
  await assert.rejects(summaryFor(ID, { url: '', key: '', fetch }), { status: 503 });
  await assert.rejects(summaryFor(ID, { ...CFG, fetch: routerFetch({ profiles: [] }) }), { status: 404 });
});

test('dayFor returns one day of meals, glucose, fasting overlap and steps', async () => {
  clearFitaiCache();
  const fetch = routerFetch({
    food_log: [
      { meal_type: 'lunch', food_name: 'Grilled chicken', calories: 413, protein_g: 78, carbs_g: 0, fat_g: 9, fiber_g: 0, sugar_g: 0, glycemic_load: 0, logged_at: '2026-09-28T12:00:00Z' }
    ],
    glucose_logs: [{ date: '2026-09-28', value: 88, meal_context: 'fasting' }],
    fasting_logs: [
      { protocol: '16:8', status: 'active', planned_start_at: '2026-09-28T16:45:00+00:00', actual_start_at: '2026-09-28T16:45:00+00:00', actual_end_at: null, planned_duration_min: 960 }
    ],
    'health_connect_records|eq.steps': [{ data_json: "{'type': 'steps', 'count': 570}" }],
    'health_connect_records|eq.active_calories': [{ data_json: "{'type': 'active_calories', 'calories': 5.5}" }],
    'health_connect_records|in.(sleep_session,sleep)': [
      { start_time: '2026-09-27T22:30:00+00:00', end_time: '2026-09-28T06:00:00+00:00', data_json: {} }
    ],
    'health_connect_records|in.(heart_rate)': [{ data_json: { bpm: 74 } }],
    'health_connect_records|in.(resting_heart_rate)': [{ data_json: { bpm: 58 } }]
  });
  const d = await dayFor(ID, { ...CFG, fetch, date: '2026-09-28', now: Date.parse('2026-09-28T20:00:00Z') });
  assert.equal(d.ok, true);
  assert.equal(d.date, '2026-09-28');
  assert.deepEqual(d.totals, { kcal: 413, protein: 78, carbs: 0, fat: 9, fiber: 0 });
  assert.equal(d.meals.length, 1);
  assert.deepEqual(d.glucose, [{ value: 88, meal_context: 'fasting' }]);
  assert.equal(d.fasting.protocol, '16:8');
  assert.equal(d.fasting.elapsedMin, 195, '16:45 → 20:00 is 195 minutes fasted');
  assert.deepEqual(d.activity, { steps: 570, activeKcal: 5.5, sleepH: 7.5, hrAvg: 74, restingHr: 58 });
});

test('dayFor validates its date and parses the single-quote wearable payload', async () => {
  clearFitaiCache();
  const fetch = routerFetch({ food_log: [], glucose_logs: [], fasting_logs: {} });
  await assert.rejects(dayFor(ID, { ...CFG, fetch, date: 'yesterday' }), { status: 400 });
  const d = await dayFor(ID, { ...CFG, fetch: routerFetch({ food_log: [], glucose_logs: [], fasting_logs: [], 'health_connect_records|eq.steps': [{ data_json: 'garbage' }] }), date: '2026-09-28' });
  assert.deepEqual(d.activity, { steps: 0, activeKcal: 0, sleepH: null, hrAvg: null, restingHr: null });
  assert.equal(d.fasting, null);
});

test('isFitaiDay accepts ISO days only', () => {
  assert.equal(isFitaiDay('2026-09-28'), true);
  assert.equal(isFitaiDay('2026-9-8'), false);
  assert.equal(isFitaiDay('tomorrow'), false);
});
