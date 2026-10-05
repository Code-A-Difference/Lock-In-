import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { HandsFree, listenOnce } from '../src/lib/listen.js';

/** A recogniser we drive by hand. */
function fake() {
  const made = [];
  class Rec {
    constructor() { made.push(this); this.starts = 0; }
    start() { this.starts++; }
    abort() { this.aborted = true; }
    say(text, final, at = 0) {
      const results = [];
      for (let i = 0; i < at; i++) results.push(Object.assign([{ transcript: '' }], { isFinal: true }));
      results.push(Object.assign([{ transcript: text }], { isFinal: final }));
      this.onresult({ resultIndex: at, results });
    }
  }
  return { Rec, made };
}
const make = (extra = {}) => {
  const log = { wake: 0, cmds: [], heard: [], errors: [] };
  const { Rec, made } = fake();
  const hf = new HandsFree({ recognition: Rec, onWake: () => log.wake++, onCommand: (t) => log.cmds.push(t), onHeard: (t) => log.heard.push(t), onError: (m) => log.errors.push(m), ...extra });
  return { hf, log, made };
};

const timed = (fn) => () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try { fn(); } finally { mock.timers.reset(); }
};

test('wakes on the interim words, acts on the whole sentence once you pause', timed(() => {
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
  assert.deepEqual(log.cmds, []);             // still listening for more
  mock.timers.tick(1400);
  assert.deepEqual(log.cmds, ['start a focus session for 50 minutes']);
  hf.stop();
}));

test('a long request that arrives in pieces is sent whole, not just its first piece', timed(() => {
  const { hf, log, made } = make();
  hf.start();
  const r = made[0];
  r.say('hey lock in add a biology test', true, 0);
  mock.timers.tick(500);
  r.say('on friday about cell', false, 1);
  mock.timers.tick(1500);                     // still talking (interim), so not sent yet
  assert.deepEqual(log.cmds, []);
  r.say('on friday about cell division', true, 1);
  mock.timers.tick(1400);
  assert.deepEqual(log.cmds, ['add a biology test on friday about cell division']);
  assert.match(log.heard.at(-1), /cell division/);
  hf.stop();
}));

test('speech with no wake phrase is ignored — a classmate saying "stop" does nothing', () => {
  const { hf, log, made } = make();
  hf.start();
  made[0].say('stop the timer please', true);
  assert.deepEqual(log.cmds, []);
  hf.stop();
});

test('after the wake phrase alone, or after an answer, the next sentence needs no wake phrase', timed(() => {
  const { hf, log, made } = make();
  hf.start();
  made[0].say('hey lock in', true);
  assert.equal(log.wake, 1);
  mock.timers.tick(1400);
  made[0].say('what is due tomorrow', true);
  mock.timers.tick(1400);
  assert.deepEqual(log.cmds, ['what is due tomorrow']);
  made[0].say('and the day after', true);     // window closed
  mock.timers.tick(1400);
  assert.deepEqual(log.cmds, ['what is due tomorrow']);
  hf.extend(10000);                           // the assistant finished answering
  made[0].say('and the day after', true);
  mock.timers.tick(1400);
  assert.deepEqual(log.cmds, ['what is due tomorrow', 'and the day after']);
  hf.stop();
}));

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

test('tap to talk keeps listening through a breath and sends what it showed, unfinished words included', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { Rec, made } = fake();
    const shown = [];
    const { promise } = listenOnce({ recognition: Rec, onInterim: (t) => shown.push(t) });
    const r = made[0];
    r.stop = () => r.onend();
    r.say('explain how', true, 0);
    mock.timers.tick(1000);                    // a breath, not the end
    r.say('photosynthesis works in', false, 1);
    mock.timers.tick(1700);                    // now a real pause
    assert.equal(await promise, 'explain how photosynthesis works in');
    assert.equal(shown.at(-1), 'explain how photosynthesis works in');
  } finally { mock.timers.reset(); }
});
