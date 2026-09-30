/* The FitAI block in Coach payloads: five flat keys matching the consent
 * categories, present for every job kind when linked, absent when not — and
 * copied field by field, never passed through. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { handleFor } = await import('../coach/handle.js');
const { DATA_CATEGORIES } = await import('../coach/core/categories.js');

const FITAI = {
  window: { from: '2026-09-22', to: '2026-09-28', days: 7 },
  targets: { calories: 2000, protein: 150, carbs: 200, fat: 65, tdee: 2400 },
  nutrition: {
    daysLogged: 2, kcalAvg: 1497, proteinAvg: 63, deficitVsTarget: 903, proteinVsTarget: 87,
    days: [
      { date: '2026-09-27', kcal: 400, protein: 40, carbs: 30, fat: 10, fiber: 5 },
      { date: '2026-09-28', kcal: 593, protein: 86, carbs: 70, fat: 11, fiber: 22 }
    ]
  },
  glucose: {
    n: 2, fastingAvg: 88, postMealAvg: 150, max: 150,
    latest: { date: '2026-09-28', value: 88, meal_context: 'fasting' }
  },
  fasting: {
    sessions: 3, completed: 2,
    active: { protocol: '16:8', startedAt: '2026-09-28T16:45:00+00:00' }
  },
  body: { weightKg: 103, scan: { at: '2026-08-23T09:37:01.617Z', bodyFatPct: 32, leanKg: 62.6, fatKg: 29.4, type: 'endomorph' } },
  labs: {
    abnormal: [{ key: 'ldl_cholesterol', value: 160, unit: 'mg/dl', flag: 'high' }],
    normalCount: 24
  },
  conditions: [{ label: 'Type 2 diabetes', code: 'type_2_diabetes', status: 'confirmed' }],
  activity: { stepsAvg: 18593, stepsDays: 6, activeKcalTotal: 782.6, sleepAvgH: 7.2, sleepNights: 6, restingHrAvg: 58, restingHrDays: 6, hrAvg: 72 },
  // Anything the bridge never sends must not be able to ride along either.
  user_id: 'fc8647ef-81bb-443c-8ecd-c4d138c81f84',
  extra: { nested: 'junk' },
  // The intake-autofill block the summary carries for the UI. The Coach never
  // sees it: the intake answers already hold the goal, so a second copy would
  // only be a second source of truth.
  profile: { goal: 'cut', gender: 'male', activityLevel: 'moderate' }
};

const build = (kind, fitai) => payload.build(sampleState(), { handle: handleFor('u-fitai'), kind, fitai });

test('the consent categories name exactly the FitAI keys the payload can carry', () => {
  for (const k of ['nutrition', 'glucose', 'fasting', 'health', 'activity']) {
    assert.ok(DATA_CATEGORIES.includes(k), `${k} is disclosed`);
  }
});

for (const kind of ['review', 'debrief', 'create']) {
  test(`a ${kind} with linked FitAI carries the five fuel keys, cleaned`, () => {
    const p = build(kind, FITAI);
    assert.deepEqual(p.nutrition.targets, { calories: 2000, protein: 150, carbs: 200, fat: 65, tdee: 2400 });
    assert.equal(p.nutrition.kcalAvg, 1497);
    assert.equal(p.nutrition.deficitVsTarget, 903);
    assert.deepEqual(p.nutrition.days, [
      { date: '2026-09-27', kcal: 400, protein: 40 },
      { date: '2026-09-28', kcal: 593, protein: 86 }
    ]);
    assert.equal(p.glucose.fastingAvg, 88);
    assert.deepEqual(p.glucose.latest, { date: '2026-09-28', value: 88, meal: 'fasting' });
    assert.deepEqual(p.fasting.active, { protocol: '16:8', startedAt: '2026-09-28T16:45:00+00:00' });
    assert.deepEqual(p.health.conditions, [{ label: 'Type 2 diabetes', code: 'type_2_diabetes', status: 'confirmed' }]);
    assert.deepEqual(p.health.labs, [{ key: 'ldl_cholesterol', value: 160, unit: 'mg/dl', flag: 'high' }]);
    assert.equal(p.health.scan.leanKg, 62.6);
    assert.equal(p.activity.stepsAvg, 18593);
    assert.equal(p.activity.sleepAvgH, 7.2);
    assert.equal(p.activity.sleepNights, 6);
    assert.equal(p.activity.restingHrAvg, 58);
    assert.equal(p.activity.restingHrDays, 6);
    assert.equal(p.activity.hrAvg, 72);
    const json = JSON.stringify(p);
    assert.ok(!json.includes('fc8647ef'), 'the FitAI user id never leaves');
    assert.ok(!json.includes('junk'), 'unknown bridge fields never ride along');
    assert.ok(!json.includes('activityLevel'), 'the intake-autofill block stays client-side');
    assert.ok(!json.includes('fat_mass_kg') && !json.includes('29.4'), 'unlisted scan fields are dropped');
  });
}

for (const kind of ['review', 'debrief', 'create']) {
  test(`a ${kind} without linked FitAI is byte-identical to before`, () => {
    const p = build(kind, null);
    for (const k of ['nutrition', 'glucose', 'fasting', 'health', 'activity']) {
      assert.ok(!(k in p), `${kind} carries no ${k} when unlinked`);
    }
    const p2 = build(kind, undefined);
    assert.equal(JSON.stringify(p), JSON.stringify(p2));
  });
}

test('a hostile bridge object cannot smuggle types through', () => {
  const p = build('review', {
    window: { from: 'x', to: 'y', days: 'seven' },
    targets: { calories: 'a lot', protein: null },
    nutrition: { daysLogged: -5, kcalAvg: NaN, days: [{ date: 'not-a-day', kcal: 'tons' }, null, 42] },
    glucose: { n: 2, latest: 'spike!' },
    fasting: { active: ['16:8'] },
    body: { weightKg: 'heavy' },
    labs: { abnormal: [{ key: 'x'.repeat(500) }] },
    conditions: 'diabetes',
    activity: null
  });
  assert.deepEqual(p.nutrition.targets, { calories: null, protein: null, carbs: null, fat: null, tdee: null });
  assert.deepEqual(p.nutrition.days, []);
  assert.equal(p.glucose.latest, null);
  assert.equal(p.fasting.active, null);
  assert.equal(p.health.weightKg, null);
  assert.ok(p.health.labs[0].key.length <= 40, 'bounded like every other free string');
  assert.deepEqual(p.health.conditions, []);
});
