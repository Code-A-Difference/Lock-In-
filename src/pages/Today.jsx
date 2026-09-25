import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lock, ChevronDown, List, CalendarDays, GraduationCap, Sparkles, PartyPopper, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudyData, useActions } from '@/lib/data';
import { useFocus } from '@/lib/FocusContext';
import { buildAgenda, pickNext, BUCKETS, formatMinutes, clock } from '@/lib/agenda';
import { relativeDay, daysUntil, parseDay, ymd, startOfDay } from '@/lib/dates';
import { Skeleton } from '@/components/ui/skeleton';
import QuickAdd from '@/components/lockin/QuickAdd';
import AgendaRow from '@/components/lockin/AgendaRow';
import StatsCard from '@/components/lockin/StatsCard';
import CalendarView from '@/components/calendar/CalendarView';
import EditHomeworkDialog from '@/components/homework/EditHomeworkDialog';
import EditTestDialog from '@/components/tests/EditTestDialog';

function inDays(day) {
  const n = daysUntil(parseDay(day));
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}

/**
 * Everything due, in the order it's due, with the thing to do next one click
 * away. The old home page was a dashboard of counts, a month calendar and a
 * collapsed class list — you had to open a dialog to add anything and another
 * to change it. Here adding is typing one line, and every action is on the row.
 */
