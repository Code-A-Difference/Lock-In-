/**
 * The lecture being recorded, for the whole app, like FocusContext, it sits
 * above the pages so a recording carries on while you check your agenda.
 *
 * Every piece of the recording (cut at a pause, ~8 to 22 s) is kept on this
 * device first, then goes to the transcriber through a queue that backs off
 * when the service is busy and keeps trying (transcribeQueue.js), so a busy
 * service delays a transcript but never loses part of a class. Results are
 * saved to the lecture as they come back. When you stop, it waits for the
 * queue (a while, not for ever) and writes the notes; if some pieces are still
 * waiting, it carries on in the background, picks them up again after the app
 * is reopened, and writes the notes as soon as the last one is in.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActions, useStudyData } from './data.js';
import { ymd } from './dates.js';
import { LectureRecorder, canRecord, resample, encodeWav, levelSpeech, isSilent, joinWav, PauseCutter, SAMPLE_RATE } from './recorder.js';
import { transcribeChunk, transcriptText, generateNotes, cleanPiece } from './lectures.js';
import { TranscribeQueue } from './transcribeQueue.js';
import { templateHow } from './classChat.js';
import { desktop } from './desktop.js';
import { EXTRACT_PROMPT, MATERIAL_MAX_CHARS } from './classQuiz.js';
import { db } from '@/api/db';
import { chime, unlockAudio } from './soundscape.js';
import { allowOutside } from './aiPrefs.js';
import { getMicPref } from './micCheck.js';
import {
  keepPending, dropPending, listPending, pendingLectureIds, keepAudio, listAudio, audioSummary, dropAudio, dropLecture, audioIndex, wantAudio, keepSafe,
} from './pendingAudio.js';

/** How slides are read: every page, labelled, so notes and answers can point to "Slide 4". */
const SLIDES_PROMPT = `These are lecture slides. Write out the text of every slide in order, each starting on its own line with "Slide N:" (N is the page or slide number). Keep headings, bullet points, formulas (in LaTeX between $ signs) and numbers exactly. Describe each diagram, chart or image in one short sentence in square brackets. Don't add anything that isn't on the slides.`;

const Ctx = createContext(null);

