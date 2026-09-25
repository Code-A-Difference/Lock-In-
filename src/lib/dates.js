/**
 * Dates as students say them. Everything works on local calendar days and
 * YYYY-MM-DD strings — due dates have no time of day, and treating them as
 * UTC midnight would shift them a day for anyone west of Greenwich (which is
 * all of BC).
 */

export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD (or a full ISO string) as a LOCAL calendar day. */
export function parseDay(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Whole calendar days from `now` to `day` (negative = in the past). */
export function daysUntil(day, now = new Date()) {
  const a = startOfDay(now).getTime();
  const b = startOfDay(day).getTime();
  return Math.round((b - a) / 86400000);
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", "Fri", "Sep 30", "Yesterday", "3 days ago". */
export function relativeDay(dayStr, now = new Date()) {
  const d = parseDay(dayStr);
  if (!d) return '';
  const n = daysUntil(d, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < -1) return `${-n} days ago`;
  if (n < 7) return WD[d.getDay()];
  return `${MO[d.getMonth()]} ${d.getDate()}`;
}

export function shortDate(dayStr) {
  const d = parseDay(dayStr);
  return d ? `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}` : '';
}

/** Which agenda section a due date belongs in. */
export function bucketFor(dayStr, now = new Date()) {
  const d = parseDay(dayStr);
  if (!d) return 'later';
  const n = daysUntil(d, now);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 7) return 'week';
  return 'later';
}

/** Monday-start week containing `now`. */
export function weekStart(now = new Date()) {
  const d = startOfDay(now);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d;
}
