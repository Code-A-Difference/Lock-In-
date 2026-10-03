import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { HandsFree } from '../src/lib/listen.js';

/** A recogniser we drive by hand. */
function fake() {
  const made = [];
  class Rec {
    constructor() { made.push(this); this.starts = 0; }
    start() { this.starts++; }
    abort() { this.aborted = true; }
    say(text, final) { this.onresult({ resultIndex: 0, results: Object.assign([Object.assign([{ transcript: text }], { isFinal: final })], { length: 1 }) }); }
  }
  return { Rec, made };
}
const make = (extra = {}) => {
  const log = { wake: 0, cmds: [], heard: [], errors: [] };
  const { Rec, made } = fake();
  const hf = new HandsFree({ recognition: Rec, onWake: () => log.wake++, onCommand: (t) => log.cmds.push(t), onHeard: (t) => log.heard.push(t), onError: (m) => log.errors.push(m), ...extra });
  return { hf, log, made };
};

test('wakes on the interim words, acts on the finished sentence', () => {
  const { hf, log, made } = make();
  hf.start();
  const r = made[0];
  r.say('hey lock', false);                  // not yet a wake phrase
  assert.equal(log.wake, 0);
  r.say('hey locking start a focus', false);
  assert.equal(log.wake, 1);                  // the chime can play now
  assert.deepEqual(log.cmds, []);
  r.say('hey locking start a focus session for 50 minutes', true);
  assert.equal(log.wake, 1);                  // not announced twice
  assert.deepEqual(log.cmds, ['start a focus session for 50 minutes']);
  hf.stop();
});

test('speech with no wake phrase is ignored — a classmate saying "stop" does nothing', () => {
  const { hf, log, made } = make();
  hf.start();
  made[0].say('stop the timer please', true);
  assert.deepEqual(log.cmds, []);
  hf.stop();
});

test('after the wake phrase alone, or after an answer, the next sentence needs no wake phrase', () => {
  const { hf, log, made } = make();
  hf.start();
  made[0].say('hey lock in', true);
  assert.equal(log.wake, 1);
  made[0].say('what is due tomorrow', true);
  assert.deepEqual(log.cmds, ['what is due tomorrow']);
  made[0].say('and the day after', true);     // window closed
  assert.deepEqual(log.cmds, ['what is due tomorrow']);
  hf.extend(10000);                           // the assistant finished answering
  made[0].say('and the day after', true);
  assert.deepEqual(log.cmds, ['what is due tomorrow', 'and the day after']);
  hf.stop();
});

test('it does not hear itself: results are dropped while muted, without closing the mic', () => {
  const { hf, log, made } = make();
  hf.start();
  hf.setMuted(true);
  made[0].say('hey lock in you have two things due', true);
  assert.equal(log.wake, 0);
  assert.equal(made.length, 1);               // no teardown, no new session
  assert.notEqual(made[0].aborted, true);
  hf.setMuted(false);
  made[0].say('hey lock in', true);           // still deaf for the echo tail
  assert.equal(log.wake, 0);
  hf.stop();
});

test('a session that keeps dying backs off, then gives up — it does not flicker forever', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { hf, log, made } = make();
    hf.start();
    const gaps = [];
    let last = Date.now();
    for (let i = 0; i < 12 && hf.running; i++) {
      made[made.length - 1].onend();           // dies at once, every time
      mock.timers.tick(20000);
      gaps.push(made.length);
    }
    assert.equal(hf.running, false);
    assert.equal(log.errors.length, 1);
    assert.match(log.errors[0], /keeps cutting out/);
    assert.ok(made.length <= 9, `opened ${made.length} sessions`);
    void last; void gaps;
  } finally { mock.timers.reset(); }
});

test('a normal end (a minute of quiet) reopens quickly', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { hf, made } = make();
    hf.start();
    mock.timers.tick(60000);                   // it lived a minute
    made[0].onend();
    mock.timers.tick(200);
    assert.equal(made.length, 2);
    hf.stop();
  } finally { mock.timers.reset(); }
});

test('a blocked microphone stops it and says so', () => {
  const { hf, log, made } = make();
  hf.start();
  made[0].onerror({ error: 'not-allowed' });
  assert.equal(hf.running, false);
  assert.match(log.errors[0], /blocked/);
});
