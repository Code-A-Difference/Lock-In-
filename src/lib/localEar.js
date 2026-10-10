/**
 * Listening on the device itself, for the desktop app and the Android app: "Hey Lock In", the
 * assistant's push-to-talk, and its conversation all go through the same
 * Whisper engine (whisper.cpp) that transcribes classes: turbo on a fast
 * computer, small where turbo would keep you waiting (desktop/main.js,
 * earModel). Nothing is sent to a speech service.
 *
 * Whisper transcribes a finished piece of sound, not a live stream, so the
 * microphone is cut into utterances here: a loudness detector that follows
 * the room's own background level opens an utterance when someone starts
 * speaking (keeping a moment of sound from just before) and closes it after
 * a short pause. Each utterance becomes a 16 kHz WAV for the engine. The
 * engine's own voice detector (Silero) then ignores anything that wasn't
 * speech, so a door or a cough doesn't turn into words.
 *
 * The browser's SpeechRecognition can't be used here: Electron has the API
 * but no speech service behind it.
 *
 * Segmenter is pure, so tests/localEar.test.mjs runs it in Node.
 */
import { SAMPLE_RATE, downsample, encodeWav, rms, enhanceSpeech } from './recorder.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { desktop, isDesktop } from './desktop.js';

// Android app 1.3+: whisper.cpp on the phone (android/.../WhisperPlugin.java). Older
// installs load this same web code, so only use it if the app really has it.
export const phoneWhisper = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('Whisper')
  ? registerPlugin('Whisper') : null;

const FRAME = 1024;                       // samples per detector step at 16 kHz: 64 ms

/**
 * Feed it 16-bit PCM in any sized pieces; it calls onStart() when speech
 * begins and onUtterance(pcm) when it ends.
 */
export class Segmenter {
  constructor({ onUtterance, onStart, onPeek, rate = SAMPLE_RATE, endMs = 600, maxMs = 15000, minMs = 350, preMs = 300, peekMs = 1300 } = {}) {
    this.onUtterance = onUtterance;
    this.onStart = onStart;
    // "Hey Lock In" takes under a second to say: hand over the first ~1.3 s of speech so it can
    // be recognised (and the chime played) while the person is still talking.
    this.onPeek = onPeek;
    this.peekFrames = Math.ceil(peekMs / 64);
    this.frame = Math.round(rate * FRAME / SAMPLE_RATE);
    this.endFrames = Math.ceil(endMs / 64);
    this.maxFrames = Math.ceil(maxMs / 64);
    this.minFrames = Math.ceil(minMs / 64);
    this.preFrames = Math.ceil(preMs / 64);
    this.floor = 0.004;                   // the room's quiet level, learnt as it goes
    this.pending = new Int16Array(0);
    this.pre = [];                        // the last few quiet frames, so the first syllable isn't cut
    this.cur = null;                      // frames of the utterance being heard
    this.loud = 0;                        // consecutive loud frames (two in a row start an utterance)
    this.quiet = 0;                       // consecutive quiet frames inside an utterance
    this.voiced = 0;                      // loud frames in the utterance
  }

  /** Loud enough to be someone talking: well above the background, and above a floor. */
  isLoud(level) { return level > Math.max(0.006, this.floor * 2.8); }

  push(pcm) {
    const all = new Int16Array(this.pending.length + pcm.length);
    all.set(this.pending); all.set(pcm, this.pending.length);
    let at = 0;
    for (; at + this.frame <= all.length; at += this.frame) this._step(all.subarray(at, at + this.frame));
    this.pending = all.slice(at);
  }

  _step(f) {
    const level = rms(f);
    const loud = this.isLoud(level);
    if (!this.cur) {
      // the background level follows quiet frames quickly and loud ones slowly
      this.floor = loud ? this.floor * 0.999 + level * 0.001 : this.floor * 0.95 + level * 0.05;
      this.pre.push(f);
      if (this.pre.length > this.preFrames + 1) this.pre.shift();
      this.loud = loud ? this.loud + 1 : 0;
      if (this.loud >= 2) {
        this.cur = this.pre.slice();
        this.peeked = false;
        this.pre = [];
        this.quiet = 0;
        this.voiced = 2;
        this.onStart?.();
      }
      return;
    }
    this.cur.push(f);
    if (loud) { this.quiet = 0; this.voiced++; } else this.quiet++;
    // only while they're still talking: a short phrase that already ended is handed over whole anyway
    if (this.onPeek && !this.peeked && loud && this.cur.length >= this.peekFrames) { this.peeked = true; this.onPeek(this._join(this.cur)); }
    if (this.quiet >= this.endFrames || this.cur.length >= this.maxFrames) this.flush();
  }

  /** End the utterance now (a pause, the length cap, or the caller stopping). True if one was handed over. */
  flush() {
    const frames = this.cur;
    this.cur = null;
    this.loud = 0;
    if (!frames || this.voiced < this.minFrames) return false;
    this.onUtterance?.(this._join(frames));
    return true;
  }

  _join(frames) {
    const out = new Int16Array(frames.reduce((s, f) => s + f.length, 0));
    let o = 0;
    for (const f of frames) { out.set(f, o); o += f.length; }
    return out;
  }
}

/* ------------------------------------------------------------ the engine */

let readyCache = null;

