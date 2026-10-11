/**
 * An instant "Hey Lock In" for the desktop app.
 *
 * Whisper writes down a finished piece of speech, so hearing the wake phrase
 * through it means waiting for the person to say 1.3 s of it, then waiting for
 * Whisper: about two seconds. The browser-based tools wake on the first words
 * because Chrome's recogniser streams. Electron has no such service, so this is
 * the on-device equivalent: Vosk, a small speech model that works on a live
 * stream and answers every ~100 ms, held to a short list of phrases (the same
 * ones the Android app listens for), so it is both quick and hard to fool.
 *
 * It only spots the wake phrase. What's said after it is still written down
 * by Whisper, which is far more accurate. If the model can't be fetched the
 * caller just keeps using Whisper for the wake phrase, as before.
 *
 * The model (41 MB, downloaded once, then kept in the browser's cache) is
 * fetched from the vosk-browser project's public mirror. Only the model comes
 * down; no audio goes anywhere.
 */
import { findWake } from './wake.js';
import { isDismissal, STOP_PHRASES } from './dismiss.js';

const MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const CACHE = 'lockin-wake-model-v1';
const RATE = 16000;
// What people say, and how recognisers hear "lock in". Anything else is [unk].
const GRAMMAR = JSON.stringify([
  'hey lock in', 'hey locking', 'hey look in', 'hey log in', 'hey luck in', 'hay lock in', 'hi lock in',
  'okay lock in', 'ok lock in', 'okay locking', 'hello lock in', 'hey locked in', 'hey lock it', 'hey lockin',
  ...STOP_PHRASES, '[unk]',     // "stop" is heard too, so the assistant can be told to be quiet while it talks
]);

/** The model's bytes as a blob: URL, from the cache if we've fetched it before. */
async function modelBlobUrl(onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (_) { /* private window: just don't keep it */ }
  let res = cache ? await cache.match(MODEL_URL) : null;
  if (!res) {
    const net = await fetch(MODEL_URL);
    if (!net.ok) throw new Error(`The wake-word model could not be downloaded (${net.status}).`);
    const total = Number(net.headers.get('content-length')) || 41e6;
    const reader = net.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress?.(Math.min(0.99, got / total));
    }
    const blob = new Blob(parts, { type: 'application/gzip' });
    if (cache) { try { await cache.put(MODEL_URL, new Response(blob, { headers: { 'content-type': 'application/gzip' } })); } catch (_) { /* quota */ } }
    return URL.createObjectURL(blob);
  }
  return URL.createObjectURL(await res.blob());
}

const toFloat = (pcm) => {
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
  return f;
};

export class WakeSpotter {
  /** onWake() fires the moment the phrase is heard; onNote({state, progress}) reports the first download. */
  constructor({ onWake, onNote, onStop } = {}) {
    this.onWake = onWake;
    this.onStop = onStop;
    this.onNote = onNote;
    this.ready = false;
    this.lastFire = 0;
    this.failed = false;
    this.model = null;
    this.rec = null;
    this.stopped = false;
  }

  async load() {
    try {
      this.onNote?.({ state: 'downloading', progress: 0 });
      const url = await modelBlobUrl((p) => this.onNote?.({ state: 'downloading', progress: p }));
      if (this.stopped) return false;
      this.onNote?.({ state: 'loading', progress: 1 });
      const { createModel } = await import('vosk-browser');     // 6 MB of WebAssembly: only loaded when needed
      this.model = await createModel(url);
      URL.revokeObjectURL(url);
      if (this.stopped) { this.model.terminate(); return false; }
      this.rec = new this.model.KaldiRecognizer(RATE, GRAMMAR);
      this.rec.on('partialresult', (m) => this._heard(m?.result?.partial));
      this.rec.on('result', (m) => this._heard(m?.result?.text));
      this.ready = true;
      this.onNote?.({ state: 'ready' });
      return true;
    } catch (e) {
      this.failed = true;
      this.onNote?.({ state: 'ready' });
      return false;
    }
  }

  /** 16 kHz 16-bit audio, in whatever sized pieces the microphone gives. */
  feed(pcm) {
    if (!this.ready || this.stopped) return;
    try { this.rec.acceptWaveformFloat(toFloat(pcm), RATE); } catch (_) { /* a hiccup: the next piece will do */ }
  }

  _heard(text) {
    if (text && !findWake(text) && isDismissal(text)) {
      const now = Date.now();
      if (now - (this.lastStop || 0) > 1500) { this.lastStop = now; this.onStop?.(); }
      return;
    }
    if (!text || !findWake(text)) return;
    const now = Date.now();
    if (now - this.lastFire < 2500) return;        // one phrase shows up in many partial results
    this.lastFire = now;
    this.onWake?.();
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    try { this.rec?.remove(); } catch (_) { /* already gone */ }
    try { this.model?.terminate(); } catch (_) { /* already gone */ }
    this.rec = this.model = null;
  }
}
