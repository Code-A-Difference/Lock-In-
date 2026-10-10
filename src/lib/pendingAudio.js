/**
 * Pieces of a recording that couldn't be transcribed yet, kept on this
 * device (IndexedDB) so they can be retried later, after the AI service
 * comes back, or after the app was closed. Once a piece is transcribed its
 * audio is deleted. Nothing here leaves the device except to be transcribed.
 */
const DB = 'lockin-audio';
const STORE = 'pending';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

const key = (lectureId, start) => `${lectureId}|${Number(start).toFixed(2)}`;

export async function keepPending(lectureId, start, duration, wav) {
  try { await tx('readwrite', s => s.put({ lectureId, start, duration, wav }, key(lectureId, start))); } catch (_) {}
}

export async function dropPending(lectureId, start) {
  try { await tx('readwrite', s => s.delete(key(lectureId, start))); } catch (_) {}
}

/** [{start, duration, wav}] for one lecture, in order. */
export async function listPending(lectureId) {
  try {
    const all = await tx('readonly', s => s.getAll(IDBKeyRange.bound(`${lectureId}|`, `${lectureId}|￿`)));
    return (all || []).sort((a, b) => a.start - b.start);
  } catch (_) { return []; }
}

export async function dropLecture(lectureId) {
  try { await tx('readwrite', s => s.delete(IDBKeyRange.bound(`${lectureId}|`, `${lectureId}|￿`))); } catch (_) {}
}
