// Node test for the utterance cutter behind on-device "Hey Lock In".
import assert from 'node:assert/strict';
import { Segmenter } from '../src/lib/localEar.js';

const RATE = 16000;
function tone(ms, amp) {
  const n = Math.round(RATE * ms / 1000), a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin(i / 8) * amp * 32767 + (Math.random() - 0.5) * 60);
  return a;
}
const quiet = (ms) => tone(ms, 0.001);

// speech between quiet stretches -> one utterance, with a little lead-in kept
{
  const got = []; let starts = 0;
  const s = new Segmenter({ onUtterance: (p) => got.push(p), onStart: () => starts++ });
  s.push(quiet(2000)); s.push(tone(1200, 0.08)); s.push(quiet(1500));
  assert.equal(got.length, 1); assert.equal(starts, 1);
  const ms = got[0].length / RATE * 1000;
  assert.ok(ms > 1200 && ms < 2400, `length ${ms}`);
}
// two sentences with a long pause -> two utterances
{
  const got = [];
  const s = new Segmenter({ onUtterance: (p) => got.push(p) });
  s.push(quiet(1000)); s.push(tone(800, 0.05)); s.push(quiet(1200)); s.push(tone(900, 0.05)); s.push(quiet(1200));
  assert.equal(got.length, 2);
}
// a click (too short) is not an utterance
{
  const got = [];
  const s = new Segmenter({ onUtterance: (p) => got.push(p) });
  s.push(quiet(1000)); s.push(tone(140, 0.3)); s.push(quiet(1500));
  assert.equal(got.length, 0);
}
// a steady loud background (fan) is learnt, not treated as endless speech
{
  const got = [];
  const s = new Segmenter({ onUtterance: (p) => got.push(p), maxMs: 15000 });
  for (let i = 0; i < 40; i++) s.push(tone(500, 0.004));
  s.push(tone(1000, 0.06)); s.push(tone(1500, 0.004));
  assert.equal(got.length, 1);
}
// talking non-stop is cut at the cap
{
  const got = [];
  const s = new Segmenter({ onUtterance: (p) => got.push(p), maxMs: 3000 });
  s.push(quiet(500)); s.push(tone(7000, 0.05));
  assert.ok(got.length >= 2);
}
// flush() hands over a sentence in progress
{
  const got = [];
  const s = new Segmenter({ onUtterance: (p) => got.push(p) });
  s.push(quiet(500)); s.push(tone(900, 0.05));
  assert.equal(s.flush(), true); assert.equal(got.length, 1);
  assert.equal(s.flush(), false);
}
// the first ~1.3 s of a longer utterance is handed over early, once (to spot "Hey Lock In")
{
  const peeks = [], got = [];
  const s = new Segmenter({ onUtterance: (p) => got.push(p), onPeek: (p) => peeks.push(p) });
  s.push(quiet(800)); s.push(tone(3000, 0.06)); s.push(quiet(1200));
  assert.equal(peeks.length, 1);
  const ms = peeks[0].length / RATE * 1000;
  assert.ok(ms > 1200 && ms < 1500, `peek ${ms}`);
  assert.equal(got.length, 1);
  const short = [];
  const s2 = new Segmenter({ onUtterance: () => {}, onPeek: (p) => short.push(p) });
  s2.push(quiet(800)); s2.push(tone(700, 0.06)); s2.push(quiet(1200));
  assert.equal(short.length, 0);
}
console.log('localEar: all passed');
