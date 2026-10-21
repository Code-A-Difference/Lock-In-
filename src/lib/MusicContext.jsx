import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { gateFetch } from '@/api/hostGate';
import { useFocus } from '@/lib/FocusContext';
import { parseSpotify, parseYouTube } from '@/lib/music/links';
import * as sp from '@/lib/music/spotify';
import { createPlayer, errorText, STATE } from '@/lib/music/youtube';
import { rank, learn, cleanProfile, nextQuery, reason, mixes as mixList, STARTER_QUERIES, channelsToFetch } from '@/lib/music/recommend';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';

/**
 * What's playing, above the pages so it keeps going while the student moves around.
 * Two sources: YouTube / YouTube Music (a player inside the app) and Spotify
 * (LOCK IN! remote-controls the Spotify app). The now-playing card, the Music page
 * and the desktop floating bar all read and drive this.
 */
const Ctx = createContext(null);
export const useMusic = () => useContext(Ctx);

const RECENT_KEY = 'lockin.music.recent';
const POOL_KEY = 'lockin.music.pool';        // songs seen in searches and plays: what recommendations are picked from
const TASTE_KEY = 'lockin.music.taste';      // this device's copy of the taste profile (the account has the shared one)
const ASKED_KEY = 'lockin.music.asked';      // searches made for recommendations, so one isn't repeated within a day
const CHANNELS_KEY = 'lockin.music.channels'; // channels whose uploads were fetched, and when (once a day each)
const POOL_MAX = 400;
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; } };

