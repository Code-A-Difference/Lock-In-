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

test('the wake phrase never goes out as the request', async () => {
  const { stripWake } = await import('../src/lib/wake.js');
  assert.equal(stripWake('Hey Companion.'), '');
  assert.equal(stripWake('Hey, Compagnion!'), '');
  assert.equal(stripWake('hey compenion what is due'), 'what is due');
  assert.equal(stripWake('Companions, start a timer'), 'start a timer');
  assert.equal(stripWake('Hey.'), '');
  assert.equal(stripWake('What is due tomorrow?'), 'What is due tomorrow?');
  assert.equal(stripWake('Company of Heroes is a game'), 'Company of Heroes is a game');
  assert.equal(stripWake('Compare these two answers'), 'Compare these two answers');
  assert.equal(stripWake('Complete my chemistry homework'), 'Complete my chemistry homework');
});
