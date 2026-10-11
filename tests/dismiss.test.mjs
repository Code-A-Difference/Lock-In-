import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDismissal, expectsAnswer } from '../src/lib/dismiss.js';

test('ways of saying "I am done"', () => {
  for (const s of ['stop', 'Stop.', 'okay stop', 'stop listening', "That's all", 'thanks', 'Thank you!', 'never mind', 'ok that is all please', 'be quiet', 'bye', "I'm done"]) {
    assert.equal(isDismissal(s), true, s);
  }
});

test('real requests are not dismissals', () => {
  for (const s of ['stop the timer', 'what is the capital of France', 'thanks, now add a test on Friday', 'cancel my chem homework', 'start recording', '']) {
    assert.equal(isDismissal(s), false, s);
  }
});

test('a question reply expects an answer', () => {
  assert.equal(expectsAnswer('A few match "x". Which one?'), true);
  assert.equal(expectsAnswer('Done. Nice work.'), false);
  assert.equal(expectsAnswer('Which one? '), true);
});
