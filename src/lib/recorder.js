/**
 * Recording a lecture, in pieces the AI can transcribe one at a time.
 *
 * The microphone is read as raw samples (not MediaRecorder): every browser,
 * including the iPhone and Android app wrappers, records a different
 * compressed format, and a WebM piece cut from the middle of a recording has
 * no header, so it can't be sent on its own. Raw samples become a small WAV
 * every CHUNK_SECONDS instead, 16 kHz mono, which is what speech models want
 * anyway, and each one stands alone. Pieces that are only silence (a quiet
 * gap while the teacher writes) are dropped rather than sent.
 *
 * The helpers at the top are pure, so tests/recorder.test.mjs runs them in
 * Node.
 */

export const SAMPLE_RATE = 16000;
// Short pieces keep the live transcript (and "catch me up") a few seconds behind, not half a minute.
export const CHUNK_SECONDS = 15;
// Low on purpose: a voice across the room is this quiet. True silence is still dropped,
// and the speech models' own voice detection skips what's left.
const SILENCE_RMS = 0.0022;

/** Average a Float32 signal down to `outRate`, as 16-bit PCM. */
export function downsample(input, inRate, outRate = SAMPLE_RATE) {
  if (inRate === outRate) return floatTo16(input);
  const ratio = inRate / outRate;
  const out = new Int16Array(Math.floor(input.length / ratio));
  let pos = 0;
  for (let i = 0; i < out.length; i++) {
    const next = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (; pos < next; pos++) { sum += input[pos]; n++; }
    const v = n ? sum / n : 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

function floatTo16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
  return out;
}

/** 16-bit mono PCM -> a complete WAV file. */
export function encodeWav(samples, rate = SAMPLE_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

/** Root-mean-square loudness of 16-bit PCM, 0..1. */
export function rms(samples) {
  if (!samples.length) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) { const x = samples[i] / 32768; s += x * x; }
  return Math.sqrt(s / samples.length);
}

export function isSilent(samples) { return rms(samples) < SILENCE_RMS; }

/**
 * Make faraway speech clear enough to transcribe. A teacher across the room
 * reaches the microphone very quietly; speech models do far better when the
 * voice is at a normal level. So: cut the low rumble (fans, desks, traffic)
 * below ~90 Hz, find the level of the loudest stretches (the speech, not the
 * gaps), raise that to a steady target, up to 30× (about +30 dB), and
 * soft-limit so nothing clips. 16-bit PCM in and out. Pure.
 */
export function enhanceSpeech(samples, rate = SAMPLE_RATE) {
  const n = samples.length;
  if (!n) return samples;
  // one-pole high-pass
  const a = Math.exp(-2 * Math.PI * 90 / rate);
  const hp = new Float32Array(n);
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i] / 32768;
    py = a * (py + x - px);
    px = x;
    hp[i] = py;
  }
  // speech level: the 90th-percentile loudness of 50 ms frames
  const frame = Math.max(1, Math.round(rate * 0.05));
  const levels = [];
  for (let s = 0; s < n; s += frame) {
    let sum = 0;
    const e = Math.min(n, s + frame);
    for (let i = s; i < e; i++) sum += hp[i] * hp[i];
    levels.push(Math.sqrt(sum / (e - s)));
  }
  levels.sort((x, y) => x - y);
  const speech = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.9))];
  const TARGET = 0.12;
  const gain = speech > 1e-5 ? Math.min(30, Math.max(1, TARGET / speech)) : 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const y = hp[i] * gain;
    const lim = Math.tanh(y * 1.2) / Math.tanh(1.2);   // gentle: unchanged when quiet, never past full scale
    out[i] = Math.max(-32767, Math.min(32767, Math.round(lim * 32767)));
  }
  return out;
}

export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Records until stopped. `onChunk({ wav, start, duration, silent })` fires for
 * every piece (start/duration in seconds from the start of the recording,
 * not counting pauses); `onLevel(0..1)` about 10 times a second, for a meter.
 */
export class LectureRecorder {
  constructor({ onChunk, onLevel, onError } = {}) {
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.onError = onError;
    this.state = 'idle';          // idle | recording | paused | stopped
    this.elapsed = 0;             // seconds captured (pauses excluded)
    this._parts = [];
    this._partLen = 0;
    this._chunkStart = 0;
  }

