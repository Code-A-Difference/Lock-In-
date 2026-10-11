import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findByTitle, describeChoices, uniqueNotes } from '../src/lib/itemMatch.js';

const hw = [
  { id: 1, title: 'Make a .tech domain' },
  { id: 2, title: 'Make a .tech domain' },
  { id: 3, title: 'Chem lab', due_date: '2026-10-12', class_name: 'Chem' },
  { id: 4, title: 'Chem lab report', due_date: '2026-10-14' },
];

test('identical titles are one item, and it says a duplicate existed', () => {
  const r = findByTitle(hw, 'make a .tech domain');
  assert.deepEqual(r.matches.map(x => x.id), [1]);
  assert.equal(r.duplicates, 1);
});

test('different titles that both fit are still a real question', () => {
  const r = findByTitle(hw, 'chem');
  assert.deepEqual(r.matches.map(x => x.id), [3, 4]);
  assert.equal(r.duplicates, 0);
});

test('an exact title wins over longer ones that contain it', () => {
  assert.deepEqual(findByTitle(hw, 'Chem lab').matches.map(x => x.id), [3]);
});

test('choices say what tells them apart', () => {
  assert.equal(describeChoices([hw[2], hw[3]]), 'Chem lab (Chem, due 2026-10-12); Chem lab report (due 2026-10-14)');
});

test('the same note is said once', () => {
  assert.deepEqual(uniqueNotes(['A few match', 'A few match', ' ']), ['A few match']);
});
