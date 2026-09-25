import React from 'react';
import { cn } from '@/lib/utils';

/**
 * The countdown ring. Focus is indigo, breaks are emerald — the colour is
 * backed by the phase name in the middle, never the only signal. It scales
 * down to fit narrow phones (aspect-ratio, not a fixed height).
 */
export default function TimerRing({ progress = 0, phase = 'focus', size = 280, stroke = 12, children, className }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  const isBreak = phase !== 'focus';
  return (
    <div className={cn('relative grid place-items-center', className)} style={{ width: size, maxWidth: '100%', aspectRatio: '1 / 1' }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-slate-800" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)}
          className={cn('transition-[stroke-dashoffset] duration-300 ease-linear',
            isBreak ? 'stroke-emerald-500 dark:stroke-emerald-400' : 'stroke-indigo-600 dark:stroke-indigo-400')} />
      </svg>
      <div className="relative flex flex-col items-center text-center">{children}</div>
    </div>
  );
}
