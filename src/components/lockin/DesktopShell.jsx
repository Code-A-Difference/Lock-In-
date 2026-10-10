import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Mic, MonitorSpeaker, Pause, Play, Square, Sparkles, Timer, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { desktop, isDesktop } from '@/lib/desktop';
import { useLecture } from '@/lib/LectureContext';
import { useStudyData, useActions } from '@/lib/data';
import { useFocus } from '@/lib/FocusContext';
import { clock } from '@/lib/lectureNotes';
import ClassChat from '@/components/lockin/ClassChat';
import { RECIPES } from '@/lib/classChat';
import { toast } from '@/components/ui/use-toast';

/**
 * The desktop app's extras, in the page: the floating mini window, and what
 * happens when a global shortcut, the tray or a detected call asks for
 * something. Renders nothing in a browser or the phone apps.
 */

export const SOURCES = [
  ['mic', 'Microphone', 'A class in the room', Mic],
  ['system', 'Computer sound', 'An online class or a video', MonitorSpeaker],
  ['both', 'Both', 'A call you talk in', MonitorSpeaker],
];
const SOURCE_KEY = 'lockin.recordSource';
export function preferredSource() {
  try { return localStorage.getItem(SOURCE_KEY) || 'mic'; } catch (_) { return 'mic'; }
}
export function rememberSource(s) {
  try { localStorage.setItem(SOURCE_KEY, s); } catch (_) {}
}

