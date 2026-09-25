import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { useFocus } from '@/lib/FocusContext';
import { listenOnce, HandsFree, canListen } from '@/lib/listen';
import { VOICE_HELP } from '@/lib/voiceCommands';
import { stopSpeaking } from '@/lib/voice';
import { unlockAudio } from '@/lib/soundscape';

/**
 * Talk to the timer. Tap the mic and say one thing, or turn on hands-free
 * and start with "Hey Lock In". Every command is answered out loud and
 * written here, so you know what it understood.
 */
export default function VoicePanel({ className }) {
  const f = useFocus();
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
    const r = await handle.current(text);
    setReply(r.reply);
  }, []);

  const startHandsFree = useCallback(() => {
    if (!hf.current) {
      hf.current = new HandsFree({
        onCommand: (text) => { run(text); },
        onWake: () => { setArmed(true); setTimeout(() => setArmed(false), 6000); },
        onState: setHandsFree,
        onError: (msg) => setError(msg),
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
    // Chrome gives the microphone to one recogniser at a time.
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
    const onTalk = () => talk();
    window.addEventListener('lockin:talk', onTalk);
    return () => window.removeEventListener('lockin:talk', onTalk);
  }, [talk]);

  if (!canListen) {
    return (
      <section className={cn('rounded-2xl border bg-card p-4', className)}>
        <h2 className="text-sm font-semibold text-foreground">Voice</h2>
        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
          <MicOff className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          This browser can't listen. Voice control works in Chrome, Edge and Safari — everything else here works without it.
        </p>
      </section>
    );
  }

  return (
    <section className={cn('rounded-2xl border bg-card p-4', className)} aria-labelledby="voice-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="voice-h" className="text-sm font-semibold text-foreground">Voice</h2>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Hands-free
          <Switch checked={handsFree} onCheckedChange={(on) => (on ? startHandsFree() : stopHandsFree())} aria-label="Hands-free: listen for Hey Lock In" />
        </label>
      </div>

      <button
        type="button"
        onClick={talk}
        aria-pressed={listening}
        className={cn('mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors duration-150',
          listening
            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300'
            : 'bg-background text-foreground hover:border-indigo-300 hover:bg-accent')}
      >
        {listening ? <Square className="h-4 w-4 fill-current" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
        {listening ? 'Listening… tap to stop' : 'Tap and speak'}
        {!listening && <kbd className="ml-1 hidden rounded border px-1.5 text-[10px] font-medium text-muted-foreground sm:inline">M</kbd>}
      </button>

      <div className="mt-3 min-h-[3rem] space-y-1.5 text-sm" aria-live="polite">
        {handsFree && !heard && !reply && (
          <p className={cn('flex items-center gap-2', armed ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-muted-foreground')}>
            <Radio className={cn('h-4 w-4', armed && 'animate-pulse')} aria-hidden="true" />
            {armed ? 'Yes? Listening for a command…' : 'Say "Hey Lock In", then a command.'}
          </p>
        )}
        {heard && <p className="text-muted-foreground"><span className="font-medium text-foreground">You:</span> “{heard}”</p>}
        {reply && <p className="text-foreground"><span className="font-semibold text-indigo-700 dark:text-indigo-300">Lock In:</span> {reply}</p>}
        {error && <p className="text-red-700 dark:text-red-400" role="alert">{error}</p>}
      </div>

      <details className="group mt-2">
        <summary className="cursor-pointer select-none rounded text-xs font-medium text-muted-foreground hover:text-foreground">What can I say?</summary>
        <dl className="mt-2 space-y-1.5 text-xs">
          {VOICE_HELP.map(([say, what]) => (
            <div key={say} className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-foreground">{say}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Chrome and Edge send what the mic hears to their own speech service to turn it into text; Safari does it on your device. Hands-free is off every time you open the app.
        </p>
      </details>
    </section>
  );
}
