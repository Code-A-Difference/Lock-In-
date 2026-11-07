import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Resampler, resample, downsample, levelSpeech, enhanceSpeech, isSilent, speechStats, PauseCutter, joinWav, encodeWav,
  classifyHearing, rms, frameLevels, SAMPLE_RATE, MIN_CHUNK_SECONDS, MAX_CHUNK_SECONDS,
} from '../src/lib/recorder.js';

const R = SAMPLE_RATE;

/** Repeatable noise in -1..1. */
function noise(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

/** A voice-like sound: harmonics of 140 Hz, swelling and fading about four times a second. */
function voice(seconds, amp, at = 0) {
  const out = new Float32Array(Math.round(seconds * R));
  for (let i = 0; i < out.length; i++) {
    const t = (i + at) / R;
    const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
    out[i] = v * swell * amp * 0.5;
  }
  return out;
}

/** Pieces of [seconds, amp] (amp 0 = a pause of just room hiss at `hiss`) as 16-bit samples. */
function scene(parts, hiss = 0.0004, seed = 7) {
  const n = noise(seed);
  const chunks = [];
  let at = 0;
  for (const [seconds, amp] of parts) {
    const v = amp ? voice(seconds, amp, at) : new Float32Array(Math.round(seconds * R));
    for (let i = 0; i < v.length; i++) v[i] += n() * hiss;
    chunks.push(v);
    at += v.length;
  }
  const all = new Int16Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) { for (let i = 0; i < c.length; i++) all[o + i] = Math.round(Math.max(-1, Math.min(1, c[i])) * 32767); o += c.length; }
  return all;
}

const sine = (hz, seconds, rate, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.sin(2 * Math.PI * hz * i / rate) * amp);
const level = (pcm, from, to) => rms(pcm.subarray(Math.round(from * R), Math.round(to * R)));

test('resampling keeps a steady level steady, and a voice-band tone at its level', () => {
  const flat = resample(new Float32Array(48000).fill(0.5), 48000);
  assert.equal(flat.length, R);
  assert.ok(flat.every((v, i) => i < 4 || Math.abs(v - Math.round(0.5 * 32767)) <= 2), 'no droop at the edges');
  const tone = resample(sine(1000, 1, 48000), 48000);
  assert.ok(Math.abs(rms(tone.subarray(1000, 15000)) - 0.5 / Math.SQRT2) < 0.01);
});

test('hiss above the new top frequency is kept out of the voice, not folded into it', () => {
  const hiss = sine(12000, 1, 48000);                // 12 kHz: well past the 8 kHz that 16 kHz can carry
  const folded = rms(downsample(hiss, 48000));       // the old averaging: it folds down to 4 kHz
  const kept = rms(resample(hiss, 48000).subarray(1000, 15000));
  assert.ok(kept < 0.01, `kept ${kept}`);
  assert.ok(kept < folded / 10, `${folded} -> ${kept}`);
});

test('resampling in small buffers gives the same sound as all at once', () => {
  const x = sine(300, 2, 44100, 0.4);
  const whole = resample(x, 44100);
  const r = new Resampler(44100);
  const parts = [];
  let seed = 3;
  for (let at = 0; at < x.length;) {
    seed = (seed * 31 + 7) % 997;
    const size = 100 + seed;                            // buffers of uneven size
    parts.push(r.process(x.subarray(at, at + size)));
    at += size;
  }
  const joined = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { joined.set(p, o); o += p.length; }
  assert.ok(whole.length - joined.length >= 0 && whole.length - joined.length <= 8, 'the stream trails by half the filter, a few samples');
  let worst = 0;
  for (let i = 50; i < joined.length - 50; i++) worst = Math.max(worst, Math.abs(joined[i] - whole[i]));
  assert.ok(worst <= 3, `worst difference ${worst}`);
});

test('a teacher across the room and a student at the microphone come out at the same level', () => {
  // 3 s teacher (faint), 3 s student (loud), 3 s teacher, in the same piece
  const raw = scene([[3, 0.006], [0.4, 0], [3, 0.25], [0.4, 0], [3, 0.006]]);
  const out = levelSpeech(raw);
  const before = level(raw, 3.4, 6.4) / level(raw, 0.2, 2.8);
  const after = level(out, 3.5, 6.3) / level(out, 0.3, 2.7);
  assert.ok(before > 20, `before ${before.toFixed(1)}x`);
  assert.ok(after < 3, `after ${after.toFixed(1)}x`);
  assert.ok(level(out, 0.3, 2.7) > 0.04, 'the faint teacher is brought up to a speaking level');
  // the old whole-piece gain left the teacher where it was
  const old = enhanceSpeech(raw);
  assert.ok(level(old, 3.5, 6.3) / level(old, 0.3, 2.7) > 10);
});

test('the hiss between words is not pumped up along with the voice', () => {
  const raw = scene([[2, 0.01], [1, 0], [2, 0.01], [1, 0], [2, 0.01]], 0.0012);
  const out = levelSpeech(raw);
  const gap = level(out, 2.2, 2.8);
  const word = level(out, 0.3, 1.8);
  assert.ok(gap < 0.03, `gap ${gap.toFixed(4)}`);
  assert.ok(word > 0.05, `word ${word.toFixed(4)}`);
  assert.ok(word / gap > 3, 'the voice still stands out of the hiss');
});

