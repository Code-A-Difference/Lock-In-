import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranscribeQueue } from '../src/lib/transcribeQueue.js';

/** A clock the test moves by hand, so backoffs of minutes take no time. */
function clock() {
  let t = 1_000_000;
  const timers = [];
  let id = 0;
  return {
    now: () => t,
    setTimer(fn, ms) { const k = ++id; timers.push({ k, at: t + ms, fn }); return k; },
    clearTimer(k) { const i = timers.findIndex(x => x.k === k); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
        await settle();
      }
      t = end;
      await settle();
    },
  };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

const piece = (start, lectureId = 'L1', extra = {}) => ({ id: `${lectureId}|${start}`, lectureId, start, ...extra });

function make(send, extra = {}) {
  const c = clock();
  const results = [];
  const failed = [];
  const q = new TranscribeQueue({
    send, onResult: (p, text) => results.push([p.start, text]), onFail: (p, e) => failed.push([p.start, e.message]),
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, random: () => 0.5, ...extra,
  });
  return { q, c, results, failed };
}

const busy = () => Object.assign(new Error('The service is busy.'), { status: 429 });

test('pieces are transcribed two at a time, and all of them are', async () => {
  const live = [];
  let most = 0;
  const { q, results } = make(async (p) => {
    live.push(p.start);
    most = Math.max(most, live.length);
    await new Promise(r => setImmediate(r));
    live.splice(live.indexOf(p.start), 1);
    return `text ${p.start}`;
  });
  for (const s of [0, 15, 30, 45]) q.add(piece(s));
  await settle();
  assert.deepEqual(results.map(r => r[0]), [0, 15, 30, 45]);
  assert.equal(most, 2);
  assert.deepEqual(q.stats(), { waiting: 0, active: 0, failed: 0, nextAt: 0, error: '' });
});

test('of the pieces waiting, the earliest goes next', async () => {
  const order = [];
  const { q } = make(async (p) => { order.push(p.start); await new Promise(r => setImmediate(r)); return 'x'; }, { concurrency: 1 });
  for (const s of [30, 45, 0, 15]) q.add(piece(s));
  await settle();
  assert.deepEqual(order, [30, 0, 15, 45]);        // 30 had already started when the others came
});

test('a busy service is waited out, with longer waits each time, then the pieces go through', async () => {
  let calls = 0;
  const times = [];
  const { q, c, results } = make(async (p) => { calls++; times.push(c.now()); if (calls <= 3) throw busy(); return `ok ${p.start}`; }, { concurrency: 1 });
  q.add(piece(0));
  q.add(piece(15));
  await settle();
  assert.equal(results.length, 0);
  assert.equal(q.stats().waiting, 2);
  assert.ok(q.stats().nextAt > c.now(), 'it says when it will try again');
  await c.advance(3000);
  assert.equal(calls, 1, 'nothing is sent before the wait is over');
  await c.advance(60000);
  assert.deepEqual(results.map(r => r[0]), [0, 15]);
  const gaps = times.slice(1, 4).map((t, i) => t - times[i]);        // between the three failed tries and the one that worked
  assert.ok(gaps[0] >= 4000 && gaps[1] >= 8000 && gaps[2] >= 16000, `waits grow: ${gaps}`);
});

test('a piece that is the problem is given up on at once, and does not hold up the others', async () => {
  const { q, results, failed } = make(async (p) => {
    if (p.start === 15) throw Object.assign(new Error('That piece of recording is too long.'), { retryable: false, status: 413 });
    return `ok ${p.start}`;
  });
  for (const s of [0, 15, 30]) q.add(piece(s));
  await settle();
  assert.deepEqual(results.map(r => r[0]).sort((a, b) => a - b), [0, 30]);
  assert.deepEqual(failed, [[15, 'That piece of recording is too long.']]);
  assert.equal(q.stats().failed, 1);
});

test('after enough tries a piece is marked failed; retry() gives every failed piece a fresh start', async () => {
  let up = false;
  const { q, c, results, failed } = make(async () => { if (!up) throw busy(); return 'back'; }, { maxAttempts: 3, baseDelay: 1000, maxDelay: 2000 });
  q.add(piece(0));
  for (let i = 0; i < 6; i++) await c.advance(3000);
  assert.equal(q.stats().failed, 1);
  assert.equal(failed.length, 1);
  up = true;
  q.retry();
  await settle();
  assert.deepEqual(results, [[0, 'back']]);
  assert.equal(q.stats().failed, 0);
});

test('a request that hangs is cut off and tried again, so it cannot block the lecture', async () => {
  let calls = 0;
  const { q, c, results } = make((p, signal) => {
    calls++;
    if (calls === 1) return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return Promise.resolve('fine');
  }, { timeout: 5000, baseDelay: 1000 });
  q.add(piece(0));
  await c.advance(4000);
  assert.equal(results.length, 0);
  await c.advance(4000);       // the 5 s limit passes
  await c.advance(4000);
  assert.deepEqual(results, [[0, 'fine']]);
});

test('settled() answers when a lecture is finished, or when nothing is getting through', async () => {
  let up = true;
  const { q, c } = make(async (p) => { if (!up) throw busy(); return 'x'; });
  q.add(piece(0));
  const done = await Promise.race([q.settled('L1', { stallMs: 20000 }), c.advance(1000).then(() => null)]);
  assert.deepEqual(done ?? await q.settled('L1'), { outcome: 'done', failed: 0 });

  up = false;
  q.add(piece(15));
  q.add(piece(30, 'L2'));
  let outcome = null;
  q.settled('L1', { stallMs: 20000 }).then(o => { outcome = o; });
  await c.advance(10000);
  assert.equal(outcome, null);
  await c.advance(15000);
  assert.deepEqual(outcome, { outcome: 'stalled' });
  assert.equal(q.stats('L2').waiting, 1, 'and it carries on trying afterwards');
});

test('kick() skips the wait (the connection is back); remove() forgets a deleted lecture', async () => {
  let up = false;
  const { q, c, results } = make(async () => { if (!up) throw busy(); return 'x'; }, { baseDelay: 60000, maxDelay: 60000 });
  q.add(piece(0));
  await settle();
  assert.equal(q.stats().waiting, 1);
  up = true;
  q.kick();
  await settle();
  assert.equal(results.length, 1);

  up = false;
  q.add(piece(15, 'L9'));
  await settle();
  q.remove('L9');
  assert.equal(q.stats('L9').waiting, 0);
  up = true;
  await c.advance(120000);
  assert.equal(results.length, 1, 'a deleted lecture is not transcribed');
});

test('a piece added twice is sent once; a lecture being recorded goes before old ones being retried', async () => {
  const order = [];
  const { q } = make(async (p) => { order.push(p.id); await new Promise(r => setImmediate(r)); return 'x'; }, { concurrency: 1 });
  q.add(piece(0, 'old'));
  q.add(piece(0, 'old'));
  q.add(piece(15, 'old'));
  q.add(piece(0, 'live', { priority: 1 }));
  await settle();
  assert.deepEqual(order, ['old|0', 'live|0', 'old|15']);        // 'old|0' had already started when 'live' arrived, and 'old|15' has waited longer but is not live
});
