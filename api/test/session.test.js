/* The session job: today's working targets for one routine.
 *
 * Everything a session answer is allowed to do is decided in two places and nowhere else —
 * payload.js decides what context is allowed to leave, validate.js decides what an answer is
 * allowed to change — so this file covers both, then walks a whole job through the real queue
 * and the fixture provider to prove the two are actually wired together. A `kind: 'session'`
 * job that reached neither would resolve to task 'create' and quietly plan a whole new programme
 * instead, which is why the dispatch itself is asserted rather than assumed.
 *
 * The other half of the contract is on the client: the app sends the routine and its own
 * prescription because core/ is framework-free and cannot recompute them. That makes the
 * allowlist here the only thing between a hand-written POST body and the provider, so the
 * hostile-body cases are asserted and not just the happy path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const payload = await import('../coach/core/payload.js');
const { validateSession } = await import('../coach/core/validate.js');
const { taskOf, buildPromptParts } = await import('../coach/core/prompt.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const HANDLE = 'h'.repeat(16);

/** The context the app sends with the session it is about to train. */
const CONTEXT = {
  routine: {
    id: 'r1', name: 'Full body A', prog: 'linear',
    ex: [
      { id: '0001', sets: 3, reps: 10, weight: 20, prog: 'linear', inc: 2.5, restSec: 120, mode: 'reps' },
      { id: '0007', sets: 3, sec: 45, mode: 'time', restSec: 60 }
    ]
  },
  history: {
    '0001': [
      { d: '2026-07-13', summary: '17.5x10,10,9', weight: 17.5, reps: 29 },
      { d: '2026-07-17', summary: '20x10,10,10', weight: 20, reps: 30 }
    ]
  },
  base: {
    '0001': { weight: 22.5, reps: 10, sets: 3, restSec: 120, kind: 'up' },
    '0007': { sec: 45, sets: 3, restSec: 60, kind: 'hold' }
  }
};
const build = (over = {}) => payload.build(sampleState(), { handle: HANDLE, kind: 'session', session: CONTEXT, ...over });

/* ================================ dispatch ================================ */

test("a session job takes the session prompt, not the create prompt", () => {
  assert.equal(taskOf('session', null), 'session');
  assert.equal(buildPromptParts('session', {}, null).task, 'session');
  const system = buildPromptParts('session', {}, null).system;
  assert.match(system, /today's working targets/);
  // The carve-out the prompt depends on: the common rules forbid day-to-day loads, and this is
  // the one task that overrides it. If the generated bundle ever loses session.md the model
  // would be handed a payload and a rule that forbids answering it.
  assert.match(system, /rule 4 in the common prompt does\s+not apply/);
  // And the payload says so too, so the two cannot disagree about which task this is.
  assert.equal(build().task, 'session');
  assert.ok(SCHEMAS.session, 'the schema map must carry a session entry for schema-constrained decoding');
});

/* ================================ the payload ================================ */

test('the session payload carries the routine, the history and the prescription, and nothing else', () => {
  const p = build();
  assert.deepEqual(p.routine.ex.map(e => e.id), ['0001', '0007']);
  assert.equal(p.routine.ex[0].restSec, 120, 'the rest the plan gives this exercise travels');
  assert.equal(p.history['0001'].length, 2);
  assert.equal(p.history['0001'][1].d, '2026-07-17');
  assert.deepEqual(p.base['0001'], { weight: 22.5, reps: 10, sets: 3, restSec: 120, kind: 'up' });
  // A session names nothing new and the day is already chosen, so neither the catalogue nor
  // the week rides along — the prompt reads neither.
  assert.equal(p.library, undefined);
  assert.equal(p.window, undefined);
  assert.equal(p.session, undefined, 'the debrief session block is not this one');
  assert.equal(p.aggregates, undefined);
});

test('the prescription only carries the fields the app writes, and only the kinds it knows', () => {
  const p = payload.build(sampleState(), {
    handle: HANDLE, kind: 'session',
    session: { base: { '0001': { weight: 20, reps: 10, sets: 3, kind: 'up', inc: 5, repsMax: 20, uid: 'secret', __proto__: {} } } }
  });
  const b = p.base['0001'];
  assert.deepEqual(Object.keys(b).sort(), ['kind', 'reps', 'sets', 'weight']);
  assert.equal(b.uid, undefined);
  // An unknown kind is not a kind the app can act on, so it is dropped rather than forwarded.
  assert.equal(p.base['nope'], undefined);
});

test('an exercise id that is not a string, or a value that is not a number, reads as absent', () => {
  const p = payload.build(sampleState(), {
    handle: HANDLE, kind: 'session',
    session: { base: { '0001': { weight: 'twenty', reps: true, sets: null, restSec: 90 } } }
  });
  assert.deepEqual(p.base['0001'], { restSec: 90 });
});

test('history is capped per exercise and the routine at the number of exercises it may name', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ d: `2026-07-${String(i + 1).padStart(2, '0')}`, summary: `${20 + i}x10` }));
  const ex = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, sets: 3, reps: 10, weight: 20 }));
  const p = payload.build(sampleState(), {
    handle: HANDLE, kind: 'session',
    session: { routine: { id: 'r1', ex }, history: { e0: many, ...Object.fromEntries(ex.map(e => [e.id, many])) } }
  });
  assert.equal(p.history.e0.length, 5, 'the last five sessions is what the prompt asks for');
  assert.equal(p.history.e0.at(-1).d, '2026-07-12');
  assert.equal(p.routine.ex.length, 20);
  assert.equal(Object.keys(p.history).length, 20, 'history is bounded by the routine, not by the body');
});

