import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWake, afterWake } from '../src/lib/wake.js';

test('how recognisers write "Hey Companion"', () => {
  for (const said of ['hey companion', 'Hey Companion', 'Hey, Companion.', 'hi companion', 'okay companion', 'ok companion',
    'hello companion', 'hey companions', 'hey compagnon', 'hey company on', 'hey campanion', 'hey compainion']) {
    assert.ok(findWake(said), `should wake on "${said}"`);
  }
});

test('the words after it', () => {
  assert.equal(afterWake('hey companion start a focus session for 50 minutes'), 'start a focus session for 50 minutes');
  assert.equal(afterWake('Hey Companion, what is due?'), 'what is due?');
  assert.equal(afterWake('hey companion'), '');
  assert.equal(afterWake('okay companion pause the timer'), 'pause the timer');
});

test('ordinary talk does not wake it', () => {
  for (const said of ['companion', 'my dog is a good companion', 'what is the companion planet', 'the study app',
    '(The study app)', 'hey lock in', 'ok lock in', 'i need to log in to my account', 'hey there', 'okay then',
    'hey company', 'hey compass', 'hey champion']) {
    assert.equal(findWake(said), null, `should not wake on "${said}"`);
  }
});