export function MusicProvider({ children }) {
  const [cfg, setCfg] = useState({ loaded: false, search: false, spotifyClientId: '' });
  const [source, setSource] = useState(null);          // 'youtube' | 'spotify' | null
  const [track, setTrack] = useState(null);            // { title, artist, art }
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [spConnected, setSpConnected] = useState(sp.isConnected());
  const [recent, setRecent] = useState(readRecent);
  const { user } = useAuth() || {};
  // the taste profile: whichever is newer, this device's or the account's
  const tasteRef = useRef(null);
  if (!tasteRef.current) {
    const local = cleanProfile(readJson(TASTE_KEY, null));
    const acct = user?.musicTaste ? cleanProfile(user.musicTaste) : null;
    tasteRef.current = acct && acct.at > local.at ? acct : local;
  }
  const poolRef = useRef(readJson(POOL_KEY, []));
  const askedRef = useRef(readJson(ASKED_KEY, {}));
  const channelsRef = useRef(readJson(CHANNELS_KEY, {}));
  const [tasteVer, setTasteVer] = useState(0);
  const nowItem = useRef(null);          // the YouTube song playing now, to learn from when it ends or is skipped
  const progressRef = useRef({ pos: 0, dur: 0 });
  const saveTimer = useRef(null);

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

  /* ------------------------------------------------- learning what they like */
  const phaseNow = () => (focus?.status === 'running' ? (focus.phase === 'focus' ? 'focus' : 'break') : '');
  /** Songs seen anywhere go into the pool recommendations are picked from (newest first, capped). */
  const addToPool = (items) => {
    const fresh = (items || []).filter((x) => x && x.id).map((x) => ({ id: x.id, title: x.title || '', channel: x.channel || x.artist || '', thumb: x.thumb || x.art || '', ...(x.channelId ? { channelId: x.channelId } : {}) }));
    if (!fresh.length) return;
    const ids = new Set(fresh.map((x) => x.id));
    poolRef.current = [...fresh, ...poolRef.current.filter((x) => !ids.has(x.id))].slice(0, POOL_MAX);
    writeJson(POOL_KEY, poolRef.current);
  };
  /** Keep the profile: on this device at once, on the account a little later (one save for many songs). */
  const saveTaste = (p) => {
    tasteRef.current = p;
    writeJson(TASTE_KEY, p);
    setTasteVer((v) => v + 1);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { db.auth.updateMe({ musicTaste: tasteRef.current }).catch(() => {}); }, 30000);
  };
  const noteTaste = (item, kind, extra = {}) => {
    if (!item || !(item.id || item.uri)) return;
    saveTaste(learn(tasteRef.current, item, kind, { phase: phaseNow(), ...extra }));
  };
  /** The song that was playing has stopped being the song: learn from how much of it they heard. */
  const settleNow = (how) => {
    const it = nowItem.current;
    nowItem.current = null;
    if (!it) return;
    const { pos, dur } = progressRef.current;
    if (how === 'finish' || (dur && pos / dur >= 0.85)) noteTaste(it, 'finish');
    else noteTaste(it, how === 'skip' ? 'skip' : 'listen', { listened: pos, duration: dur });
  };
  const beginNow = (item) => {
    if (nowItem.current && nowItem.current.id !== item.id) settleNow('skip');
    if (!item?.id) return;
    nowItem.current = { id: item.id, title: item.title || '', channel: item.channel || item.artist || '' };
    progressRef.current = { pos: 0, dur: 0 };
    addToPool([item]);
    noteTaste(nowItem.current, 'play');
  };
  // the account copy arrives (sign in on a new device, or another device saved a newer one)
  useEffect(() => {
    const acct = user?.musicTaste ? cleanProfile(user.musicTaste) : null;
    if (acct && acct.at > tasteRef.current.at) { tasteRef.current = acct; writeJson(TASTE_KEY, acct); setTasteVer((v) => v + 1); }
  }, [user?.musicTaste]); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving: save what was learned now rather than in 30 seconds
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden' && saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; db.auth.updateMe({ musicTaste: tasteRef.current }).catch(() => {}); } };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  /** The YouTube search through the site's server (it holds the key). Results also join the pool. */
  const fetchSearch = useCallback(async (text) => {
    const r = await gateFetch(`/api/music.php?action=search&q=${encodeURIComponent(text)}`, { headers: { 'X-LockIn': '1' }, credentials: 'same-origin' });
    const j = await r.json().catch(() => null);
    if (!j?.ok) throw new Error(j?.error || 'Search didn’t work just now.');
    addToPool(j.items);
    return j.items;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** A channel's latest uploads, into the pool: 1 unit of YouTube's quota (a search uses one of ~100 a day). Once a day per channel. */
  const fetchChannel = async (cid) => {
    channelsRef.current = { ...Object.fromEntries(Object.entries(channelsRef.current).filter(([, t]) => Date.now() - t < 86400000)), [cid]: Date.now() };
    writeJson(CHANNELS_KEY, channelsRef.current);
    try {
      const r = await gateFetch(`/api/music.php?action=channel&id=${encodeURIComponent(cid)}`, { headers: { 'X-LockIn': '1' }, credentials: 'same-origin' });
      const j = await r.json().catch(() => null);
      if (j?.ok) addToPool(j.items);
    } catch (_) { /* offline: the pool has what it has */ }
  };

  /**
   * Ranked picks from the pool. When too few good ones are left: first the uploads of channels the
   * student likes (cheap), and only then one search (a new one, never repeated within a day).
   */
  const picks = async ({ mode = 'mix', phase = phaseNow(), n = 12, exclude = new Set(), search = true } = {}) => {
    const ctx = { mode, phase, now: Date.now() };
    let list = rank(poolRef.current, tasteRef.current, ctx, n, exclude);
    const enough = () => list.length >= Math.min(n, 6);
    if (search && !enough()) {
      const ids = channelsToFetch(tasteRef.current, poolRef.current, channelsRef.current, { now: Date.now(), phase });
      if (ids.length) {
        await Promise.all(ids.map(fetchChannel));
        list = rank(poolRef.current, tasteRef.current, ctx, n, exclude);
      }
    }
    if (search && !enough()) {
      const c = cfgRef.current.loaded ? cfgRef.current : await loadConfigRef.current();
      const q = c.search ? nextQuery(tasteRef.current, { mode, phase, asked: askedRef.current, now: Date.now() }) : null;
      if (q) {
        askedRef.current = { ...Object.fromEntries(Object.entries(askedRef.current).filter(([, t]) => Date.now() - t < 86400000)), [q]: Date.now() };
        writeJson(ASKED_KEY, askedRef.current);
        try { await fetchSearch(q); } catch (_) { /* quota or offline: rank what there is */ }
        list = rank(poolRef.current, tasteRef.current, ctx, n, exclude);
      }
    }
    return list;
  };

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
    beginNow(it);
    setTrack({ title: it.title, artist: it.channel || it.artist || '', art: it.thumb || it.art || (it.id ? `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg` : '') });
    setPlaying(true);
    loadInPlayer(it);
  };

  /** Nothing is lined up after this song: play what the student is most likely to want next (recommend.js), or go on through what was played before. */
  const radio = async () => {
    try {
      const found = await picks({ n: 10, exclude: playedRef.current });
      if (found.length) { queueRef.current = { items: found, i: 0 }; startItem(found[0]); return; }
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
          else if (s === STATE.ENDED) { setPlaying(false); settleNow('finish'); ytNext(); }
        },
        onError: (code) => {
          setError(errorText(code));
          nowItem.current = null;          // a video that won't play says nothing about the student's taste
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
    beginNow(item);
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
      // a new Spotify track: learn from the last one (finished if it got most of the way)
      const prevSp = spBase.current;
      if (prevSp?.uri && s.track.uri && prevSp.uri !== s.track.uri) {
        const heard = prevSp.playing ? prevSp.pos + (Date.now() - prevSp.at) / 1000 : prevSp.pos;
        const it = { uri: prevSp.uri, title: prevSp.title, channel: prevSp.artist };
        if (prevSp.dur && heard / prevSp.dur >= 0.85) noteTaste(it, 'finish'); else noteTaste(it, 'skip', { listened: heard, duration: prevSp.dur });
      }
      setTrack({ title: s.track.title, artist: s.track.artist, art: s.track.art });
      setPlaying(s.playing);
      spBase.current = { pos: s.progress, dur: s.track.duration, playing: s.playing, at: Date.now(), uri: s.track.uri, title: s.track.title, artist: s.track.artist };
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
    if (sourceRef.current === 'youtube') { settleNow('skip'); ytNext(); }
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
    if (sourceRef.current === 'youtube') { settleNow('listen'); stopYouTube(); }
    else if (sourceRef.current === 'spotify') sp.pause().catch(() => {});
    setSource(null); setTrack(null); setPlaying(false); setError('');
  }, []);

  // where the song is up to, for the seek bar
  useEffect(() => {
    if (!source) { setProgress({ pos: 0, dur: 0 }); return undefined; }
    const t = setInterval(() => {
      if (sourceRef.current === 'youtube') {
        const p = playerRef.current;
        if (p?.getCurrentTime) { const pr = { pos: p.getCurrentTime() || 0, dur: p.getDuration?.() || 0 }; progressRef.current = pr; setProgress(pr); }
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


  /* ------------------------------------------------------- recommendations */
  const [forYou, setForYou] = useState([]);
  const refreshing = useRef(false);
  /** The For you row: from the pool at once; a search only when it's thin, and at most every 6 hours unless asked. */
  const refreshForYou = useCallback(async ({ force = false } = {}) => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const last = readJson('lockin.music.forYouAt', 0);
      const may = force || Date.now() - last > 6 * 3600000 || poolRef.current.length < 12;
      const list = await picks({ n: 8, search: may });
      if (may) writeJson('lockin.music.forYouAt', Date.now());
      setForYou(list.map((t) => ({ ...t, why: reason(t, tasteRef.current, { phase: phaseNow(), now: Date.now() }) })));
    } finally { refreshing.current = false; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // re-rank (no search) when something new was learned
  useEffect(() => {
    if (!forYou.length && !poolRef.current.length) return;
    const ctx = { phase: phaseNow(), now: Date.now() };
    setForYou(rank(poolRef.current, tasteRef.current, ctx, 8).map((t) => ({ ...t, why: reason(t, tasteRef.current, ctx) })));
  }, [tasteVer]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Play a ready-made mix (Deep focus, Break time, Favourites, Something new) as a queue. */
  const playMix = useCallback(async (id) => {
    setError('');
    const m = mixList().find((x) => x.id === id) || mixList()[0];
    let list = await picks({ mode: m.mode, phase: m.phase || phaseNow(), n: 20 });
    if (list.length < 3) {
      try { await fetchSearch(STARTER_QUERIES[m.id] || STARTER_QUERIES.focus); } catch (e) { setError(e.message); }
      list = rank(poolRef.current, tasteRef.current, { mode: m.mode, phase: m.phase, now: Date.now() }, 20);
    }
    if (!list.length) { setError('Nothing to play in that mix yet. Search for a song you like first.'); return; }
    await playYouTube(list[0], list);
  }, [playYouTube]); // eslint-disable-line react-hooks/exhaustive-deps

  /** More like this / Not for me. Turning down the song that's playing skips it. */
  const feedback = useCallback((item, kind) => {
    if (!item) return;
    noteTaste(item, kind === 'less' ? 'less' : 'more');
    const cid = item.channelId || poolRef.current.find((x) => x.id === item.id)?.channelId;
    if (kind !== 'less' && cid && !(channelsRef.current[cid] && Date.now() - channelsRef.current[cid] < 86400000)) fetchChannel(cid);
    if (kind === 'less' && nowItem.current && item.id === nowItem.current.id) { nowItem.current = null; ytNext(); }
  }, [ytNext]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowPlayingItem = () => nowItem.current;

  const value = useMemo(() => ({
    cfg, loadConfig, source, track, playing, error, setError, recent, hostRef, locked: false,
    forYou, refreshForYou, playMix, feedback, nowPlayingItem, mixes: mixList({ phase: focus?.status === 'running' ? (focus.phase === 'focus' ? 'focus' : 'break') : '' }),
    spotify: { connected: spConnected, connect: connectSpotify, finish: finishSpotify, disconnect: disconnectSpotify },
    search, suggest, progress, seek, playYouTube, playSpotify, toggle, next, previous, close,
  }), [forYou, refreshForYou, playMix, feedback, focus?.status, focus?.phase, cfg, loadConfig, suggest, progress, seek, source, track, playing, error, recent, spConnected, connectSpotify, finishSpotify, disconnectSpotify, search, playYouTube, playSpotify, toggle, next, previous, close]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