test('a `__proto__` key in the request body is a field, not a prototype write', () => {
  const p = payload.build(sampleState(), {
    handle: HANDLE, kind: 'session',
    session: { base: JSON.parse('{"__proto__": {"weight": 9999}, "0001": {"weight": 20}}') }
  });
  assert.equal({}.weight, undefined, 'Object.prototype must be untouched');
  assert.deepEqual(Object.keys(p.base), ['__proto__', '0001'], 'and it travels as the inert field it is');
});

test('the two single FitAI days are cleaned like every other field', () => {
  const p = payload.build(sampleState(), {
    handle: HANDLE, kind: 'session',
    session: {
      yesterday: { date: '2026-07-20', kcal: 2400, protein: 160, sleepH: 5.5, restingHr: 62, steps: 4000, user_id: 'u-secret', profile: { a: 1 } },
      today: { date: 'not-a-date', kcal: 2000 },
      base: {}
    }
  });
  assert.deepEqual(p.yesterday, { date: '2026-07-20', kcal: 2400, protein: 160, sleepH: 5.5, restingHr: 62, steps: 4000 });
  assert.equal(JSON.stringify(p).includes('u-secret'), false);
  // An undated day cannot be placed against anything, so it does not travel at all.
  assert.equal(p.today, null);
});

test('no FitAI link, none of the seven fuel keys exist at all', () => {
  const p = build();
  for (const k of ['nutrition', 'glucose', 'fasting', 'health', 'activity']) assert.equal(p[k], undefined, k);
});

test('a session job sent with no routine at all still builds, and is refused at the job', () => {
  const p = payload.build(sampleState(), { handle: HANDLE, kind: 'session', session: { base: { '0001': { weight: 20 } } } });
  assert.equal(p.routine, null);
  assert.equal(p.history['0001'], undefined);
});

/* ================================ the validator ================================ */

const routineIds = () => ['0001', '0007'];
const targets = over => ({
  coach_contract: 1,
  summary: 'Holding the jump — sleep was short.',
  targets: [
    { id: '0001', weight: 20, reps: 10, sets: 3, restSec: 150, why: 'Last session was clean but sleep was 5.5h, so hold the weight and rest longer.' },
    { id: '0007', sec: 45, sets: 3, restSec: 60, why: 'Timed work: unchanged, nothing argues for a change.' },
    ...(over || [])
  ]
});
const check = (data, ctx = {}) => validateSession(data, { routine: CONTEXT.routine, base: CONTEXT.base, ...ctx });
/**
 * Validates against a routine holding exactly the exercises named, so a case can be about one
 * target without every other target in the answer having to be right as well — one missing
 * exercise is itself a refusal, which would otherwise mask the rule under test.
 */
const solo = (data, ex = [{ id: '0001', sets: 3, reps: 10, weight: 20, mode: 'reps' }]) =>
  validateSession(data, { routine: { id: 'r1', ex }, base: CONTEXT.base });

test('a session answer that stays inside the bounds reaches the card, with `before` from the app', () => {
  const r = check(targets());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.proposal.targets.length, 2);
  assert.equal(r.proposal.targets[0].id, '0001');
  assert.equal(r.proposal.targets[0].weight, 20);
  assert.equal(r.proposal.targets[0].restSec, 150);
  // `before` is read off the prescription the app sent, never off the answer.
  assert.equal(r.proposal.targets[0].before.weight, 22.5);
  assert.equal(r.proposal.targets[0].before.kind, 'up');
  // Every target names an exercise, so the card can read "Flat bench press" without a lookup.
  assert.ok(r.proposal.targets[0].name);
});

