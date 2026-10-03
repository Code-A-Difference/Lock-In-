/**
 * The lecture being recorded, for the whole app — like FocusContext, it sits
 * above the pages so a recording carries on while you check your agenda.
 *
 * Each ~30 s piece goes to the transcriber in order (the end of one piece is
 * the spelling hint for the next) and is saved to the lecture as it comes
 * back, so a crash or a dead battery loses at most the piece in flight. When
 * you stop, it finishes the queue and writes the notes.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActions, useStudyData } from './data.js';
import { ymd } from './dates.js';
import { LectureRecorder, canRecord, downsample, encodeWav, isSilent, SAMPLE_RATE, CHUNK_SECONDS } from './recorder.js';
import { transcribeChunk, transcriptText, generateNotes } from './lectures.js';
import { chime, unlockAudio } from './soundscape.js';

const Ctx = createContext(null);

export function defaultTitle(className, when = new Date()) {
  const d = when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${className || 'Lecture'} · ${d}`;
}

export function LectureProvider({ children }) {
  const actions = useActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const { lectures } = useStudyData();
  const lecturesRef = useRef(lectures);
  lecturesRef.current = lectures;
  const navigate = useNavigate();

  const [active, setActive] = useState(null);     // { id, state, elapsed, level, queued, failed }
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(null);   // { id, title, done, total } while a video or audio file is transcribed
  const [writing, setWriting] = useState({});     // id -> progress text while notes are written
  const rec = useRef(null);
  const queue = useRef(Promise.resolve());
  const segs = useRef([]);
  const failedChunks = useRef(new Map());        // start -> wav, while the app is open
  const meta = useRef({ id: null, className: '' });
  const tick = useRef(null);

  const save = useCallback((id, patch) => actionsRef.current.updateLecture(id, patch).catch(() => {}), []);

  const writeNotes = useCallback(async (lec) => {
    const transcript = transcriptText(lec.segments);
    setWriting(w => ({ ...w, [lec.id]: 'Writing your notes…' }));
    await save(lec.id, { status: 'writing' });
    try {
      const notes = await generateNotes({
        transcript, myNotes: lec.my_notes, className: lec.class_name, title: lec.title, date: lec.date,
      }, (msg) => setWriting(w => ({ ...w, [lec.id]: msg })));
      const patch = { notes, status: 'ready', notes_at: new Date().toISOString() };
      if (lec.auto_title && notes.title) patch.title = notes.title;
      await save(lec.id, patch);
    } catch (e) {
      await save(lec.id, { status: 'transcribed', notes_error: e.message || 'The notes could not be written.' });
      throw e;
    } finally {
      setWriting(w => { const n = { ...w }; delete n[lec.id]; return n; });
    }
  }, [save]);

  const transcribe = useCallback((chunk) => {
    const { id, className } = meta.current;
    setActive(a => a && { ...a, queued: a.queued + 1 });
    queue.current = queue.current.then(async () => {
      const before = transcriptText(segs.current).slice(-300);
      const hint = [className, before].filter(Boolean).join(' — ');
      let seg;
      try {
        const text = await transcribeChunk(chunk.wav, hint);
        seg = { start: chunk.start, duration: chunk.duration, text };
        failedChunks.current.delete(chunk.start);
      } catch (e) {
        seg = { start: chunk.start, duration: chunk.duration, text: '', error: e.message };
        failedChunks.current.set(chunk.start, chunk.wav);
        setActive(a => a && { ...a, failed: a.failed + 1 });
      }
      segs.current = [...segs.current.filter(s => s.start !== seg.start), seg].sort((a, b) => a.start - b.start);
      await save(id, { segments: segs.current });
      setActive(a => a && { ...a, queued: Math.max(0, a.queued - 1) });
    });
  }, [save]);

  const start = useCallback(async ({ className = '', classId = '', title = '' } = {}) => {
    if (rec.current) return null;
    setError('');
    unlockAudio();
    const now = new Date();
    const lec = await actionsRef.current.addLecture({
      title: title || defaultTitle(className, now),
      auto_title: !title,
      class_name: className, class_id: classId,
      date: ymd(now), started_at: now.toISOString(),
      status: 'recording', duration: 0, segments: [], my_notes: '',
    });
    meta.current = { id: lec.id, className };
    segs.current = [];
    failedChunks.current = new Map();
    queue.current = Promise.resolve();
    const r = new LectureRecorder({
      onChunk: (c) => { if (!c.silent) transcribe(c); },
      onLevel: (level) => setActive(a => a && { ...a, level }),
    });
    try {
      await r.start();
    } catch (e) {
      await actionsRef.current.deleteLecture(lec).catch(() => {});
      setError(e.message);
      throw e;
    }
    rec.current = r;
    chime('assistantActive', 0.25);
    setActive({ id: lec.id, state: 'recording', elapsed: 0, level: 0, queued: 0, failed: 0 });
    tick.current = setInterval(() => setActive(a => a && { ...a, elapsed: r.elapsed }), 500);
    navigate(`/Notes?id=${lec.id}`);
    return lec;
  }, [navigate, transcribe]);

  const pause = useCallback(() => { rec.current?.pause(); setActive(a => a && { ...a, state: 'paused' }); }, []);
  const resume = useCallback(() => { rec.current?.resume(); setActive(a => a && { ...a, state: 'recording' }); }, []);

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearInterval(tick.current);
    const { id } = meta.current;
    setActive(a => a && { ...a, state: 'finishing', elapsed: r.elapsed });
    await r.stop();
    chime('breakEnd', 0.25);
    await save(id, { duration: Math.round(r.elapsed), status: 'transcribing' });
    await queue.current;
    const transcript = transcriptText(segs.current);
    const lec = { id, segments: segs.current, class_name: meta.current.className };
    setActive(null);
    if (!transcript) {
      await save(id, { status: 'transcribed', notes_error: 'Nothing was heard clearly enough to transcribe.' });
      return;
    }
    await save(id, { status: 'transcribed' });
    // The page passes the latest my_notes/title in; fall back to what we have.
    const latest = lecturesRef.current.find(l => l.id === id) || {};
    writeNotes({ ...latest, ...lec }).catch(() => {});
  }, [save, writeNotes]);

  /**
   * A video or audio file the student already has (a recorded class, a
   * lesson video) becomes a lecture: the sound is decoded in the browser,
   * cut into the same 30-second pieces a live recording makes, transcribed,
   * and turned into notes — after which the assistant can answer questions
   * about it like any other lecture.
   */
  const MAX_IMPORT_BYTES = 150 * 1024 * 1024;
  const importMedia = useCallback(async (file, { className = '', classId = '' } = {}) => {
    if (!file) return null;
    if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is over 150 MB. Trim it, or export just the audio, and try again.');
    unlockAudio();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser can’t read audio files.');
    const ac = new AC();
    let decoded;
    try {
      decoded = await ac.decodeAudioData(await file.arrayBuffer());
    } catch (_) {
      throw new Error('I couldn’t read sound from that file. MP4, MP3, M4A, WAV and WebM usually work; try another format.');
    } finally { ac.close?.().catch?.(() => {}); }

    const a = decoded.getChannelData(0);
    const b = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
    const mono = b ? a.map((v, i) => (v + b[i]) / 2) : a;
    const pcm = downsample(mono, decoded.sampleRate);
    const now = new Date();
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported video';
    const lec = await actionsRef.current.addLecture({
      title, auto_title: false, class_name: className, class_id: classId,
      date: ymd(now), started_at: now.toISOString(), status: 'transcribing',
      duration: Math.round(pcm.length / SAMPLE_RATE), segments: [], my_notes: '', source: 'import',
    });
    const piece = CHUNK_SECONDS * SAMPLE_RATE;
    const total = Math.ceil(pcm.length / piece);
    const out = [];
    setImporting({ id: lec.id, title, done: 0, total });
    try {
      for (let i = 0; i < total; i++) {
        const samples = pcm.subarray(i * piece, Math.min(pcm.length, (i + 1) * piece));
        let seg = { start: i * CHUNK_SECONDS, duration: samples.length / SAMPLE_RATE, text: '' };
        if (!isSilent(samples)) {
          try {
            seg.text = await transcribeChunk(encodeWav(samples), [className, transcriptText(out).slice(-300)].filter(Boolean).join(' — '));
          } catch (e) { seg.error = e.message; }
        }
        out.push(seg);
        await save(lec.id, { segments: out });
        setImporting({ id: lec.id, title, done: i + 1, total });
      }
      if (!transcriptText(out)) {
        await save(lec.id, { status: 'transcribed', notes_error: 'Nothing was heard clearly enough to transcribe.' });
        return lec;
      }
      await save(lec.id, { status: 'transcribed' });
    } finally { setImporting(null); }
    writeNotes({ ...lec, segments: out, class_name: className }).catch(() => {});
    return lec;
  }, [save, writeNotes]);

  /** Try the pieces that failed again (only while the app has them in memory). */
  const retryFailed = useCallback(async () => {
    const pending = [...failedChunks.current.entries()];
    for (const [startAt, wav] of pending) transcribe({ wav, start: startAt, duration: 0 });
    await queue.current;
  }, [transcribe]);

  // Leaving (sign-out) mid-recording: stop the microphone.
  useEffect(() => () => { clearInterval(tick.current); rec.current?.stop(); }, []);

  // Closing the tab mid-recording asks first.
  useEffect(() => {
    if (!active) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [!!active]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    canRecord, active, error, writing, importing, importMedia, start, pause, resume, stop, retryFailed, writeNotes,
    hasFailed: (active?.failed || 0) > 0 || failedChunks.current.size > 0,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLecture() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLecture must be used inside LectureProvider');
  return v;
}
