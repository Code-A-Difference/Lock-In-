// node --test tests/   (Node's built-in runner; no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/lib/quickadd.js';

const THU = new Date(2026, 8, 24);          // Thursday 24 Sep 2026
const SAT = new Date(2026, 8, 26);
const classes = [
  { id: 'm10', name: 'Math 10' },
  { id: 'm11', name: 'Math 11' },
  { id: 'en', name: 'English 10' },
  { id: 'ch', name: 'Chemistry 11' },
  { id: 'cs', name: 'CPSC 110' },
];
const q = (s, now = THU) => parseQuickAdd(s, { classes, now });

test('the example from the placeholder', () => {
  const r = q('essay for English due fri !!');
  assert.equal(r.kind, 'homework');
  assert.equal(r.title, 'Essay');
  assert.equal(r.classItem.id, 'en');
  assert.equal(r.dueDate, '2026-09-25');
  assert.equal(r.priority, 'high');
});

test('abbreviated class and tmrw', () => {
  const r = q('chem lab report tmrw');
  assert.equal(r.classItem.id, 'ch');
  assert.equal(r.title, 'Lab report');
  assert.equal(r.dueDate, '2026-09-25');
});

test('tests are detected and keep their word', () => {
  const r = q('unit 3 test Math 10 next thu');
  assert.equal(r.kind, 'test');
  assert.equal(r.classItem.id, 'm10');
  assert.equal(r.title, 'Unit 3 test');
  assert.equal(r.dueDate, '2026-10-01');       // Thursday of next week
});

test('"next fri" means Friday of next week, from Thursday and from Saturday', () => {
  assert.equal(q('read ch 4 English 10 next fri').dueDate, '2026-10-02');
  assert.equal(q('read ch 4 English 10 next fri', SAT).dueDate, '2026-10-02');
});

test('a bare weekday is the next one, today included', () => {
  assert.equal(q('worksheet English 10 thursday').dueDate, '2026-09-24');
  assert.equal(q('worksheet English 10 mon').dueDate, '2026-09-28');
});

test('ambiguous class is not guessed', () => {
  const r = q('math worksheet tomorrow');
  assert.equal(r.classItem, null);
  assert.deepEqual(r.ambiguousClasses.map(c => c.id).sort(), ['m10', 'm11']);
  assert.equal(r.title, 'Worksheet');
});

test('full name beats the ambiguous first word', () => {
  assert.equal(q('problem set math 11 fri').classItem.id, 'm11');
  assert.equal(q('problem set math11 fri').classItem.id, 'm11');
});

test('course codes work', () => {
  const r = q('assignment 2 CPSC 110 oct 3 !!!');
  assert.equal(r.classItem.id, 'cs');
  assert.equal(r.dueDate, '2026-10-03');
  assert.equal(r.priority, 'asap');
  assert.equal(r.title, 'Assignment 2');
});

test('month-day forms and numeric dates', () => {
  assert.equal(q('essay English 10 30 sep').dueDate, '2026-09-30');
  assert.equal(q('essay English 10 september 30th').dueDate, '2026-09-30');
  assert.equal(q('essay English 10 9/30').dueDate, '2026-09-30');
  assert.equal(q('essay English 10 30/9').dueDate, '2026-09-30');   // impossible as m/d
  assert.equal(q('essay English 10 2026-10-15').dueDate, '2026-10-15');
});

test('a recent past date is overdue, not next year', () => {
  assert.equal(q('essay English 10 sep 20').dueDate, '2026-09-20');
  assert.equal(q('essay English 10 jun 1').dueDate, '2027-06-01');    // far past -> next year
});

test('in N days / next week', () => {
  assert.equal(q('essay English 10 in 3 days').dueDate, '2026-09-27');
  assert.equal(q('essay English 10 in two weeks').dueDate, '2026-10-08');
  assert.equal(q('essay English 10 next week').dueDate, '2026-10-01');
});

test('no date: homework defaults to tomorrow, tests to a week, and says so', () => {
  const h = q('vocab list English 10');
  assert.equal(h.dueDate, '2026-09-25');
  assert.equal(h.dueExplicit, false);
  const t = q('Chemistry 11 quiz');
  assert.equal(t.kind, 'test');
  assert.equal(t.dueDate, '2026-10-01');
});

test('"math test fri" names the test after the class', () => {
  const r = parseQuickAdd('math test fri', { classes: [{ id: 'm', name: 'Math 10' }], now: THU });
  assert.equal(r.title, 'Math 10 test');
});

test('priority words and low', () => {
  assert.equal(q('reading English 10 urgent').priority, 'asap');
  assert.equal(q('reading English 10 important').priority, 'high');
  assert.equal(q('reading English 10 low priority').priority, 'low');
  assert.equal(q('reading English 10').priority, 'medium');
});

test('words inside other words are left alone', () => {
  // "fri" inside "friends", "mon" inside "monologue", "sat" inside "satire"
  const r = q('satire monologue about friends English 10 tomorrow');
  assert.equal(r.title, 'Satire monologue about friends');
  assert.equal(r.dueDate, '2026-09-25');
});

test('no classes at all still parses', () => {
  const r = parseQuickAdd('essay due fri', { classes: [], now: THU });
  assert.equal(r.title, 'Essay');
  assert.equal(r.classItem, null);
  assert.equal(r.dueDate, '2026-09-25');
});
