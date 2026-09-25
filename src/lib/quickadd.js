/**
 * One line in, one homework (or test) out.
 *
 *   "essay for English due fri !!"   -> homework · English · Fri · high
 *   "chem lab report tmrw"           -> homework · Chemistry 11 · tomorrow
 *   "unit 3 test math next thu"      -> test · Math 10 · Thursday next week
 *
 * Adding homework used to take a dialog with four fields and a class picker.
 * This parses what a student would say out loud instead, and the Today page
 * shows the result as chips before saving, so nothing is guessed silently.
 * Pure function: no React, no storage — the tests run it in Node.
 */
import { addDays, startOfDay, ymd } from './dates.js';

const WEEKDAY = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const MONTH = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};
const SMALL = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const WD_ALT = Object.keys(WEEKDAY).sort((a, b) => b.length - a.length).join('|');
const MO_ALT = Object.keys(MONTH).sort((a, b) => b.length - a.length).join('|');
// words that only connect a date or class to the rest of the sentence
const LEAD = '(?:(?:due|on|by|for|before|this|in)\\s+)?';

const TEST_RE = /\b(test|tests|quiz|quizzes|exam|exams|midterm|midterms|final|finals)\b/i;

function stripSpan(text, re) {
  return text.replace(re, ' ');
}

