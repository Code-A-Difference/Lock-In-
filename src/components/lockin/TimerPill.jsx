import React from 'react';
import { Pause, Play } from 'lucide-react';
import { useFocus, PHASE_LABEL } from '@/lib/FocusContext';
import { clock } from '@/lib/agenda';
import { cn } from '@/lib/utils';

/**
 * The running timer, visible from every page. Hidden while nothing is going,
 * so it never becomes furniture.
 */
export default function TimerPill({ className, wide = false }) {
  const f = useFocus();
  if (f.status === 'idle') return null;
  const isBreak = f.phase !== 'focus';
  return (
    <div className={cn(
      'flex items-center gap-1 rounded-full border bg-card pl-1 pr-1 shadow-sm',
      isBreak ? 'border-emerald-300 dark:border-emerald-800' : 'border-indigo-200 dark:border-indigo-900',
      wide && 'w-full rounded-xl', className,
    )}>
      <button
        type="button"
        onClick={f.toggle}
        aria-label={f.status === 'running' ? 'Pause timer' : 'Resume timer'}
        className={cn('grid h-8 w-8 flex-none place-items-center rounded-full text-white',
          isBreak ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700')}
      >
        {f.status === 'running' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
      </button>
      <button type="button" onClick={f.openFocus} className="flex min-w-0 flex-1 items-baseline gap-2 rounded-full px-2 py-1.5 text-left" aria-label="Open the focus timer">
        <span className="font-semibold tabular-nums text-foreground">{clock(f.remaining)}</span>
        <span className={cn('truncate text-xs font-medium', isBreak ? 'text-emerald-700 dark:text-emerald-400' : 'text-indigo-700 dark:text-indigo-300')}>
          {f.status === 'paused' ? 'Paused' : wide && f.taskItem ? f.taskItem.title : PHASE_LABEL[f.phase]}
        </span>
      </button>
    </div>
  );
}
