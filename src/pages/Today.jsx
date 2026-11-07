import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lock, ChevronDown, List, CalendarDays, CheckCircle2, Play, CalendarClock, ChevronRight, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudyData, useActions } from '@/lib/data';
import { useFocus } from '@/lib/FocusContext';
import { buildAgenda, pickNext, BUCKETS, formatMinutes, clock, focusStats } from '@/lib/agenda';
import { relativeDay, daysUntil, parseDay, ymd, startOfDay } from '@/lib/dates';
import { Skeleton } from '@/components/ui/skeleton';
import QuickAdd from '@/components/lockin/QuickAdd';
import AgendaRow from '@/components/lockin/AgendaRow';
import StatsCard from '@/components/lockin/StatsCard';
import { BadgesButton } from '@/components/lockin/Badges';
import CalendarView from '@/components/calendar/CalendarView';
import EditHomeworkDialog from '@/components/homework/EditHomeworkDialog';
import EditTestDialog from '@/components/tests/EditTestDialog';
import { usePlanner } from '@/lib/PlannerContext';
import { niceTime } from '@/lib/planner';
import { FEEDBACK_URL } from '@/lib/site';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}

/**
 * Today. It answers three questions in the order a student asks them: what is
 * the state of things (the line under the greeting), what should I start (one
 * panel, with the only filled button on the page), and what is everything else
 * (the agenda, one card, rows divided by hairlines, with adding a line to it as
 * its first row). The week behind you and the tests ahead sit to the side.
 */
