import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceprint, soundsLikeYou, resampleTo16k, Ring, RATE } from '../src/lib/voiceprint.js';

// A stand-in for a spoken phrase: a run of vowel-like sounds (two formants each), at some speed.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
function phrase(vowels, { speed = 1, noise = 0.01, pad = 0.3, pitch = 140 } = {}) {
  const seg = Math.round(0.16 * RATE / speed);
  const padN = Math.round(pad * RATE);
  const out = new Float32Array(padN * 2 + seg * vowels.length);
  for (let i = 0; i < out.length; i++) out[i] = rand() * noise;
  vowels.forEach(([f1, f2], v) => {
    for (let i = 0; i < seg; i++) {
      const t = (v * seg + i) / RATE;
      const env = Math.sin((Math.PI * i) / seg);
      let s = 0;
      for (let h = 1; h * pitch < 4000; h++) {
        const f = h * pitch;
        const g = Math.exp(-(((f - f1) / 120) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 160) ** 2));
        s += g * Math.sin(2 * Math.PI * f * t) / h ** 0.3;
      }
      out[padN + v * seg + i] += 0.25 * env * s;
    }
  });
  return out;
}

const HEY_COMPANION = [[700, 1800], [400, 2300], [500, 1000], [650, 1200], [300, 2300], [450, 900], [350, 1400]];
const OTHER = [[300, 870], [750, 1250], [270, 2290], [600, 1000], [700, 1700], [350, 2500], [520, 1200]];

test('a trained voiceprint accepts the phrase, said a little differently', () => {
  const vp = buildVoiceprint([0.9, 1, 1.1, 1.05].map(speed => phrase(HEY_COMPANION, { speed })));
  for (const speed of [0.95, 1.08]) {
    const r = soundsLikeYou(phrase(HEY_COMPANION, { speed, noise: 0.02, pad: 0.6 }), vp);
    assert.ok(r.ok, `should accept at speed ${speed} (cost ${r.cost} vs ${r.threshold})`);
  }
});

test('it rejects other speech and silence', () => {
  const vp = buildVoiceprint([0.9, 1, 1.1, 1.05].map(speed => phrase(HEY_COMPANION, { speed })));
  assert.equal(soundsLikeYou(phrase(OTHER), vp).ok, false);
  assert.equal(soundsLikeYou(phrase(HEY_COMPANION.slice().reverse()), vp).ok, false);
  assert.equal(soundsLikeYou(new Float32Array(RATE), vp).ok, false);
});

test('untrained: everything still counts', () => {
  assert.equal(soundsLikeYou(phrase(OTHER), null).ok, true);
});

test('recordings of different things are refused in training', () => {
  assert.throws(() => buildVoiceprint([phrase(HEY_COMPANION), phrase(OTHER), phrase(HEY_COMPANION, { speed: 1.2 }), new Float32Array(RATE)]));
});

test('resampling and the ring buffer', () => {
  assert.equal(resampleTo16k(new Float32Array(48000), 48000).length, 16000);
  const r = new Ring(1);
  r.push(new Float32Array(10000).fill(0.5));
  r.push(new Float32Array(10000).fill(-0.5));
  const out = r.read();
  assert.equal(out.length, RATE);
  assert.equal(out[out.length - 1], -0.5);
  assert.equal(out[0], 0.5);
});
