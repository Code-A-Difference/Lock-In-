/**
 * Deadline reminders: which notifications to show, and when. Pure, so it is
 * tested in Node (tests/reminders.test.mjs); Reminders.jsx does the showing.
 *
 * Homework: the evening before it's due and the morning it's due. Tests: a few
 * days before, the evening before and the morning of. Planned study blocks: a
 * few minutes before they start. Things that land at the same moment become one
 * notification ("3 things due tomorrow"), so a busy week isn't a wall of pings.
 */

export const DEFAULT_REMINDERS = {
  on: false,
  eveningBefore: '19:00',
  morningOf: '07:30',
  testDaysBefore: 3,       // 0 = no early test reminder
  blocks: true,            // a reminder before each planned study block
  blockLead: 5,            // minutes before it starts
};

const HORIZON_DAYS = 14;

const pad = (n) => String(n).padStart(2, '0');
export const ymdLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-10-14" + "07:30" -> that moment in local time; null if either is malformed. */
export function at(day, hhmm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m || !t) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0);
}

function shift(day, days) {
  const d = at(day, '12:00');
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
}

/** A stable number for a reminder (Android wants a 31-bit int id). */
export function idOf(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) & 0x7fffffff;
}

const list = (titles) => (titles.length <= 3 ? titles.join(', ') : `${titles.slice(0, 3).join(', ')} and ${titles.length - 3} more`);

/**
 * Every reminder still to come, soonest first: [{ id, key, at: Date, title, body, kind }].
 */
export function plannedReminders({ homework = [], tests = [], schedule = null, prefs = {}, now = new Date() } = {}) {
  const p = { ...DEFAULT_REMINDERS, ...prefs };
  if (!p.on) return [];
  const until = new Date(now.getTime() + HORIZON_DAYS * 864e5);
  const raw = [];
  const add = (when, group, title, what) => { if (when && when > now && when <= until) raw.push({ when, group, title, what }); };

  for (const h of homework) {
    if (h.is_completed || !h.due_date) continue;
    const name = h.title + (h.class_name ? ` (${h.class_name})` : '');
    add(at(shift(h.due_date, -1), p.eveningBefore), 'due-tomorrow', 'Due tomorrow', name);
    add(at(h.due_date, p.morningOf), 'due-today', 'Due today', name);
  }
  for (const t of tests) {
    if (!t.date) continue;
    const name = t.title + (t.class_name ? ` (${t.class_name})` : '');
    if (p.testDaysBefore > 1) add(at(shift(t.date, -p.testDaysBefore), p.eveningBefore), `test-${p.testDaysBefore}`, `Test in ${p.testDaysBefore} days`, name);
    add(at(shift(t.date, -1), p.eveningBefore), 'test-tomorrow', 'Test tomorrow', name);
    add(at(t.date, p.morningOf), 'test-today', 'Test today', name);
  }
  if (p.blocks) {
    for (const b of schedule?.blocks || []) {
      const start = at(b.date, b.start);
      if (!start || b.type === 'break') continue;
      add(new Date(start.getTime() - p.blockLead * 60000), `block-${b.date}-${b.start}`, `Study block at ${niceClock(b.start)}`, b.title);
    }
  }

  // Same moment, same kind: one notification
  const byKey = new Map();
  for (const r of raw) {
    const k = `${r.when.getTime()}|${r.group}`;
    if (!byKey.has(k)) byKey.set(k, { ...r, items: [] });
    byKey.get(k).items.push(r.what);
  }
  return [...byKey.values()]
    .map(r => {
      const items = [...new Set(r.items)];
      const key = `${r.group}|${ymdLocal(r.when)}|${items.join('|')}`;
      const title = items.length > 1 && !r.group.startsWith('block') ? `${items.length} things: ${r.title.toLowerCase()}` : r.title;
      return { id: idOf(key), key, at: r.when, title, body: list(items), kind: r.group };
    })
    .sort((a, b) => a.at - b.at);
}

/** "15:30" -> "3:30 pm" */
function niceClock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${((h + 11) % 12) + 1}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}