export default function Today() {
  const { user, classes, homework, tests, sessions, isLoading } = useStudyData();
  const act = useActions();
  const focus = useFocus();
  const navigate = useNavigate();
  const location = useLocation();
  const quickAdd = useRef(null);
  const planner = usePlanner();
  const [view, setView] = useState(() => { try { return localStorage.getItem('lockin.todayView') || 'list'; } catch (_) { return 'list'; } });
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedDay, setSelectedDay] = useState(startOfDay(new Date()));

  useEffect(() => { try { localStorage.setItem('lockin.todayView', view); } catch (_) {} }, [view]);

  // "N" from anywhere lands here with the box focused.
  useEffect(() => {
    const go = () => quickAdd.current?.focus();
    window.addEventListener('lockin:quickadd', go);
    if (location.state?.quickAdd) setTimeout(go, 50);
    if (location.state?.openPlanner) planner.setOpen(true);
    if (location.state?.quickAdd || location.state?.openPlanner) navigate('.', { replace: true, state: null });
    return () => window.removeEventListener('lockin:quickadd', go);
  }, [location.state, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const agenda = useMemo(() => buildAgenda(homework, tests), [homework, tests]);
  const next = useMemo(() => pickNext(homework, tests), [homework, tests]);
  const stats = useMemo(() => focusStats(sessions), [sessions]);
  const upcomingTests = useMemo(
    () => tests.filter(t => { const d = parseDay(t.date); return d && daysUntil(d) >= 0; }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4),
    [tests],
  );

  const overdue = agenda.overdue.length;
  const dueToday = agenda.today.filter(e => e.kind === 'homework').length;
  const soonTest = upcomingTests.find(t => daysUntil(parseDay(t.date)) <= 6);
  const firstName = (user?.full_name || '').split(' ')[0];
  const empty = !isLoading && homework.length === 0 && tests.length === 0;
  const goal = focus.prefs.dailyGoal || 120;
  const focusMin = focus.prefs.focusMin || 25;

  // Mid-block, the button goes back to that block, it never swaps the task
  // you're on for a different one.
  const inBlock = focus.phase === 'focus' && focus.status !== 'idle';
  const lockIn = () => {
    if (!inBlock) focus.lockIn(next ? { type: next.kind, id: next.item.id } : null);
    focus.openFocus();
  };

  const dayEntries = useMemo(() => {
    const key = ymd(selectedDay);
    return [
      ...tests.filter(t => t.date === key).map(item => ({ kind: 'test', item })),
      ...homework.filter(h => h.due_date === key).map(item => ({ kind: 'homework', item })),
    ];
  }, [selectedDay, homework, tests]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 lg:mb-8">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          {!isLoading && <StatusLine empty={empty} overdue={overdue} dueToday={dueToday} test={soonTest} />}
        </div>
        <BadgesButton className="mt-1 flex-none" />
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-8">
        <div className="min-w-0 space-y-6">
          {!isLoading && (
            <UpNext inBlock={inBlock} focus={focus} next={next} classes={classes} stats={stats} goal={goal} focusMin={focusMin} onLockIn={lockIn} />
          )}

          <section aria-labelledby="agenda-h" className="overflow-hidden rounded-2xl border bg-card">
            <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
              <h2 id="agenda-h" className="text-lg font-semibold tracking-tight text-foreground">Agenda</h2>
              <div className="inline-flex rounded-lg bg-secondary/60 p-0.5" role="group" aria-label="View">
                {[['list', List, 'List'], ['calendar', CalendarDays, 'Calendar']].map(([id, Icon, label]) => (
                  <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id}
                    className={cn('inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors duration-150',
                      view === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                  </button>
                ))}
              </div>
            </div>

            <QuickAdd ref={quickAdd} classes={classes} flush className="mx-2 mb-1" />
            {!isLoading && <PlanRow planner={planner} />}

            {isLoading ? (
              <div className="space-y-2 border-t p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
            ) : empty ? (
              <EmptyState hasClasses={classes.length > 0} onAdd={() => quickAdd.current?.focus()} />
            ) : view === 'calendar' ? (
              <div className="space-y-4 border-t p-4 sm:p-5">
                <CalendarView
                  homework={homework}
                  tests={tests}
                  selectedDay={selectedDay}
                  onDayClick={setSelectedDay}
                  onHomeworkClick={(item) => setEditing({ kind: 'homework', item })}
                  onTestClick={(item) => setEditing({ kind: 'test', item })}
                />
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">
                    {relativeDay(ymd(selectedDay))}
                    <span className="ml-2 font-normal text-muted-foreground">{selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                  </h3>
                  {dayEntries.length ? (
                    <ul className="-mx-4 divide-y divide-border/60 border-y sm:-mx-5">{dayEntries.map(e => <AgendaRow key={e.item.id} entry={e} classes={classes} onEdit={setEditing} showDay={false} />)}</ul>
                  ) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing on this day.</p>}
                </div>
              </div>
            ) : (
              <div className="border-t pb-2">
                {BUCKETS.map(({ id, label }) => agenda[id].length > 0 && (
                  <div key={id}>
                    <h3 className={cn('flex items-center gap-2 px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide sm:px-5',
                      id === 'overdue' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
                      {label}<span className="rounded-full bg-secondary px-1.5 py-px text-xs tabular-nums text-muted-foreground">{agenda[id].length}</span>
                    </h3>
                    <ul className="divide-y divide-border/60">
                      {agenda[id].map(e => (
                        <AgendaRow key={e.item.id} entry={e} classes={classes} onEdit={setEditing} showDay={id !== 'today' && id !== 'tomorrow'} />
                      ))}
                    </ul>
                  </div>
                ))}
                {BUCKETS.every(b => agenda[b.id].length === 0) && (
                  <div className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-5">
                    <CheckCircle2 className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                    <span>All caught up. Nothing is due, so the rest of today is yours.</span>
                  </div>
                )}
                {agenda.done.length > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowDone(s => !s)} aria-expanded={showDone}
                      className="flex min-h-11 w-full items-center gap-1.5 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground sm:px-5">
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', !showDone && '-rotate-90')} aria-hidden="true" />
                      Done <span className="rounded-full bg-secondary px-1.5 py-px text-xs tabular-nums">{agenda.done.length}</span>
                    </button>
                    {showDone && (
                      <ul className="divide-y divide-border/60">
                        {agenda.done.slice(0, 30).map(e => <AgendaRow key={e.item.id} entry={e} classes={classes} onEdit={setEditing} />)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <BetaNote />
        </div>

        {/* Only on a wide screen: next to the sidebar, anything narrower leaves the agenda too thin to read.
            The agenda already lists the tests, and today's focus minutes are beside the Lock in button. */}
        <aside className="hidden xl:block" aria-label="Your week">
          <div className="sticky top-8 divide-y overflow-hidden rounded-2xl border bg-card">
            <StatsCard sessions={sessions} goal={goal} />
            <ComingUp tests={upcomingTests} onStudy={(t) => { focus.lockIn({ type: 'test', id: t.id }); focus.openFocus(); }} />
          </div>
        </aside>
      </div>

      <EditHomeworkDialog
        open={editing?.kind === 'homework'}
        onOpenChange={(o) => !o && setEditing(null)}
        homework={editing?.kind === 'homework' ? editing.item : null}
        onSubmit={async (data) => { await act.updateHomework(editing.item.id, data); setEditing(null); }}
        isLoading={false}
      />
      <EditTestDialog
        open={editing?.kind === 'test'}
        onOpenChange={(o) => !o && setEditing(null)}
        test={editing?.kind === 'test' ? editing.item : null}
        onSubmit={async (data) => { await act.updateTest(editing.item.id, data); setEditing(null); }}
        isLoading={false}
      />
    </div>
  );
}

/** How things stand, in a line: what is overdue, what is due today, the next test. */
function StatusLine({ empty, overdue, dueToday, test }) {
  const cls = 'mt-2 text-base text-muted-foreground sm:text-lg';
  if (empty) return <p className={cls}>A clear slate. Add what you have, and it lines up here.</p>;
  const n = test ? daysUntil(parseDay(test.date)) : null;
  const bits = [];
  if (overdue) bits.push(<span key="o" className="font-semibold text-red-700 dark:text-red-400">{overdue} overdue</span>);
  bits.push(dueToday ? <span key="d" className="font-semibold text-foreground">{dueToday} due today</span> : <span key="d">Nothing due today</span>);
  if (test) bits.push(<span key="t">{test.title} {n === 0 ? 'today' : n === 1 ? 'tomorrow' : `on ${relativeDay(test.date)}`}</span>);
  return <p className={cn(cls, 'flex flex-wrap items-baseline gap-x-3 gap-y-0.5')}>{bits}</p>;
}

/**
 * The thing to start, and the one filled button on the page. Mid-block it is that
 * block (time left, a way back in); otherwise the most urgent item, or a plain
 * block if there is nothing queued. Today's minutes against the daily goal sit
 * under it, because that is where they make you want to press it.
 */
function UpNext({ inBlock, focus, next, classes, stats, goal, focusMin, onLockIn }) {
  const item = next?.item;
  const cls = item && classes.find(c => c.name === item.class_name);
  const day = item && (next.kind === 'test' ? item.date : item.due_date);
  const title = inBlock ? (focus.taskItem?.title || 'Your focus block')
    : item ? `${next.kind === 'test' ? 'Study for ' : ''}${item.title}` : 'Start a focus block';
  const pct = Math.min(100, Math.round((stats.todayMinutes / goal) * 100));
  return (
    <section aria-label={inBlock ? 'Your focus block' : 'Up next'} className="rounded-2xl border bg-accent/40 p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-balance text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">{title}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {inBlock ? (
              <span><span className="font-semibold tabular-nums text-foreground">{clock(focus.remaining)}</span> left in this block</span>
            ) : item ? (
              <>
                {item.class_name && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', cls?.color || 'bg-slate-400')} aria-hidden="true" />{item.class_name}
                  </span>
                )}
                {day && <span>{next.kind === 'test' ? '' : 'Due '}{relativeDay(day)}</span>}
              </>
            ) : (
              <span>Add homework below and Lock in picks what is most urgent.</span>
            )}
          </p>
        </div>
        <button type="button" onClick={onLockIn}
          className="inline-flex h-12 flex-none items-center justify-center gap-2.5 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 sm:h-14 sm:px-7 sm:text-lg">
          {inBlock ? <Play className="h-5 w-5 fill-current" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
          {inBlock ? 'Back to your block' : `Lock in · ${focusMin} min`}
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border/60 pt-4 text-sm">
        <span className="flex-none text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{formatMinutes(stats.todayMinutes)}</span> of {formatMinutes(goal)} today
        </span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Today’s focus goal" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
        {pct >= 100 && <span className="inline-flex flex-none items-center gap-1 font-medium text-primary"><Target className="h-4 w-4" aria-hidden="true" />Goal hit</span>}
      </div>
    </section>
  );
}

/** Today's plan in one line, or the way to make one. The full planner is a sheet. */
function PlanRow({ planner }) {
  const next = planner.today.filter(b => b.type !== 'break').slice(0, 2);
  return (
    <button type="button" onClick={() => planner.setOpen(true)}
      className="flex min-h-12 w-full items-center gap-3 border-t px-4 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-accent/30 sm:px-5">
      <CalendarClock className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{next.length ? 'Today’s plan' : 'Plan my day'}</span>
        {next.length > 0 && <span className="text-muted-foreground"> · {next.map(b => `${niceTime(b.start)} ${b.title}`).join(' · ')}</span>}
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/** Tests ahead, as a count of days. */
function ComingUp({ tests, onStudy }) {
  return (
    <section className="p-5" aria-labelledby="tests-h">
      <h2 id="tests-h" className="text-base font-semibold tracking-tight text-foreground">Tests coming up</h2>
      {tests.length ? (
        <ul className="mt-3 space-y-3">
          {tests.map(t => {
            const n = daysUntil(parseDay(t.date));
            return (
              <li key={t.id} className="flex items-center gap-3">
                <span className={cn('grid h-12 w-12 flex-none place-items-center rounded-xl text-center leading-none',
                  n <= 2 ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-secondary text-foreground')}>
                  <span>
                    <span className="block text-lg font-bold tabular-nums">{n}</span>
                    <span className="block text-xs font-medium">{n === 1 ? 'day' : 'days'}</span>
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                  <p className="truncate text-[13px] text-muted-foreground">{t.class_name || 'No class'} · {relativeDay(t.date)}{t.focus_minutes ? ` · ${formatMinutes(t.focus_minutes)} studied` : ''}</p>
                </div>
                <button type="button" onClick={() => onStudy(t)}
                  className="h-11 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-accent"
                  aria-label={`Study for ${t.title}`}>Study</button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">None coming up.</p>
      )}
    </section>
  );
}

/** Everything in LOCK IN! is in beta; say so once, plainly, and say where feedback goes. */
function BetaNote() {
  return (
    <p className="px-1 text-sm text-muted-foreground">
      LOCK IN! is in beta, so some things will change and some will break.{' '}
      {FEEDBACK_URL
        ? <a href={FEEDBACK_URL} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">Feedback is always welcome.</a>
        : <span className="font-medium text-foreground">Feedback is always welcome.</span>}
    </p>
  );
}

function EmptyState({ hasClasses, onAdd }) {
  return (
    <div className="border-t p-6 text-center">
      <h3 className="text-base font-semibold text-foreground">Nothing due</h3>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onAdd} className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Add homework</button>
        {!hasClasses && (
          <Link to="/Classes" className="inline-flex h-11 items-center rounded-xl border px-5 text-sm font-semibold text-foreground hover:bg-secondary">Add your classes</Link>
        )}
      </div>
    </div>
  );
}