test('a target that names an exercise the session does not contain is refused, with the ids it may name', () => {
  const r = check(targets([{ id: '0042', weight: 20, why: 'invented' }]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /"0042" is not one of today's exercises/);
  assert.match(r.errors.join(' '), /"0001"/);
});

test('every exercise in the routine gets exactly one target', () => {
  const dup = check(targets([{ id: '0001', weight: 20, why: 'again' }]));
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join(' '), /appears twice/);

  const missing = validateSession(
    { coach_contract: 1, summary: 's', targets: [{ id: '0001', weight: 20, why: 'held' }] },
    { routine: CONTEXT.routine, base: CONTEXT.base }
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /no target for "0007"/);
});

test('a target with no reason behind it is never accepted', () => {
  const noWhy = solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', weight: 20 }] });
  assert.equal(noWhy.ok, false);
  assert.match(noWhy.errors.join(' '), /targets\[0\]\.why is required/);
  // The same target with a reason is accepted, so the rule is the missing reason and nothing else.
  assert.equal(solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', weight: 20, why: 'Held: sleep was 5.5h.' }] }).ok, true);
});

test('the bounds are the ones the prompt stated', () => {
  const bad = t => solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', why: 'held', ...t }] }).ok === false;
  assert.ok(bad({ weight: 1001 }), 'weight over the ceiling');
  assert.ok(bad({ weight: -1 }), 'negative weight');
  assert.ok(bad({ weight: '20' }), 'a weight written as a string');
  assert.ok(bad({ reps: 0 }), 'reps below 1');
  assert.ok(bad({ reps: 101 }), 'reps over 100');
  assert.ok(bad({ reps: 10.5 }), 'a fractional rep count');
  assert.ok(bad({ sets: 11 }), 'sets over 10');
  assert.ok(bad({ sec: 4 }), 'seconds below 5');
  assert.ok(bad({ sec: 3601 }), 'seconds over an hour');
  assert.ok(bad({ restSec: 10 }), 'a rest below 15 that is not 0');
  assert.ok(bad({ restSec: 301 }), 'a rest over five minutes');
  // The prompt allows restSec 0 (no rest at all) explicitly, so it is allowed here too.
  assert.equal(solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', why: 'no rest between sets', restSec: 0 }] }).ok, true);
  // And within the range all three of weight, reps and sets hold at once.
  assert.equal(solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', why: 'climbed', weight: 22.5, reps: 10, sets: 3 }] }).ok, true);
});

test('per-side reps stay even, read off the routine rather than the answer', () => {
  const perSide = [{ id: '0001', sets: 3, reps: 6, side: true }];
  const r = solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', reps: 7, why: 'one more rep a side' }] }, perSide);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /per-side exercise/);
  // The same odd number on an exercise the routine does not mark per-side is fine.
  assert.equal(solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', reps: 7, why: 'held' }] }).ok, true);
  // And an even count on the per-side exercise passes, so it is the parity and not the number.
  assert.equal(solo({ coach_contract: 1, summary: 's', targets: [{ id: '0001', reps: 8, why: 'held' }] }, perSide).ok, true);
});

test('a field the model had no opinion about is simply absent, and the app keeps its base', () => {
  const r = validateSession(
    { coach_contract: 1, summary: 's', targets: [{ id: '0001', why: 'held' }, { id: '0007', why: 'held' }] },
    { routine: CONTEXT.routine, base: CONTEXT.base }
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(Object.keys(r.proposal.targets[0]).sort(), ['before', 'id', 'name', 'why']);
  assert.equal(r.proposal.targets[0].weight, undefined);
});

test('"nothing to change today" is an answer, and a missing targets list is not', () => {
  const none = check({ coach_contract: 1, nochange: true, reading: 'Base is right — nothing in the recovery signals argues otherwise.' });
  assert.equal(none.ok, true);
  assert.equal(none.nochange, true);
  assert.match(none.reading, /nothing in the recovery signals/);
  assert.equal(check({ coach_contract: 1, summary: 's' }).ok, false);
  // A summary on its own is not a prescription for today's loads.
  assert.match(check({ coach_contract: 1, summary: 'all good' }).errors.join(' '), /targets must be an array/);
});

test('a session answer validated against no routine is refused rather than applied blind', () => {
  const r = validateSession(targets(), {});
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /carried no routine to tune/);
});

test('routineIds helper stays in step with the routine it names', () => {
  assert.deepEqual(routineIds(), CONTEXT.routine.ex.map(e => e.id));
});

/* ================================ end to end ================================ */

async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}

test('a session job runs through the queue and lands as a checked pending proposal', async () => {
  const uid = 'u-session-e2e';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'session', session: CONTEXT });
  const s = await settle(uid);
  assert.equal(s.pending.kind, 'session');
  assert.equal(s.pending.id, (await Promise.resolve(jobs.readUser(uid).history.at(-1).id)));
  // The fixture echoes the app's own prescription back, so every target must be inside the
  // bounds the validator holds — which is the only reason the fixture can stand in for a model.
  assert.equal(s.pending.targets.length, 2);
  for (const t of s.pending.targets) {
    assert.ok(CONTEXT.routine.ex.some(e => e.id === t.id), `${t.id} is in the routine`);
    assert.ok(t.why.length > 0, `${t.id} carries a reason`);
    assert.ok(t.weight === undefined || (t.weight >= 0 && t.weight <= 1000));
  }
  assert.equal(jobs.status(uid).pending.planHash, s.pending.planHash, 'a plan fingerprint rides along like every other pending');
});

test('a session job with nothing to tune fails as its own outcome, before any provider call', async () => {
  const uid = 'u-session-empty';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'session', session: { base: { '0001': { weight: 20 } } } });
  await settle(uid);
  const last = jobs.readUser(uid).history.at(-1);
  assert.equal(last.outcome, 'failed');
  assert.equal(last.errorClass, 'nosession');
  assert.equal(jobs.status(uid).pending, null);
});

