// Notes must come from what was said, not from what the AI knows about the subject
// (src/lib/lectureNotes.js: MIN_WORDS, groundNotes, tooShortNotes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseNotes, groundNotes, tooShortNotes, spokenWords, MIN_WORDS, notesPrompt } from '../src/lib/lectureNotes.js';

// what the AI wrote for a 5-second recording that only said "what the hell", in a class about probability
const INVENTED = normaliseNotes({
  title: 'Introduction to Probability',
  summary: 'This lecture introduces the fundamental concepts of probability, including sample spaces, events, and basic probability calculations.',
  sections: [
    { heading: 'Sample Spaces and Events', points: [
      'A sample space, denoted by $S$, is the set of all possible outcomes of an experiment.',
      'An event is a subset of the sample space, representing a specific outcome or set of outcomes.',
      'For example, when rolling a standard six-sided die, the sample space is $S=\\{1,2,3,4,5,6\\}$',
    ] },
    { heading: 'Calculating Probabilities', points: [
      'Consider an experiment of flipping a fair coin twice. The sample space is $S=\\{HH,HT,TH,TT\\}$',
      'The probability of getting exactly one head is $P(E)=\\frac{2}{4}=\\frac{1}{2}$.',
    ] },
  ],
  key_terms: [{ term: 'Sample Space', definition: 'The set of all possible outcomes of an experiment.' },
              { term: 'Probability', definition: 'The measure of the likelihood of an event occurring.' }],
  review_questions: ['What is a sample space and how is it represented?', 'What is the formula for calculating the probability of an event?'],
});

const REAL = 'Okay so today we are looking at probability. A sample space is the set of all possible outcomes of an experiment, ' +
  'like rolling a die gives one to six. An event is a subset of the sample space. The probability of an event is always ' +
  'between zero and one, so between 0 and 1, and we work it out as favourable outcomes over total outcomes. For a fair coin ' +
  'flipped twice the outcomes are heads heads, heads tails, tails heads, tails tails, so exactly one head is two out of four, a half.';

test('a few words are too few to make notes from', () => {
  assert.ok(spokenWords('what the hell') < MIN_WORDS);
  const n = tooShortNotes(3);
  assert.match(n.summary, /Only 3 words were recorded/);
  assert.deepEqual([n.sections, n.key_terms, n.review_questions], [[], [], []]);
  assert.match(tooShortNotes(0).summary, /Nothing was heard/);
});

test('notes invented from general knowledge are dropped and flagged', () => {
  const g = groundNotes(INVENTED, 'what the hell');
  assert.deepEqual(g.sections, []);
  assert.deepEqual(g.key_terms, []);
  assert.deepEqual(g.review_questions, []);
  assert.ok(g.warning);
  assert.match(g.summary, /Nothing in the recording/);
});

test('notes that follow what was said are kept', () => {
  const g = groundNotes(INVENTED, REAL);
  assert.equal(g.checked.dropped, 0, JSON.stringify(g));
  assert.ok(!g.warning);
  assert.equal(g.sections.length, 2);
});

test('the prompt forbids filling in from outside knowledge and allows empty lists', () => {
  const p = notesPrompt({ transcript: 'x', className: 'Probability' });
  assert.match(p, /Never add facts/);
  assert.match(p, /never fill them in to look complete/);
  assert.doesNotMatch(p, /3-5 questions/);
});
