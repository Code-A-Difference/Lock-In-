/**
 * Recording a lecture, in pieces the AI can transcribe one at a time.
 *
 * The microphone is read as raw samples (not MediaRecorder): every browser,
 * including the iPhone and Android app wrappers, records a different
 * compressed format, and a WebM piece cut from the middle of a recording has
 * no header, so it can't be sent on its own. Raw samples become a small WAV
 * for each piece instead, 16 kHz mono, which is what speech models want
 * anyway, and each one stands alone.
 *
 * What makes it hear a classroom:
 *  - the sound is tapped on the audio thread (AudioWorklet), so a busy page
 *    can't make it drop a few milliseconds, and it is brought down to 16 kHz
 *    with a proper low-pass first, so hiss above 8 kHz isn't folded into the voice;
 *  - pieces are cut in the pauses between sentences, not every 15 seconds on
 *    the dot, so a word is never split across two requests;
 *  - each piece is levelled word by word, not once: a teacher across the room
 *    and a student next to the microphone both come out at a normal speaking
 *    level, and the hiss between words is not lifted with them;
 *  - it notices when it can't hear (a muted or unplugged microphone, a
 *    suspended page, a room so quiet nothing registers) and says so.
 *
 * The helpers at the top are pure, so tests/recorder.test.mjs runs them in
 * Node.
 */

export const SAMPLE_RATE = 16000;
// Nominal length. Live pieces are cut at the first pause after MIN seconds (never past MAX),
// so the live transcript stays a few seconds behind, not half a minute.
export const CHUNK_SECONDS = 15;
export const MIN_CHUNK_SECONDS = 8;
export const MAX_CHUNK_SECONDS = 22;
// Below this a piece is only silence. The test is on the loudest stretches of a piece
// (a quiet gap while the teacher writes is dropped), not its average, so a faint voice
// that is only speaking half the time isn't mistaken for it.
const SILENCE_SPEECH = 0.001;
const HUM_SPEECH = 0.006;       // a steady hum this loud, with nothing standing out of it, is not a voice either
const HUM_RATIO = 1.35;

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

const LOBES = 6;      // zero crossings of the resampling filter on each side, at the lower rate

/**
 * Sample-rate conversion with a windowed-sinc low-pass, in a stream: call
 * process() with each buffer as it arrives. `downsample` above just averages
 * neighbouring samples, which lets fan hiss and mic noise above the new top
 * frequency fold down into the voice; this keeps them out.
 */
export class Resampler {
  constructor(inRate, outRate = SAMPLE_RATE) {
    this.ratio = inRate / outRate;
    this.pass = inRate === outRate;
    const down = Math.max(1, this.ratio);
    this.cut = 0.47 / down;                       // cycles per input sample: just under the new Nyquist
    this.half = Math.ceil(LOBES * down);          // filter half-width, in input samples
    this.buf = new Float32Array(0);
    this.pos = 0;                                 // where the next output sample sits, in buf
  }

  _weight(t) {
    const x = 2 * this.cut * t;
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return sinc * (0.5 + 0.5 * Math.cos(Math.PI * t / this.half));      // Hann window
  }

  /** Float32 samples in, 16-bit samples out. Output trails the input by half the filter (under a millisecond). */
  process(input) {
    if (this.pass) return floatTo16(input);
    const joined = new Float32Array(this.buf.length + input.length);
    joined.set(this.buf, 0);
    joined.set(input, this.buf.length);
    const out = [];
    for (; this.pos + this.half < joined.length; this.pos += this.ratio) {
      const c = this.pos;
      let sum = 0;
      let norm = 0;
      for (let k = Math.max(0, Math.ceil(c - this.half)), hi = Math.floor(c + this.half); k <= hi; k++) {
        const w = this._weight(k - c);
        sum += joined[k] * w;
        norm += w;
      }
      out.push(norm ? sum / norm : 0);        // dividing by the weights keeps a steady level steady, even at the very start
    }
    const keep = Math.max(0, Math.ceil(this.pos - this.half));
    this.buf = joined.slice(keep);
    this.pos -= keep;
    return floatTo16(Float32Array.from(out));
  }
}

