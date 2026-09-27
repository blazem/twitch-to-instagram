import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { waitUntilReady, duplicateDecision, photoSize, obsAuthentication, formatCaption } from '../core.mjs';
test('waits for processing to finish before allowing publication', async () => {
  let reads = 0, waits = 0;
  const result = await waitUntilReady(async () => ({ status_code: ++reads === 3 ? 'FINISHED' : 'IN_PROGRESS' }), { wait: async () => waits++ });
  assert.equal(result, 'FINISHED'); assert.equal(reads, 3); assert.equal(waits, 2);
});
test('never publishes after an error, expiry or processing timeout', async () => {
  for (const code of ['ERROR', 'EXPIRED']) await assert.rejects(waitUntilReady(async () => ({ status_code: code }), { wait: async () => {} }), /processing ended/);
  await assert.rejects(waitUntilReady(async () => ({ status_code: 'IN_PROGRESS' }), { wait: async () => {}, attempts: 2 }), /still processing/);
});
test('already published containers do not need another publish call', async () => {
  assert.equal(await waitUntilReady(async () => ({ status_code: 'PUBLISHED' })), 'PUBLISHED');
});
test('duplicate protection distinguishes pending, completed and uncertain publication', () => {
  assert.equal(duplicateDecision(), 'new');
  assert.equal(duplicateDecision({ containerId: '1' }), 'resume');
  assert.equal(duplicateDecision({ containerId: '1', publishAttempted: true }), 'uncertain');
  assert.equal(duplicateDecision({ published: true }), 'done');
});
test('normal OBS landscape canvas fits Instagram without cropping', () => {
  assert.deepEqual(photoSize(1920, 1080), { imageWidth: 1080, imageHeight: 608 });
  assert.throws(() => photoSize(3440, 1440), /outside Instagram/);
  assert.throws(() => photoSize(0, 1080), /invalid/);
});
test('caption combines optional prefix, Twitch title and suffix', () => {
  assert.equal(formatCaption({ captionPrefix: 'Live now!', captionSuffix: '#dnb' }, 'Rolling session'), 'Live now! Rolling session #dnb');
  assert.equal(formatCaption({}, 'Rolling session'), 'Rolling session');
  assert.throws(() => formatCaption({ captionPrefix: 'x'.repeat(2200) }, 'title'), /2,200/);
});
test('OBS challenge authentication follows its two-stage SHA-256 protocol', () => {
  const hash = x => createHash('sha256').update(x).digest('base64');
  assert.equal(obsAuthentication('pass', 'salt', 'challenge'), hash(hash('passsalt') + 'challenge'));
});
