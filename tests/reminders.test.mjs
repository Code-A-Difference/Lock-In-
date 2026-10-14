import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedReminders, at, idOf } from '../src/lib/reminders.js';

const now = new Date(2026, 9, 13, 12, 0);   // Tue 13 Oct 2026, noon
const on = { on: true };

test('off means nothing', () => {
  assert.deepEqual(plannedReminders({ homework: [{ title: 'Essay', due_date: '2026-10-15' }], now }), []);
});

test('homework: the evening before and the morning of', () => {
  const r = plannedReminders({ homework: [{ title: 'Essay', class_name: 'English', due_date: '2026-10-15' }], prefs: on, now });
  assert.deepEqual(r.map(x => [x.title, x.at.getTime()]), [
    ['Due tomorrow', at('2026-10-14', '19:00').getTime()],
    ['Due today', at('2026-10-15', '07:30').getTime()],
  ]);
  assert.equal(r[0].body, 'Essay (English)');
});

test('finished homework and past times are skipped', () => {
  const r = plannedReminders({ homework: [
    { title: 'Done already', due_date: '2026-10-15', is_completed: true },
    { title: 'Due today', due_date: '2026-10-13' },      // this morning's reminder has passed
  ], prefs: on, now });
  assert.equal(r.length, 0);
});

test('tests: days before, the evening before, the morning of', () => {
  const r = plannedReminders({ tests: [{ title: 'Chem unit 2', date: '2026-10-20' }], prefs: on, now });
  assert.deepEqual(r.map(x => x.title), ['Test in 3 days', 'Test tomorrow', 'Test today']);
  assert.equal(r[0].at.getTime(), at('2026-10-17', '19:00').getTime());
});

test('several things at once become one notification', () => {
  const r = plannedReminders({ homework: [
    { title: 'Essay', due_date: '2026-10-15' }, { title: 'Worksheet', due_date: '2026-10-15' },
  ], prefs: { on: true }, now });
  assert.equal(r.length, 2);
  assert.equal(r[0].title, '2 things: due tomorrow');
  assert.equal(r[0].body, 'Essay, Worksheet');
});

test('planned study blocks, a few minutes before', () => {
  const schedule = { blocks: [{ date: '2026-10-13', start: '15:30', end: '16:30', title: 'Revise cells', type: 'study' },
    { date: '2026-10-13', start: '16:30', end: '16:40', title: 'Break', type: 'break' }] };
  const r = plannedReminders({ schedule, prefs: on, now });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Study block at 3:30 pm');
  assert.equal(r[0].at.getTime(), at('2026-10-13', '15:25').getTime());
});

test('ids are stable 31-bit numbers', () => {
  assert.equal(idOf('a'), idOf('a'));
  assert.ok(idOf('due-today|2026-10-15|Essay') < 2 ** 31);
});