/** The whole of a signal at once, with the same filter. Same length as `downsample` would give. */
export function resample(input, inRate, outRate = SAMPLE_RATE) {
  if (inRate === outRate) return floatTo16(input);
  const r = new Resampler(inRate, outRate);
  const tail = new Float32Array(r.half + 2).fill(input.length ? input[input.length - 1] : 0);   // hold the last value, so the end doesn't droop
  const joined = new Float32Array(input.length + tail.length);
  joined.set(input, 0);
  joined.set(tail, input.length);
  return r.process(joined).subarray(0, Math.floor(input.length / r.ratio));
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

/** Several of this file's WAV pieces (44-byte header, 16-bit mono) as one WAV, for playing back or saving a whole lecture. */
export function joinWav(pieces) {
  const data = pieces.reduce((n, p) => n + Math.max(0, p.length - 44), 0);
  const out = new Uint8Array(44 + data);
  if (pieces.length) out.set(pieces[0].subarray(0, 44), 0);
  const v = new DataView(out.buffer);
  v.setUint32(4, 36 + data, true);
  v.setUint32(40, data, true);
  let o = 44;
  for (const p of pieces) { out.set(p.subarray(44), o); o += Math.max(0, p.length - 44); }
  return out;
}

/** Root-mean-square loudness of 16-bit PCM, 0..1. */
export function rms(samples) {
  if (!samples.length) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) { const x = samples[i] / 32768; s += x * x; }
  return Math.sqrt(s / samples.length);
}