/** Find a due date in the text. Returns { date, text } with the words removed. */
function takeDate(text, now) {
  const today = startOfDay(now);
  const tries = [
    [new RegExp(`${LEAD}\\b(today|tonight)\\b`, 'i'), () => today],
    [new RegExp(`${LEAD}\\b(tomorrow|tmrw|tmr|tmw|tomoro)\\b`, 'i'), () => addDays(today, 1)],
    [new RegExp(`${LEAD}\\bin\\s+(\\d+|${Object.keys(SMALL).join('|')})\\s+(day|days|week|weeks)\\b`, 'i'), (m) => {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : SMALL[m[1].toLowerCase()];
      return addDays(today, /week/i.test(m[2]) ? n * 7 : n);
    }],
    [new RegExp(`${LEAD}\\bnext\\s+week\\b`, 'i'), () => addDays(today, 7)],
    // "next fri" = Friday of NEXT (Monday-start) week
    [new RegExp(`${LEAD}\\bnext\\s+(${WD_ALT})\\b\\.?`, 'i'), (m) => {
      const wd = WEEKDAY[m[1].toLowerCase()];
      const toNextMon = ((8 - today.getDay()) % 7) || 7;
      return addDays(today, toNextMon + ((wd + 6) % 7));
    }],
    // "fri" = the next Friday, today included
    [new RegExp(`${LEAD}\\b(${WD_ALT})\\b\\.?`, 'i'), (m) => {
      const wd = WEEKDAY[m[1].toLowerCase()];
      return addDays(today, (wd - today.getDay() + 7) % 7);
    }],
    // "sep 30", "september 30th"
    [new RegExp(`${LEAD}\\b(${MO_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m) => monthDay(MONTH[m[1].toLowerCase()], Number(m[2]), today)],
    // "30 sep", "30th of september"
    [new RegExp(`${LEAD}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MO_ALT})\\b\\.?`, 'i'), (m) => monthDay(MONTH[m[2].toLowerCase()], Number(m[1]), today)],
    // 2026-09-30
    [new RegExp(`${LEAD}\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b`, 'i'), (m) => new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))],
    // 9/30 — month first unless that is impossible (30/9)
    [new RegExp(`${LEAD}\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b`, 'i'), (m) => {
      let a = Number(m[1]), b = Number(m[2]);
      let month = a, day = b;
      if (a > 12 && b <= 12) { month = b; day = a; }
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      if (m[3]) {
        const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
        return new Date(y, month - 1, day);
      }
      return monthDay(month - 1, day, today);
    }],
  ];
  for (const [re, fn] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const date = fn(m);
    if (!date || isNaN(date)) continue;
    return { date: startOfDay(date), text: stripSpan(text, re) };
  }
  return { date: null, text };
}

/** A month/day with no year: this year, unless that was long ago. */
function monthDay(month, day, today) {
  if (month == null || day < 1 || day > 31) return null;
  let d = new Date(today.getFullYear(), month, day);
  // "due sep 20" typed on Sep 24 is overdue, not next year. Only roll over
  // when the date is well in the past (typing next term's dates in June).
  if ((today - d) / 86400000 > 60) d = new Date(today.getFullYear() + 1, month, day);
  return d;
}

function takePriority(text) {
  const rules = [
    [/(^|\s)!!!+(?=\s|$)|\b(asap|urgent)\b/i, 'asap'],
    [/(^|\s)!!?(?=\s|$)|\b(high(\s+priority)?|important)\b/i, 'high'],
    [/\b(low(\s+priority)?|whenever)\b/i, 'low'],
  ];
  for (const [re, p] of rules) {
    if (re.test(text)) return { priority: p, text: text.replace(re, ' ') };
  }
  return { priority: 'medium', text };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Match a class by what students actually type: the full name ("Math 10"),
 * the name without spaces ("math10"), its first word ("math"), or an
 * abbreviation of it ("chem" for Chemistry 11). A first-word match that fits
 * more than one class ("math" with Math 10 and Math 11) is ambiguous, and
 * the caller asks instead of guessing.
 */
function takeClass(text, classes) {
  const lower = ` ${norm(text)} `;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. full names, longest first
  const byLength = classes.slice().sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const c of byLength) {
    const n = norm(c.name);
    if (!n) continue;
    for (const form of [n, n.replace(/ /g, '')]) {
      if (lower.includes(` ${form} `)) {
        const re = new RegExp(`(?:\\b(?:for|in)\\s+)?\\b${escape(form).replace(/ /g, '\\s+')}\\b`, 'i');
        return { classItem: c, ambiguous: [], text: text.replace(re, ' ') };
      }
    }
  }

  // 2. single words against first words and abbreviations
  const words = norm(text).split(' ').filter(w => w.length >= 3);
  for (const w of words) {
    const hits = classes.filter(c => {
      const first = norm(c.name).split(' ')[0] || '';
      if (first.length < 3) return false;
      return first === w || first.startsWith(w) || (first.length >= 4 && w.startsWith(first));
    });
    if (!hits.length) continue;
    const re = new RegExp(`(?:\\b(?:for|in)\\s+)?\\b${escape(w)}\\b`, 'i');
    if (hits.length === 1) return { classItem: hits[0], ambiguous: [], text: text.replace(re, ' ') };
    return { classItem: null, ambiguous: hits, text: text.replace(re, ' ') };
  }
  return { classItem: null, ambiguous: [], text };
}

function tidyTitle(t) {
  let s = ` ${t} `
    .replace(/\s+/g, ' ')
    .replace(/\s+(due|for|on|by|in|at|before|-|:|,)\s*$/i, ' ')
    .replace(/^\s*(due|for|on|by|in|-|:|,)\s+/i, ' ')
    .trim()
    .replace(/[\s,;:-]+$/, '');
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @returns {{
 *   kind: 'homework'|'test', title: string, classItem: object|null,
 *   ambiguousClasses: object[], dueDate: string, dueExplicit: boolean,
 *   priority: 'low'|'medium'|'high'|'asap'
 * }}
 */
export function parseQuickAdd(input, { classes = [], now = new Date() } = {}) {
  const raw = String(input || '').trim();
  const kind = TEST_RE.test(raw) ? 'test' : 'homework';

  let text = ` ${raw} `;
  const p = takePriority(text); text = p.text;
  const d = takeDate(text, now); text = d.text;
  const c = takeClass(text, classes); text = c.text;

  // "due" with nothing after it once the date is gone
  text = text.replace(/\bdue\b\s*$/i, ' ');

  let title = tidyTitle(text);
  // "math test fri" -> after taking the class and date only "test" is left:
  // name it after the class so the list reads well.
  if (kind === 'test' && /^(test|quiz|exam|midterm|final)s?$/i.test(title) && c.classItem) {
    title = `${c.classItem.name} ${title.toLowerCase()}`;
  }

  const fallback = kind === 'test' ? addDays(now, 7) : addDays(now, 1);
  return {
    kind,
    title,
    classItem: c.classItem,
    ambiguousClasses: c.ambiguous,
    dueDate: ymd(d.date || fallback),
    dueExplicit: !!d.date,
    priority: p.priority,
  };
}
