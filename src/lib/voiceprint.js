/**
 * "Hey Companion" in your own voice.
 *
 * A speech recogniser decides whether the words "hey companion" were said. It
 * can't tell that it was you, and when it guesses wrong, a TV, a classmate or a
 * cough wakes the assistant. So, like Google Assistant's Voice Match, you say
 * the phrase a few times when you turn it on, and from then on a wake-up only
 * counts when what was just heard sounds like those recordings.
 *
 * How: each recording becomes a sequence of MFCC frames (the standard "what does
 * this sound like" summary of speech, 100 per second). A wake-up is compared with
 * each recording by dynamic time warping, which lines up the two even when you
 * say it faster or slower, and the closest match has to be within the spread
 * your own recordings showed. Only these numbers are kept, on this device; the
 * recordings themselves are thrown away.
 *
 * Pure apart from localStorage, so it is tested in Node (tests/voiceprint.test.mjs).
 */

export const RATE = 16000;
const FRAME = 400;          // 25 ms
const HOP = 160;            // 10 ms
const NFFT = 512;
const MELS = 26;
const CEPS = 12;            // c1..c12; c0 is loudness, which says nothing about who or what
const KEY = 'lockin.voiceprint';
export const SAMPLES_NEEDED = 4;

/* ------------------------------------------------------------- the maths */

let melBank = null;
const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);

function filters() {
  if (melBank) return melBank;
  const lo = hz2mel(60), hi = hz2mel(7600);
  const pts = Array.from({ length: MELS + 2 }, (_, i) => mel2hz(lo + (i * (hi - lo)) / (MELS + 1)));
  const bins = pts.map(f => Math.floor(((NFFT + 1) * f) / RATE));
  melBank = [];
  for (let m = 1; m <= MELS; m++) {
    const w = new Float32Array(NFFT / 2 + 1);
    for (let k = bins[m - 1]; k < bins[m]; k++) w[k] = (k - bins[m - 1]) / Math.max(1, bins[m] - bins[m - 1]);
    for (let k = bins[m]; k <= bins[m + 1]; k++) w[k] = (bins[m + 1] - k) / Math.max(1, bins[m + 1] - bins[m]);
    melBank.push(w);
  }
  return melBank;
}

const HAMMING = Float32Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** In-place radix-2 FFT of (re, im), length a power of two. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Int16 or Float32 samples at 16 kHz -> Float32 in [-1, 1]. */
export function toFloat(pcm) {
  if (pcm instanceof Float32Array) return pcm;
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
  return f;
}

/** { feats: Float32Array[] (12 MFCCs per 10 ms), energy: number[] (dB per frame) } */
export function analyse(samples) {
  const x = toFloat(samples);
  const bank = filters();
  const mels = [], energy = [];
  const re = new Float32Array(NFFT), im = new Float32Array(NFFT);
  let top = -Infinity;
  for (let start = 0; start + FRAME <= x.length; start += HOP) {
    const logMel = new Float32Array(MELS);
    re.fill(0); im.fill(0);
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = x[start + i] - 0.97 * (i ? x[start + i - 1] : 0);   // pre-emphasis
      e += x[start + i] * x[start + i];
      re[i] = s * HAMMING[i];
    }
    energy.push(10 * Math.log10(e / FRAME + 1e-10));
    fft(re, im);
    for (let m = 0; m < MELS; m++) {
      let sum = 0;
      const w = bank[m];
      for (let k = 0; k <= NFFT / 2; k++) if (w[k]) sum += w[k] * (re[k] * re[k] + im[k] * im[k]);
      logMel[m] = Math.log(sum + 1e-10);
      if (logMel[m] > top) top = logMel[m];
    }
    mels.push(logMel);
  }
  // Anything 30 dB under the loudest sound is treated as the same quiet: otherwise a
  // noisier room changes the pauses between syllables enough to look like another phrase.
  const floor = top - 6.9;
  const feats = mels.map((logMel) => {
    const c = new Float32Array(CEPS);
    for (let k = 1; k <= CEPS; k++) {
      let s = 0;
      for (let m = 0; m < MELS; m++) s += Math.max(logMel[m], floor) * Math.cos((Math.PI * k * (m + 0.5)) / MELS);
      c[k - 1] = s;
    }
    return c;
  });
  return { feats, energy };
}

/** The frames where someone is actually speaking: from the first loud frame to the last. */
export function speechSpan(energy, below = 25) {
  if (!energy.length) return null;
  const peak = Math.max(...energy);
  if (peak < -55) return null;                         // silence: nothing to compare
  const floor = peak - below;
  let a = energy.findIndex(e => e > floor);
  let b = energy.length - 1;
  while (b > a && energy[b] <= floor) b--;
  return a < 0 ? null : [Math.max(0, a - 3), Math.min(energy.length, b + 4)];
}

/** Subtract each coefficient's average: the microphone's own colour cancels out. */
function normalise(feats) {
  if (!feats.length) return feats;
  const mean = new Float32Array(CEPS);
  for (const f of feats) for (let k = 0; k < CEPS; k++) mean[k] += f[k] / feats.length;
  return feats.map(f => f.map((v, k) => v - mean[k]));
}

/** The comparable shape of one spoken phrase, or null if it's silence. */
export function phraseFeatures(samples) {
  const { feats, energy } = analyse(samples);
  const span = speechSpan(energy);
  if (!span) return null;
  const cut = feats.slice(span[0], span[1]);
  return cut.length >= 20 ? normalise(cut) : null;     // under 0.2 s isn't "hey companion"
}

const dist = (a, b) => {
  let s = 0;
  for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; s += d * d; }
  return Math.sqrt(s);
};

