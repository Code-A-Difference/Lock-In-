import React, { useState } from 'react';
import { CalendarClock, Loader2, Pencil, Play, Plus, Repeat, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePlanner } from '@/lib/PlannerContext';
import { useFocus } from '@/lib/FocusContext';
import { relativeDay, ymd, addDays } from '@/lib/dates';
import { niceTime, blockMinutes, totalMinutes, weekdayName } from '@/lib/planner';

const TYPE = {
  homework: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  study: 'bg-accent text-primary',
  break: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const PRESETS = [
  ['After school', '15:30', '18:00'],
  ['Evening', '19:00', '21:00'],
  ['Morning', '09:00', '11:00'],
];

/**
 * Free time in, plan out. Pick a day, tap a preset or type the times, and
 * "Plan it". The assistant fills in the same list when you tell it when you're
 * free, so this is also where you see what it did.
 */
export default function PlannerSheet() {
  const p = usePlanner();
  const focus = useFocus();
  const [day, setDay] = useState(() => ymd(new Date()));
  const [start, setStart] = useState('15:30');
  const [end, setEnd] = useState('18:00');
  const [msg, setMsg] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [editing, setEditing] = useState(null);      // index of the block being edited, -1 for a new one

  const days = [0, 1, 2, 3, 4, 5, 6].map(n => ymd(addDays(new Date(), n)));
  const add = (s = start, e = end) => {
    const r = p.addSlot({ date: day, start: s, end: e }, { weekly });
    setMsg(r.error || '');
  };
  const plan = async () => {
    setMsg('');
    try { await p.generate(); } catch (e) { setMsg(e.message); }
  };
  const byDay = (list, key) => list.reduce((acc, x) => { (acc[x[key]] ||= []).push(x); return acc; }, {});
  const slotDays = byDay(p.slots, 'date');
  // each block keeps its place in the saved list, so editing one knows which it is
  const blockDays = byDay((p.schedule?.blocks || []).map((b, index) => ({ ...b, index })).filter(b => b.date >= ymd(new Date())), 'date');

  return (
    <Dialog open={p.open} onOpenChange={p.setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overflow-x-hidden sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" />Study planner</DialogTitle>
          <DialogDescription>Add when you’re free; I’ll fit your homework and test prep into it. You can also just tell the assistant “I’m free 4 to 6 today, plan my day”.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="free-h" className="space-y-3">
          <h3 id="free-h" className="text-sm font-semibold text-foreground">When you’re free</h3>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Day">
            {days.map(d => (
              <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={day === d}
                className={cn('h-9 flex-none rounded-lg border px-3 text-xs font-medium', day === d ? 'border-primary/40 bg-accent text-primary' : 'text-foreground hover:bg-secondary')}>
                {relativeDay(d)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([label, s, e]) => (
              <button key={label} type="button" onClick={() => add(s, e)}
                className="h-8 rounded-full border px-3 text-xs text-foreground hover:border-primary/40 hover:bg-accent">
                + {label} <span className="text-muted-foreground">{niceTime(s)} to {niceTime(e)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">From
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm text-foreground" />
            </label>
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">To
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm text-foreground" />
            </label>
            <button type="button" onClick={() => add()} aria-label="Add this free time" className="inline-flex h-10 flex-none items-center gap-1 rounded-lg border px-2.5 text-sm font-medium text-foreground hover:bg-secondary">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">Add</span>
            </button>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={weekly} onChange={e => setWeekly(e.target.checked)} className="h-4 w-4 accent-primary" />
            Every week{weekly ? ` (every ${weekdayName(new Date(`${day}T12:00:00`).getDay())})` : ''}
          </label>

          {!p.schedule && editing !== -1 && (
            <button type="button" onClick={() => setEditing(-1)} className="inline-flex h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" />Or plan a block yourself
            </button>
          )}
          {p.slots.length ? (
            <ul className="space-y-1.5">
              {Object.entries(slotDays).map(([d, list]) => (
                <li key={d} className="rounded-xl border p-2.5">
                  <p className="text-xs font-semibold text-foreground">{relativeDay(d)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {list.map(s => (
                      <span key={s.start} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                        {s.weekly && <Repeat className="h-3 w-3 text-primary" aria-label="every week" />}
                        {niceTime(s.start)} to {niceTime(s.end)}
                        <button type="button" onClick={() => p.removeSlot(s)} aria-label={s.weekly ? `Stop repeating ${niceTime(s.start)} to ${niceTime(s.end)} every week` : `Remove ${niceTime(s.start)} to ${niceTime(s.end)}`}
                          className="-my-1 grid h-7 w-7 place-items-center rounded-full hover:bg-background"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No free time yet.</p>}

          <textarea aria-label="Notes for the planner" value={p.notes} onChange={e => p.setNotes(e.target.value)} rows={2}
            placeholder="Anything to know? e.g. chemistry is my weakest, I study best in the evening"
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:border-primary" />

          {(msg || p.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{msg || p.error}</p>}
          <button type="button" onClick={plan} disabled={p.busy || !p.slots.length}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {p.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {p.busy ? 'Planning…' : p.schedule ? 'Re-plan' : `Plan it${p.slots.length ? ` (${Math.round(totalMinutes(p.slots) / 6) / 10} h free)` : ''}`}
          </button>
        </section>

        {(p.schedule || editing === -1) && (
          <section aria-labelledby="plan-h" className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 id="plan-h" className="text-sm font-semibold text-foreground">Your plan</h3>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setEditing(-1)} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-accent"><Plus className="h-3.5 w-3.5" />Add a block</button>
                {p.schedule && <button type="button" onClick={p.clearPlan} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"><Trash2 className="h-3.5 w-3.5" />Clear</button>}
              </div>
            </div>
            {p.schedule?.summary && <p className="text-sm text-muted-foreground">{p.schedule.summary}</p>}
            {editing === -1 && <BlockEditor initial={{ date: day, start, end, title: '' }} onSave={(b) => p.editBlock(-1, b)} onDone={() => setEditing(null)} />}
            {Object.entries(blockDays).map(([d, list]) => (
              <div key={d}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{relativeDay(d)}</p>
                <ul className="space-y-1.5">
                  {list.map((b, i) => editing === b.index ? (
                    <li key={`${b.start}${i}`}><BlockEditor initial={b} onSave={(nb) => p.editBlock(b.index, nb)} onDone={() => setEditing(null)} /></li>
                  ) : (
                    <li key={`${b.start}${i}`} className="flex items-start gap-3 rounded-xl border p-2.5">
                      <span className="w-16 flex-none text-xs tabular-nums text-muted-foreground">{niceTime(b.start)}<br />{niceTime(b.end)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{b.title}</p>
                        {b.reason && <p className="text-xs text-muted-foreground">{b.reason}</p>}
                      </div>
                      <span className={cn('flex-none rounded-full px-2 py-0.5 text-xs font-medium', TYPE[b.type])}>{b.type}</span>
                      <button type="button" onClick={() => setEditing(b.index)} aria-label={`Change ${b.title}`} className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => p.editBlock(b.index, null)} aria-label={`Remove ${b.title}`} className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      {b.type !== 'break' && d === ymd(new Date()) && (
                        <button type="button" onClick={() => { focus.startFocus(Math.min(90, blockMinutes(b))); focus.openFocus(); p.setOpen(false); }}
                          aria-label={`Start ${b.title}`} className="grid h-8 w-8 flex-none place-items-center rounded-lg text-primary hover:bg-accent"><Play className="h-4 w-4" /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {p.schedule?.notes && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{p.schedule.notes}</p>}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One plan block, editable: day, times, what it's for, and its kind. */
function BlockEditor({ initial, onSave, onDone }) {
  const [b, setB] = useState({ type: 'study', ...initial });
  const [err, setErr] = useState('');
  const days = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(n => ymd(addDays(new Date(), n)));
  const set = (k) => (e) => setB(x => ({ ...x, [k]: e.target.value }));
  const box = 'mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm text-foreground';
  const save = () => {
    const r = onSave(b);
    if (r?.error) { setErr(r.error); return; }
    onDone();
  };
  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-accent/40 p-3">
      <label className="block text-xs text-muted-foreground">What for
        <input autoFocus value={b.title} onChange={set('title')} placeholder="e.g. Revise cell division" className={box} />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-muted-foreground">Day
          <select value={b.date} onChange={set('date')} className={box}>
            {days.map(d => <option key={d} value={d}>{relativeDay(d)}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">From<input type="time" value={b.start} onChange={set('start')} className={box} /></label>
        <label className="text-xs text-muted-foreground">To<input type="time" value={b.end} onChange={set('end')} className={box} /></label>
        <label className="text-xs text-muted-foreground">Kind
          <select value={b.type} onChange={set('type')} className={box}>
            <option value="study">Study</option><option value="homework">Homework</option><option value="break">Break</option>
          </select>
        </label>
      </div>
      {err && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-10 rounded-lg border px-3 text-sm font-medium text-foreground hover:bg-secondary">Cancel</button>
        <button type="button" onClick={save} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Save</button>
      </div>
    </div>
  );
}