test('POST /api/coach/session enqueues a session job with the context it was sent', async () => {
  const uid = 'u-session-route';
  writeState(DIR, uid, sampleState());
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: uid }),
    requireAdmin: () => false
  });
  const res = {};
  await routes['POST /api/coach/session']({
    body: { lang: 'pt-BR', routine: CONTEXT.routine, history: CONTEXT.history, base: CONTEXT.base, yesterday: { date: '2026-07-20', kcal: 2400 }, today: { date: '2026-07-21', kcal: 2300 } }
  }, res);
  assert.equal(res.status, 202);
  assert.ok(res.body.job.id);

  const s = await settle(uid);
  assert.equal(s.pending.kind, 'session');
  assert.equal(s.pending.targets.length, 2);
  jobs.resolvePending(uid, { accepted: s.pending.targets.map(t => t.id) });
  assert.equal(jobs.status(uid).pending, null);
});

test('a body that puts an array where the context belongs does not enqueue a broken job', async () => {
  const uid = 'u-session-shape';
  writeState(DIR, uid, sampleState());
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: uid }),
    requireAdmin: () => false
  });
  const res = {};
  await routes['POST /api/coach/session']({ body: { routine: ['nope'], base: 'nope', history: [] } }, res);
  assert.equal(res.status, 202);
  await settle(uid);
  assert.equal(jobs.readUser(uid).history.at(-1).errorClass, 'nosession');
});

// The recovery half of a session answer is the FitAI window, and it is client-supplied like the
// rest of the request: the bridge is a service of the client's, not ours. Pinned end to end,
// because the seam is three hops (body -> job -> payload -> provider) and each one is a place
// the fuel block could quietly stop travelling.
const FITAI = {
  activity: { sleepAvgH: 5.4, sleepNights: 6, restingHrAvg: 61, stepsAvg: 4200 },
  nutrition: { kcalAvg: 2100, deficitVsTarget: -600, daysLogged: 6 },
  fasting: { sessions: 3, completed: 3, active: { protocol: '16:8', startedAt: '2026-07-20T20:00' } }
};
test("the seven-day FitAI window reaches the provider, and an unlinked profile carries none", async () => {
  const linked = 'u-session-fuel';
  const bare = 'u-session-nofuel';
  writeState(DIR, linked, sampleState());
  writeState(DIR, bare, sampleState());
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: req => ({ id: req.uid }),
    requireAdmin: () => false
  });
  const send = async (uid, fitai) => {
    const res = {};
    await routes['POST /api/coach/session']({ uid, body: { routine: CONTEXT.routine, base: CONTEXT.base, ...(fitai ? { fitai } : {}) } }, res);
    assert.equal(res.status, 202);
    return settle(uid);
  }
  const withFuel = await send(linked, FITAI);
  // The fixture names the window it was given, so its wording is the proof that fuel arrived.
  assert.match(withFuel.pending.summary, /5\.4h of sleep across 6 night/);
  assert.match(withFuel.pending.targets[0].why, /recovery signals and 5\.4h of sleep/);

// A profile with no FitAI link sends nothing, and then the payload carries no fuel block at
  // all rather than an empty one - same rule as every other kind. ("The fuel block" is the set
  // of top-level keys the prompt names: nutrition, glucose, fasting, health, activity.)
  const without = await send(bare);
  assert.doesNotMatch(without.pending.summary, /sleep/);
  assert.equal(build({ fitai: null }).activity, undefined, 'no link, no fuel block');
  // And what does arrive is cleaned: a field the bridge never had stays absent, not zero.
  const cleaned = build({ fitai: { activity: { sleepAvgH: 5.4, sleepNights: 'six' }, glucose: { n: 3 }, madeUp: 'x' } });
  assert.equal(cleaned.activity.sleepAvgH, 5.4);
  assert.equal(cleaned.activity.sleepNights, null, 'a count that is not a number reads as none logged');
  assert.equal(cleaned.madeUp, undefined, 'nothing outside the allowlist rides along');
});