  /**
   * `source`: 'mic' (default), 'system', the computer's own sound, e.g. an
   * online class or a lecture video (desktop app only), or 'both', mixed.
   */
  async start({ source = 'mic' } = {}) {
    if (!canRecord) throw new Error('This device can’t record audio here.');
    this.streams = [];
    if (source === 'system' || source === 'both') {
      let disp;
      try {
        disp = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      } catch (_) {
        throw new Error('The computer’s sound couldn’t be recorded. On a Mac, allow LOCK IN! under System Settings → Privacy & Security → Screen & System Audio Recording.');
      }
      // Only the sound is wanted; the picture is never kept.
      disp.getVideoTracks().forEach(t => { t.enabled = false; });
      if (!disp.getAudioTracks().length) {
        disp.getTracks().forEach(t => t.stop());
        throw new Error('This computer didn’t share its sound. Record with the microphone instead.');
      }
      this.streams.push(new MediaStream(disp.getAudioTracks()));
      this._display = disp;
    }
    if (source !== 'system') {
      try {
        this.streams.push(await navigator.mediaDevices.getUserMedia({
          // with the computer's sound too, cancel the speakers out of the mic so nothing is heard twice
          // No noise suppression: it's built for calls, where a faraway voice IS the noise to remove
          // in a classroom that's the teacher. enhanceSpeech() levels the sound instead.
          audio: { channelCount: 1, echoCancellation: source === 'both', noiseSuppression: false, autoGainControl: true },
        }));
      } catch (e) {
        this._display?.getTracks().forEach(t => t.stop());
        throw new Error(e?.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it for LOCK IN!, then try again.'
          : 'No microphone could be opened.');
      }
    }
    this.stream = this.streams[0];
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.sources = this.streams.map(s => this.ctx.createMediaStreamSource(s));
    // ScriptProcessor is deprecated but is the one sample tap every WebView
    // has, including older iOS ones; the work done per buffer is tiny.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (this.state !== 'recording') return;
      const pcm = downsample(e.inputBuffer.getChannelData(0), this.ctx.sampleRate);
      this._parts.push(pcm);
      this._partLen += pcm.length;
      this.elapsed += pcm.length / SAMPLE_RATE;
      this.onLevel?.(Math.min(1, rms(pcm) * 6));
      if (this._partLen >= CHUNK_SECONDS * SAMPLE_RATE) this._flush();
    };
    // A muted gain keeps the processor running without playing the mic back.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.sources.forEach(s => s.connect(this.node));     // several inputs are summed: mic + computer sound
    this.node.connect(this.mute);
    this.mute.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.state = 'recording';
    this._wake();
  }

  pause() {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    this._flush();
  }

  resume() {
    if (this.state === 'paused') this.state = 'recording';
  }

  async stop() {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.state = 'stopped';
    this._flush();
    try { this.node.disconnect(); this.sources.forEach(s => s.disconnect()); this.mute.disconnect(); } catch (_) {}
    this.streams?.forEach(s => s.getTracks().forEach(t => t.stop()));
    this._display?.getTracks().forEach(t => t.stop());
    try { await this.ctx.close(); } catch (_) {}
    try { await this.wakeLock?.release(); } catch (_) {}
    this.wakeLock = null;
  }

  /** Send what's been heard since the last piece now (someone asked about the class). */
  flushNow(minSeconds = 2) {
    if (this.state === 'recording' && this._partLen >= minSeconds * SAMPLE_RATE) this._flush();
  }

  _flush() {
    if (!this._partLen) return;
    const all = new Int16Array(this._partLen);
    let o = 0;
    for (const p of this._parts) { all.set(p, o); o += p.length; }
    const start = this._chunkStart;
    const duration = all.length / SAMPLE_RATE;
    this._chunkStart += duration;
    this._parts = [];
    this._partLen = 0;
    this.onChunk?.({ wav: encodeWav(enhanceSpeech(all)), start, duration, silent: isSilent(all), loudness: rms(all) });
  }

  // Keep the screen (and with it, on phones, the recording) awake.
  async _wake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch (_) { /* not offered here; the page tells people to keep it open */ }
  }
}