export function defaultTitle(className, when = new Date()) {
  const d = when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${className || 'Lecture'} · ${d}`;
}

const pieceId = (lectureId, start) => `${lectureId}|${Number(start).toFixed(2)}`;
const HEARTBEAT = 'lockin.recording';      // a tab that is recording says so, so another tab doesn't mistake its lecture for an abandoned one
const sameInfo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function LectureProvider({ children }) {
  const actions = useActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const { lectures } = useStudyData();
  const lecturesRef = useRef(lectures);
  lecturesRef.current = lectures;
  const navigate = useNavigate();

  const [active, setActive] = useState(null);     // { id, state, elapsed, level, queued, failed, health, warning }
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(null);   // { id, title, done, total } while a video or audio file is transcribed
  const [writing, setWriting] = useState({});     // id -> progress text while notes are written
  const [retrying, setRetrying] = useState({});   // id -> {done, total} while missing pieces are retried
  const [queueInfo, setQueueInfo] = useState({}); // id -> { waiting, active, failed, nextAt, error } for lectures with pieces in the queue
  const rec = useRef(null);
  const segMap = useRef({});                      // id -> segments, what has come back (the lecture record can lag behind it)
  const finishing = useRef(new Map());            // id -> { className }: write the notes when the last piece is in
  const retryingRef = useRef({});
  const writingRef = useRef(new Set());           // lectures whose notes are being written right now
  const importRef = useRef(null);
  const meta = useRef({ id: null, className: '' });
  const tick = useRef(null);
  const queueRef = useRef(null);
  const h = useRef({});                           // the queue's callbacks, kept current

  const save = useCallback((id, patch) => actionsRef.current.updateLecture(id, patch).catch(() => {}), []);
  const latest = (id) => lecturesRef.current.find(l => l.id === id) || {};
  const segsOf = (id) => segMap.current[id] ?? latest(id).segments ?? [];
  const putSeg = (id, seg) => {
    const next = [...segsOf(id).filter(s => Math.abs(s.start - seg.start) > 0.01), seg].sort((a, b) => a.start - b.start);
    segMap.current[id] = next;
    return next;
  };

  const writeNotes = useCallback(async (lec, { partial = false } = {}) => {
    // added material has its own text; a recording has its transcript
    const transcript = lec.material_text || transcriptText(lec.segments);
    writingRef.current.add(lec.id);
    setWriting(w => ({ ...w, [lec.id]: 'Writing your notes…' }));
    await save(lec.id, { status: 'writing' });
    try {
      const notes = await generateNotes({
        transcript, myNotes: lec.my_notes, className: lec.class_name, title: lec.title, date: lec.date,
        how: templateHow(lec.template),
        slides: (lec.slides || []).map(d => `Slides${d.name ? ` (${d.name})` : ''}:\n${d.text}`).join('\n\n'),
        outside: allowOutside(),
      }, (msg) => setWriting(w => ({ ...w, [lec.id]: msg })));
      const patch = { notes, status: 'ready', notes_at: new Date().toISOString(), notes_partial: !!partial, notes_error: '' };
      if (lec.auto_title && notes.title) patch.title = notes.title;
      await save(lec.id, patch);
    } catch (e) {
      await save(lec.id, { status: 'transcribed', notes_error: e.message || 'The notes could not be written.' });
      throw e;
    } finally {
      writingRef.current.delete(lec.id);
      setWriting(w => { const n = { ...w }; delete n[lec.id]; return n; });
    }
  }, [save]);

  /** Everything a lecture has been sent for is back (or given up on): write its notes, once. */
  const maybeFinish = async (id) => {
    const s = queueRef.current.stats(id);
    if (s.waiting || s.active) return;
    const f = finishing.current.get(id);
    if (!f) return;
    finishing.current.delete(id);
    const now = latest(id);
    const segments = segsOf(id);
    if (!transcriptText(segments)) {
      await save(id, { status: 'transcribed', notes_error: s.failed
        ? 'The recording is saved on this device, but it couldn’t be transcribed yet.'
        : 'Nothing was heard clearly enough to transcribe. Check that the right microphone is chosen (Settings, Lectures) and that nothing is muted.' });
      return;
    }
    await save(id, { status: 'transcribed' });
    await writeNotes({ ...now, id, segments, class_name: f.className ?? now.class_name }, { partial: s.failed > 0 }).catch(() => {});
  };

  /** The lecture's waiting/failed counts, and the progress of anything that is counting them. */
  const refreshInfo = () => {
    const q = queueRef.current;
    const ids = new Set([...q.items.values()].map(i => i.lectureId));
    const next = {};
    for (const id of ids) next[id] = q.stats(id);
    setQueueInfo(prev => (sameInfo(prev, next) ? prev : next));
    const imp = importRef.current;
    if (imp) {
      const s = q.stats(imp.id);
      setImporting({ ...imp, done: Math.max(0, imp.total - s.waiting - s.active - s.failed) });
    }
    for (const [id, r] of Object.entries(retryingRef.current)) {
      const s = q.stats(id);
      setRetrying(all => ({ ...all, [id]: { total: r.total, done: Math.max(0, r.total - s.waiting - s.active - s.failed) } }));
    }
    setActive(a => {
      const s = a && next[a.id];
      return s ? { ...a, queued: s.waiting + s.active, failed: s.failed } : a;
    });
  };

  if (!queueRef.current) {
    queueRef.current = new TranscribeQueue({
      send: async (p, signal) => {
        const before = transcriptText(segsOf(p.lectureId).filter(s => s.start < p.start)).slice(-300);
        const hint = [p.className, before].filter(Boolean).join(', ');
        return cleanPiece(await transcribeChunk(p.wav, hint, { tries: 1, signal }), p.loudness ?? 1);
      },
      onResult: (p, text) => h.current.result(p, text),
      onFail: (p, e) => h.current.fail(p, e),
      onChange: () => h.current.changed(),
    });
  }
  h.current.result = async (p, text) => {
    const next = putSeg(p.lectureId, { start: p.start, duration: p.duration, text });
    dropPending(p.lectureId, p.start);
    await save(p.lectureId, { segments: next });
    await maybeFinish(p.lectureId);
  };
  h.current.fail = async (p, e) => {
    const next = putSeg(p.lectureId, { start: p.start, duration: p.duration, text: '', error: e.message });
    await save(p.lectureId, { segments: next });
    await maybeFinish(p.lectureId);
  };
  h.current.changed = refreshInfo;
  const queue = queueRef.current;

  /**
   * A piece of the recording: kept on this device first, then queued. Every piece that needs words is
   * kept until it has them (so closing the app or a busy service loses nothing); the whole recording
   * is kept as well, silences included, unless the student turned that off.
   */
  const handleChunk = (lectureId, className, c) => {
    if (wantAudio()) {
      keepAudio(lectureId, c.start, c.duration, c.wav, c.silent).then((ok) => {
        if (!ok) setActive(a => a && { ...a, warning: 'This device is out of space for lecture audio. The lecture is still being transcribed.' });
      });
    }
    if (c.silent) return;
    keepPending(lectureId, c.start, c.duration, c.wav);
    queue.add({ id: pieceId(lectureId, c.start), lectureId, start: c.start, duration: c.duration, wav: c.wav, loudness: c.loudness, className, priority: 1 });
  };

  /** Pieces of a lecture still waiting for their words on this device: failed ones, ones the app was closed on, ones given up on. */
  const missingPieces = useCallback(async (lectureId) => {
    const have = segsOf(lectureId);
    const hasText = (start) => have.some(s => Math.abs(s.start - start) <= 0.01 && s.text);
    return (await listPending(lectureId)).filter(x => !hasText(x.start));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Put a lecture's missing pieces (from storage) in the queue. Returns how many. */
  const enqueueMissing = useCallback(async (lectureId, priority = 0) => {
    const lecture = latest(lectureId);
    const pieces = await missingPieces(lectureId);
    for (const x of pieces) {
      queue.add({ id: pieceId(lectureId, x.start), lectureId, start: x.start, duration: x.duration, wav: x.wav, className: lecture.class_name || '', priority });
    }
    return pieces.length;
  }, [missingPieces, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async ({ className = '', classId = '', title = '', source = 'mic', deviceId } = {}) => {
    if (rec.current) return null;
    setError('');
    unlockAudio();
    if (wantAudio()) keepSafe();
    const now = new Date();
    const lec = await actionsRef.current.addLecture({
      title: title || defaultTitle(className, now),
      auto_title: !title,
      class_name: className, class_id: classId,
      date: ymd(now), started_at: now.toISOString(),
      status: 'recording', duration: 0, segments: [], my_notes: '',
    });
    meta.current = { id: lec.id, className };
    segMap.current[lec.id] = [];
    const r = new LectureRecorder({
      onChunk: (c) => handleChunk(lec.id, className, c),
      onLevel: (level) => setActive(a => a && { ...a, level }),
      onHealth: (health) => setActive(a => a && { ...a, health }),
      onError: (message) => setActive(a => a && { ...a, warning: message }),
    });
    try {
      await r.start({ source, deviceId: deviceId ?? getMicPref() });
    } catch (e) {
      await actionsRef.current.deleteLecture(lec).catch(() => {});
      setError(e.message);
      throw e;
    }
    rec.current = r;
    desktop?.setRecording(true);
    chime('assistantActive', 0.25);
    setActive({ id: lec.id, state: 'recording', elapsed: 0, level: 0, queued: 0, failed: 0, health: { hearing: 'ok', mic: 'ok', audio: 'ok' }, warning: '' });
    const beat = () => { try { localStorage.setItem(HEARTBEAT, JSON.stringify({ id: lec.id, at: Date.now() })); } catch (_) {} };
    beat();
    tick.current = setInterval(() => { setActive(a => a && { ...a, elapsed: r.elapsed }); beat(); }, 500);
    navigate(`/Notes?id=${lec.id}`);
    return lec;
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => { rec.current?.pause(); setActive(a => a && { ...a, state: 'paused' }); }, []);
  const resume = useCallback(() => { rec.current?.resume(); setActive(a => a && { ...a, state: 'recording' }); }, []);

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    desktop?.setRecording(false);
    clearInterval(tick.current);
    try { localStorage.removeItem(HEARTBEAT); } catch (_) {}
    const { id, className } = meta.current;
    setActive(a => a && { ...a, state: 'finishing', elapsed: r.elapsed });
    await r.stop();                                   // the last piece is in the queue by now
    chime('breakEnd', 0.25);
    await save(id, { duration: Math.round(r.elapsed), status: 'transcribing' });
    finishing.current.set(id, { className });
    // Wait for the queue, but not for ever: if the service isn't answering, the audio is safe on this
    // device and the queue goes on trying in the background; the notes are written when it's back.
    const res = await queue.settled(id, { stallMs: 45000 });
    setActive(null);
    if (res.outcome === 'stalled') {
      await save(id, { status: 'transcribed' });
      return;
    }
    await maybeFinish(id);
  }, [save]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A video or audio file the student already has (a recorded class, a
   * lesson video) becomes a lecture: the sound is decoded in the browser,
   * cut at the pauses like a live recording, transcribed, and turned into
   * notes, after which the assistant can answer questions about it like any
   * other lecture.
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
    const pcm = resample(mono, decoded.sampleRate);
    const now = new Date();
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported video';
    const lec = await actionsRef.current.addLecture({
      title, auto_title: false, class_name: className, class_id: classId,
      date: ymd(now), started_at: now.toISOString(), status: 'transcribing',
      duration: Math.round(pcm.length / SAMPLE_RATE), segments: [], my_notes: '', source: 'import',
    });
    // cut at the pauses, as a live recording is
    const cutter = new PauseCutter();
    const pieces = [];
    for (let at = 0; at < pcm.length; at += SAMPLE_RATE) pieces.push(...cutter.push(pcm.subarray(at, at + SAMPLE_RATE)));
    const rest = cutter.flush();
    if (rest) pieces.push(rest);
    const segments = [];
    const toSend = [];
    let startAt = 0;
    for (const p of pieces) {
      const duration = p.length / SAMPLE_RATE;
      if (isSilent(p)) segments.push({ start: startAt, duration, text: '' });
      else toSend.push({ start: startAt, duration, wav: encodeWav(levelSpeech(p)) });
      startAt += duration;
    }
    segMap.current[lec.id] = segments;
    await save(lec.id, { segments });
    finishing.current.set(lec.id, { className });
    importRef.current = { id: lec.id, title, done: 0, total: toSend.length };
    setImporting(importRef.current);
    try {
      for (const p of toSend) {
        keepPending(lec.id, p.start, p.duration, p.wav);
        queue.add({ id: pieceId(lec.id, p.start), lectureId: lec.id, start: p.start, duration: p.duration, wav: p.wav, className, priority: 0 });
      }
      await queue.settled(lec.id, { stallMs: 120000 });
    } finally {
      importRef.current = null;
      setImporting(null);
    }
    await maybeFinish(lec.id);
    return lec;
  }, [save]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Try the pieces of a lecture that haven't been transcribed again, now. Their audio is kept on this
   * device, so this works days later too. Returns {done, left, error}.
   */
  const retryFailed = useCallback(async (lectureId) => {
    const id = lectureId || meta.current.id;
    const live = !!rec.current && id === meta.current.id;
    retryingRef.current = { ...retryingRef.current, [id]: { total: 0 } };
    setRetrying(r => ({ ...r, [id]: { done: 0, total: 0 } }));
    try {
      await enqueueMissing(id, live ? 1 : 0);
      queue.retry(id);
      const before = queue.stats(id);
      const total = before.waiting + before.active + before.failed;
      retryingRef.current[id] = { total };
      setRetrying(r => ({ ...r, [id]: { done: 0, total } }));
      const lecture = latest(id);
      if (!live && (lecture.notes_partial || !lecture.notes)) finishing.current.set(id, { className: lecture.class_name });
      await queue.settled(id, { stallMs: 60000 });
      const after = queue.stats(id);
      const left = after.waiting + after.active + after.failed;
      return { done: Math.max(0, total - left), left, error: left ? (after.error || 'The transcription service isn’t answering yet.') : '' };
    } finally {
      const rest = { ...retryingRef.current };
      delete rest[id];
      retryingRef.current = rest;
      setRetrying(r => { const n = { ...r }; delete n[id]; return n; });
    }
  }, [enqueueMissing, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  /** How many pieces of a lecture are waiting on this device to be transcribed. */
  const pendingCount = useCallback(async (lectureId) => (await missingPieces(lectureId)).length, [missingPieces]);

  /** Send the audio heard since the last piece and wait until the transcript has it, for "catch me up". */
  const flushNow = useCallback(async () => {
    rec.current?.flushNow();
    await Promise.race([queue.settled(meta.current.id, { stallMs: 9000 }), new Promise(r => setTimeout(r, 9000))]);
  }, [queue]);

  /** The audio kept for a lecture: { pieces, seconds, bytes }. */
  const audioInfo = useCallback((id) => audioSummary(id), []);
  /** The whole recording as one WAV file (a Blob), or null if none is kept here. */
  const audioFile = useCallback(async (id) => {
    const pieces = await listAudio(id);
    return pieces.length ? new Blob([joinWav(pieces.map(p => p.wav))], { type: 'audio/wav' }) : null;
  }, []);
  const deleteAudio = useCallback((id) => dropAudio(id), []);
  /** A lecture was deleted: stop transcribing it and clear what is kept for it on this device. */
  const forget = useCallback((id) => { queue.remove(id); finishing.current.delete(id); return dropLecture(id); }, [queue]);

  // Pieces that never got their words (the app was closed, the service was down): put them back in the queue
  // when the app opens, and every few minutes after. A recording that was cut off mid-way (a dead battery) is finished off.
  const resumeAll = useCallback(async () => {
    const waiting = new Set(await pendingLectureIds());       // lectures with pieces still to transcribe on this device
    for (const l of lecturesRef.current) {
      if (rec.current && meta.current.id === l.id) continue;
      const hasPending = waiting.has(l.id);
      let stale = false;
      if (l.status === 'recording') {
        let beat = null;
        try { beat = JSON.parse(localStorage.getItem(HEARTBEAT) || 'null'); } catch (_) {}
        if (beat?.id === l.id && Date.now() - beat.at < 20000) continue;                    // being recorded in another tab
        stale = hasPending || (await audioSummary(l.id)).pieces > 0;                         // recorded on this device
        if (!stale) continue;
      } else if (l.status === 'writing') {
        // the app was closed while the notes were being written: let the student ask for them again
        if (!writingRef.current.has(l.id)) await save(l.id, { status: l.notes ? 'ready' : 'transcribed' });
        continue;
      } else if (!(hasPending || l.status === 'transcribing')) continue;
      const n = hasPending ? await enqueueMissing(l.id, 0) : 0;
      if (stale) {
        const sum = await audioSummary(l.id);
        await save(l.id, { status: 'transcribing', duration: l.duration || Math.round(sum.seconds) });
      }
      const needsNotes = stale || !l.notes || l.notes_partial;
      if (needsNotes && (n || stale || l.status === 'transcribing')) {
        finishing.current.set(l.id, { className: l.class_name });
        if (!n) await maybeFinish(l.id);                                                // nothing to wait for: the notes now
      } else if (l.status === 'transcribing' && !n) {
        await save(l.id, { status: 'transcribed' });
      }
    }
  }, [enqueueMissing, save]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = lectures.length > 0;
  useEffect(() => {
    if (!loaded) return undefined;
    resumeAll().catch(() => {});
    const again = setInterval(() => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (queue.stats().failed) queue.retry();
      resumeAll().catch(() => {});
    }, 180000);
    const back = () => queue.kick();
    window.addEventListener('online', back);
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(again); window.removeEventListener('online', back); document.removeEventListener('visibilitychange', back); };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audio left behind by lectures that were deleted (on this or another device). Only old audio, and only
  // when lectures have loaded at all, so a bad connection can never be taken for "everything was deleted".
  useEffect(() => {
    if (!loaded) return;
    audioIndex().then((all) => {
      const ids = new Set(lecturesRef.current.map(l => l.id));
      for (const x of all) if (!ids.has(x.lectureId) && Date.now() - (x.at || 0) > 86400000) dropLecture(x.lectureId);
    }).catch(() => {});
  }, [loaded]);

  // Leaving (sign-out) mid-recording: stop the microphone.
  useEffect(() => () => { clearInterval(tick.current); rec.current?.stop(); queue.pause(); }, [queue]);

  // Closing the tab mid-recording asks first.
  useEffect(() => {
    if (!active) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [!!active]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Material the student adds to a class themselves, a handout, slides, a
   * photo of the board, a study guide, or text they paste. Files are read
   * once by the AI (everything they teach, diagrams described in words) and
   * kept as text, so they don't fill up the account; then notes are written
   * from it like a lecture's. It lives with the class's lectures, so it can
   * be asked about and quizzed on. `onProgress(text)` reports each step.
   */
  const addMaterial = useCallback(async ({ title = '', className = '', classId = '', text = '', files = [] } = {}, onProgress) => {
    const parts = [];
    if (text.trim()) parts.push(text.trim());
    for (const f of files) {
      onProgress?.(`Reading ${f.name}…`);
      if (/^text\/|\.(txt|md|csv)$/i.test(f.type || f.name)) {
        parts.push(`${f.name}\n${(await f.text()).trim()}`);
        continue;
      }
      if (!/^image\/|application\/pdf/.test(f.type)) throw new Error(`${f.name}: add a PDF, a photo or a text file.`);
      const { file_url } = await db.integrations.Core.UploadFile({ file: f });
      const out = await db.integrations.Core.InvokeLLM({ feature: 'notes', prompt: EXTRACT_PROMPT, file_urls: [file_url] });
      if (String(out || '').trim()) parts.push(`${f.name}\n${String(out).trim()}`);
    }
    const material = parts.join('\n\n').slice(0, MATERIAL_MAX_CHARS);
    if (material.trim().length < 20) throw new Error('There’s nothing in that to keep, add a file, or paste some notes.');
    const now = new Date();
    const name = title.trim() || files[0]?.name?.replace(/\.[^.]+$/, '') || 'Class material';
    const lec = await actionsRef.current.addLecture({
      title: name.slice(0, 120), auto_title: false, class_name: className, class_id: classId,
      date: ymd(now), started_at: now.toISOString(), status: 'transcribed', duration: 0,
      segments: [], my_notes: '', source: 'material', material_text: material,
    });
    onProgress?.('Writing notes from it…');
    await writeNotes({ ...lec, material_text: material, class_name: className }).catch(() => {});
    return lec;
  }, [writeNotes]);

  /**
   * Slides for a lecture (PDF or photos): read once by the AI into labelled text
   * and kept with the lecture, so notes and answers can use and cite them.
   * Returns the lecture's updated slide list.
   */
  const addSlides = useCallback(async (lec, files, onProgress) => {
    const decks = [...(lec.slides || [])];
    for (const f of files) {
      if (!/^image\/|application\/pdf/.test(f.type)) throw new Error(`${f.name}: add the slides as a PDF or photos.`);
      if (f.size > 4 * 1024 * 1024) throw new Error(`${f.name} is over 4 MB. Export the slides as a smaller PDF, or add them a few pages at a time.`);
      onProgress?.(`Reading ${f.name}…`);
      const { file_url } = await db.integrations.Core.UploadFile({ file: f });
      const text = String(await db.integrations.Core.InvokeLLM({ feature: 'notes', prompt: SLIDES_PROMPT, file_urls: [file_url] }) || '').trim();
      if (text) decks.push({ name: f.name.replace(/\.[^.]+$/, ''), text: text.slice(0, 40000), added: new Date().toISOString() });
    }
    await actionsRef.current.updateLecture(lec.id, { slides: decks });
    return decks;
  }, []);

  const removeSlides = useCallback((lec, i) => {
    const decks = (lec.slides || []).filter((_, k) => k !== i);
    return actionsRef.current.updateLecture(lec.id, { slides: decks });
  }, []);

  const value = {
    canRecord, active, error, writing, importing, retrying, queueInfo, importMedia, addMaterial, addSlides, removeSlides,
    start, pause, resume, stop, retryFailed, pendingCount, flushNow, writeNotes, audioInfo, audioFile, deleteAudio, forget,
    hasFailed: (active?.failed || 0) > 0,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLecture() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLecture must be used inside LectureProvider');
  return v;
}
