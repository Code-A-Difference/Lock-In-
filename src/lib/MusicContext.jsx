import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { gateFetch } from '@/api/hostGate';
import { useFocus } from '@/lib/FocusContext';
import { parseSpotify, parseYouTube } from '@/lib/music/links';
import * as sp from '@/lib/music/spotify';
import { createPlayer, errorText, STATE } from '@/lib/music/youtube';

/**
 * What's playing, above the pages so it keeps going while the student moves around.
 * Two sources: YouTube / YouTube Music (a player inside the app) and Spotify
 * (LOCK IN! remote-controls the Spotify app). The now-playing card, the Music page
 * and the desktop floating bar all read and drive this.
 */
const Ctx = createContext(null);
export const useMusic = () => useContext(Ctx);

const RECENT_KEY = 'lockin.music.recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; } };

export function MusicProvider({ children }) {
  const [cfg, setCfg] = useState({ loaded: false, search: false, spotifyClientId: '' });
  const [source, setSource] = useState(null);          // 'youtube' | 'spotify' | null
  const [track, setTrack] = useState(null);            // { title, artist, art }
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [spConnected, setSpConnected] = useState(sp.isConnected());
  const [recent, setRecent] = useState(readRecent);

  const hostRef = useRef(null);          // where the YouTube player lives (the now-playing card)
  const playerRef = useRef(null);
  const creating = useRef(false);
  const pending = useRef(null);          // the first thing to play once the player exists
  const queueRef = useRef({ items: [], i: 0 });
  const focus = useFocus();
  const trackRef = useRef(null);
  const cfgRef = useRef(cfg);
  const recentRef = useRef(recent);
  const playedRef = useRef(new Set());              // YouTube ids already played this session, so skipping never loops back
  const spBase = useRef(null);                      // Spotify's position at the last poll, to count on from
  const [progress, setProgress] = useState({ pos: 0, dur: 0 });
  const sourceRef = useRef(null);
  trackRef.current = track; cfgRef.current = cfg; recentRef.current = recent;
  if (import.meta.env.DEV) window.__music = { get player() { return playerRef.current; } };   // for tests only: not in the shipped build
  sourceRef.current = source;

  /* ---------------------------------------------------------------- config */
  const loadConfig = useCallback(async () => {
    if (cfg.loaded) return cfg;
    let next = { loaded: true, search: false, spotifyClientId: '' };
    try {
      const r = await gateFetch('/api/music.php?action=config', { headers: { 'X-LockIn': '1' }, credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) next = { loaded: true, search: !!j.search, spotifyClientId: j.spotifyClientId || '' };
    } catch (_) { /* offline: links still work */ }
    setCfg(next);
    return next;
  }, [cfg]);

  const loadConfigRef = useRef(null);
  loadConfigRef.current = loadConfig;

  /** The YouTube search through the site's server (it holds the key). */
  const fetchSearch = useCallback(async (text) => {
    const r = await gateFetch(`/api/music.php?action=search&q=${encodeURIComponent(text)}`, { headers: { 'X-LockIn': '1' }, credentials: 'same-origin' });
    const j = await r.json().catch(() => null);
    if (!j?.ok) throw new Error(j?.error || 'Search didn’t work just now.');
    return j.items;
  }, []);

  /** Type-ahead words for a half-typed search; no key needed. */
  const suggest = useCallback(async (text) => {
    try {
      const r = await gateFetch(`/api/music.php?action=suggest&q=${encodeURIComponent(text)}`, { headers: { 'X-LockIn': '1' }, credentials: 'same-origin' });
      const j = await r.json();
      return j?.ok && Array.isArray(j.items) ? j.items : [];
    } catch (_) { return []; }
  }, []);

  const remember = useCallback((item) => {
    setRecent((r) => {
      const key = item.id || item.uri || item.list;
      const next = [item, ...r.filter((x) => (x.id || x.uri || x.list) !== key)].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
      return next;
    });
  }, []);

  /* --------------------------------------------------------------- YouTube */
  const ytTitle = () => {
    const d = playerRef.current?.getVideoData?.();
    if (d?.title) setTrack((t) => ({ ...(t || {}), title: d.title, artist: d.author || t?.artist || '', art: t?.art || (d.video_id ? `https://i.ytimg.com/vi/${d.video_id}/mqdefault.jpg` : '') }));
  };

  // a pasted link has no title yet: ask YouTube for it, and fix the "recently played" row too
  const fillTitle = (id) => {
    fetch(`https://www.youtube.com/oembed?${new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, format: 'json' })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.title) return;
        setTrack((t) => (t && (!t.title || t.title === 'YouTube') ? { title: j.title, artist: j.author_name || '', art: j.thumbnail_url || t.art } : t));
        setRecent((r) => {
          const next = r.map((x) => (x.id === id && (!x.title || x.title === 'YouTube') ? { ...x, title: j.title, artist: j.author_name || '', art: j.thumbnail_url || x.art } : x));
          try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
          return next;
        });
      })
      .catch(() => {});
  };

  const loadInPlayer = (item) => {
    if (item.id) playedRef.current.add(item.id);
    const p = playerRef.current;
    if (item.list && !item.id) p.loadPlaylist({ list: item.list, listType: 'playlist' });
    else if (item.list) p.loadPlaylist({ list: item.list, listType: 'playlist', index: 0 });
    else p.loadVideoById(item.id);
  };

  const startItem = (it) => {
    setTrack({ title: it.title, artist: it.channel || it.artist || '', art: it.thumb || it.art || (it.id ? `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg` : '') });
    setPlaying(true);
    loadInPlayer(it);
  };

  /** Nothing is lined up after this song: find more like it (search) or go on through what was played before. */
  const radio = async () => {
    const t = trackRef.current;
    const query = [t?.title, t?.artist].filter(Boolean).join(' ').trim();
    try {
      const c = cfgRef.current.loaded ? cfgRef.current : await loadConfigRef.current();
      if (c.search && query) {
        const found = (await fetchSearch(query)).filter((x) => !playedRef.current.has(x.id));
        if (found.length) { queueRef.current = { items: found, i: 0 }; startItem(found[0]); return; }
      }
      const older = recentRef.current.filter((x) => x.source === 'youtube' && x.id && !playedRef.current.has(x.id));
      if (older.length) { queueRef.current = { items: older, i: 0 }; startItem(older[0]); return; }
      setError('Nothing is lined up to skip to. Search for a song and the next ones line up after it, or paste a playlist link.');
    } catch (e) { setError(e.message || 'Couldn’t find the next song.'); }
  };

  const ytNext = useCallback(() => {
    const q = queueRef.current;
    const p = playerRef.current;
    if (q.i + 1 < q.items.length) { q.i += 1; startItem(q.items[q.i]); }
    else if (p?.getPlaylist && (p.getPlaylist() || []).length > 1) p.nextVideo();     // a real YouTube playlist
    else radio();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startPlayer = useCallback(async () => {
    if (creating.current || playerRef.current || !hostRef.current || !pending.current) return;
    creating.current = true;
    const first = pending.current;
    pending.current = null;
    const el = document.createElement('div');
    hostRef.current.appendChild(el);
    try {
      playerRef.current = await createPlayer(el, {
        onReady: () => ytTitle(),
        onState: (s) => {
          if (s === STATE.PLAYING) { setPlaying(true); ytTitle(); }
          else if (s === STATE.PAUSED) setPlaying(false);
          else if (s === STATE.ENDED) { setPlaying(false); ytNext(); }
        },
        onError: (code) => {
          setError(errorText(code));
          const q = queueRef.current;
          if (q.i + 1 < q.items.length) setTimeout(ytNext, 1200);
        },
      }, first);
    } catch (e) { setError(e.message); setSource(null); }
    creating.current = false;
  }, [ytNext]);

  // the card (with the player's home in it) appears when the source becomes YouTube
  useEffect(() => { if (source === 'youtube') startPlayer(); }, [source, startPlayer]);

  const stopYouTube = () => {
    try { playerRef.current?.destroy?.(); } catch (_) { /* already gone */ }
    playerRef.current = null;
    if (hostRef.current) hostRef.current.innerHTML = '';
  };

  const playYouTube = useCallback(async (item, items = []) => {
    setError('');
    if (sourceRef.current === 'spotify') sp.pause().catch(() => {});
    if (item.id) playedRef.current.add(item.id);
    const i = Math.max(0, items.findIndex((x) => x.id === item.id));
    queueRef.current = { items, i };
    setTrack({ title: item.title || 'YouTube', artist: item.channel || item.artist || '', art: item.thumb || item.art || (item.id ? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg` : '') });
    setPlaying(true);
    if (item.id && !item.title) fillTitle(item.id);
    remember({ source: 'youtube', id: item.id || null, list: item.list || null, title: item.title || 'YouTube', artist: item.channel || item.artist || '', art: item.thumb || item.art || (item.id ? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg` : '') });
    if (playerRef.current) { setSource('youtube'); loadInPlayer(item); return; }
    pending.current = item;
    if (sourceRef.current === 'youtube') startPlayer(); else setSource('youtube');
  }, [remember, startPlayer]);

  /* --------------------------------------------------------------- Spotify */
  const pollSpotify = useCallback(async () => {
    try {
      const s = await sp.nowPlaying();
      if (!s) return;
      if (sourceRef.current === 'youtube') return;           // YouTube has the floor
      setSource('spotify');
      setTrack({ title: s.track.title, artist: s.track.artist, art: s.track.art });
      setPlaying(s.playing);
      spBase.current = { pos: s.progress, dur: s.track.duration, playing: s.playing, at: Date.now() };
    } catch (e) { if (e.code === 'auth') { setSpConnected(false); } }
  }, []);

  useEffect(() => {
    if (!spConnected) return undefined;
    pollSpotify();
    const t = setInterval(pollSpotify, 5000);
    return () => clearInterval(t);
  }, [spConnected, pollSpotify]);

  const playSpotify = useCallback(async (item) => {
    setError('');
    try {
      if (sourceRef.current === 'youtube') { try { playerRef.current?.pauseVideo?.(); } catch (_) { /* ok */ } }
      await sp.play({ uri: item.uri, kind: item.kind || 'track' });
      stopYouTube();
      setSource('spotify');
      if (item.title) setTrack({ title: item.title, artist: item.artist || '', art: item.art || '' });
      setPlaying(true);
      remember({ source: 'spotify', uri: item.uri, kind: item.kind || 'track', title: item.title || 'Spotify', artist: item.artist || '', art: item.art || '' });
      setTimeout(pollSpotify, 900);
    } catch (e) { setError(e.message); if (e.code === 'auth') setSpConnected(false); }
  }, [pollSpotify, remember]);

  const connectSpotify = useCallback(async () => {
    const c = await loadConfig();
    if (!c.spotifyClientId) { setError('Spotify isn’t switched on yet. It needs to be set up by whoever runs this site.'); return; }
    sp.connect(c.spotifyClientId);
  }, [loadConfig]);

  const finishSpotify = useCallback(async (search) => {
    try { const done = await sp.finishConnect(search); if (done) setSpConnected(true); return done; }
    catch (e) { setError(e.message); return false; }
  }, []);

  const disconnectSpotify = useCallback(() => {
    sp.disconnect(); setSpConnected(false);
    if (sourceRef.current === 'spotify') { setSource(null); setTrack(null); setPlaying(false); }
  }, []);

  /* -------------------------------------------------------------- controls */
  const toggle = useCallback(async () => {
    setError('');
    if (sourceRef.current === 'youtube') {
      const p = playerRef.current; if (!p) return;
      if (p.getPlayerState?.() === STATE.PLAYING) p.pauseVideo(); else p.playVideo();
    } else if (sourceRef.current === 'spotify') {
      try { if (playing) await sp.pause(); else await sp.resume(); setPlaying(!playing); setTimeout(pollSpotify, 700); }
      catch (e) { setError(e.message); }
    }
  }, [playing, pollSpotify]);

  const next = useCallback(async () => {
    setError('');
    if (sourceRef.current === 'youtube') ytNext();
    else if (sourceRef.current === 'spotify') { try { await sp.next(); setTimeout(pollSpotify, 800); } catch (e) { setError(e.message); } }
  }, [ytNext, pollSpotify]);

  const previous = useCallback(async () => {
    setError('');
    if (sourceRef.current === 'youtube') {
      const q = queueRef.current; const p = playerRef.current;
      if (p && p.getCurrentTime?.() > 4) p.seekTo(0, true);
      else if (q.i > 0) { q.i -= 1; const it = q.items[q.i]; setTrack({ title: it.title, artist: it.channel || '', art: it.thumb || '' }); loadInPlayer(it); }
      else p?.seekTo(0, true);
    } else if (sourceRef.current === 'spotify') { try { await sp.previous(); setTimeout(pollSpotify, 800); } catch (e) { setError(e.message); } }
  }, [pollSpotify]);

  const close = useCallback(() => {
    if (sourceRef.current === 'youtube') stopYouTube();
    else if (sourceRef.current === 'spotify') sp.pause().catch(() => {});
    setSource(null); setTrack(null); setPlaying(false); setError('');
  }, []);

  // where the song is up to, for the seek bar
  useEffect(() => {
    if (!source) { setProgress({ pos: 0, dur: 0 }); return undefined; }
    const t = setInterval(() => {
      if (sourceRef.current === 'youtube') {
        const p = playerRef.current;
        if (p?.getCurrentTime) setProgress({ pos: p.getCurrentTime() || 0, dur: p.getDuration?.() || 0 });
      } else if (spBase.current) {
        const b = spBase.current;
        const pos = b.playing ? b.pos + (Date.now() - b.at) / 1000 : b.pos;
        setProgress({ pos: b.dur ? Math.min(pos, b.dur) : pos, dur: b.dur || 0 });
      }
    }, 500);
    return () => clearInterval(t);
  }, [source]);

  const seek = useCallback(async (sec) => {
    sec = Math.max(0, Number(sec) || 0);
    setProgress((p) => ({ ...p, pos: sec }));
    if (sourceRef.current === 'youtube') playerRef.current?.seekTo?.(sec, true);
    else if (sourceRef.current === 'spotify') {
      if (spBase.current) spBase.current = { ...spBase.current, pos: sec, at: Date.now() };
      try { await sp.seek(sec * 1000); } catch (e) { setError(e.message); }
    }
  }, []);

  /** Search (or a pasted link) for a source. Returns { items } or { played: true }. */
  const search = useCallback(async (provider, q) => {
    const text = q.trim();
    if (provider === 'youtube') {
      const link = parseYouTube(text);
      if (link) { await playYouTube({ id: link.id, list: link.list, title: '' }); return { played: true }; }
      return { items: await fetchSearch(text) };
    }
    const link = parseSpotify(text);
    if (link) { await playSpotify({ uri: link.uri, kind: link.kind }); return { played: true }; }
    return { items: await sp.search(text) };
  }, [playSpotify, playYouTube, fetchSearch]);


  const value = useMemo(() => ({
    cfg, loadConfig, source, track, playing, error, setError, recent, hostRef, locked: false,
    spotify: { connected: spConnected, connect: connectSpotify, finish: finishSpotify, disconnect: disconnectSpotify },
    search, suggest, progress, seek, playYouTube, playSpotify, toggle, next, previous, close,
  }), [cfg, loadConfig, suggest, progress, seek, source, track, playing, error, recent, spConnected, connectSpotify, finishSpotify, disconnectSpotify, search, playYouTube, playSpotify, toggle, next, previous, close]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
