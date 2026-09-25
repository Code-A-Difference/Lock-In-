import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgenda, pickNext, focusStats, formatMinutes, clock, spokenTime } from '../src/lib/agenda.js';

// Thursday 24 Sep 2026, mid-morning, local time
const NOW = new Date(2026, 8, 24, 10, 0, 0);

const hw = (title, due_date, extra = {}) => ({ id: title, title, due_date, is_completed: false, priority: 'medium', ...extra });

test('agenda buckets by due day and keeps past tests out', () => {
  const a = buildAgenda(
    [hw('late', '2026-09-22'), hw('now', '2026-09-24'), hw('tmr', '2026-09-25'), hw('sat', '2026-09-26'),
     hw('far', '2026-10-20'), hw('none', ''), hw('fin', '2026-09-24', { is_completed: true })],
    [{ id: 't1', title: 'Chem', date: '2026-09-25' }, { id: 't0', title: 'old', date: '2026-09-20' }],
    NOW,
  );
  assert.deepEqual(a.overdue.map(x => x.item.title), ['late']);
  assert.deepEqual(a.today.map(x => x.item.title), ['now']);
  assert.deepEqual(a.tomorrow.map(x => x.item.title), ['Chem', 'tmr'], 'tests sort ahead of homework on the same day');
  assert.deepEqual(a.week.map(x => x.item.title), ['sat']);
  assert.deepEqual(a.later.map(x => x.item.title), ['far', 'none'], 'undated homework goes last');
  assert.deepEqual(a.done.map(x => x.item.title), ['fin']);
});

test('pickNext: overdue first, then priority within a day', () => {
  assert.equal(pickNext([hw('a', '2026-09-26'), hw('b', '2026-09-23')], [], NOW).item.title, 'b');
  assert.equal(pickNext([hw('a', '2026-09-24'), hw('b', '2026-09-24', { priority: 'asap' })], [], NOW).item.title, 'b');
});

test('pickNext: a test tomorrow outranks homework due later', () => {
  const r = pickNext([hw('essay', '2026-09-27')], [{ id: 't', title: 'Bio test', date: '2026-09-25' }], NOW);
  assert.equal(r.kind, 'test');
});

test('pickNext: a started checklist wins a tie', () => {
  const started = hw('b', '2026-09-25', { steps: [{ done: true }, { done: false }] });
  assert.equal(pickNext([hw('a', '2026-09-25'), started], [], NOW).item.title, 'b');
});

test('pickNext: nothing to do is null', () => {
  assert.equal(pickNext([hw('x', '2026-09-24', { is_completed: true })], [], NOW), null);
});

test('focus stats: totals and a streak that survives until tonight', () => {
  const s = focusStats([
    { day: '2026-09-23', minutes: 25 }, { day: '2026-09-22', minutes: 50 }, { day: '2026-09-21', minutes: 25 },
    { day: '2026-09-19', minutes: 90 },
  ], NOW);
  assert.equal(s.todayMinutes, 0);
  assert.equal(s.streak, 3, 'Mon, Tue, Wed (yesterday) count; not having studied yet today is fine');
  assert.equal(s.weekMinutes, 190);
  assert.equal(s.days.length, 7);
  assert.equal(s.days[6].isToday, true);

  const s2 = focusStats([{ day: '2026-09-24', minutes: 25 }, { day: '2026-09-23', minutes: 25 }], NOW);
  assert.equal(s2.streak, 2);
  assert.equal(s2.blocksToday, 1);
});

test('time formatting', () => {
  assert.equal(formatMinutes(95), '1h 35m');
  assert.equal(formatMinutes(120), '2h');
  assert.equal(formatMinutes(40), '40m');
  assert.equal(clock(754), '12:34');
  assert.equal(clock(0.2), '00:01', 'rounds up so it never shows 00:00 while still running');
  assert.equal(spokenTime(754), 'about 13 minutes', '12:34 rounds to the nearer minute');
  assert.equal(spokenTime(784), '13 minutes');
  assert.equal(spokenTime(150), '2 minutes and 30 seconds');
  assert.equal(spokenTime(40), '40 seconds');
});