/** Mic / computer sound / both, only in the desktop app. */
export function SourcePicker({ value, onChange, className }) {
  if (!isDesktop) return null;
  return (
    <div className={cn('grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1', className)} role="radiogroup" aria-label="What to record">
      {SOURCES.map(([id, label, hint, Icon]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} title={hint}
          onClick={() => { onChange(id); rememberSource(id); }}
          className={cn('flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-xs font-semibold',
            value === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
          <Icon className="h-4 w-4" aria-hidden="true" /><span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Whether the window is the floating mini window right now. */
export function useMini() {
  const [mini, setMini] = useState(false);
  useEffect(() => {
    if (!isDesktop) return undefined;
    const apply = (on) => { setMini(on); document.documentElement.classList.toggle('lockin-mini', !!on); };
    desktop.mini.get().then(apply).catch(() => {});
    return desktop.mini.onChange(apply);
  }, []);
  return mini;
}

/** Shortcuts, the tray and call detection -> actions in the app. */
export function DesktopBridge() {
  const lec = useLecture();
  const navigate = useNavigate();
  const lecRef = useRef(lec);
  lecRef.current = lec;

  useEffect(() => {
    if (!isDesktop) return undefined;
    return desktop.onCommand(async (cmd) => {
      const L = lecRef.current;
      if (cmd.type === 'assistant') { window.dispatchEvent(new Event('lockin:assistant')); return; }
      if (cmd.type === 'catchup') {
        if (L.active) {
          navigate(`/Notes?id=${L.active.id}`);
          setTimeout(() => window.dispatchEvent(new CustomEvent('lockin:quickask', { detail: 'catchup' })), 300);
        } else {
          window.dispatchEvent(new Event('lockin:assistant'));
        }
        return;
      }
      if (cmd.type === 'record') {
        if (L.active) { navigate(`/Notes?id=${L.active.id}`); return; }
        const source = cmd.source || preferredSource();
        try {
          await L.start({ source, title: cmd.app ? `${cmd.app} call · ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '' });
        } catch (e) {
          if (source !== 'mic') {
            toast({ title: 'Recording with the microphone instead', description: e.message });
            try { await L.start({ source: 'mic' }); } catch (e2) { toast({ title: 'Could not start recording', description: e2.message, variant: 'destructive' }); }
          } else {
            toast({ title: 'Could not start recording', description: e.message, variant: 'destructive' });
          }
        }
      }
    });
  }, [navigate]);
  return null;
}

/* ------------------------------------------------------------ mini window */

export function MiniView() {
  const lec = useLecture();
  const focus = useFocus();
  const { lectures } = useStudyData();
  const actions = useActions();
  const live = lec.active;
  const lecture = live ? lectures.find(l => l.id === live.id) : null;
  const [tab, setTab] = useState('ask');
  const [source, setSource] = useState(preferredSource);
  const [autoAsk, setAutoAsk] = useState(null);
  const [starting, setStarting] = useState(false);
  const end = useRef(null);

  useEffect(() => {
    const on = (e) => { const r = RECIPES.find(x => x.id === e.detail); if (r) { setTab('ask'); setAutoAsk(r); } };
    window.addEventListener('lockin:quickask', on);
    return () => window.removeEventListener('lockin:quickask', on);
  }, []);
  const segs = (lecture?.segments || []).filter(s => s.text);
  useEffect(() => { if (tab === 'live') end.current?.scrollIntoView({ block: 'end' }); }, [segs.length, tab]);

  const record = async () => {
    setStarting(true);
    try { await lec.start({ source }); } catch (e) {
      toast({ title: 'Could not start recording', description: e.message, variant: 'destructive' });
    } finally { setStarting(false); }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-primary"><Lock className="h-3.5 w-3.5 text-primary-foreground" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{lecture ? lecture.title : 'LOCK IN!'}</span>
        <button type="button" onClick={() => desktop.mini.set(false)} aria-label="Open the full window" title="Full window"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
          <Maximize2 className="h-4 w-4" />
        </button>
      </header>

      {live && lecture ? (
        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
            <span className={cn('h-2.5 w-2.5 flex-none rounded-full', live.state === 'recording' ? 'animate-pulse bg-red-500 motion-reduce:animate-none' : 'bg-muted-foreground')} aria-hidden="true" />
            <span className="flex-1 text-2xl font-bold tabular-nums text-foreground" role="timer">{clock(live.elapsed)}</span>
            <button type="button" onClick={live.state === 'paused' ? lec.resume : lec.pause} disabled={live.state === 'finishing'}
              aria-label={live.state === 'paused' ? 'Resume recording' : 'Pause recording'}
              className="grid h-10 w-10 place-items-center rounded-full bg-secondary disabled:opacity-40">
              {live.state === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button type="button" onClick={lec.stop} disabled={live.state === 'finishing'} aria-label="Stop and write notes"
              className="grid h-10 w-10 place-items-center rounded-full bg-red-600 text-white disabled:opacity-40">
              {live.state === 'finishing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1" role="tablist">
            {[['ask', 'Ask'], ['live', 'Live transcript']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cn('h-9 rounded-lg text-sm font-semibold', tab === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>{label}</button>
            ))}
          </div>
          {tab === 'ask' ? (
            <ClassChat lecture={lecture} live={live} lec={lec} autoAsk={autoAsk} onAutoAsked={() => setAutoAsk(null)}
              onSaveChat={(chat) => actions.updateLecture(lecture.id, { chat })} dockClassName="bottom-3" />
          ) : (
            <ol className="space-y-2 text-sm leading-relaxed text-foreground">
              {segs.length === 0 && <li className="text-muted-foreground">The first lines appear about 15 seconds in.</li>}
              {segs.slice(-30).map(s => (
                <li key={s.start} className="flex gap-2"><span className="w-10 flex-none text-xs tabular-nums text-muted-foreground">{clock(s.start)}</span><span>{s.text}</span></li>
              ))}
              <li ref={end} />
            </ol>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 p-3">
          <SourcePicker value={source} onChange={setSource} />
          <button type="button" onClick={record} disabled={starting || !lec.canRecord}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground disabled:opacity-50">
            {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}Record a class
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={focus.openFocus} className="flex h-12 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-semibold text-foreground">
              <Timer className="h-4 w-4" />Focus
            </button>
            <button type="button" onClick={() => window.dispatchEvent(new Event('lockin:assistant'))} className="flex h-12 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4" />Assistant
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This window floats over your other apps. While a class records, ask “catch me up” here, or press {desktop?.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+K from anywhere.
          </p>
        </div>
      )}
    </div>
  );
}
