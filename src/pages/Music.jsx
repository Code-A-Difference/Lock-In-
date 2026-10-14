import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Music2, Play, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMusic } from '@/lib/MusicContext';
import { Waves } from '@/components/lockin/NowPlaying';

const SOURCES = [['youtube', 'YouTube Music'], ['spotify', 'Spotify']];

/**
 * Music to study to. Search or paste a link; it plays in the little card that
 * follows you around the app (and in the floating bar on the desktop app).
 */
export default function Music() {
  const m = useMusic();
  const location = useLocation();
  const navigate = useNavigate();
  const [provider, setProvider] = useState('youtube');
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const handled = useRef(false);

  useEffect(() => { m.loadConfig(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Spotify sends the student back here with ?code=...
  useEffect(() => {
    if (handled.current || !/[?&](code|error)=/.test(location.search)) return;
    handled.current = true;
    setProvider('spotify');
    m.spotify.finish(location.search).then(() => navigate('/Music', { replace: true }));
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (e) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setMsg(''); setItems(null); m.setError('');
    try {
      const r = await m.search(provider, q);
      if (r.items) { setItems(r.items); if (!r.items.length) setMsg('Nothing found. Try different words, or paste a link.'); }
      else setQ('');
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  };

  const play = (it) => (provider === 'youtube' ? m.playYouTube(it, items || []) : m.playSpotify({ ...it, kind: 'track' }));
  const needsConnect = provider === 'spotify' && !m.spotify.connected;
  const noSearch = provider === 'youtube' && m.cfg.loaded && !m.cfg.search;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Music</h1>
      <p className="mt-1 text-sm text-muted-foreground">Play something while you study. It keeps going on every page, and the desktop app shows it in the floating bar.</p>

      <div role="radiogroup" aria-label="Where to play from" className="mt-5 inline-flex rounded-lg border p-0.5">
        {SOURCES.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={provider === id} onClick={() => { setProvider(id); setItems(null); setMsg(''); }}
            className={cn('h-10 rounded-md px-4 text-sm font-medium', provider === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {needsConnect ? (
        <div className="mt-5 rounded-2xl border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Connect Spotify</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            LOCK IN! becomes a remote for your Spotify app: search, play, pause and skip from here. It needs Spotify Premium, and Spotify open on this computer or your phone.
          </p>
          <button type="button" onClick={m.spotify.connect} disabled={m.cfg.loaded && !m.cfg.spotifyClientId}
            className="mt-4 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Connect Spotify
          </button>
          {m.cfg.loaded && !m.cfg.spotifyClientId && <p className="mt-2 text-xs text-muted-foreground">Spotify isn’t switched on for this site yet.</p>}
        </div>
      ) : (
        <form onSubmit={go} className="mt-5">
          <label htmlFor="music-q" className="sr-only">Search or paste a link</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input id="music-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
                placeholder={provider === 'youtube' ? (noSearch ? 'Paste a YouTube or YouTube Music link' : 'Search a song, or paste a link') : 'Search Spotify, or paste a link'}
                className="h-12 w-full rounded-xl border bg-background pl-10 pr-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <button type="submit" disabled={busy || !q.trim()} className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{noSearch ? 'Play' : 'Go'}
            </button>
          </div>
          {noSearch && <p className="mt-2 text-xs text-muted-foreground">Search isn’t switched on yet, but any YouTube or YouTube Music link plays.</p>}
        </form>
      )}

      {(msg || m.error) && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{msg || m.error}</p>}

      {items && items.length > 0 && (
        <ul className="mt-5 divide-y rounded-2xl border bg-card" aria-label="Results">
          {items.map((it) => (
            <li key={it.id || it.uri}>
              <button type="button" onClick={() => play(it)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {(it.thumb || it.art) ? <img src={it.thumb || it.art} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" /> : <span className="grid h-12 w-12 flex-none place-items-center rounded-lg bg-muted"><Music2 className="h-5 w-5" aria-hidden="true" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{it.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{it.channel || it.artist}</span>
                </span>
                <Play className="h-4 w-4 flex-none text-primary" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!items && m.recent.length > 0 && (
        <section className="mt-7" aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-sm font-semibold text-foreground">Recently played</h2>
          <ul className="mt-2 divide-y rounded-2xl border bg-card">
            {m.recent.map((it) => (
              <li key={it.id || it.uri || it.list}>
                <button type="button" onClick={() => (it.source === 'spotify' ? m.playSpotify(it) : m.playYouTube(it))} className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {it.art ? <img src={it.art} alt="" className="h-10 w-10 flex-none rounded-lg object-cover" /> : <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-muted"><Music2 className="h-4 w-4" aria-hidden="true" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{it.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{it.source === 'spotify' ? 'Spotify' : 'YouTube Music'}{it.artist ? ` · ${it.artist}` : ''}</span>
                  </span>
                  {m.track?.title === it.title && m.playing ? <Waves playing className="text-primary" /> : <Play className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {provider === 'spotify' && m.spotify.connected && (
        <button type="button" onClick={m.spotify.disconnect} className="mt-6 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Disconnect Spotify</button>
      )}
    </div>
  );
}
