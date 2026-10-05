import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, parseDay, makeSlot, mergeSlots, cleanSchedule, blocksLeftToday, niceTime, totalMinutes } from '../src/lib/planner.js';
import { actionToCommand } from '../src/lib/assistant.js';

const now = new Date('2026-10-05T12:00:00');   // a Monday

test('times the way people say them', () => {
  assert.equal(parseTime('3:30pm'), '15:30');
  assert.equal(parseTime('3pm'), '15:00');
  assert.equal(parseTime('15:30'), '15:30');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('noon'), '12:00');
  assert.equal(parseTime('9'), '09:00');
  assert.equal(parseTime('soon'), null);
  assert.equal(niceTime('15:30'), '3:30 pm');
  assert.equal(niceTime('09:00'), '9 am');
});

test('days', () => {
  assert.equal(parseDay('today', now), '2026-10-05');
  assert.equal(parseDay('tomorrow', now), '2026-10-06');
  assert.equal(parseDay('friday', now), '2026-10-09');
  assert.equal(parseDay('monday', now), '2026-10-05');
  assert.equal(parseDay('next monday', now), '2026-10-12');
  assert.equal(parseDay('2026-11-01', now), '2026-11-01');
  assert.equal(parseDay('someday', now), null);
});

test('free time slots are checked and merged', () => {
  assert.deepEqual(makeSlot({ date: 'today', start: '4pm', end: '6pm' }, now), { date: '2026-10-05', start: '16:00', end: '18:00' });
  assert.match(makeSlot({ date: 'today', start: '6pm', end: '4pm' }, now).error, /end after/);
  assert.match(makeSlot({ date: 'whenever', start: '4', end: '5' }, now).error, /which day/);
  const merged = mergeSlots([
    { date: '2026-10-05', start: '16:00', end: '17:00' },
    { date: '2026-10-05', start: '16:30', end: '18:00' },
    { date: '2026-10-06', start: '09:00', end: '10:00' },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].end, '18:00');
  assert.equal(totalMinutes(merged), 180);
});

test('the schedule is cleaned, sorted, and read back for today', () => {
  const s = cleanSchedule({ blocks: [
    { date: '2026-10-05', start_time: '17:00', end_time: '17:45', title: 'Essay', type: 'homework' },
    { date: '2026-10-05', start_time: '11:00', end_time: '11:30', title: 'Earlier', type: 'study' },
    { date: '2026-10-05', start_time: '16:00', end_time: '16:50', title: 'Bio revision', type: 'nonsense' },
    { date: 'tomorrow', start_time: '9', end_time: '10', title: 'Bad date' },
  ], summary: ' ok ' });
  assert.deepEqual(s.blocks.map(b => b.title), ['Earlier', 'Bio revision', 'Essay']);
  assert.equal(s.blocks[1].type, 'study');
  assert.equal(s.summary, 'ok');
  assert.deepEqual(blocksLeftToday(s, now).map(b => b.title), ['Bio revision', 'Essay']);
});

test('the assistant can drive the planner, edits, classes and tools', () => {
  assert.deepEqual(actionToCommand({ name: 'addFreeTime', date: 'today', start: '16:00', end: '18:00' }), { action: 'addFreeTime', date: 'today', start: '16:00', end: '18:00' });
  assert.equal(actionToCommand({ name: 'addFreeTime', date: 'today' }), null);
  assert.equal(actionToCommand({ name: 'makePlan' }).action, 'makePlan');
  assert.deepEqual(actionToCommand({ name: 'graph', expressions: ['y=x^2', 'y=2x'] }).expressions, ['y=x^2', 'y=2x']);
  assert.equal(actionToCommand({ name: 'updateHomework', title: 'essay', date: '2026-10-09' }).date, '2026-10-09');
  assert.equal(actionToCommand({ name: 'addClass', title: 'Chemistry' }).name, 'Chemistry');
  assert.equal(actionToCommand({ name: 'setGoal', minutes: 90 }).minutes, 90);
  assert.equal(actionToCommand({ name: 'setDarkMode', on: false }).on, false);
  assert.equal(actionToCommand({ name: 'openCamera' }).action, 'openCamera');
});
