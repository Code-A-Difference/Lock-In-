import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWake, afterWake } from '../src/lib/wake.js';

test('how recognisers actually write "Hey Lock In"', () => {
  for (const said of ['hey lock in', 'Hey Lock In', 'hey lockin', 'hey locking', 'hay log in', 'okay lock in', 'ok luck in',
    'hey look in', 'hi lock-in', 'Hey, lock in.', 'hey lock in pause', 'hello lockin', 'yo lock in']) {
    assert.ok(findWake(said), `should wake on "${said}"`);
  }
});

test('the words after it', () => {
  assert.equal(afterWake('hey lock in start a focus session for 50 minutes'), 'start a focus session for 50 minutes');
  assert.equal(afterWake('Hey Lock In, what is due?'), 'what is due?');
  assert.equal(afterWake('hey lock in'), '');
  assert.equal(afterWake('okay locking pause the timer'), 'pause the timer');
  assert.equal(afterWake('companion pause'), 'pause');
});

test('ordinary talk does not wake it', () => {
  for (const said of ['lock in', 'i need to log in to my account', 'she is looking in the drawer', 'the lock in the door',
    'hey there', 'okay then', 'what is the companion planet', 'blocking the shot']) {
    if (/companion/.test(said)) continue;     // "companion" is Ambient Voice Study's own wake word
    assert.equal(findWake(said), null, `should not wake on "${said}"`);
  }
});