/** Is the on-device engine set up (switched on, a model downloaded)? Cached for a minute. */
export function localReady() {
  if (readyCache && Date.now() - readyCache.at < 60000) return readyCache.p;
  let p;
  if (phoneWhisper) {
    p = phoneWhisper.status().then(s => !!(s?.available && s.enabled !== false && s.using)).catch(() => false);
  } else if (isDesktop && desktop?.whisper?.status && desktop.transcribe) {
    p = desktop.whisper.status()
      .then(s => !!(s?.available && s.settings?.enabled !== false && Object.values(s.models || {}).some(m => m.installed)))
      .catch(() => false);
  } else return Promise.resolve(false);
  readyCache = { at: Date.now(), p };
  return p;
}
export const forgetReady = () => { readyCache = null; };
export const canHearLocally = !!phoneWhisper || (isDesktop && !!desktop?.transcribe);

/** WAV bytes -> base64, for the phone's plugin bridge. */
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Bracketed noise tags Whisper writes for silence and sounds — never words. */
export const cleanHeard = (t) => String(t || '')
  .replace(/[[(]\s*(BLANK_AUDIO|MUSIC|NOISE|SILENCE|inaudible|unintelligible|indistinct[^\])]*)\s*[\])]/gi, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * One WAV through whichever on-device engine this is. Resolves to the text, or
 * null when it isn't set up (switched off, no model) so the caller can use the
 * online service or the phone's recogniser instead. Throws on a real failure.
 */
export async function transcribeOnDevice(wav, hint = '', { phrase = false } = {}) {
  if (phoneWhisper) {
    try {
      const r = await phoneWhisper.transcribe({ wav: b64(wav), hint });
      return cleanHeard(r?.text);
    } catch (e) {
      if (/^(off|no-model|not-available)$/.test(e?.message || '')) { readyCache = null; return null; }
      throw e;
    }
  }
  if (!isDesktop) return null;
  // desktop 1.0.2+ has a quick lane for phrases; older apps share the class transcriber
  const r = await (phrase && desktop.hear ? desktop.hear(wav, hint) : desktop.transcribe(wav, hint));
  if (r?.ok) return r.text;
  if (r?.error === 'off' || r?.error === 'no-model') { readyCache = null; return null; }
  throw new Error(r?.error || 'On-device transcription failed.');
}

// Spelling the name helps Whisper write "Lock In" rather than "locking". Not "Hey Lock In, ":
// Whisper reads the hint as words already said, and then leaves the wake phrase out.
const HINT = 'Glossary: Lock In (the study app).';

/** One utterance -> its words, on this device. '' when nothing was said. */
export async function hearLocally(pcm, hint = HINT) {
  const text = await transcribeOnDevice(encodeWav(enhanceSpeech(pcm)), hint, { phrase: true });
  if (text === null) throw Object.assign(new Error('On-device listening is off.'), { off: true });
  return String(text).trim();
}

/**
 * The microphone, cut into utterances. onUtterance(pcm) for each one;
 * onSpeech(true|false) as speaking starts and the utterance is handed over.
 */
export class LocalEar {
  constructor({ onUtterance, onSpeech, onError, onPeek } = {}) {
    this.onUtterance = onUtterance;
    this.onPeek = onPeek;
    this.onSpeech = onSpeech;
    this.onError = onError;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      // Echo cancellation keeps the assistant's own voice out; no noise suppression, which
      // treats a faraway voice as noise (see recorder.js).
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      this.running = false;
      throw new Error(e?.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it for LOCK IN!, then try again.'
        : 'No microphone could be opened.');
    }
    if (!this.running) { this.stream.getTracks().forEach(t => t.stop()); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.seg = new Segmenter({
      onStart: () => this.onSpeech?.(true),
      onPeek: this.onPeek ? (pcm) => this.onPeek(pcm) : null,
      onUtterance: (pcm) => { this.onSpeech?.(false); this.onUtterance?.(pcm); },
    });
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (this.running) this.seg.push(downsample(e.inputBuffer.getChannelData(0), this.ctx.sampleRate));
    };
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.src.connect(this.node);
    this.node.connect(this.mute);
    this.mute.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Hand over what's been said so far (push-to-talk's stop button). */
  flush() { return !!this.seg?.flush(); }

  stop() {
    this.running = false;
    try { this.node && (this.node.onaudioprocess = null); } catch (_) {}
    try { this.src?.disconnect(); this.node?.disconnect(); this.mute?.disconnect(); } catch (_) {}
    this.ctx?.close().catch(() => {});
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx = this.stream = this.node = this.src = this.mute = this.seg = null;
  }
}

/**
 * Push-to-talk on this computer: listen for one utterance, transcribe it.
 * Same shape as listen.js's listenOnce: { promise, stop }.
 */
export function listenOnceLocally({ onInterim, onSpeech, quietMs = 8000 } = {}) {
  let ear = null, timer = null, done = false, finish = () => {};
  const promise = new Promise((resolve, reject) => {
    finish = (err, text = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ear?.stop();
      if (err) reject(err); else resolve(text);
    };
    ear = new LocalEar({
      onSpeech: (on) => { if (on) { clearTimeout(timer); onSpeech?.(true); onInterim?.('…'); } },
      onUtterance: (pcm) => {
        ear.stop();
        hearLocally(pcm).then(t => { onSpeech?.(false); onInterim?.(t); finish(null, t); },
          e => { onSpeech?.(false); finish(e); });
      },
    });
    ear.start().then(() => {
      if (!done) timer = setTimeout(() => finish(null, ''), quietMs);     // nobody said anything
    }, e => finish(e));
  });
  // Stopping mid-sentence sends what was said so far; before anyone spoke, it's just ''.
  const stop = () => {
    clearTimeout(timer);
    if (!ear?.flush()) finish(null, '');
  };
  return { promise, stop };
}
