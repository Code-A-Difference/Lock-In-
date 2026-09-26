import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pause, Play, RotateCcw, SkipForward, Lock, CloudRain, Waves, AudioLines, VolumeX, Volume1, Volume2, Coffee, Brain, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { useFocus, PHASE_LABEL } from '@/lib/FocusContext';
import { useStudyData, useActions } from '@/lib/data';
import { clock, formatMinutes } from '@/lib/agenda';
import { relativeDay, daysUntil, parseDay, ymd } from '@/lib/dates';
import { SOUNDS } from '@/lib/soundscape';
import TimerRing from '@/components/lockin/TimerRing';
import StepList from '@/components/lockin/StepList';
import { breakDownToast } from '@/components/lockin/AgendaRow';

const PRESETS = [[25, 5], [50, 10], [90, 20]];
const SOUND_ICON = { off: VolumeX, rain: CloudRain, brown: Waves, drone: AudioLines };

function typingIn(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
}

/**
 * Ambient Voice Study, rebuilt inside LOCK IN!: the timer, the background
 * sound and the voice control, now tied to the homework you're actually
 * doing — its checklist sits next to the clock, and the minutes you put in
 * are logged against it.
 */
export default function Focus() {
  const f = useFocus();
  const { homework, tests, sessions } = useStudyData();
  const act = useActions();
  const navigate = useNavigate();
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const fRef = useRef(f);
  fRef.current = f;

  // The context value changes every second, so the handler reads it from a
  // ref instead of re-binding on each tick.
  useEffect(() => {
    const onKey = (e) => {
      const f = fRef.current;
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      if (document.querySelector('[role="menu"]')) return;
      if ([...document.querySelectorAll('[role="dialog"]')].some(d => d.getAttribute('aria-label') !== 'Focus timer')) return;
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); f.toggle(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); f.adjust(5); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); f.adjust(-5); }
      // M (talk) is handled globally in Layout.jsx, so it also works when this overlay is closed.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pending = useMemo(() => homework.filter(h => !h.is_completed), [homework]);
  const upcoming = useMemo(() => tests.filter(t => { const d = parseDay(t.date); return d && daysUntil(d) >= 0; }), [tests]);
  const today = ymd(new Date());
  const todays = sessions.filter(s => s.day === today);

  const isBreak = f.phase !== 'focus';
  const running = f.status === 'running';
  const item = f.taskItem;
  const kind = f.task?.type;
  const endsAt = running ? new Date(Date.now() + f.remaining * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const activePreset = PRESETS.find(([a, b]) => a === f.prefs.focusMin && b === f.prefs.breakMin);

  const onMain = () => {
    if (f.status === 'idle' && f.phase === 'focus') f.lockIn(null);
    else f.toggle();
  };

  const breakDown = async () => {
    if (!item || kind !== 'homework') return;
    setBusy(true);
    try { breakDownToast(await act.breakDown(item)); } catch (_) {} finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="sr-only">Focus</h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── the clock ─────────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <section className="flex flex-col items-center rounded-2xl border bg-card px-4 py-6 sm:px-8 sm:py-8" aria-label="Timer">
            {/* The ring is the time you have left: full at the start, draining to zero. */}
            <TimerRing progress={f.total ? f.remaining / f.total : 1} phase={f.phase} size={300}>
              <span className={cn('text-xs font-bold uppercase tracking-[0.2em]', isBreak ? 'text-emerald-700 dark:text-emerald-400' : 'text-indigo-700 dark:text-indigo-300')}>
                {PHASE_LABEL[f.phase]}
              </span>
              <span className="mt-1 text-6xl font-bold tabular-nums tracking-tight text-foreground sm:text-7xl" role="timer" aria-live="off">
                {clock(f.remaining)}
              </span>
              <span className="mt-1 text-sm text-muted-foreground">
                {f.status === 'paused' ? 'Paused' : running ? `until ${endsAt}` : `${Math.round(f.total / 60)} minute ${isBreak ? 'break' : 'block'}`}
              </span>
              <span className="mt-3 flex gap-1.5" aria-label={`${f.blocks % f.prefs.longEvery} of ${f.prefs.longEvery} blocks before a long break`}>
                {Array.from({ length: f.prefs.longEvery }, (_, i) => (
                  <span key={i} className={cn('h-2 w-2 rounded-full',
                    i < f.blocks % f.prefs.longEvery || (f.phase === 'long' && f.blocks > 0) ? 'bg-indigo-600 dark:bg-indigo-400' : 'bg-slate-200 dark:bg-slate-700')} />
                ))}
              </span>
            </TimerRing>

            <div className="mt-6 flex items-center gap-3">
              <button type="button" onClick={f.reset} aria-label="Reset timer" title="Reset"
                className="grid h-12 w-12 place-items-center rounded-full border text-muted-foreground hover:bg-secondary hover:text-foreground">
                <RotateCcw className="h-5 w-5" />
              </button>
              <button type="button" onClick={onMain}
                className={cn('inline-flex h-14 min-w-[10rem] items-center justify-center gap-2 rounded-full px-8 text-base font-bold text-white shadow-md transition-transform duration-150 active:scale-[0.98]',
                  f.status === 'idle' && !isBreak ? 'bg-gradient-to-r from-indigo-600 to-fuchsia-600 shadow-indigo-600/25'
                    : isBreak ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white')}>
                {running ? <Pause className="h-5 w-5" /> : f.status === 'idle' && !isBreak ? <Lock className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                {running ? 'Pause' : f.status === 'paused' ? 'Resume' : isBreak ? 'Start break' : 'Lock in'}
              </button>
              <button type="button" onClick={f.skip} aria-label={isBreak ? 'Skip the break' : 'End this block now'} title={isBreak ? 'Skip break' : 'End block'}
                className="grid h-12 w-12 place-items-center rounded-full border text-muted-foreground hover:bg-secondary hover:text-foreground">
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => f.adjust(-5)} className="h-9 rounded-lg border px-3 text-sm font-medium text-foreground hover:bg-secondary">−5 min</button>
              <button type="button" onClick={() => f.adjust(5)} className="h-9 rounded-lg border px-3 text-sm font-medium text-foreground hover:bg-secondary">+5 min</button>
              {!isBreak && (
                <button type="button" onClick={f.startBreak} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">
                  <Coffee className="h-4 w-4" />Break now
                </button>
              )}
            </div>

            <div className="mt-6 w-full max-w-md border-t pt-4">
              <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Timer length">
                {PRESETS.map(([a, b]) => {
                  const on = activePreset && activePreset[0] === a;
                  return (
                    <button key={a} type="button" aria-pressed={!!on} onClick={() => { setCustom(false); f.setDurations({ focusMin: a, breakMin: b }); }}
                      className={cn('h-9 rounded-full border px-3.5 text-sm font-medium tabular-nums transition-colors duration-150',
                        on ? 'border-indigo-300 bg-accent text-accent-foreground dark:border-indigo-700' : 'text-foreground hover:bg-secondary')}>
                      {a} / {b}
                    </button>
                  );
                })}
                <button type="button" aria-pressed={custom || !activePreset} onClick={() => setCustom(c => !c)}
                  className={cn('h-9 rounded-full border px-3.5 text-sm font-medium transition-colors duration-150',
                    custom || !activePreset ? 'border-indigo-300 bg-accent text-accent-foreground dark:border-indigo-700' : 'text-foreground hover:bg-secondary')}>
                  Custom
                </button>
              </div>
              {(custom || !activePreset) && (
                <div className="mt-3 flex flex-wrap items-end justify-center gap-3">
                  {[['focusMin', 'Focus', 180], ['breakMin', 'Break', 60], ['longMin', 'Long break', 90]].map(([k, label, max]) => (
                    <label key={k} className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      {label}
                      <span className="flex items-center gap-1">
                        <input type="number" min={1} max={max} inputMode="numeric" defaultValue={f.prefs[k]} key={f.prefs[k]}
                          onBlur={e => f.setDurations({ [k]: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          className="h-9 w-16 rounded-lg border bg-background px-2 text-center text-sm tabular-nums text-foreground" />
                        <span>min</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Every {f.prefs.longEvery}th break is a {f.prefs.longMin}-minute long one ·{' '}
                <Link to="/Settings" className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline dark:text-indigo-300"><Settings2 className="h-3 w-3" />Timer settings</Link>
              </p>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4" aria-labelledby="blocks-h">
            <div className="flex items-center justify-between">
              <h2 id="blocks-h" className="text-sm font-semibold text-foreground">Today's blocks</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{formatMinutes(todays.reduce((a, s) => a + (s.minutes || 0), 0))} total</span>
            </div>
            {todays.length ? (
              <ul className="mt-2 divide-y">
                {todays.map(s => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-foreground">{s.title || 'Focus block'}{s.class_name && <span className="text-muted-foreground"> · {s.class_name}</span>}</span>
                    <span className="flex-none tabular-nums text-muted-foreground">
                      {s.minutes}m · {new Date(s.ended_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted-foreground">Finished blocks show up here, and count toward your streak.</p>}
          </section>
        </div>

        {/* ── what you're doing, what you hear, how you talk to it ── */}
        <aside className="space-y-5">
          <section className="rounded-2xl border bg-card p-4" aria-labelledby="task-h">
            <h2 id="task-h" className="text-sm font-semibold text-foreground">Working on</h2>
            <label className="sr-only" htmlFor="task-pick">Task for this block</label>
            <select
              id="task-pick"
              value={f.task ? `${f.task.type}:${f.task.id}` : ''}
              onChange={e => {
                const [type, id] = e.target.value.split(':');
                f.setTask(id ? { type, id } : null);
              }}
              className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm text-foreground"
            >
              <option value="">Nothing specific</option>
              {pending.length > 0 && (
                <optgroup label="Homework">
                  {pending.map(h => <option key={h.id} value={`homework:${h.id}`}>{h.title}{h.due_date ? ` — due ${relativeDay(h.due_date)}` : ''}</option>)}
                </optgroup>
              )}
              {upcoming.length > 0 && (
                <optgroup label="Tests">
                  {upcoming.map(t => <option key={t.id} value={`test:${t.id}`}>{t.title} — {relativeDay(t.date)}</option>)}
                </optgroup>
              )}
            </select>

            {item && kind === 'homework' && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {[item.class_name, item.due_date && `due ${relativeDay(item.due_date)}`, item.focus_minutes && `${formatMinutes(item.focus_minutes)} so far`].filter(Boolean).join(' · ')}
                </p>
                <StepList steps={item.steps || []} onChange={s => act.setSteps(item, s)} onRedo={breakDown} redoing={busy} compact />
                {(item.steps || []).length > 0 && (item.steps || []).every(s => s.done) && (
                  <button type="button" onClick={() => act.toggleHomework(item)}
                    className="mt-3 h-10 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700">
                    All steps done — mark it finished
                  </button>
                )}
              </div>
            )}
            {item && kind === 'test' && (
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {[item.class_name, relativeDay(item.date), item.focus_minutes && `${formatMinutes(item.focus_minutes)} studied`].filter(Boolean).join(' · ')}
                </p>
                {item.notes && <p className="whitespace-pre-wrap text-foreground">{item.notes}</p>}
                <button type="button" onClick={() => navigate('/Study', { state: { tab: 'quiz', testId: item.id } })}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 font-medium text-foreground hover:bg-secondary">
                  <Brain className="h-4 w-4" />Quiz me on this
                </button>
              </div>
            )}
            {!item && (
              <p className="mt-2 text-xs text-muted-foreground">Pick one to see its steps here and log this block's minutes to it.</p>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4" aria-labelledby="sound-h">
            <h2 id="sound-h" className="text-sm font-semibold text-foreground">Background sound</h2>
            <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="Background sound">
              {SOUNDS.map(s => {
                const Icon = SOUND_ICON[s.id] || AudioLines;
                const on = f.prefs.sound === s.id;
                return (
                  <button key={s.id} type="button" aria-pressed={on} onClick={() => f.setSound(s.id)}
                    className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors duration-150',
                      on ? 'border-indigo-300 bg-accent text-accent-foreground dark:border-indigo-700' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {s.id === 'brown' ? 'Brown' : s.id === 'drone' ? 'Drone' : s.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Volume1 className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
              <Slider value={[Math.round(f.prefs.volume * 100)]} min={0} max={100} step={1}
                onValueChange={([v]) => f.setVolume(v / 100)} aria-label="Volume" disabled={f.prefs.sound === 'off'} />
              <Volume2 className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Loops continuously until you choose Off or say “stop the sound.” Made live in your browser — nothing to download.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
