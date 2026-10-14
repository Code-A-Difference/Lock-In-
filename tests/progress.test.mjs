import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressStats } from '../src/lib/progress.js';

const now = new Date(2026, 9, 13, 18, 0);   // Tue 13 Oct 2026

test('focus time per day and per class, in the window only', () => {
  const s = progressStats({
    now, days: 7,
    sessions: [
      { day: '2026-10-13', minutes: 25, class_name: 'Chem' },
      { day: '2026-10-13', minutes: 50, class_name: 'Chem' },
      { day: '2026-10-10', minutes: 30, class_name: 'Maths' },
      { day: '2026-10-11', minutes: 15 },
      { day: '2026-09-01', minutes: 99, class_name: 'Chem' },     // outside the week
    ],
  });
  assert.equal(s.total, 120);
  assert.equal(s.perDay.length, 7);
  assert.equal(s.perDay[6].minutes, 75);
  assert.equal(s.best.day, '2026-10-13');
  assert.equal(s.activeDays, 3);
  assert.deepEqual(s.classes, [{ name: 'Chem', minutes: 75 }, { name: 'Maths', minutes: 30 }, { name: 'No class', minutes: 15 }]);
});

test('homework finished, on time, per week, and what is coming', () => {
  const s = progressStats({
    now, days: 7,
    homework: [
      { is_completed: true, completed_at: '2026-10-12T20:00:00', due_date: '2026-10-13' },   // on time
      { is_completed: true, completed_at: '2026-10-12T20:00:00', due_date: '2026-10-11' },   // late
      { is_completed: true, completed_at: '2026-09-29T12:00:00', due_date: '2026-09-30' },   // earlier week
      { is_completed: false, due_date: '2026-10-15' },
      { is_completed: false, due_date: '2026-10-01' },
    ],
    tests: [{ date: '2026-10-20' }, { date: '2026-11-30' }],
  });
  assert.equal(s.done, 2);
  assert.equal(s.onTime, 1);
  assert.equal(s.weeks.length, 6);
  assert.equal(s.weeks.at(-1).label, 'This week');
  assert.equal(s.weeks.at(-1).done, 2);           // the 12th is the Monday of this week
  assert.equal(s.weeks.at(-3).done, 1);           // the week of Mon 28 Sep
  assert.equal(s.dueSoon, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.testsSoon, 1);
});
