import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, sessionLive, pickSession, lockedHere, sessionExit, requestSessionExit, confirmSessionExit, cancelSessionExit, finishSession, reactTo, MAX_SESSION_MS } from '../src/lib/crossLock.js';
import { TERMS_VERSION, termsStatus, canAccept, makeTermsRecord } from '../src/lib/strictTerms.js';

const T0 = 1_700_000_000_000;
const mk = (o = {}) => newSession({ id: 'a1', deviceId: 'dev-A', kind: 'desktop', startedAt: T0, endsAt: T0 + 25 * 60000, plannedMin: 25, pages: ['desmos.com'], support: [], delaySec: 30, ...o });

test('terms: nothing is agreed until the student ticks; under 18 also needs a guardian', () => {
  assert.equal(canAccept({}).ok, false);
  assert.equal(canAccept({ agree: true }).ok, true);
  assert.equal(canAccept({ agree: true, under18: true }).ok, false);
  assert.equal(canAccept({ agree: true, under18: true, guardianOk: true }).ok, true);
  assert.equal(canAccept({ agree: false, under18: true, guardianOk: true }).ok, false);
  assert.throws(() => makeTermsRecord({ agree: true, under18: true, guardianOk: false }));
  assert.throws(() => makeTermsRecord({ agree: false }));
});

test('terms: a record is good only for the version it was agreed to', () => {
  const rec = makeTermsRecord({ agree: true, device: 'phone', now: T0 });
  assert.equal(termsStatus(rec), 'ok');
  assert.equal(termsStatus(null), 'none');
  assert.equal(termsStatus({ ...rec, v: TERMS_VERSION - 1 }), 'old');
  assert.equal(termsStatus({ ...rec, v: TERMS_VERSION + 1 }), 'old');
  // a hand-edited under-18 record without the guardian tick does not count
  assert.equal(termsStatus({ ...rec, under18: true, guardianOk: false }), 'none');
  assert.equal(makeTermsRecord({ agree: true, under18: false, guardianOk: true }).guardianOk, false);
});

test('a session is live until its end, never longer than four hours, and not once it has ended', () => {
  const s = mk();
  assert.equal(sessionLive(s, T0 + 1000), true);
  assert.equal(sessionLive(s, T0 + 25 * 60000), false);
  assert.equal(sessionLive({ ...s, endedAt: T0 + 5 }, T0 + 1000), false);
  assert.equal(sessionLive(null, T0), false);
  const long = mk({ endsAt: T0 + 10 * 3600000 });
  assert.equal(long.endsAt, T0 + MAX_SESSION_MS);
  assert.equal(sessionLive({ ...long, endsAt: T0 + 10 * 3600000 }, T0 + 1000), false, 'a tampered record longer than four hours is not honoured');
});

test('two devices start at once: the earlier start wins, ties go to the smaller id, a live one beats a finished one', () => {
  const a = mk({ id: 'a1', startedAt: T0 });
  const b = mk({ id: 'b1', deviceId: 'dev-B', startedAt: T0 + 400, endsAt: T0 + 60 * 60000 });
  assert.equal(pickSession(a, b, T0 + 1000).id, 'a1');
  assert.equal(pickSession(b, a, T0 + 1000).id, 'a1');
  const tie = mk({ id: 'a0', deviceId: 'dev-B', startedAt: T0 });
  assert.equal(pickSession(a, tie, T0 + 1000).id, 'a0');
  const done = { ...a, endedAt: T0 + 5 };
  assert.equal(pickSession(done, b, T0 + 1000).id, 'b1');
});

test('only the other device is locked', () => {
  const s = mk();
  assert.equal(lockedHere(s, { deviceId: 'dev-A', now: T0 + 1000 }), false);
  assert.equal(lockedHere(s, { deviceId: 'dev-B', now: T0 + 1000 }), true);
  assert.equal(lockedHere(s, { deviceId: 'dev-B', now: T0 + 26 * 60000 }), false, 'it lets go by itself at the end time');
});

test('the early-exit countdown works from either device and is idempotent', () => {
  let s = mk({ delaySec: 20 });
  assert.equal(sessionExit(s, T0).phase, 'idle');
  s = requestSessionExit(s, T0 + 1000);
  const again = requestSessionExit(s, T0 + 9000);
  assert.equal(again.exitReqAt, s.exitReqAt, 'asking again does not restart the wait');
  assert.equal(confirmSessionExit(s, T0 + 10000), null, 'too soon');
  const ended = confirmSessionExit(s, T0 + 22000);
  assert.ok(ended && ended.endedAt === T0 + 22000 && ended.endReason === 'early');
  assert.equal(sessionLive(ended, T0 + 22001), false);
  assert.equal(confirmSessionExit(s, T0 + 1000 + 20000 + 61000), null, 'the confirm window expires');
  assert.equal(cancelSessionExit(s).exitReqAt, null);
});

test('reactTo: lock the other device; the starting device lets go when the other one ended it early', () => {
  const s = mk();
  assert.equal(reactTo(s, { deviceId: 'dev-B', now: T0 + 1000 }).action, 'lock');
  assert.equal(reactTo(s, { deviceId: 'dev-A', ownSessionId: 'a1', now: T0 + 1000 }).action, 'none');
  const early = confirmSessionExit(requestSessionExit(s, T0), T0 + 40000);
  assert.equal(reactTo(early, { deviceId: 'dev-A', ownSessionId: 'a1', now: T0 + 41000 }).action, 'release-own');
  assert.equal(reactTo(finishSession(s, T0 + 25 * 60000), { deviceId: 'dev-A', ownSessionId: 'a1', now: T0 + 25 * 60000 }).action, 'none');
  assert.equal(reactTo(early, { deviceId: 'dev-A', ownSessionId: 'zzz', now: T0 + 41000 }).action, 'none');
});
