/* Gym-photo scan: validation, taxonomy matching, and the provider call.
 *
 * Images never touch disk or the job log — these tests pin the parsing that guards the
 * 5 MB body budget, the taxonomy allowlist that keeps a model from inventing equipment,
 * and the unsupported path for runtimes with no vision model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const scan = await import('../coach/equipment-scan.js');

const tiny = (mime = 'image/jpeg') => `data:${mime};base64,${Buffer.from('hello').toString('base64')}`;

test('taxonomy comes from the catalogue and holds the familiar kit', () => {
  const tax = scan.taxonomy();
  assert.ok(tax.length >= 28);
  for (const k of ['dumbbell', 'barbell', 'cable', 'body weight']) assert.ok(tax.includes(k));
});

test('parseImages accepts up to 3 data URLs and rejects the rest', () => {
  assert.equal(scan.parseImages([tiny()]).length, 1);
  assert.equal(scan.parseImages([tiny(), tiny('image/png'), tiny('image/webp')]).length, 3);
  assert.throws(() => scan.parseImages([]), /photos/);
  assert.throws(() => scan.parseImages([tiny(), tiny(), tiny(), tiny()]), /at most 3/);
  assert.throws(() => scan.parseImages(['not-a-url']), /data URL/);
  assert.throws(() => scan.parseImages(['data:image/gif;base64,abcd']), /JPEG, PNG or WebP/);
});

test('parseImages rejects oversized photos before any provider is called', () => {
  const big = `data:image/jpeg;base64,${Buffer.alloc(scan.MAX_IMAGE_BYTES + 1).toString('base64')}`;
  assert.throws(() => scan.parseImages([big]), /too large/);
});

test('cleanScanAnswer keeps taxonomy verbs and moves the rest to other', () => {
  const tax = ['dumbbell', 'barbell', 'body weight'];
  const r = scan.cleanScanAnswer({ equipment: ['Dumbbell', 'TRX', 'dumbbell'], other: ['Pull-Up Bar', 'dumbbell', 'x'] }, tax);
  assert.deepEqual(r.equipment, ['dumbbell']);
  assert.ok(r.other.includes('TRX'));
  assert.ok(r.other.includes('Pull-Up Bar'));
  assert.ok(!r.other.includes('dumbbell'));
});

test('scan refuses runtimes without vision instead of spending on them', async () => {
  const r = await scan.scan({ adapter: { spawns: true }, cfg: {}, env: {}, images: [] });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, 'unsupported');
});

test('scan returns taxonomy hits from a fake vision adapter', async () => {
  const fake = {
    spawns: false,
    async invoke() { return { code: 0, text: '{"equipment": ["dumbbell", "nonsense rig"], "other": []}', stderr: '' }; }
  };
  const r = await scan.scan({ adapter: fake, cfg: {}, env: {}, model: 'm', fetch: globalThis.fetch, images: [{ mime: 'image/jpeg', b64: 'abcd', bytes: 3 }] });
  assert.equal(r.ok, true);
  assert.ok(r.equipment.includes('dumbbell'));
  assert.ok(r.other.includes('nonsense rig'));
});

test('scan maps an image-rejecting provider to unsupported, not to outage', async () => {
  const fake = {
    spawns: false,
    async invoke() { return { code: 1, text: '', stderr: '400 image content is not supported' }; }
  };
  const r = await scan.scan({ adapter: fake, cfg: {}, env: {}, model: 'm', fetch: globalThis.fetch, images: [{ mime: 'image/jpeg', b64: 'abcd', bytes: 3 }] });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, 'unsupported');
});