/** Loudness (0..1) of each consecutive `ms`-long frame of 16-bit PCM. */
export function frameLevels(samples, rate = SAMPLE_RATE, ms = 30) {
  const frame = Math.max(1, Math.round(rate * ms / 1000));
  const out = new Float32Array(Math.ceil(samples.length / frame));
  for (let f = 0, s = 0; s < samples.length; f++, s += frame) {
    const e = Math.min(samples.length, s + frame);
    let sum = 0;
    for (let i = s; i < e; i++) { const x = samples[i] / 32768; sum += x * x; }
    out[f] = Math.sqrt(sum / (e - s));
  }
  return out;
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

/**
 * How a piece sounds: `speech` is the level of its loudest stretches (what a
 * voice reaches), `floor` that of its quietest (the room). Their ratio says
 * whether anything stands out of the noise.
 */
export function speechStats(samples, rate = SAMPLE_RATE) {
  const sorted = Float32Array.from(frameLevels(samples, rate)).sort();
  return { speech: percentile(sorted, 0.9), floor: percentile(sorted, 0.15), median: percentile(sorted, 0.5), peak: sorted[sorted.length - 1] || 0 };
}

export function isSilent(samples) {
  const { speech, floor } = speechStats(samples);
  if (speech < SILENCE_SPEECH) return true;
  return speech < HUM_SPEECH && speech < floor * HUM_RATIO;       // quiet, and nothing stands out of the noise
}

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

const LEVEL_TARGET = 0.12;       // a normal speaking level, as RMS
const LEVEL_MAX_GAIN = 60;       // about +35 dB
const NOISE_CEILING = 0.012;     // the hiss between words is never raised above this
const LEVEL_FRAME_MS = 20;

/**
 * Level a piece of speech word by word. `enhanceSpeech` finds one gain for a
 * whole piece, so a loud student near the microphone left the quiet teacher
 * across the room as quiet as before. Here every 20 ms of speech is raised (or,
 * if it is loud, left alone) toward the same level: gain falls at once when
 * something loud arrives and recovers over a fraction of a second. The quiet
 * stretches between words are held to a ceiling, so the room's hiss isn't
 * pumped up along with the voice. Rumble below ~90 Hz is cut first, and a soft
 * limiter keeps the result under full scale. 16-bit PCM in and out. Pure.
 */
export function levelSpeech(samples, rate = SAMPLE_RATE) {
  const n = samples.length;
  if (!n) return samples;
  const a = Math.exp(-2 * Math.PI * 90 / rate);
  const hp = new Float32Array(n);
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i] / 32768;
    py = a * (py + x - px);
    px = x;
    hp[i] = py;
  }
  const frame = Math.max(1, Math.round(rate * LEVEL_FRAME_MS / 1000));
  const frames = Math.ceil(n / frame);
  const level = new Float32Array(frames);
  for (let f = 0, s = 0; f < frames; f++, s += frame) {
    const e = Math.min(n, s + frame);
    let sum = 0;
    for (let i = s; i < e; i++) sum += hp[i] * hp[i];
    level[f] = Math.sqrt(sum / (e - s));
  }
  const sorted = Float32Array.from(level).sort();
  const floor = Math.max(1e-5, percentile(sorted, 0.12));
  const loud = percentile(sorted, 0.9);
  const out = new Int16Array(n);
  if (loud < 1e-5) {                              // nothing at all in it: nothing to level
    for (let i = 0; i < n; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(hp[i] * 32767)));
    return out;
  }
  const base = Math.min(LEVEL_MAX_GAIN, Math.max(1, LEVEL_TARGET / loud));
  const hiss = Math.min(base, Math.max(1, NOISE_CEILING / floor));
  const voiced = floor * 2.2;
  const want = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    want[f] = level[f] >= voiced ? Math.min(LEVEL_MAX_GAIN, Math.max(1, LEVEL_TARGET / level[f])) : hiss;
  }
  // gain follows `want` down quickly and up slowly; held between frame centres by linear interpolation
  const gain = new Float32Array(frames);
  let g = want[0];
  for (let f = 0; f < frames; f++) {
    g += (want[f] - g) * (want[f] < g ? 0.6 : 0.12);
    gain[f] = g;
  }
  for (let i = 0; i < n; i++) {
    const pos = i / frame - 0.5;
    const f0 = Math.max(0, Math.min(frames - 1, Math.floor(pos)));
    const f1 = Math.min(frames - 1, f0 + 1);
    const t = Math.max(0, Math.min(1, pos - f0));
    const y = hp[i] * (gain[f0] + (gain[f1] - gain[f0]) * t);
    const lim = Math.tanh(y * 1.2) / Math.tanh(1.2);
    out[i] = Math.max(-32767, Math.min(32767, Math.round(lim * 32767)));
  }
  return out;
}

/**
 * Cuts a stream of 16-bit samples into pieces at the pauses between sentences.
 * A piece is at least `min` seconds long; once it is, it ends in the middle
 * of the first pause (about `pauseMs` of quiet) that follows. If nobody ever
 * stops talking it is cut at `max` seconds, at the quietest moment of the
 * last few. Nothing is lost or repeated: the pieces, joined, are the stream.
 */
export class PauseCutter {
  constructor({ rate = SAMPLE_RATE, min = MIN_CHUNK_SECONDS, max = MAX_CHUNK_SECONDS, pauseMs = 380 } = {}) {
    this.frame = Math.round(rate * 0.02);
    this.minLen = Math.round(min * rate);
    this.maxLen = Math.round(max * rate);
    this.pauseFrames = Math.max(1, Math.round(pauseMs / 20));
    this.buf = new Int16Array(this.maxLen + rate * 2);
    this.len = 0;
    this.levels = [];               // loudness of each whole 20 ms frame in the piece being built
    this.floor = 0.002;             // the room's quietest level lately
    this.primed = false;
  }

  get seconds() { return this.len / (this.frame * 50); }

