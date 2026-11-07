import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { focusStats, formatMinutes } from '@/lib/agenda';

/**
 * The last seven days of focus, small. (Today's minutes and the daily goal live
 * beside the Lock in button, where they motivate; this is the week behind them.)
 * It has no box of its own: the page puts it in the side card.
 */
export default function StatsCard({ sessions = [], goal = 120, className }) {
  const s = focusStats(sessions);
  const max = Math.max(goal, ...s.days.map(d => d.minutes), 1);
  return (
    <section className={cn('p-5', className)} aria-labelledby="stats-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="stats-h" className="text-base font-semibold tracking-tight text-foreground">This week</h2>
        {s.streak > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />
            {s.streak}-day streak
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{formatMinutes(s.weekMinutes)}</span> focused in the last 7 days
      </p>

      <div className="mt-4 grid grid-cols-7 gap-2" role="img" aria-label={`Minutes focused each day, last 7 days: ${s.days.map(d => `${d.label} ${formatMinutes(d.minutes)}`).join(', ')}`}>
        {s.days.map((d, i) => (
          <div key={d.day} className="flex flex-col items-center gap-1.5" title={`${d.day}: ${formatMinutes(d.minutes)}`}>
            <div className="flex h-12 w-full items-end">
              <div className={cn('w-full rounded-sm transition-[height] duration-500 ease-out',
                d.isToday ? 'bg-primary' : d.minutes ? 'bg-primary/40' : 'bg-secondary')}
                style={{ height: `${Math.max(d.minutes ? 8 : 3, (d.minutes / max) * 100)}%` }} />
            </div>
            <span className={cn('text-xs', d.isToday ? 'font-bold text-foreground' : 'text-muted-foreground')} aria-hidden="true">{d.label}</span>
          </div>
        ))}
      </div>
      <Link to="/Progress" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">
        See your progress<ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
