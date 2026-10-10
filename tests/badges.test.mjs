import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badges, bestStreak, tallies, claimable, nextUp } from '../src/lib/badges.js';

const lectures = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i}` }));

test('the 100th lecture earns Centurion; added material does not count', () => {
  const b = badges({ lectures: [...lectures(100), { source: 'material' }] });
  assert.equal(b.find(x => x.id === 'lectures-100').earned, true);
  assert.equal(badges({ lectures: [...lectures(99), { source: 'material' }] }).find(x => x.id === 'lectures-100').earned, false);
});

test('the best streak is the longest run of focused days, across a month end', () => {
  const s = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03', '2026-10-04'].map(day => ({ day, minutes: 25 }));
  assert.equal(bestStreak(s), 3);
  assert.equal(bestStreak([{ day: '2026-10-01', minutes: 0 }]), 0);
  assert.equal(bestStreak([]), 0);
});

test('tallies count hours, homework, quizzes, decks and slides', () => {
  const t = tallies({
    sessions: [{ day: '2026-10-01', minutes: 90 }, { day: '2026-10-02', minutes: 45 }],
    homework: [{ is_completed: true }, { is_completed: false }],
    history: [{ type: 'quiz' }, { type: 'class_quiz' }, { type: 'flashcards' }, { type: 'grading' }],
    lectures: [{ slides: [{ name: 'a.pdf' }] }, { slides: [] }],
  });
  assert.deepEqual(t, { lectures: 2, streak: 2, hours: 2, homework: 1, quizzes: 2, decks: 1, slides: 1 });
});

test('firsts appear only when the server says this student holds them', () => {
  assert.equal(badges({}).some(b => b.first), false);
  const b = badges({}, { 'first-deck': true, founder: true });
  assert.deepEqual(b.filter(x => x.first).map(x => x.id), ['founder', 'first-deck']);
});

test('only reached firsts are claimable', () => {
  assert.deepEqual(claimable({ history: [{ type: 'flashcards' }] }), ['first-deck']);
  assert.deepEqual(claimable({}), []);
});

test('next up is the closest unearned badge', () => {
  const n = nextUp(badges({ lectures: lectures(8) }));
  assert.equal(n.id, 'lectures-10');
  assert.equal(n.have, 8);
});
