/**
 * An instant "Hey Companion" for the desktop app.
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
import { Ring, hasVoiceprint, soundsLikeYou } from './voiceprint.js';

const MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const CACHE = 'lockin-wake-model-v1';
const RATE = 16000;
// The wake phrase and nothing like it. A grammar this small makes the model force whatever it
// hears onto one of these lines, which is why "[unk]" is there to soak up everything else, why
// the wake-up has to be the whole phrase, and why it is checked against your voice.
const GRAMMAR = JSON.stringify([
  'hey companion', 'hi companion', 'hello companion', 'okay companion', 'ok companion',
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
  constructor({ onWake, onNote, onStop, onReject } = {}) {
    this.onWake = onWake;
    this.onReject = onReject;
    this.onStop = onStop;
    this.onNote = onNote;
    this.ready = false;
    this.lastFire = 0;
    this.failed = false;
    this.model = null;
    this.rec = null;
    this.stopped = false;
    this.ring = new Ring(3);          // what was just said, to check it against the trained voice
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
      this.rec.on('partialresult', (m) => this._heard(m?.result?.partial, true));
      this.rec.on('result', (m) => { this._heard(m?.result?.text, false); this.lastPartial = ''; });
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
    this.ring.push(pcm);
    if (!this.ready || this.stopped) return;
    try { this.rec.acceptWaveformFloat(toFloat(pcm), RATE); } catch (_) { /* a hiccup: the next piece will do */ }
  }

  _heard(text, partial) {
    if (text && !findWake(text) && isDismissal(text)) {
      const now = Date.now();
      if (now - (this.lastStop || 0) > 1500) { this.lastStop = now; this.onStop?.(); }
      return;
    }
    // A partial is a guess that changes as more sound arrives: it has to name the phrase on two
    // reads running before it counts (the Android app does the same). A final result counts at once.
    const said = text && findWake(text) ? text.replace(/\[unk\]/g, '').trim() : '';
    const steady = !partial || (said !== '' && said === this.lastPartial);
    if (partial) this.lastPartial = said;
    if (!said || !steady) return;
    const now = Date.now();
    if (now - this.lastFire < 2500) return;        // one phrase shows up in many partial results
    this.lastFire = now;
    if (!hasVoiceprint()) { this.onWake?.(); return; }
    // The model calls it as the last syllable starts: give the audio a moment to catch up, then
    // compare what was said with the trained recordings. Not you, or not the phrase: ignored.
    setTimeout(() => {
      if (this.stopped) return;
      if (soundsLikeYou(this.ring.read()).ok) this.onWake?.();
      else this.onReject?.();
    }, 350);
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    try { this.rec?.remove(); } catch (_) { /* already gone */ }
    try { this.model?.terminate(); } catch (_) { /* already gone */ }
    this.rec = this.model = null;
  }
}