  /** Add samples; returns the pieces (0 or more Int16Arrays) that are now complete. */
  push(pcm) {
    const done = [];
    for (let at = 0; at < pcm.length;) {
      const room = this.buf.length - this.len;
      const take = Math.min(room, pcm.length - at);
      this.buf.set(pcm.subarray(at, at + take), this.len);
      this.len += take;
      at += take;
      this._measure();
      for (let cut = this._cutAt(); cut > 0; cut = this._cutAt()) done.push(this._take(cut));
    }
    return done;
  }

  /** Whatever is left, if there are at least `minSamples` of it. */
  flush(minSamples = 1) {
    if (!this.len || this.len < minSamples) return null;
    return this._take(this.len);
  }

  _measure() {
    for (let f = this.levels.length; (f + 1) * this.frame <= this.len; f++) {
      let sum = 0;
      for (let i = f * this.frame, e = i + this.frame; i < e; i++) { const x = this.buf[i] / 32768; sum += x * x; }
      const lv = Math.sqrt(sum / this.frame);
      this.levels.push(lv);
      if (!this.primed) { this.floor = lv || this.floor; this.primed = true; }
      else if (lv < this.floor) this.floor = lv;
      else this.floor += (lv - this.floor) * 0.0005;      // creeps up if the room gets noisier
    }
  }

  _quiet(lv) { return lv <= Math.max(this.floor * 1.8, 0.0009); }

  _cutAt() {
    const frames = this.levels.length;
    if (this.len >= this.maxLen) {
      // nobody paused: cut where it is quietest within the last 4 seconds
      let best = -1, bestSum = Infinity;
      for (let f = Math.max(Math.ceil(this.minLen / this.frame), frames - 200); f + 8 <= frames; f++) {
        let s = 0;
        for (let k = 0; k < 8; k++) s += this.levels[f + k];
        if (s < bestSum) { bestSum = s; best = f + 4; }
      }
      return best > 0 ? best * this.frame : Math.floor(this.maxLen / this.frame) * this.frame;
    }
    if (this.len < this.minLen) return 0;
    let quiet = 0;
    while (quiet < frames && this._quiet(this.levels[frames - 1 - quiet])) quiet++;
    if (quiet < this.pauseFrames) return 0;
    const mid = frames - Math.floor(quiet / 2);
    return Math.min(frames, Math.max(mid, Math.ceil(this.minLen / this.frame))) * this.frame;
  }

  _take(cut) {
    const piece = this.buf.slice(0, cut);
    this.buf.copyWithin(0, cut, this.len);
    this.len -= cut;
    this.levels.splice(0, Math.floor(cut / this.frame));
    return piece;
  }
}

/** What the last few seconds say about whether the room can be heard: 'ok', 'quiet' or 'silent'. `level` is the loud end of the recent raw loudness. */
export function classifyHearing(level) {
  if (level < 0.0005) return 'silent';
  if (level < 0.0035) return 'quiet';
  return 'ok';
}

export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

// The tap runs on the audio thread: it only collects 2048 samples at a time and hands them over.
const WORKLET_SOURCE = `
class LockInTap extends AudioWorkletProcessor {
  constructor() { super(); this.size = 2048; this.buf = new Float32Array(this.size); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(this.size); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('lockin-tap', LockInTap);`;

/** The constraints for a classroom microphone. */
export function micConstraints({ deviceId = '', echoCancel = false } = {}) {
  // No noise suppression: it's built for calls, where a faraway voice IS the noise to remove;
  // in a classroom that's the teacher. levelSpeech() evens out the sound instead.
  const audio = { channelCount: 1, echoCancellation: echoCancel, noiseSuppression: false, autoGainControl: true };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}

/**
 * Records until stopped. `onChunk({ wav, start, duration, silent, loudness })` fires for
 * every piece (start/duration in seconds from the start of the recording,
 * not counting pauses); `onLevel(0..1)` about 20 times a second, for a meter;
 * `onHealth({ hearing, mic, audio })` whenever what it can hear changes:
 * hearing 'ok' | 'quiet' | 'silent', mic 'ok' | 'muted' | 'ended', audio 'ok' | 'suspended'.
 */