/**
 * How far `template` is from its best match anywhere inside `query` (the query may
 * have silence or other words around the phrase). Average cost per template frame.
 */
export function matchCost(template, query) {
  const n = template.length, m = query.length;
  if (!n || !m) return Infinity;
  let prev = new Float32Array(m).fill(0);     // free start anywhere in the query
  let cur = new Float32Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = dist(template[i], query[j]);
      const up = prev[j];
      const left = j ? cur[j - 1] : Infinity;
      const diag = j ? prev[j - 1] : (i ? Infinity : 0);
      cur[j] = d + Math.min(i ? up : 0, left, diag);
    }
    [prev, cur] = [cur, prev];
  }
  let best = Infinity;
  for (let j = 0; j < m; j++) best = Math.min(best, prev[j]);   // free end
  return best / n;
}

/* ------------------------------------------------------------- training */

/**
 * From the recordings made in training, the voiceprint: their features and how
 * close a wake-up has to be. Throws with a plain reason if they don't agree
 * well enough to be the same phrase.
 */
export function buildVoiceprint(recordings) {
  const templates = recordings.map(phraseFeatures).filter(Boolean);
  if (templates.length < SAMPLES_NEEDED) throw new Error('Some recordings were too quiet or too short. Try again a little closer to the microphone.');
  const costs = [];
  for (let i = 0; i < templates.length; i++) {
    for (let j = 0; j < templates.length; j++) if (i !== j) costs.push(matchCost(templates[i], templates[j]));
  }
  const mean = costs.reduce((s, c) => s + c, 0) / costs.length;
  const sd = Math.sqrt(costs.reduce((s, c) => s + (c - mean) ** 2, 0) / costs.length);
  // Recordings that disagree this much were probably not all the same phrase
  if (sd > mean * 0.6) throw new Error('The recordings sounded quite different from each other. Say “Hey Companion” the same way each time, in a quiet room.');
  // A wake-up is allowed a bit more than twice the widest gap between your own recordings: a
  // different room or a tired voice stays inside it, other words land several times further out.
  const threshold = Math.max(...costs) * 2.2;
  return {
    v: 1,
    phrase: 'hey companion',
    threshold: Number(threshold.toFixed(3)),
    templates: templates.map(t => t.map(f => Array.from(f, v => Number(v.toFixed(2))))),
    trainedAt: Date.now(),
  };
}

/* ------------------------------------------------------------- checking */

let cache;
export function loadVoiceprint() {
  if (cache !== undefined) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    cache = raw && raw.v === 1 && raw.templates?.length ? { ...raw, templates: raw.templates.map(t => t.map(f => Float32Array.from(f))) } : null;
  } catch (_) { cache = null; }
  return cache;
}

export function saveVoiceprint(vp) {
  try { localStorage.setItem(KEY, JSON.stringify(vp)); } catch (_) { /* private mode: it works for this visit */ }
  cache = vp ? { ...vp, templates: vp.templates.map(t => t.map(f => Float32Array.from(f))) } : null;
  try { window.dispatchEvent(new Event('lockin:voiceprint')); } catch (_) { /* not in a browser */ }
}

export function forgetVoiceprint() {
  try { localStorage.removeItem(KEY); } catch (_) { /* nothing kept */ }
  cache = null;
  try { window.dispatchEvent(new Event('lockin:voiceprint')); } catch (_) { /* not in a browser */ }
}

export const hasVoiceprint = () => !!loadVoiceprint();

/**
 * Was the wake phrase in `samples` (the last couple of seconds at 16 kHz) said by
 * the trained voice? Untrained: always yes, so nothing changes until training.
 */
export function soundsLikeYou(samples, vp = loadVoiceprint()) {
  if (!vp) return { ok: true, untrained: true };
  const { feats, energy } = analyse(samples);
  const span = speechSpan(energy);
  if (!span) return { ok: false, cost: Infinity, threshold: vp.threshold };
  const query = normalise(feats.slice(span[0], span[1]));
  let cost = Infinity;
  for (const t of vp.templates) cost = Math.min(cost, matchCost(t, query));
  return { ok: cost <= vp.threshold, cost, threshold: vp.threshold };
}

/* ------------------------------------------------------------- audio */

/** Samples at `from` Hz -> 16 kHz, averaging so nothing above 8 kHz folds back in. */
export function resampleTo16k(input, from) {
  if (from === RATE) return Float32Array.from(input);
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += input[k];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/** The last `seconds` of audio, kept as it arrives. */
export class Ring {
  constructor(seconds = 3) { this.buf = new Float32Array(RATE * seconds); this.at = 0; this.full = false; }
  push(samples) {
    const x = toFloat(samples);
    for (let i = 0; i < x.length; i++) {
      this.buf[this.at++] = x[i];
      if (this.at === this.buf.length) { this.at = 0; this.full = true; }
    }
  }
  read() {
    if (!this.full) return this.buf.slice(0, this.at);
    const out = new Float32Array(this.buf.length);
    out.set(this.buf.subarray(this.at));
    out.set(this.buf.subarray(0, this.at), this.buf.length - this.at);
    return out;
  }
}

/**
 * The microphone at 16 kHz, for the browser (the desktop app's LocalEar already
 * has its own): onAudio(Float32Array) for every piece. Returns stop().
 */
export async function openMic(onAudio) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => onAudio(resampleTo16k(e.inputBuffer.getChannelData(0), ctx.sampleRate));
  src.connect(node);
  node.connect(ctx.destination);       // a script processor only runs while connected; it writes silence
  return () => {
    try { node.disconnect(); src.disconnect(); } catch (_) { /* already */ }
    stream.getTracks().forEach(t => t.stop());
    ctx.close().catch(() => {});
  };
}
