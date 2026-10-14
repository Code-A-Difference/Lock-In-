/**
 * The numbers on the Progress page, from focus sessions and homework. Pure, so
 * it is tested in Node (tests/progress.test.mjs).
 */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The local day an ISO time falls on. */
const dayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : ymd(d); };

/** Monday of the week `d` is in. */
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function progressStats({ sessions = [], homework = [], tests = [], days = 7, now = new Date() } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = ymd(addDays(today, -(days - 1)));
  const to = ymd(today);
  const inRange = (day) => day && day >= from && day <= to;

  // focus time per day
  const perDay = Array.from({ length: days }, (_, i) => {
    const d = addDays(today, i - (days - 1));
    return { day: ymd(d), label: days <= 7 ? SHORT[d.getDay()] : String(d.getDate()), minutes: 0 };
  });
  const index = new Map(perDay.map((d, i) => [d.day, i]));
  const byClass = new Map();
  for (const s of sessions) {
    const day = s.day || dayOf(s.ended_at);
    if (!inRange(day)) continue;
    const m = Math.max(0, Number(s.minutes) || 0);
    perDay[index.get(day)].minutes += m;
    const c = (s.class_name || '').trim() || 'No class';
    byClass.set(c, (byClass.get(c) || 0) + m);
  }
  const total = perDay.reduce((n, d) => n + d.minutes, 0);
  const best = perDay.reduce((b, d) => (d.minutes > (b?.minutes || 0) ? d : b), null);
  const activeDays = perDay.filter(d => d.minutes > 0).length;

  // homework finished, and whether on time
  const done = homework.filter(h => h.is_completed && inRange(dayOf(h.completed_at)));
  const onTime = done.filter(h => !h.due_date || dayOf(h.completed_at) <= h.due_date).length;

  // homework finished per week, the last six weeks
  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const start = addDays(thisWeek, (i - 5) * 7);
    return { start: ymd(start), label: i === 5 ? 'This week' : `${start.getDate()} ${start.toLocaleString('en', { month: 'short' })}`, done: 0 };
  });
  for (const h of homework) {
    if (!h.is_completed || !h.completed_at) continue;
    const w = ymd(weekStart(new Date(h.completed_at)));
    const slot = weeks.find(x => x.start === w);
    if (slot) slot.done++;
  }

  // what's coming
  const week = ymd(addDays(today, 7));
  const fortnight = ymd(addDays(today, 14));
  const dueSoon = homework.filter(h => !h.is_completed && h.due_date && h.due_date >= to && h.due_date <= week).length;
  const overdue = homework.filter(h => !h.is_completed && h.due_date && h.due_date < to).length;
  const testsSoon = tests.filter(t => t.date && t.date >= to && t.date <= fortnight).length;

  return {
    perDay, total, average: Math.round(total / days), best: best && best.minutes ? best : null, activeDays,
    classes: [...byClass.entries()].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes),
    done: done.length, onTime, weeks, dueSoon, overdue, testsSoon,
  };
}
