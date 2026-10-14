import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudyData } from '@/lib/data';
import { formatMinutes } from '@/lib/agenda';
import { progressStats } from '@/lib/progress';

const RANGES = [[7, 'This week'], [30, 'Last 30 days']];

/**
 * How studying is going: focus time by day and by class, homework finished week
 * by week, and what's coming up. Everything here comes from what's already
 * recorded (focus blocks, ticked homework); nothing extra to fill in.
 */
export default function Progress() {
  const { sessions, homework, tests } = useStudyData();
  const [days, setDays] = useState(7);
  const s = useMemo(() => progressStats({ sessions, homework, tests, days }), [sessions, homework, tests, days]);
  const dayMax = Math.max(1, ...s.perDay.map(d => d.minutes));
  const classMax = Math.max(1, ...s.classes.map(c => c.minutes));
  const weekMax = Math.max(1, ...s.weeks.map(w => w.done));
  const span = days === 7 ? 'this week' : 'in the last 30 days';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <Link to="/" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />Today
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Progress</h1>
        <div role="radiogroup" aria-label="Time span" className="flex rounded-lg border p-0.5">
          {RANGES.map(([n, label]) => (
            <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)}
              className={cn('h-10 rounded-md px-3 text-sm font-medium', days === n ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 max-w-[60ch] text-base text-foreground">
        {s.total
          ? <>You focused <strong>{formatMinutes(s.total)}</strong> {span}, on {s.activeDays} {s.activeDays === 1 ? 'day' : 'days'}{s.classes[0] && s.classes[0].name !== 'No class' ? <>, most of it on <strong>{s.classes[0].name}</strong></> : null}. You finished <strong>{s.done}</strong> {s.done === 1 ? 'piece' : 'pieces'} of homework{s.done ? `, ${s.onTime} on time` : ''}.</>
          : <>No focus time {span} yet. Lock in on something and it shows up here.</>}
      </p>

      <section aria-labelledby="by-day" className="mt-8">
        <h2 id="by-day" className="text-base font-semibold text-foreground">Focus by day</h2>
        <div className={cn('mt-3 grid items-end gap-1', days === 7 ? 'grid-cols-7' : 'grid-cols-[repeat(30,minmax(0,1fr))]')}>
          {s.perDay.map((d, i) => (
            <div key={d.day} className="flex flex-col items-center gap-1" title={`${d.day}: ${formatMinutes(d.minutes)}`}>
              <div className="flex h-28 w-full items-end">
                <div className={cn('w-full rounded-t', d.minutes ? 'bg-primary' : 'bg-secondary')}
                  style={{ height: `${Math.max(d.minutes ? 4 : 2, (d.minutes / dayMax) * 100)}%` }} />
              </div>
              {(days === 7 || i % 5 === 4) && <span className="text-xs text-muted-foreground">{d.label}</span>}
              <span className="sr-only">{d.day}: {formatMinutes(d.minutes)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          About {formatMinutes(s.average)} a day{s.best ? `, most on ${new Date(`${s.best.day}T12:00:00`).toLocaleDateString('en', { weekday: 'long' })} (${formatMinutes(s.best.minutes)})` : ''}.
        </p>
      </section>

      {s.classes.length > 0 && (
        <section aria-labelledby="by-class" className="mt-8">
          <h2 id="by-class" className="text-base font-semibold text-foreground">By class</h2>
          <ul className="mt-3 space-y-2">
            {s.classes.map(c => (
              <li key={c.name} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-foreground">{c.name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(c.minutes / classMax) * 100}%` }} />
                </span>
                <span className="tabular-nums text-muted-foreground">{formatMinutes(c.minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="hw-weeks" className="mt-8">
        <h2 id="hw-weeks" className="text-base font-semibold text-foreground">Homework finished, week by week</h2>
        <div className="mt-3 grid grid-cols-6 items-end gap-2">
          {s.weeks.map(w => (
            <div key={w.start} className="flex flex-col items-center gap-1">
              <span className="text-sm font-semibold tabular-nums text-foreground">{w.done}</span>
              <div className="flex h-20 w-full items-end">
                <div className={cn('w-full rounded-t', w.done ? 'bg-primary' : 'bg-secondary')} style={{ height: `${Math.max(w.done ? 6 : 2, (w.done / weekMax) * 100)}%` }} />
              </div>
              <span className="text-center text-xs text-muted-foreground">{w.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="coming" className="mt-8 border-t pt-6">
        <h2 id="coming" className="text-base font-semibold text-foreground">Coming up</h2>
        <ul className="mt-2 space-y-1 text-sm text-foreground">
          <li>{s.dueSoon ? `${s.dueSoon} ${s.dueSoon === 1 ? 'piece' : 'pieces'} of homework due in the next 7 days.` : 'Nothing due in the next 7 days.'}</li>
          <li>{s.testsSoon ? `${s.testsSoon} ${s.testsSoon === 1 ? 'test' : 'tests'} in the next two weeks.` : 'No tests in the next two weeks.'}</li>
          {s.overdue > 0 && <li>{s.overdue} overdue. <Link to="/" className="font-medium text-primary underline">See them on Today</Link>.</li>}
        </ul>
      </section>
    </div>
  );
}
