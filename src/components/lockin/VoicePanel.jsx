import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Radio, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { useFocus } from '@/lib/FocusContext';
import { listenOnce, HandsFree, canListen } from '@/lib/listen';
import { parseCommand, VOICE_HELP } from '@/lib/voiceCommands';
import { speak, stopSpeaking } from '@/lib/voice';
import { chime, unlockAudio } from '@/lib/soundscape';

/** Persistent voice assistant dock. It stays mounted across every app route. */
export default function VoicePanel() {
  const f = useFocus();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const [armed, setArmed] = useState(false);
  const stopRef = useRef(null);
  const hf = useRef(null);
  const handle = useRef(f.handleVoice);
  handle.current = f.handleVoice;

  const run = useCallback(async (text) => {
    setHeard(text);
    setArmed(false);
    const cmd = parseCommand(text);
    let result;
    if (cmd.action === 'openFocus') {
      f.openFocus();
      result = { reply: 'Focus is open.' };
    } else if (cmd.action === 'openPlanner') {
      navigate('/', { state: { openPlanner: true } });
      setTimeout(() => window.dispatchEvent(new Event('lockin:planner')), 120);
      result = { reply: 'Opening your AI Study Planner on the home page.' };
    } else if (cmd.action === 'navigate') {
      navigate(cmd.path);
      result = { reply: cmd.path === '/' ? 'Going to today.' : `Opening ${cmd.path.slice(1)}.` };
    } else {
      result = await handle.current(text);
    }
    setReply(result.reply);
    if (['openFocus', 'openPlanner', 'navigate'].includes(cmd.action)) speak(result.reply);
  }, [f.openFocus, navigate]);

  const startHandsFree = useCallback(() => {
    unlockAudio();
    if (!hf.current) {
      hf.current = new HandsFree({
        onCommand: run,
        onWake: ({ inline } = {}) => {
          setExpanded(true);
          setArmed(!inline);
          setError('');
          chime('assistantActive', 0.32);
          if (!inline) setTimeout(() => setArmed(false), 6000);
        },
        onState: setHandsFree,
        onError: (message) => setError(message),
      });
    }
    setError('');
    hf.current.start();
  }, [run]);

  const stopHandsFree = useCallback(() => { hf.current?.stop(); setArmed(false); }, []);

  useEffect(() => () => hf.current?.stop(), []);

  const talk = useCallback(async () => {
    unlockAudio();
    stopSpeaking();
    if (listening) { stopRef.current?.(); return; }
    setError(''); setHeard(''); setReply('');
    const resumeHandsFree = !!hf.current?.running;
    if (resumeHandsFree) hf.current.stop();
    const { promise, stop } = listenOnce({ onInterim: setHeard });
    stopRef.current = stop;
    setListening(true);
    try {
      const text = await promise;
      if (text) await run(text);
      else setHeard('');
    } catch (e) {
      setError(e.message);
    } finally {
      setListening(false);
      stopRef.current = null;
      if (resumeHandsFree) startHandsFree();
    }
  }, [listening, run, startHandsFree]);

  useEffect(() => {
    const onTalk = () => { setExpanded(true); talk(); };
    window.addEventListener('lockin:talk', onTalk);
    return () => window.removeEventListener('lockin:talk', onTalk);
  }, [talk]);

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-2 lg:bottom-5">
      {expanded && (
        <section className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 shadow-2xl" aria-labelledby="global-voice-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="global-voice-title" className="text-sm font-semibold text-foreground">Hey Lock In</h2>
              <p className="text-xs text-muted-foreground">Your voice assistant, anywhere in the app</p>
            </div>
            <button type="button" onClick={() => setExpanded(false)} aria-label="Close voice assistant"
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>

          {!canListen ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground"><MicOff className="mt-0.5 h-4 w-4 flex-none" />Voice input is supported in Chrome, Edge, and Safari.</p>
          ) : <>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground"><Radio className={cn('h-4 w-4', handsFree && 'text-indigo-600')} />Hands-free wake phrase</span>
              <Switch checked={handsFree} onCheckedChange={on => on ? startHandsFree() : stopHandsFree()} aria-label="Listen for Hey Lock In" />
            </div>
            <button type="button" onClick={talk} aria-pressed={listening}
              className={cn('mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors',
                listening ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300' : 'bg-background text-foreground hover:border-indigo-300 hover:bg-accent')}>
              {listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
              {listening ? 'Listening… tap to stop' : 'Tap and speak'}
            </button>
          </>}

          <div className="mt-3 min-h-10 space-y-1.5 text-sm" aria-live="polite">
            {handsFree && !heard && !reply && <p className={cn('flex items-center gap-2', armed ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-muted-foreground')}>
              <Radio className={cn('h-4 w-4', armed && 'animate-pulse')} />{armed ? 'I’m active — go ahead.' : 'Say “Hey Lock In” to get started.'}
            </p>}
            {heard && <p className="text-muted-foreground"><span className="font-medium text-foreground">You:</span> “{heard}”</p>}
            {reply && <p className="text-foreground"><span className="font-semibold text-indigo-700 dark:text-indigo-300">Lock In:</span> {reply}</p>}
            {error && <p className="text-red-700 dark:text-red-400" role="alert">{error}</p>}
          </div>

          <details className="group mt-1">
            <summary className="cursor-pointer select-none rounded text-xs font-medium text-muted-foreground hover:text-foreground">What can I say?</summary>
            <dl className="mt-2 space-y-1.5 text-xs">{VOICE_HELP.map(([sayText, what]) => <div key={sayText} className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-foreground">{sayText}</dt><dd className="text-muted-foreground">{what}</dd>
            </div>)}</dl>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Hands-free listening is off when you open the app. Your browser may send speech to its recognition service.</p>
          </details>
        </section>
      )}

      <button type="button" onClick={() => setExpanded(open => !open)} aria-expanded={expanded} aria-label={expanded ? 'Close Hey Lock In assistant' : 'Open Hey Lock In assistant'}
        className={cn('grid h-14 w-14 place-items-center rounded-full text-white shadow-lg ring-4 ring-background transition-transform hover:scale-105 active:scale-95',
          handsFree && armed ? 'bg-emerald-600' : 'bg-gradient-to-br from-indigo-600 to-fuchsia-600')}>
        {handsFree && armed ? <Radio className="h-6 w-6 animate-pulse" /> : <Mic className="h-6 w-6" />}
      </button>
    </div>
  );
}
