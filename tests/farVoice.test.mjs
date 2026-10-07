import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceSpeech, rms, isSilent, SAMPLE_RATE } from '../src/lib/recorder.js';
import { cleanPiece } from '../src/lib/lectureNotes.js';

// a faint "voice": 220 Hz bursts at about -30 dB, with gaps
function faintVoice(seconds = 2, amp = 0.01) {
  const out = new Int16Array(SAMPLE_RATE * seconds);
  for (let i = 0; i < out.length; i++) {
    const on = Math.floor(i / (SAMPLE_RATE * 0.25)) % 2 === 0;
    out[i] = Math.round((on ? Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE) * amp : 0) * 32767);
  }
  return out;
}

test('a faraway voice is raised to a normal speaking level', () => {
  const quiet = faintVoice();
  const loud = enhanceSpeech(quiet);
  assert.ok(rms(quiet) < 0.01);
  assert.ok(rms(loud) > 10 * rms(quiet), `${rms(quiet)} -> ${rms(loud)}`);
  assert.ok(Math.max(...loud.map(Math.abs)) <= 32767);
});

test('a voice is not counted as silence just because it is far away', () => {
  assert.equal(isSilent(faintVoice(2, 0.005)), false);
  assert.equal(isSilent(new Int16Array(SAMPLE_RATE)), true);
});

test('loud audio is not boosted or clipped harshly; low rumble is removed', () => {
  const loud = faintVoice(2, 0.5);
  const out = enhanceSpeech(loud);
  assert.ok(rms(out) < 1.5 * rms(loud));
  // a voice-band tone over a loud 20 Hz rumble: the rumble's share drops sharply
  const amp = (x, hz) => {   // amplitude of one frequency in x
    let s = 0, c = 0;
    for (let i = 0; i < x.length; i++) { const t = 2 * Math.PI * hz * i / SAMPLE_RATE; s += x[i] * Math.sin(t); c += x[i] * Math.cos(t); }
    return Math.hypot(s, c) / x.length;
  };
  const mix = new Int16Array(SAMPLE_RATE).map((_, i) => Math.round((Math.sin(2 * Math.PI * 20 * i / SAMPLE_RATE) * 0.2 + Math.sin(2 * Math.PI * 1000 * i / SAMPLE_RATE) * 0.02) * 32767));
  const out2 = enhanceSpeech(mix);
  const before = amp(mix, 20) / amp(mix, 1000), after = amp(out2, 20) / amp(out2, 1000);
  assert.ok(after < before / 3, `rumble:voice ${before.toFixed(2)} -> ${after.toFixed(2)}`);
});

test('[inaudible]-style tags are removed; a piece that is only tags is empty', () => {
  assert.equal(cleanPiece('[inaudible]'), '');
  assert.equal(cleanPiece(' [ Inaudible ] (indistinct chatter) [BLANK_AUDIO] '), '');
  assert.equal(cleanPiece('So the mitochondria [inaudible] the cell.'), 'So the mitochondria the cell.');
  assert.equal(cleanPiece('Today we learn (unintelligible) about cells.'), 'Today we learn about cells.');
  assert.equal(cleanPiece('Thank you.', 0.001), '');
  assert.equal(cleanPiece('Thank you for the question about osmosis.', 0.001), 'Thank you for the question about osmosis.');
});
