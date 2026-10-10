import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCards, cardsFromNotes, startRound, gotIt, again, cardsPrompt } from '../src/lib/flashcards.js';

test('cards are tidied: both sides, no duplicates, a cap', () => {
  const c = normaliseCards({ cards: [{ front: 'Enthalpy', back: 'Heat at constant pressure' }, { front: 'enthalpy ', back: 'dup' }, { front: '', back: 'x' }, { front: 'Hess', back: '' }] });
  assert.deepEqual(c, [{ front: 'Enthalpy', back: 'Heat at constant pressure' }]);
  assert.equal(normaliseCards({ cards: Array.from({ length: 80 }, (_, i) => ({ front: `t${i}`, back: 'b' })) }).length, 60);
  assert.deepEqual(normaliseCards(null), []);
});

test('an instant deck comes from the notes key terms', () => {
  const lectures = [{ notes: { key_terms: [{ term: 'Sample space', definition: 'All outcomes' }] } }, { notes: null }];
  assert.deepEqual(cardsFromNotes(lectures), [{ front: 'Sample space', back: 'All outcomes' }]);
});

test('"Again" brings a card back a few cards later; "Got it" retires it', () => {
  let s = startRound(5, () => 0.999);           // no shuffle: 0..4
  assert.deepEqual(s.queue, [0, 1, 2, 3, 4]);
  s = again(s);                                   // 0 comes back after 3 more
  assert.deepEqual(s.queue, [1, 2, 3, 0, 4]);
  s = gotIt(s); s = gotIt(s); s = gotIt(s);       // 1, 2, 3 known
  assert.equal(s.queue[0], 0);
  s = gotIt(s); s = gotIt(s);
  assert.deepEqual(s.queue, []);
  assert.deepEqual(s.missed, [0]);
  assert.equal(s.known.length, 5);
});

test('the prompt keeps to the material unless outside knowledge is on', () => {
  assert.match(cardsPrompt('x'), /Use ONLY what is in the material/);
  assert.doesNotMatch(cardsPrompt('x', { outside: true }), /Use ONLY/);
});
