/**
 * What to show, in what order, and what to work on next. Pure functions over
 * plain records, so they are tested in Node (tests/agenda.test.mjs).
 */
import { parseDay, daysUntil, bucketFor, ymd, addDays, startOfDay } from './dates.js';

export const PRIORITY_RANK = { low: 0, medium: 1, high: 2, asap: 3 };

export const BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
];

const rank = (p) => PRIORITY_RANK[p] ?? 1;

/**
 * Homework and tests together, grouped by when they are due. Tests only show
 * until their day has passed; finished homework goes to `done`.
 */
export function buildAgenda(homework = [], tests = [], now = new Date()) {
  const out = Object.fromEntries(BUCKETS.map(b => [b.id, []]));
  const done = [];
  for (const h of homework) {
    if (h.is_completed) { done.push({ kind: 'homework', item: h, day: h.due_date || '' }); continue; }
    out[h.due_date ? bucketFor(h.due_date, now) : 'later'].push({ kind: 'homework', item: h, day: h.due_date || '' });
  }
  for (const t of tests) {
    const d = parseDay(t.date);
    if (!d || daysUntil(d, now) < 0) continue;
    out[bucketFor(t.date, now)].push({ kind: 'test', item: t, day: t.date });
  }
  const cmp = (a, b) =>
    (a.day || '9999').localeCompare(b.day || '9999') ||
    (a.kind === b.kind ? 0 : a.kind === 'test' ? -1 : 1) ||
    rank(b.item.priority) - rank(a.item.priority) ||
    String(a.item.title).localeCompare(String(b.item.title));
  for (const k of Object.keys(out)) out[k].sort(cmp);
  done.sort((a, b) => String(b.item.updated_date || '').localeCompare(String(a.item.updated_date || '')));
  return { ...out, done };
}

/**
 * The one thing the "Lock in" button starts on. Overdue beats due today beats
 * everything else; a test tomorrow counts as due today, because the studying
 * has to happen today. Within a day, higher priority first, then anything
 * already started (a half-done checklist is the easiest thing to resume).
 */
export function pickNext(homework = [], tests = [], now = new Date()) {
  const cands = [];
  for (const h of homework) {
    if (h.is_completed) continue;
    const d = parseDay(h.due_date);
    const eff = d ? daysUntil(d, now) : 7;
    const started = (h.steps || []).some(s => s.done) ? 1 : 0;
    cands.push({ kind: 'homework', item: h, score: eff * 10 - rank(h.priority) * 2 - started });
  }
  for (const t of tests) {
    const d = parseDay(t.date);
    if (!d) continue;
    const n = daysUntil(d, now);
    if (n < 0 || n > 14) continue;
    cands.push({ kind: 'test', item: t, score: (n - 1) * 10 - 3 });
  }
  cands.sort((a, b) => a.score - b.score);
  return cands[0] ? { kind: cands[0].kind, item: cands[0].item } : null;
}

/**
 * Focus stats from FocusSession records ({minutes, day: 'YYYY-MM-DD'}).
 * The streak counts consecutive days with at least one block, and survives
 * until the end of today — not having studied YET today doesn't break it.
 */
export function focusStats(sessions = [], now = new Date()) {
  const byDay = new Map();
  for (const s of sessions) {
    if (!s || !s.day) continue;
    byDay.set(s.day, (byDay.get(s.day) || 0) + (Number(s.minutes) || 0));
  }
  const today = ymd(now);
  let streak = 0;
  let cursor = byDay.get(today) ? startOfDay(now) : addDays(now, -1);
  while (byDay.get(ymd(cursor))) { streak++; cursor = addDays(cursor, -1); }

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(now, -i);
    const key = ymd(d);
    days.push({ day: key, label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()], minutes: byDay.get(key) || 0, isToday: i === 0 });
  }
  return {
    todayMinutes: byDay.get(today) || 0,
    weekMinutes: days.reduce((a, d) => a + d.minutes, 0),
    streak,
    days,
    blocksToday: sessions.filter(s => s && s.day === today).length,
  };
}

/** 95 -> "1h 35m", 40 -> "40m", 0 -> "0m". */
export function formatMinutes(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** 754 -> "12:34". */
export function clock(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 754 -> "12 minutes and 34 seconds", for the voice. */
export function spokenTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const mm = m === 1 ? '1 minute' : `${m} minutes`;
  if (m >= 5 || !r) return m ? (r >= 30 && m < 59 ? `about ${m + 1} minutes` : mm) : `${r} seconds`;
  return m ? `${mm} and ${r} seconds` : `${r} seconds`;
}
