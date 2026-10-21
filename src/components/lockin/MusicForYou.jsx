import React, { useEffect, useState } from 'react';
import { Brain, Coffee, Heart, Loader2, Music2, Play, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMusic } from '@/lib/MusicContext';
import { cn } from '@/lib/utils';
import { Waves } from '@/components/lockin/NowPlaying';

const MIX_ICON = { focus: Brain, break: Coffee, favourites: Heart, new: Sparkles };

/**
 * "For you" on the Music page: songs picked from what this student finishes, skips and likes
 * (src/lib/music/recommend.js), plus ready-made mixes. Thumbs up and down teach it directly.
 */
export default function MusicForYou({ provider }) {
  const m = useMusic();
  const [busy, setBusy] = useState('');
  useEffect(() => { m.refreshForYou(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (provider !== 'youtube' || (m.cfg.loaded && !m.cfg.search && !m.forYou.length)) return null;

  const playMix = async (id) => { setBusy(id); try { await m.playMix(id); } finally { setBusy(''); } };
  const refresh = async () => { setBusy('refresh'); try { await m.refreshForYou({ force: true }); } finally { setBusy(''); } };
  const list = m.forYou;

  return (
    <section className="mt-6" aria-labelledby="foryou-h">
      <div className="flex items-center gap-2">
        <h2 id="foryou-h" className="text-sm font-semibold text-foreground">For you</h2>
        <span className="text-xs text-muted-foreground">learns from what you finish, skip and like</span>
        <button type="button" onClick={refresh} disabled={!!busy} aria-label="Find new picks"
          className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50">
          {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Mixes">
        {m.mixes.map((x) => {
          const Icon = MIX_ICON[x.id] || Music2;
          return (
            <button key={x.id} type="button" onClick={() => playMix(x.id)} disabled={!!busy}
              className="inline-flex h-10 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium text-foreground hover:border-primary/50 hover:bg-accent disabled:opacity-60">
              {busy === x.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4 text-primary" aria-hidden="true" />}{x.title}
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">Play a few songs, or start a mix above. Picks appear here as LOCK IN! learns what you like.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Picked for you">
          {list.map((it, i) => {
            const on = m.track?.title === it.title && m.playing;
            return (
              <li key={it.id} className="flex items-center gap-2 rounded-2xl border bg-card p-2">
                <button type="button" onClick={() => m.playYouTube(it, list.slice(i))} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {(it.thumb || it.id) ? <img src={it.thumb || `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`} alt="" className="h-12 w-16 flex-none rounded-lg object-cover" /> : <span className="grid h-12 w-16 flex-none place-items-center rounded-lg bg-muted"><Music2 className="h-4 w-4" aria-hidden="true" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{it.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{it.channel}</span>
                    <span className="block truncate text-xs text-primary">{it.why}</span>
                  </span>
                  {on ? <Waves playing className="text-primary" /> : <Play className="h-4 w-4 flex-none text-primary" aria-hidden="true" />}
                </button>
                <div className="flex flex-col">
                  <button type="button" onClick={() => m.feedback(it, 'more')} aria-label={`More like ${it.title}`} title="More like this"
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><ThumbsUp className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" onClick={() => m.feedback(it, 'less')} aria-label={`Not for me: ${it.title}`} title="Not for me"
                    className={cn('grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground')}><ThumbsDown className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