export class LectureRecorder {
  constructor({ onChunk, onLevel, onError, onHealth } = {}) {
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.onError = onError;
    this.onHealth = onHealth;
    this.state = 'idle';          // idle | recording | paused | stopped
    this.elapsed = 0;             // seconds captured (pauses excluded)
    this.cutter = new PauseCutter();
    this._chunkStart = 0;
    this._levels = [];            // raw loudness of recent blocks, for "can it hear anything"
    this._health = { hearing: 'ok', mic: 'ok', audio: 'ok' };
    this._reopens = 0;
  }

  /**
   * `source`: 'mic' (default), 'system', the computer's own sound, e.g. an
   * online class or a lecture video (desktop app only), or 'both', mixed.
   * `deviceId`: a particular microphone (a USB or room mic), else the default one.
   */
  async start({ source = 'mic', deviceId = '' } = {}) {
    if (!canRecord) throw new Error('This device can’t record audio here.');
    this.source = source;
    this.deviceId = deviceId;
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
        this.mic = await this._openMic();
        this.streams.push(this.mic);
      } catch (e) {
        this._display?.getTracks().forEach(t => t.stop());
        throw new Error(e?.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it for LOCK IN!, then try again.'
          : 'No microphone could be opened.');
      }
    }
    this.stream = this.streams[0];
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.resampler = new Resampler(this.ctx.sampleRate);
      this.ctx.onstatechange = () => this._audioState();
      this.sources = this.streams.map(s => this.ctx.createMediaStreamSource(s));
      await this._tap();
      // A muted gain keeps the tap running without playing the mic back.
      this.mute = this.ctx.createGain();
      this.mute.gain.value = 0;
      this.sources.forEach(s => s.connect(this.node));     // several inputs are summed: mic + computer sound
      this.node.connect(this.mute);
      this.mute.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (e) {
      this.streams.forEach(s => s.getTracks().forEach(t => { t.onended = null; t.stop(); }));
      this._display?.getTracks().forEach(t => t.stop());
      try { await this.ctx?.close(); } catch (_) {}
      throw new Error('Recording couldn’t start on this device.');
    }
    this.state = 'recording';
    this._wake();
    this._watch();
  }

  /** A microphone stream, the chosen one if it is still there, else the default. */
  async _openMic() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(micConstraints({ deviceId: this.deviceId, echoCancel: this.source === 'both' }));
    } catch (e) {
      if (!this.deviceId || !/Overconstrained|NotFound/.test(e?.name || '')) throw e;
      this.deviceId = '';                                  // that microphone is gone: use the default
      stream = await navigator.mediaDevices.getUserMedia(micConstraints({ echoCancel: this.source === 'both' }));
    }
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => this._micGone(t);
      t.onmute = () => this._set({ mic: 'muted' });
      t.onunmute = () => this._set({ mic: 'ok' });
    });
    return stream;
  }

  /**
   * The audio thread is where sound is collected when the browser allows it, so a page that is
   * busy drawing can't make it drop a few milliseconds. ScriptProcessor (deprecated, but every
   * WebView has it) is the fallback; the work per buffer is tiny.
   */
  async _tap() {
    if (this.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const node = new AudioWorkletNode(this.ctx, 'lockin-tap', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
        });
        node.port.onmessage = (e) => this._block(e.data);
        this.node = node;
        return;
      } catch (_) { /* blocked or unsupported here: the fallback below */ }
    }
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => this._block(e.inputBuffer.getChannelData(0));
    this.node = node;
  }

  _block(block) {
    if (this.state !== 'recording') return;
    const pcm = this.resampler.process(block);
    if (!pcm.length) return;
    this.elapsed += pcm.length / SAMPLE_RATE;
    const level = rms(pcm);
    this.onLevel?.(Math.min(1, level * 6));
    this._levels.push(level);
    if (this._levels.length > 470) this._levels.shift();           // about the last 20 seconds
    for (const piece of this.cutter.push(pcm)) this._emit(piece);
  }

  _emit(all) {
    const duration = all.length / SAMPLE_RATE;
    const start = this._chunkStart;
    this._chunkStart += duration;
    const silent = isSilent(all);
    // a silent piece is kept as it was heard (so playing the lecture back has no wall of hiss) but never sent
    this.onChunk?.({ wav: encodeWav(silent ? all : levelSpeech(all)), start, duration, silent, loudness: rms(all) });
  }

  _set(patch) {
    const next = { ...this._health, ...patch };
    if (next.hearing === this._health.hearing && next.mic === this._health.mic && next.audio === this._health.audio) return;
    this._health = next;
    this.onHealth?.({ ...next });
  }

  _audioState() {
    if (this.state === 'stopped' || !this.ctx) return;
    if (this.ctx.state === 'running') { this._set({ audio: 'ok' }); return; }
    this._set({ audio: 'suspended' });
    this.ctx.resume?.().catch(() => {});
  }

  /** Once a second: can it hear anything? And, when the page comes back to the front, wake everything up again. */
  _watch() {
    this._timer = setInterval(() => {
      if (this.state !== 'recording' || this.elapsed < 12) return;
      const sorted = [...this._levels].sort((a, b) => a - b);
      this._set({ hearing: classifyHearing(percentile(sorted, 0.9)) });
    }, 1000);
    this._visible = () => {
      if (document.visibilityState !== 'visible' || this.state === 'stopped') return;
      this._audioState();
      this._wake();
    };
    document.addEventListener('visibilitychange', this._visible);
  }

  /** The microphone stopped by itself (unplugged, a Bluetooth headset going to sleep): try to get it back. */
  async _micGone(track) {
    if (this.state === 'stopped' || !this.mic || !this.mic.getAudioTracks().includes(track)) return;
    this._set({ mic: 'ended' });
    if (this._reopens >= 3) { this.onError?.('The microphone disconnected.'); return; }
    this._reopens++;
    await new Promise(r => setTimeout(r, 1500 * this._reopens));
    if (this.state === 'stopped') return;
    try {
      const stream = await this._openMic();
      const at = this.streams.indexOf(this.mic);
      try { this.sources[at]?.disconnect(); } catch (_) {}
      this.mic = stream;
      this.streams[at] = stream;
      this.sources[at] = this.ctx.createMediaStreamSource(stream);
      this.sources[at].connect(this.node);
      this._set({ mic: 'ok' });
    } catch (_) {
      this.onError?.('The microphone disconnected. Plug it back in, or stop and start the recording.');
    }
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
    clearInterval(this._timer);
    if (this._visible) document.removeEventListener('visibilitychange', this._visible);
    try { this.node.disconnect(); this.sources.forEach(s => s.disconnect()); this.mute.disconnect(); } catch (_) {}
    this.streams?.forEach(s => s.getTracks().forEach(t => { t.onended = null; t.stop(); }));
    this._display?.getTracks().forEach(t => t.stop());
    try { await this.ctx.close(); } catch (_) {}
    try { await this.wakeLock?.release(); } catch (_) {}
    this.wakeLock = null;
  }

  /** Send what's been heard since the last piece now (someone asked about the class). */
  flushNow(minSeconds = 2) {
    if (this.state !== 'recording') return;
    const piece = this.cutter.flush(minSeconds * SAMPLE_RATE);
    if (piece) this._emit(piece);
  }

  _flush() {
    const piece = this.cutter.flush();
    if (piece) this._emit(piece);
  }

  // Keep the screen (and with it, on phones, the recording) awake. Browsers let go of it when the page is hidden.
  async _wake() {
    try {
      if (this.wakeLock && !this.wakeLock.released) return;
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch (_) { /* not offered here; the page tells people to keep it open */ }
  }
}
