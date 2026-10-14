import React from 'react';
import { Pause, Play, SkipBack, SkipForward, X, Music2 } from 'lucide-react';
import { useMusic } from '@/lib/MusicContext';
import { cn } from '@/lib/utils';

/** Little equaliser bars that move while music plays and rest when it doesn't. */
export function Waves({ playing, className }) {
  return (
    <span className={cn('lk-waves', playing && 'is-on', className)} aria-hidden="true">
      <style>{`
        .lk-waves{display:inline-flex;align-items:flex-end;gap:2px;height:14px}
        .lk-waves i{display:block;width:3px;height:4px;border-radius:2px;background:currentColor;transform-origin:bottom}
        .lk-waves.is-on i{animation:lk-wave 900ms ease-in-out infinite}
        .lk-waves.is-on i:nth-child(2){animation-delay:-.45s;animation-duration:760ms}
        .lk-waves.is-on i:nth-child(3){animation-delay:-.2s;animation-duration:1040ms}
        .lk-waves.is-on i:nth-child(4){animation-delay:-.65s;animation-duration:820ms}
        @keyframes lk-wave{0%,100%{height:3px}50%{height:14px}}
        @media (prefers-reduced-motion:reduce){.lk-waves.is-on i{animation:none;height:9px}}
      `}</style>
      <i /><i /><i /><i />
    </span>
  );
}

/**
 * The now-playing card: what's playing, with pause and skip, on every page.
 * YouTube's player lives inside it (YouTube asks for the player to be visible).
 */
export default function NowPlaying() {
  const m = useMusic();
  if (!m || !m.source) return null;
  const { source, track, playing, error } = m;
  return (
    <section aria-label="Now playing"
      className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 z-40 w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border bg-card/95 p-2 shadow-xl backdrop-blur lg:bottom-4 lg:left-[16.5rem]">
      <div className="flex items-center gap-3">
        <div className="relative h-[68px] w-[120px] flex-none overflow-hidden rounded-lg bg-black">
          {source === 'youtube'
            ? <div ref={m.hostRef} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
            : track?.art
              ? <img src={track.art} alt="" className="h-full w-full object-cover" />
              : <div className="grid h-full w-full place-items-center text-muted-foreground"><Music2 className="h-6 w-6" aria-hidden="true" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground" title={track?.title}>{track?.title || 'Loading…'}</p>
          <p className="truncate text-xs text-muted-foreground">{track?.artist || (source === 'spotify' ? 'Spotify' : 'YouTube')}</p>
          <div className="mt-1 flex items-center gap-0.5 text-primary">
            <Waves playing={playing} className="mr-2" />
            <button type="button" onClick={m.previous} aria-label="Previous" className="grid h-8 w-8 place-items-center rounded-lg text-foreground hover:bg-muted"><SkipBack className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={m.toggle} aria-label={playing ? 'Pause' : 'Play'} className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
              {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={m.next} aria-label="Next" className="grid h-8 w-8 place-items-center rounded-lg text-foreground hover:bg-muted"><SkipForward className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={m.close} aria-label="Close the player" className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{error}</p>}
    </section>
  );
}