export default function Today() {
  const { user, classes, homework, tests, sessions, isLoading } = useStudyData();
  const act = useActions();
  const focus = useFocus();
  const navigate = useNavigate();
  const location = useLocation();
  const quickAdd = useRef(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('lockin.todayView') || 'list'; } catch (_) { return 'list'; } });
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedDay, setSelectedDay] = useState(startOfDay(new Date()));

  useEffect(() => { try { localStorage.setItem('lockin.todayView', view); } catch (_) {} }, [view]);

  // "N" from anywhere lands here with the box focused.
  useEffect(() => {
    const go = () => quickAdd.current?.focus();
    window.addEventListener('lockin:quickadd', go);
    if (location.state?.quickAdd) { setTimeout(go, 50); navigate('.', { replace: true, state: null }); }
    return () => window.removeEventListener('lockin:quickadd', go);
  }, [location.state, navigate]);

  const agenda = useMemo(() => buildAgenda(homework, tests), [homework, tests]);
  const next = useMemo(() => pickNext(homework, tests), [homework, tests]);
  const upcomingTests = useMemo(
    () => tests.filter(t => { const d = parseDay(t.date); return d && daysUntil(d) >= 0; }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4),
    [tests],
  );

  const dueToday = agenda.overdue.length + agenda.today.filter(e => e.kind === 'homework').length;
  const weekCount = agenda.overdue.length + agenda.today.length + agenda.tomorrow.length + agenda.week.length;
  const firstName = (user?.full_name || '').split(' ')[0];
  const empty = !isLoading && homework.length === 0 && tests.length === 0;

  // Mid-block, the button goes back to that block — it never swaps the task
  // you're on for a different one.
  const inBlock = focus.phase === 'focus' && focus.status !== 'idle';
  const lockIn = () => {
    if (!inBlock) focus.lockIn(next ? { type: next.kind, id: next.item.id } : null);
    navigate('/Focus');
  };

  const dayEntries = useMemo(() => {
    const key = ymd(selectedDay);
    return [
      ...tests.filter(t => t.date === key).map(item => ({ kind: 'test', item })),
      ...homework.filter(h => h.due_date === key).map(item => ({ kind: 'homework', item })),
    ];
  }, [selectedDay, homework, tests]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-5">
        <p className="text-sm font-medium text-muted-foreground">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </h1>
        {!isLoading && !empty && (
          <p className="mt-1 text-sm text-muted-foreground">
            {dueToday ? `${dueToday} due today${agenda.overdue.length ? ` (${agenda.overdue.length} overdue)` : ''}` : 'Nothing due today'}
            {' · '}{weekCount} this week
            {upcomingTests[0] && <> · <span className="font-medium text-foreground">{upcomingTests[0].title}</span> {inDays(upcomingTests[0].date)}</>}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <QuickAdd ref={quickAdd} classes={classes} />

          {/* The one gradient on the screen: start on the most urgent thing. */}
          {!isLoading && (
            <button
              type="button"
              onClick={lockIn}
              className="group flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 p-4 text-left text-white shadow-md shadow-indigo-600/20 transition-transform duration-150 hover:shadow-lg active:scale-[0.99]"
            >
              <span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-white/15">
                {inBlock ? <Play className="h-6 w-6" aria-hidden="true" /> : <Lock className="h-6 w-6" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-extrabold tracking-tight">
                  {inBlock ? 'Back to your block' : 'Lock in'}
                </span>
                <span className="block truncate text-sm text-white/85">
                  {inBlock
                    ? `${clock(focus.remaining)} ${focus.status === 'paused' ? 'left, paused' : 'left'}${focus.taskItem ? ` · ${focus.taskItem.title}` : ''}`
                    : next
                    ? <>{next.kind === 'test' ? 'Study for ' : ''}{next.item.title}{next.item.class_name ? ` · ${next.item.class_name}` : ''} · {next.kind === 'test' ? '' : 'due '}{relativeDay(next.kind === 'test' ? next.item.date : next.item.due_date).toLowerCase() || 'no date'}</>
                    : `${focus.prefs.focusMin} minutes, no distractions`}
                </span>
              </span>
              <span className="hidden text-sm font-semibold text-white/90 sm:block">{inBlock ? 'Open →' : `${focus.prefs.focusMin} min →`}</span>
            </button>
          )}

          <section aria-labelledby="agenda-h">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="agenda-h" className="text-base font-semibold text-foreground">Agenda</h2>
              <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="View">
                {[['list', List, 'List'], ['calendar', CalendarDays, 'Calendar']].map(([id, Icon, label]) => (
                  <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id}
                    className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150',
                      view === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : empty ? (
              <EmptyState hasClasses={classes.length > 0} onAdd={() => quickAdd.current?.focus()} />
            ) : view === 'calendar' ? (
              <div className="space-y-4">
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
                    <ul className="space-y-2">{dayEntries.map(e => <AgendaRow key={e.item.id} entry={e} classes={classes} onEdit={setEditing} showDay={false} />)}</ul>
                  ) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing on this day.</p>}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {BUCKETS.map(({ id, label }) => agenda[id].length > 0 && (
                  <div key={id}>
                    <h3 className={cn('mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide',
                      id === 'overdue' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
                      {label}<span className="rounded-full bg-secondary px-1.5 py-px text-[11px] tabular-nums text-muted-foreground">{agenda[id].length}</span>
                    </h3>
                    <ul className="space-y-2">
                      {agenda[id].map(e => (
                        <AgendaRow key={e.item.id} entry={e} classes={classes} onEdit={setEditing} showDay={id !== 'today' && id !== 'tomorrow'} />
                      ))}
                    </ul>
                  </div>
                ))}
                {BUCKETS.every(b => agenda[b.id].length === 0) && (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    <PartyPopper className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                    All caught up. Add what's next above, or lock in on something ahead of time.
                  </div>
                )}
                {agenda.done.length > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowDone(s => !s)} aria-expanded={showDone}
                      className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', !showDone && '-rotate-90')} aria-hidden="true" />
                      Done <span className="rounded-full bg-secondary px-1.5 py-px text-[11px] tabular-nums">{agenda.done.length}</span>
                    </button>
                    {showDone && (
                      <ul className="space-y-2">
                        {agenda.done.slice(0, 30).map(e => <AgendaRow key={e.item.id} entry={e} classes={classes} onEdit={setEditing} />)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5" aria-label="Your week">
          <StatsCard sessions={sessions} goal={focus.prefs.dailyGoal} />

          <section className="rounded-2xl border bg-card p-4" aria-labelledby="tests-h">
            <div className="flex items-center justify-between">
              <h2 id="tests-h" className="text-sm font-semibold text-foreground">Tests coming up</h2>
              <GraduationCap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            {upcomingTests.length ? (
              <ul className="mt-3 space-y-2">
                {upcomingTests.map(t => {
                  const n = daysUntil(parseDay(t.date));
                  return (
                    <li key={t.id} className="flex items-center gap-3">
                      <span className={cn('grid h-11 w-11 flex-none place-items-center rounded-xl text-center leading-none',
                        n <= 2 ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-secondary text-foreground')}>
                        <span>
                          <span className="block text-base font-bold tabular-nums">{n}</span>
                          <span className="block text-[10px] font-medium">{n === 1 ? 'day' : 'days'}</span>
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{t.class_name || 'No class'} · {relativeDay(t.date)}{t.focus_minutes ? ` · ${formatMinutes(t.focus_minutes)} studied` : ''}</p>
                      </div>
                      <button type="button" onClick={() => { focus.lockIn({ type: 'test', id: t.id }); navigate('/Focus'); }}
                        className="h-8 rounded-lg px-2.5 text-xs font-semibold text-indigo-700 hover:bg-accent dark:text-indigo-300"
                        aria-label={`Study for ${t.title}`}>Study</button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">None scheduled. Type “bio test oct 3” above to add one.</p>
            )}
          </section>

          <Link to="/Study" state={{ tab: 'planner' }}
            className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors duration-150 hover:border-indigo-300 hover:bg-accent">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent text-accent-foreground"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">Plan my week</span>
              <span className="block text-xs text-muted-foreground">The AI spreads your work and test prep across the days you have.</span>
            </span>
          </Link>
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

function EmptyState({ hasClasses, onAdd }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-6 text-center">
      <h3 className="text-base font-semibold text-foreground">Nothing here yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Type your first assignment in the box above — like <em>“read chapter 4 tmr”</em> or <em>“history essay oct 10 !”</em>.
        {!hasClasses && ' Adding your classes first lets it tag each one automatically.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onAdd} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Add homework</button>
        {!hasClasses && (
          <Link to="/Classes" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary">Add your classes</Link>
        )}
      </div>
    </div>
  );
}
