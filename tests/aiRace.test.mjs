import test from 'node:test';
import assert from 'node:assert/strict';
import { raceAI, hedgeDelay, usualTime, noteTime } from '../src/lib/aiRace.js';

const wait = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
});

test('hedge delay is about twice the usual time, within bounds', () => {
  assert.equal(hedgeDelay(null), 3500);
  assert.equal(hedgeDelay(1500), 3000);
  assert.equal(hedgeDelay(200), 2500);
  assert.equal(hedgeDelay(30000), 9000);
  assert.equal(hedgeDelay(null, true), 9000);
  assert.equal(hedgeDelay(5000, true), 10000);
});

test('a quick answer is never raced (no second request)', async () => {
  const aborted = [];
  const send = async (lane, signal) => {
    signal.addEventListener('abort', () => aborted.push(lane));
    await wait(lane === 0 ? 400 : 30, signal);
    return `lane ${lane}`;
  };
  const t = Date.now();
  const r = await raceAI(send, { usualMs: 50 });        // race delay: the 2500 ms floor
  // lane 0 answers in 400 ms, long before any race starts
  assert.equal(r.value, 'lane 0');
  assert.ok(Date.now() - t < 1000);
  assert.deepEqual(aborted, []);
});

test('when the first lane lags past the delay, the second starts and wins', async () => {
  const started = [];
  const cancelled = [];
  const send = async (lane, signal) => {
    started.push(lane);
    signal.addEventListener('abort', () => cancelled.push(lane));
    await wait(lane === 0 ? 6000 : 100, signal);
    return `lane ${lane}`;
  };
  const t = Date.now();
  const r = await raceAI(send, { usualMs: 1250 });      // delay 2500 ms
  const ms = Date.now() - t;
  assert.equal(r.value, 'lane 1');
  assert.equal(r.lane, 1);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(cancelled, [0]);
  assert.ok(ms >= 2500 && ms < 3500, `took ${ms} ms`);
});

test('a server error that already tried every key ends the race at once', async () => {
  const started = [];
  const send = async (lane) => { started.push(lane); throw Object.assign(new Error('All keys failed'), { final: true }); };
  await assert.rejects(raceAI(send), /All keys failed/);
  assert.deepEqual(started, [0]);
});

test('a dropped connection on the first lane is retried on the second', async () => {
  const send = async (lane) => { if (lane === 0) throw new Error('network'); return 'ok from 1'; };
  const r = await raceAI(send);
  assert.equal(r.value, 'ok from 1');
});

test('if the racing lane fails, the first lane can still answer', async () => {
  const send = async (lane, signal) => {
    if (lane === 1) throw Object.assign(new Error('lane 1 failed'), { final: true });
    await wait(2800, signal);
    return 'lane 0 after all';
  };
  const r = await raceAI(send, { usualMs: 1250 });
  assert.equal(r.value, 'lane 0 after all');
});

test('the usual time is learned per device and kind', () => {
  const mem = new Map();
  const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(usualTime('s', store), null);
  noteTime('s', 1000, store);
  noteTime('s', 2000, store);
  assert.equal(usualTime('s', store), 1300);
  assert.equal(usualTime('l', store), null);
  assert.equal(usualTime('s', { getItem() { throw new Error('blocked'); } }), null);
});
