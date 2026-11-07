/**
 * Lecture audio, kept on this device (IndexedDB). Nothing here leaves the
 * device except to be transcribed.
 *
 *  - `audio` holds every piece of a recording as it was heard, so the whole
 *    lecture can be played back, saved as a file, or transcribed again later.
 *    It is the person's choice (Settings, "Keep lecture audio on this
 *    device") and each lecture's audio can be deleted on its own.
 *  - `pending` holds every piece that is waiting to be transcribed, whatever
 *    that choice: a piece goes in as it is recorded and comes out when its
 *    words are saved, so the AI service being down, or the app being closed,
 *    never loses part of a class. It is what is picked up again later.
 *  - `meta` is a small summary per lecture (pieces, seconds, bytes), so the
 *    page can say how much is kept without reading the audio.
 */
const DB = 'lockin-audio';
const PENDING = 'pending';
const AUDIO = 'audio';
const META = 'meta';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      for (const name of [PENDING, AUDIO, META]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Run `work(...stores)` in one transaction; resolves with a request's result, or what `work` returned. */
async function run(names, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let out;
    try { out = work(...names.map(n => t.objectStore(n))); } catch (e) { db.close(); reject(e); return; }
    t.oncomplete = () => { db.close(); resolve(out && typeof out === 'object' && 'result' in out ? out.result : out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error || new Error('aborted')); };
  });
}

const key = (lectureId, start) => `${lectureId}|${Number(start).toFixed(2)}`;
const range = (lectureId) => IDBKeyRange.bound(`${lectureId}|`, `${lectureId}|￿`);

/* --------------------------------------------------- pieces still to transcribe */

export async function keepPending(lectureId, start, duration, wav) {
  try { await run([PENDING], 'readwrite', s => s.put({ lectureId, start, duration, wav }, key(lectureId, start))); } catch (_) {}
}

export async function dropPending(lectureId, start) {
  try { await run([PENDING], 'readwrite', s => s.delete(key(lectureId, start))); } catch (_) {}
}

/** [{start, duration, wav}] for one lecture, in order. */
export async function listPending(lectureId) {
  try {
    const all = await run([PENDING], 'readonly', s => s.getAll(range(lectureId)));
    return (all || []).sort((a, b) => a.start - b.start);
  } catch (_) { return []; }
}

/** The ids of lectures that have pieces waiting to be transcribed here (reads only the keys, so it's cheap). */
export async function pendingLectureIds() {
  try {
    const keys = await run([PENDING], 'readonly', s => s.getAllKeys());
    return [...new Set((keys || []).map(k => String(k).split('|')[0]))];
  } catch (_) { return []; }
}

/* ---------------------------------------------------- the whole recording */

/** Is keeping the audio switched on? It is, unless the person turned it off. */
export function wantAudio() {
  try { return localStorage.getItem('lockin.keepAudio') !== 'off'; } catch (_) { return true; }
}
export function setWantAudio(on) {
  try { localStorage.setItem('lockin.keepAudio', on ? 'on' : 'off'); } catch (_) {}
}

/** Ask the browser not to clear this device's stored audio when it is short of space. Harmless if refused. */
export function keepSafe() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch (_) {}
}

/**
 * Store one piece of the recording. `silent` pieces were never sent to be transcribed, so they
 * are not "missing" later. Resolves false if it couldn't be kept (the device is full), true otherwise.
 */
export async function keepAudio(lectureId, start, duration, wav, silent = false) {
  try {
    await run([AUDIO, META], 'readwrite', (audio, meta) => {
      audio.put({ lectureId, start, duration, wav, silent: !!silent }, key(lectureId, start));
      const had = meta.get(lectureId);
      had.onsuccess = () => {
        const m = had.result || { pieces: 0, seconds: 0, bytes: 0 };
        meta.put({ pieces: m.pieces + 1, seconds: m.seconds + duration, bytes: m.bytes + wav.length, at: Date.now() }, lectureId);
      };
    });
    return true;
  } catch (_) { return false; }
}

/** [{ lectureId, at, bytes, seconds }] for every lecture with audio kept here, so audio left behind by deleted lectures can be tidied up. */
export async function audioIndex() {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const t = db.transaction([META], 'readonly');
      const s = t.objectStore(META);
      const keys = s.getAllKeys();
      const vals = s.getAll();
      t.oncomplete = () => { db.close(); resolve((keys.result || []).map((k, i) => ({ lectureId: k, ...(vals.result?.[i] || {}) }))); };
      t.onerror = t.onabort = () => { db.close(); resolve([]); };
    });
  } catch (_) { return []; }
}

/** [{start, duration, wav}] of the whole recording, in order. */
export async function listAudio(lectureId) {
  try {
    const all = await run([AUDIO], 'readonly', s => s.getAll(range(lectureId)));
    return (all || []).sort((a, b) => a.start - b.start);
  } catch (_) { return []; }
}

/** { pieces, seconds, bytes } of the audio kept for a lecture (all zero if none). */
export async function audioSummary(lectureId) {
  try {
    const m = await run([META], 'readonly', s => s.get(lectureId));
    return m || { pieces: 0, seconds: 0, bytes: 0 };
  } catch (_) { return { pieces: 0, seconds: 0, bytes: 0 }; }
}

export async function dropAudio(lectureId) {
  try { await run([AUDIO, META], 'readwrite', (audio, meta) => { audio.delete(range(lectureId)); meta.delete(lectureId); }); } catch (_) {}
}

/** Everything kept for a lecture: its audio and its untranscribed pieces. */
export async function dropLecture(lectureId) {
  try {
    await run([PENDING, AUDIO, META], 'readwrite', (pending, audio, meta) => {
      pending.delete(range(lectureId));
      audio.delete(range(lectureId));
      meta.delete(lectureId);
    });
  } catch (_) {}
}
