import React, { useState } from 'react';
import { Check, Plus, Wand2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { makeStep, stepProgress } from '@/lib/shredder';
import { formatMinutes } from '@/lib/agenda';

/**
 * A homework item's checklist — Task Shredder's output, editable. The next
 * step is highlighted, because "what do I do now" is the whole point.
 */
export default function StepList({ steps = [], onChange, onRedo, redoing = false, compact = false }) {
  const [draft, setDraft] = useState('');
  const { total, done, minutesLeft, next } = stepProgress(steps);

  const add = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const m = /(\d{1,2})\s*(?:m|min|mins|minutes)\s*$/i.exec(text);
    onChange([...steps, makeStep(m ? text.slice(0, m.index).trim() : text, m ? Number(m[1]) : 10)]);
    setDraft('');
  };

  return (
    <div className={cn('space-y-2', compact ? '' : 'pt-1')}>
      {total > 0 && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Steps done">
            <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 dark:bg-indigo-400" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{total}{minutesLeft ? ` · ${formatMinutes(minutesLeft)} left` : ''}
          </span>
        </div>
      )}

      <ol className="space-y-1">
        {steps.map((s) => {
          const isNext = next && s.id === next.id;
          return (
            <li key={s.id} className={cn('group flex items-start gap-2 rounded-lg px-1.5 py-1', isNext && 'bg-accent')}>
              <button
                type="button"
                role="checkbox"
                aria-checked={!!s.done}
                aria-label={s.done ? `Mark "${s.text}" not done` : `Mark "${s.text}" done`}
                onClick={() => onChange(steps.map(x => (x.id === s.id ? { ...x, done: !x.done } : x)))}
                className={cn('mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-md border-2 transition-colors duration-150',
                  s.done ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-400 dark:text-slate-900' : 'border-slate-300 hover:border-indigo-500 dark:border-slate-600')}
              >
                {s.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </button>
              <span className={cn('flex-1 text-sm leading-6', s.done ? 'text-muted-foreground line-through' : 'text-foreground', isNext && 'font-medium')}>
                {s.text}
              </span>
              <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">{s.minutes}m</span>
              <button type="button" aria-label={`Remove "${s.text}"`}
                onClick={() => onChange(steps.filter(x => x.id !== s.id))}
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground focus:opacity-100 group-hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={add} className="flex min-w-[12rem] flex-1 items-center gap-1 rounded-lg border bg-background pl-2 focus-within:ring-2 focus-within:ring-ring">
          <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a step (e.g. outline intro 10m)"
            aria-label="Add a step"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </form>
        {onRedo && (
          <button type="button" onClick={onRedo} disabled={redoing}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-indigo-700 hover:bg-accent disabled:opacity-60 dark:text-indigo-300">
            {redoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {total ? 'Redo steps' : 'Break it down'}
          </button>
        )}
      </div>
    </div>
  );
}
