import React, { useState } from 'react';
import { CalendarClock, Loader2, Play, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePlanner } from '@/lib/PlannerContext';
import { useFocus } from '@/lib/FocusContext';
import { relativeDay, ymd, addDays } from '@/lib/dates';
import { niceTime, blockMinutes, totalMinutes } from '@/lib/planner';

const TYPE = {
  homework: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  study: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
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

  const days = [0, 1, 2, 3, 4, 5, 6].map(n => ymd(addDays(new Date(), n)));
  const add = (s = start, e = end) => {
    const r = p.addSlot({ date: day, start: s, end: e });
    setMsg(r.error || '');
  };
  const plan = async () => {
    setMsg('');
    try { await p.generate(); } catch (e) { setMsg(e.message); }
  };
  const byDay = (list, key) => list.reduce((acc, x) => { (acc[x[key]] ||= []).push(x); return acc; }, {});
  const slotDays = byDay(p.slots, 'date');
  const blockDays = byDay(p.schedule?.blocks?.filter(b => b.date >= ymd(new Date())) || [], 'date');

  return (
    <Dialog open={p.open} onOpenChange={p.setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overflow-x-hidden sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-indigo-600" />Study planner</DialogTitle>
          <DialogDescription>Add when you’re free; I’ll fit your homework and test prep into it. You can also just tell the assistant “I’m free 4 to 6 today, plan my day”.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="free-h" className="space-y-3">
          <h3 id="free-h" className="text-sm font-semibold text-foreground">When you’re free</h3>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Day">
            {days.map(d => (
              <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={day === d}
                className={cn('h-9 flex-none rounded-lg border px-3 text-xs font-medium', day === d ? 'border-indigo-400 bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200' : 'text-foreground hover:bg-secondary')}>
                {relativeDay(d)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([label, s, e]) => (
              <button key={label} type="button" onClick={() => add(s, e)}
                className="h-8 rounded-full border px-3 text-xs text-foreground hover:border-indigo-300 hover:bg-accent">
                + {label} <span className="text-muted-foreground">{niceTime(s)}–{niceTime(e)}</span>
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

          {p.slots.length ? (
            <ul className="space-y-1.5">
              {Object.entries(slotDays).map(([d, list]) => (
                <li key={d} className="rounded-xl border p-2.5">
                  <p className="text-xs font-semibold text-foreground">{relativeDay(d)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {list.map(s => (
                      <span key={s.start} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                        {niceTime(s.start)}–{niceTime(s.end)}
                        <button type="button" onClick={() => p.removeSlot(s)} aria-label={`Remove ${niceTime(s.start)} to ${niceTime(s.end)}`}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No free time yet.</p>}

          <textarea value={p.notes} onChange={e => p.setNotes(e.target.value)} rows={2}
            placeholder="Anything to know? e.g. chemistry is my weakest, I study best in the evening"
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-indigo-400" />

          {(msg || p.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{msg || p.error}</p>}
          <button type="button" onClick={plan} disabled={p.busy || !p.slots.length}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {p.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {p.busy ? 'Planning…' : p.schedule ? 'Re-plan' : `Plan it${p.slots.length ? ` (${Math.round(totalMinutes(p.slots) / 6) / 10} h free)` : ''}`}
          </button>
        </section>

        {p.schedule && (
          <section aria-labelledby="plan-h" className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 id="plan-h" className="text-sm font-semibold text-foreground">Your plan</h3>
              <button type="button" onClick={p.clearPlan} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Trash2 className="h-3.5 w-3.5" />Clear</button>
            </div>
            {p.schedule.summary && <p className="text-sm text-muted-foreground">{p.schedule.summary}</p>}
            {Object.entries(blockDays).map(([d, list]) => (
              <div key={d}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{relativeDay(d)}</p>
                <ul className="space-y-1.5">
                  {list.map((b, i) => (
                    <li key={`${b.start}${i}`} className="flex items-start gap-3 rounded-xl border p-2.5">
                      <span className="w-16 flex-none text-xs tabular-nums text-muted-foreground">{niceTime(b.start)}<br />{niceTime(b.end)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{b.title}</p>
                        {b.reason && <p className="text-xs text-muted-foreground">{b.reason}</p>}
                      </div>
                      <span className={cn('flex-none rounded-full px-2 py-0.5 text-[11px] font-medium', TYPE[b.type])}>{b.type}</span>
                      {b.type !== 'break' && d === ymd(new Date()) && (
                        <button type="button" onClick={() => { focus.startFocus(Math.min(90, blockMinutes(b))); focus.openFocus(); p.setOpen(false); }}
                          aria-label={`Start ${b.title}`} className="grid h-8 w-8 flex-none place-items-center rounded-lg text-indigo-700 hover:bg-accent dark:text-indigo-300"><Play className="h-4 w-4" /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {p.schedule.notes && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{p.schedule.notes}</p>}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
