import React, { useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-alert-dialog';
import { ShieldCheck } from 'lucide-react';
import { useFocus } from '@/lib/FocusContext';
import { clock } from '@/lib/agenda';

/**
 * Ending a strict block early. Asking starts a countdown; when it is over you can confirm, and the
 * block is saved as "ended early". The countdown is kept by the timer (not by this dialog), so closing
 * and reopening it, or pressing the button again, never starts it over. Only the buttons here end a
 * block: voice and the assistant can't.
 */
export default function StrictExitDialog() {
  const f = useFocus();
  const open = f.exitOpen && f.strictOn;
  const { exit } = f;
  const waiting = exit.phase === 'waiting';
  const ready = exit.phase === 'ready';
  const keep = useRef(null);

  // say the wait out loud now and then (every ten seconds), not every second
  const say = ready ? 'You can end the block now.' : waiting && exit.secondsLeft % 10 === 0 ? `${exit.secondsLeft} seconds to go.` : '';
  const last = useRef('');
  const announce = say && say !== last.current ? say : '';
  useEffect(() => { if (say) last.current = say; }, [say]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) f.setExitOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/70" />
        <Dialog.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); keep.current?.focus(); }}
          className="fixed left-1/2 top-1/2 z-[96] grid w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border bg-background p-6 shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-foreground">End your strict block early?</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {Math.ceil(f.remaining / 60)} minutes are left ({clock(f.remaining)}). Ending now is saved as “ended early”.
                {exit.phase === 'idle' && ` You’ll wait ${f.strictPrefs.exitDelaySec} seconds first.`}
              </Dialog.Description>
            </div>
          </div>

          {(waiting || ready) && (
            <div className="rounded-xl border bg-card px-4 py-3 text-center">
              {waiting ? (
                <p className="text-sm text-foreground">You can end it in <strong className="tabular-nums text-xl">{exit.secondsLeft}</strong> seconds. Use the time to breathe.</p>
              ) : (
                <p className="text-sm font-medium text-foreground">The wait is over. Still want to stop?</p>
              )}
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">{announce}</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {exit.phase === 'idle' ? (
              <button type="button" onClick={f.requestExit}
                className="inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary">
                Start the {f.strictPrefs.exitDelaySec}-second wait
              </button>
            ) : (
              <button type="button" onClick={f.confirmExit} disabled={!ready}
                className="inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40">
                End early
              </button>
            )}
            <button ref={keep} type="button" onClick={f.cancelExit}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90">
              Keep focusing
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