test('levelling never clips, leaves silence silent, and still removes rumble', () => {
  const loud = scene([[2, 0.9]]);
  assert.ok(levelSpeech(loud).every(v => Math.abs(v) <= 32767));
  assert.ok(levelSpeech(new Int16Array(R)).every(v => v === 0));
  assert.equal(levelSpeech(new Int16Array(0)).length, 0);
  const mix = Int16Array.from({ length: R }, (_, i) => Math.round((Math.sin(2 * Math.PI * 20 * i / R) * 0.2 + Math.sin(2 * Math.PI * 1000 * i / R) * 0.02) * 32767));
  const amp = (x, hz) => {
    let s = 0, c = 0;
    for (let i = 0; i < x.length; i++) { const t = 2 * Math.PI * hz * i / R; s += x[i] * Math.sin(t); c += x[i] * Math.cos(t); }
    return Math.hypot(s, c) / x.length;
  };
  const out = levelSpeech(mix);
  assert.ok(amp(out, 20) / amp(out, 1000) < (amp(mix, 20) / amp(mix, 1000)) / 3);
});

test('faint speech is kept, a steady hum and silence are not', () => {
  assert.equal(isSilent(new Int16Array(15 * R)), true);
  const hum = scene([[15, 0]], 0.004);                                  // a fan: steady, nothing in it
  assert.equal(isSilent(hum), true);
  const faint = scene([[2, 0.006], [1.5, 0], [2, 0.006], [1.5, 0], [3, 0.006]], 0.0005);   // speaking about two thirds of the time
  assert.equal(isSilent(faint), false);
  const far = speechStats(faint);
  assert.ok(far.speech > 2 * far.floor);
  // a teacher so far away the average sound is quieter than the old gate allowed
  const veryFar = scene([[1, 0.011], [3, 0], [1, 0.011], [3, 0], [1, 0.011], [3, 0]], 0.0003);   // words at about -50 dB, 1 s in 4
  assert.ok(rms(veryFar) < 0.0022, `average ${rms(veryFar).toFixed(4)}`);
  assert.equal(isSilent(veryFar), false);
  const levelled = levelSpeech(veryFar);
  assert.ok(level(levelled, 0.2, 0.9) > 0.05, 'and it is brought up to where a speech model can use it');
});

test('pieces are cut in the pauses between sentences, and joined they are exactly the recording', () => {
  // sentences of 3 to 7 seconds with 0.6 to 1 second pauses, for about 80 seconds
  const parts = [];
  let len = 0, k = 0;
  while (len < 80) { const s = 3 + (k * 7) % 5, p = 0.6 + ((k * 3) % 5) / 12; parts.push([s, 0.05], [p, 0]); len += s + p; k++; }
  const stream = scene(parts);
  const cutter = new PauseCutter();
  const pieces = [];
  for (let at = 0; at < stream.length; at += 4096) pieces.push(...cutter.push(stream.subarray(at, at + 4096)));
  const rest = cutter.flush();
  if (rest) pieces.push(rest);

  assert.ok(pieces.length >= 5 && pieces.length <= 12, `${pieces.length} pieces`);
  const joined = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) { joined.set(p, o); o += p.length; }
  assert.equal(joined.length, stream.length);
  assert.ok(joined.every((v, i) => v === stream[i]), 'nothing lost, nothing repeated');
  for (const p of pieces.slice(0, -1)) {
    assert.ok(p.length / R >= MIN_CHUNK_SECONDS - 0.01 && p.length / R <= MAX_CHUNK_SECONDS + 0.01, `${p.length / R}s`);
  }
  // every cut falls in a pause: the sound either side of it is the room, not a word
  let at = 0;
  for (const p of pieces.slice(0, -1)) {
    at += p.length;
    assert.ok(level(stream, at / R - 0.1, at / R + 0.1) < 0.004, `cut at ${(at / R).toFixed(2)}s is inside a word`);
  }
});

test('if nobody ever pauses it still cuts, at the longest allowed', () => {
  const stream = scene([[60, 0.05]]);
  const cutter = new PauseCutter();
  const pieces = [];
  for (let at = 0; at < stream.length; at += 4096) pieces.push(...cutter.push(stream.subarray(at, at + 4096)));
  assert.ok(pieces.length >= 2);
  assert.ok(pieces.every(p => p.length / R <= MAX_CHUNK_SECONDS + 0.01));
  const total = pieces.reduce((n, p) => n + p.length, 0) + (cutter.flush()?.length || 0);
  assert.equal(total, stream.length);
});

test('flushing sends what is there, but not less than asked', () => {
  const cutter = new PauseCutter();
  cutter.push(scene([[3, 0.05]]));
  assert.equal(cutter.flush(5 * R), null);
  assert.equal(cutter.flush(2 * R).length, 3 * R);
  assert.equal(cutter.flush(), null);
});

test('WAV pieces join into one WAV', () => {
  const a = encodeWav(Int16Array.from([1, 2, 3]));
  const b = encodeWav(Int16Array.from([4, 5]));
  const w = joinWav([a, b]);
  const v = new DataView(w.buffer);
  assert.equal(w.length, 44 + 10);
  assert.equal(v.getUint32(40, true), 10);
  assert.equal(v.getUint32(4, true), 36 + 10);
  assert.deepEqual([...new Int16Array(w.slice(44).buffer)], [1, 2, 3, 4, 5]);
  assert.equal(joinWav([]).length, 44);
});

test('what the room sounds like, from the loud end of the last twenty seconds', () => {
  assert.equal(classifyHearing(0), 'silent');
  assert.equal(classifyHearing(0.0012), 'quiet');
  assert.equal(classifyHearing(0.02), 'ok');
});

test('frame loudness covers the whole piece', () => {
  assert.equal(frameLevels(new Int16Array(R), R, 30).length, Math.ceil(R / 480));
  assert.ok(frameLevels(Int16Array.from({ length: 480 }, () => 16384), R, 30)[0] > 0.49);
});
