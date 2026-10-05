/**
 * The study planner's logic: free-time slots, the request that turns them into
 * a schedule, and reading the schedule back. Pure, so tests/planner.test.mjs
 * runs it in Node. The state and the screen are in PlannerContext.jsx.
 */
import { ymd, addDays } from './dates.js';

/** "3:30pm", "15:30", "3pm", "noon" -> "15:30"; null if it isn't a time. */
export function parseTime(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/\./g, '');
  if (!t) return null;
  if (t === 'noon' || t === 'midday') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.[0];
  if (min > 59 || h > 24) return null;
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "today", "tomorrow", "friday", "2026-10-09" -> "YYYY-MM-DD"; null if not a day. */
export function parseDay(raw, now = new Date()) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t || t === 'today' || t === 'tonight') return ymd(now);
  if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') return ymd(addDays(now, 1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const w = /^(?:next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(t);
  if (w) {
    const target = DAYS.findIndex(d => d.startsWith(w[1]));
    const gap = (target - now.getDay() + 7) % 7;
    return ymd(addDays(now, gap === 0 && t.startsWith('next') ? 7 : gap));
  }
  return null;
}

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** A slot as typed or as the AI sent it -> { date, start, end } or an error message. */
export function makeSlot({ date, start, end }, now = new Date()) {
  const day = parseDay(date, now);
  const s = parseTime(start);
  const e = parseTime(end);
  if (!day) return { error: `I don't know which day "${date}" is.` };
  if (!s || !e) return { error: 'Give a start and an end time, like 3:30pm to 6pm.' };
  if (minutes(e) <= minutes(s)) return { error: 'The free time has to end after it starts.' };
  return { date: day, start: s, end: e };
}

/** Slots in time order, with overlapping or touching ones on the same day merged. */
export function mergeSlots(slots) {
  const sorted = [...slots].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.date === s.date && minutes(s.start) <= minutes(last.end)) {
      if (minutes(s.end) > minutes(last.end)) last.end = s.end;
    } else out.push({ ...s });
  }
  return out;
}

/** Only today and later. */
export const upcoming = (slots, now = new Date()) => slots.filter(s => s.date >= ymd(now));

export const totalMinutes = (slots) => slots.reduce((n, s) => n + minutes(s.end) - minutes(s.start), 0);

export const SCHEDULE_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' },
          title: { type: 'string' }, type: { type: 'string' }, priority: { type: 'string' }, reason: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
    notes: { type: 'string' },
  },
};

export function schedulePrompt({ homework, tests, slots, notes, now = new Date() }) {
  const hw = homework.filter(h => !h.is_completed).map(h => ({
    title: h.title, class: h.class_name || '', due_date: h.due_date || '', priority: h.priority || 'medium',
    steps_left: (h.steps || []).filter(s => !s.done).length || undefined,
  }));
  const ts = tests.filter(t => !t.date || t.date >= ymd(now)).map(t => ({ title: t.title, class: t.class_name || '', date: t.date }));
  return `You are planning a student's study time. Today is ${ymd(now)} (${DAYS[now.getDay()]}).

Homework still to do (priority low/medium/high/asap):
${JSON.stringify(hw)}

Tests coming up:
${JSON.stringify(ts)}

When they are free (only schedule inside these):
${JSON.stringify(slots.map(s => ({ date: s.date, start: s.start, end: s.end })))}
${notes ? `\nWhat they told you: ${notes}\n` : ''}
Rules: urgent and high-priority work first, finished before it's due; spread test revision over the days before each test; focused blocks of at most 60-90 minutes with short breaks between; never outside the free time; if it doesn't all fit, say what's left over in "notes". Give each block a one-line reason. Times are 24-hour HH:MM.`;
}

/** The schedule as the AI returned it, cleaned and sorted. */
export function cleanSchedule(raw) {
  const blocks = (Array.isArray(raw?.blocks) ? raw.blocks : [])
    .map(b => ({
      date: String(b.date || ''), start: parseTime(b.start_time) || '', end: parseTime(b.end_time) || '',
      title: String(b.title || '').trim(), type: ['homework', 'study', 'break'].includes(b.type) ? b.type : 'study',
      priority: String(b.priority || ''), reason: String(b.reason || '').trim(),
    }))
    .filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.start && b.end && b.title)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { blocks, summary: String(raw?.summary || '').trim(), notes: String(raw?.notes || '').trim() };
}

/** Today's blocks still to come (or running now). */
export function blocksLeftToday(schedule, now = new Date()) {
  const today = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (schedule?.blocks || []).filter(b => b.date === today && minutes(b.end) > nowMin);
}

export const blockMinutes = (b) => minutes(b.end) - minutes(b.start);

/** "15:30" -> "3:30 pm" */
export function niceTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}
