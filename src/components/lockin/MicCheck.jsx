import React, { useEffect, useRef, useState } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getMicPref, setMicPref, listMics, startMicCheck } from '@/lib/micCheck';

const SAYS = {
  ok: ['I can hear the room.', 'text-emerald-700 dark:text-emerald-300'],
  quiet: ['That’s quiet. Move closer to the sound, or choose another microphone.', 'text-amber-700 dark:text-amber-300'],
  silent: ['I can’t hear anything yet. Say something, or choose another microphone.', 'text-red-700 dark:text-red-300'],
};

/**
 * Pick a microphone and watch it hear the room, before a lecture starts rather
 * than after the first ten minutes turn out to be silence. Nothing opens until
 * it's asked to, since opening a microphone is what asks for permission.
 */
export default function MicCheck({ className }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mics, setMics] = useState([]);
  const [deviceId, setDeviceId] = useState(getMicPref);
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState('silent');
  const probe = useRef(null);

  const open = async (id) => {
    probe.current?.stop();
    probe.current = null;
    setBusy(true);
    setError('');
    try {
      probe.current = await startMicCheck({ deviceId: id, onLevel: (l, h) => { setLevel(l); setHearing(h); } });
      setOn(true);
      setMics(await listMics());
    } catch (e) {
      setOn(false);
      setError(e.message);
    }
    setBusy(false);
  };
  useEffect(() => () => probe.current?.stop(), []);

  const choose = (id) => { setDeviceId(id); setMicPref(id); open(id); };

  if (!on) {
    return (
      <div className={className}>
        <button type="button" onClick={() => open(deviceId)} disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          Check the microphone
        </button>
        {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
      </div>
    );
  }

  const [says, tone] = SAYS[hearing];
  return (
    <div className={cn('rounded-xl border bg-secondary/40 p-3', className)}>
      <label htmlFor="mic-choice" className="text-xs font-medium text-muted-foreground">Microphone</label>
      <select id="mic-choice" value={deviceId} onChange={(e) => choose(e.target.value)}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm text-foreground">
        <option value="">Default microphone</option>
        {mics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className={cn('h-full rounded-full transition-[width] duration-100 motion-reduce:transition-none',
          hearing === 'ok' ? 'bg-emerald-500' : hearing === 'quiet' ? 'bg-amber-500' : 'bg-red-500')}
          style={{ width: `${Math.max(2, Math.round(level * 100))}%` }} />
      </div>
      <p className={cn('mt-2 text-sm font-medium', tone)} role="status">{says}</p>
      {error && <p className="mt-1 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
    </div>
  );
}
