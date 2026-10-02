/**
 * Recording a lecture, in pieces the AI can transcribe one at a time.
 *
 * The microphone is read as raw samples (not MediaRecorder): every browser,
 * including the iPhone and Android app wrappers, records a different
 * compressed format, and a WebM piece cut from the middle of a recording has
 * no header, so it can't be sent on its own. Raw samples become a small WAV
 * every CHUNK_SECONDS instead — 16 kHz mono, which is what speech models want
 * anyway — and each one stands alone. Pieces that are only silence (a quiet
 * gap while the teacher writes) are dropped rather than sent.
 *
 * The helpers at the top are pure, so tests/recorder.test.mjs runs them in
 * Node.
 */

export const SAMPLE_RATE = 16000;
export const CHUNK_SECONDS = 30;
const SILENCE_RMS = 0.006;

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

  async start() {
    if (!canRecord) throw new Error('This device can’t record audio here.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw new Error(e?.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it for LOCK IN!, then try again.'
        : 'No microphone could be opened.');
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.source = this.ctx.createMediaStreamSource(this.stream);
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
    this.source.connect(this.node);
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
    try { this.node.disconnect(); this.source.disconnect(); this.mute.disconnect(); } catch (_) {}
    this.stream?.getTracks().forEach(t => t.stop());
    try { await this.ctx.close(); } catch (_) {}
    try { await this.wakeLock?.release(); } catch (_) {}
    this.wakeLock = null;
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
    this.onChunk?.({ wav: encodeWav(all), start, duration, silent: isSilent(all) });
  }

  // Keep the screen (and with it, on phones, the recording) awake.
  async _wake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch (_) { /* not offered here; the page tells people to keep it open */ }
  }
}
