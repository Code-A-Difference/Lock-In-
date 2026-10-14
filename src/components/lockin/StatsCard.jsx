import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Flame, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { focusStats, formatMinutes } from '@/lib/agenda';

/** Minutes focused, the daily goal, the streak, and the last seven days. */
export default function StatsCard({ sessions = [], goal = 120, className }) {
  const s = focusStats(sessions);
  const max = Math.max(goal, ...s.days.map(d => d.minutes), 1);
  const pct = Math.min(100, Math.round((s.todayMinutes / goal) * 100));
  return (
    <section className={cn('rounded-2xl border bg-card p-4', className)} aria-labelledby="stats-h">
      <div className="flex items-center justify-between">
        <h2 id="stats-h" className="text-sm font-semibold text-foreground">Focus</h2>
        {s.streak > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />
            {s.streak}-day streak
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{formatMinutes(s.todayMinutes)}</p>
          <p className="text-xs text-muted-foreground">today · goal {formatMinutes(goal)}</p>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          <span className="block text-sm font-semibold tabular-nums text-foreground">{formatMinutes(s.weekMinutes)}</span>
          last 7 days
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Daily goal" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-7 items-end gap-1.5" aria-label="Minutes per day, last 7 days">
        {s.days.map(d => (
          <div key={d.day} className="flex flex-col items-center gap-1" title={`${d.day}: ${formatMinutes(d.minutes)}`}>
            <div className="flex h-10 w-full items-end">
              <div className={cn('w-full rounded-t', d.isToday ? 'bg-primary' : 'bg-accent')}
                style={{ height: `${Math.max(d.minutes ? 6 : 2, (d.minutes / max) * 100)}%` }} />
            </div>
            <span className={cn('text-xs', d.isToday ? 'font-bold text-foreground' : 'text-muted-foreground')}>{d.label}</span>
            <span className="sr-only">{formatMinutes(d.minutes)}</span>
          </div>
        ))}
      </div>
      {pct >= 100 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Target className="h-3.5 w-3.5" aria-hidden="true" />Goal hit for today.
        </p>
      )}
      <Link to="/Progress" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">
        See your progress<ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
