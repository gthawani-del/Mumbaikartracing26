import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntro, advanceIntro, skipIntro } from './race-intro.js';

test('flyover settles before a three-second countdown releases racing', () => {
  const intro = createIntro();
  assert.equal(advanceIntro(intro, 3.5), false);
  assert.equal(intro.phase, 'flyover');
  advanceIntro(intro, .2);
  assert.equal(intro.phase, 'countdown'); assert.equal(intro.count, 3);
  assert.equal(advanceIntro(intro, 2), false);
  assert.equal(intro.count, 1);
  assert.equal(advanceIntro(intro, 1), true);
});

test('skip and retries bypass only the cinematic, preserving a fair countdown', () => {
  const skipped = createIntro(); skipIntro(skipped);
  const retry = createIntro(true);
  for (const intro of [skipped, retry]) {
    assert.equal(advanceIntro(intro, 0), false);
    assert.equal(intro.phase, 'countdown'); assert.equal(intro.count, 3);
    assert.equal(advanceIntro(intro, 3), true);
  }
});
