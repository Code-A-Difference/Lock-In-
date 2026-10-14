import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { openMic, buildVoiceprint, saveVoiceprint, SAMPLES_NEEDED, RATE } from '@/lib/voiceprint';
import { TRAINING_EVENT } from '@/lib/handsfreePref';
import { WAKE_PHRASE } from '@/lib/wake';

const dbOf = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, x.length) + 1e-10);
};

/**
 * Teaching Companion your voice: say "Hey Companion" a few times. Each time is
 * cut out of the microphone by loudness (it starts when you speak and ends when
 * you've been quiet for a moment), then the recordings become a voiceprint
 * (voiceprint.js) and are thrown away.
 */
export default function VoiceTraining({ open, onOpenChange, onDone }) {
  const [step, setStep] = useState('intro');          // intro | listening | saving | done
  const [count, setCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const stopMic = useRef(null);
  const takes = useRef([]);

  const release = () => {
    stopMic.current?.();
    stopMic.current = null;
    window.dispatchEvent(new CustomEvent(TRAINING_EVENT, { detail: false }));
  };

  useEffect(() => {
    if (!open) { release(); setStep('intro'); setCount(0); setError(''); setHint(''); takes.current = []; }
    return release;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError('');
    setHint('');
    takes.current = [];
    setCount(0);
    window.dispatchEvent(new CustomEvent(TRAINING_EVENT, { detail: true }));   // the assistant lets go of the mic
    await new Promise(r => setTimeout(r, 300));
    // Cutting the microphone into takes: the room's own level is learned in the first half second
    let floor = null, calib = [], speaking = false, take = [], quiet = 0, pre = [];
    try {
      stopMic.current = await openMic((chunk) => {
        if (takes.current.length >= SAMPLES_NEEDED) return;
        const db = dbOf(chunk);
        setLevel(Math.max(0, Math.min(1, (db + 60) / 50)));
        if (floor === null) {
          calib.push(db);
          if (calib.length * chunk.length >= RATE * 0.5) floor = Math.max(-70, calib.reduce((s, v) => s + v, 0) / calib.length);
          return;
        }
        const loud = db > Math.max(floor + 12, -50);
        if (!speaking) {
          pre = [...pre, chunk].slice(-2);                   // keep the moment before, so the "h" isn't cut off
          if (loud) { speaking = true; take = [...pre]; quiet = 0; }
          return;
        }
        take.push(chunk);
        quiet = db > floor + 8 ? 0 : quiet + chunk.length;
        const len = take.reduce((s, c) => s + c.length, 0);
        if (quiet >= RATE * 0.6 || len >= RATE * 3) {
          speaking = false;
          pre = [];
          const secs = (len - quiet) / RATE;
          if (secs < 0.45) { setHint('That was very short. Say the whole phrase: “Hey Companion”.'); return; }
          if (len >= RATE * 3) { setHint('That was long. Say just “Hey Companion”, then stop.'); return; }
          const all = new Float32Array(len);
          let at = 0;
          for (const c of take) { all.set(c, at); at += c.length; }
          takes.current.push(all);
          setHint('');
          setCount(takes.current.length);
          if (takes.current.length >= SAMPLES_NEEDED) finish();
        }
      });
      setStep('listening');
    } catch (e) {
      release();
      setError(e?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it, then try again.' : 'No microphone could be opened.');
    }
  };

  const finish = () => {
    release();
    setStep('saving');
    setTimeout(() => {
      try {
        saveVoiceprint(buildVoiceprint(takes.current));
        setStep('done');
      } catch (e) {
        setError(e.message);
        setStep('intro');
        setCount(0);
      }
    }, 50);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) release(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step === 'done' ? 'Companion knows your voice' : `Teach Companion your voice`}</DialogTitle>
          <DialogDescription>
            {step === 'done'
              ? `Say “${WAKE_PHRASE}” any time. It now listens for your voice saying it.`
              : `Say “${WAKE_PHRASE}” ${SAMPLES_NEEDED} times, the way you normally would. Only a pattern of your voice is kept, on this device; the recordings are deleted.`}
          </DialogDescription>
        </DialogHeader>

        {step !== 'done' && (
          <div className="mt-2 flex flex-col items-center gap-4">
            <div className={cn('grid h-20 w-20 place-items-center rounded-full border-2 transition-colors',
              step === 'listening' ? 'border-primary bg-accent' : 'border-border')}
              style={step === 'listening' ? { boxShadow: `0 0 0 ${Math.round(level * 14)}px hsl(var(--primary) / 0.18)` } : undefined}>
              {step === 'saving' ? <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" /> : <Mic className="h-8 w-8 text-primary" aria-hidden="true" />}
            </div>
            <ol className="flex gap-2" aria-label={`${count} of ${SAMPLES_NEEDED} recorded`}>
              {Array.from({ length: SAMPLES_NEEDED }, (_, i) => (
                <li key={i} className={cn('grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold',
                  i < count ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                  {i < count ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
                </li>
              ))}
            </ol>
            <p className="min-h-10 text-center text-sm text-foreground" role="status" aria-live="polite">
              {step === 'listening' ? (hint || (count === 0 ? `Say “${WAKE_PHRASE}”` : `Again: “${WAKE_PHRASE}”`)) : step === 'saving' ? 'Learning your voice…' : ''}
            </p>
            {error && <p role="alert" className="text-center text-sm text-red-700 dark:text-red-400">{error}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {step === 'intro' && (
            <>
              <button type="button" onClick={() => onOpenChange(false)} className="h-11 rounded-lg border px-4 text-sm font-medium text-foreground hover:bg-secondary">Cancel</button>
              <button type="button" onClick={start} className="h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                {error ? 'Try again' : 'Start'}
              </button>
            </>
          )}
          {step === 'listening' && (
            <button type="button" onClick={() => { release(); setStep('intro'); setCount(0); }} className="h-11 rounded-lg border px-4 text-sm font-medium text-foreground hover:bg-secondary">Cancel</button>
          )}
          {step === 'done' && (
            <button type="button" onClick={() => { onOpenChange(false); onDone?.(); }} className="h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Done</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
