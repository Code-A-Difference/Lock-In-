import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStrict, hostMatches, cleanHosts, MAX_BLOCK_MS, CONFIRM_WINDOW_MS } = require('../strict.js');

const SPEC = (extra = {}) => ({ id: 'b1', endsAt: 1_000_000 + 25 * 60_000, pages: ['codeadifference.ct.ws', 'desmos.com'], support: ['gstatic.com'], delaySec: 30, ...extra });

function make(startAt = 1_000_000, hooks = {}) {
  let t = startAt;
  const saves = [];
  const s = createStrict({ now: () => t, save: (x) => saves.push(x), ...hooks });
  return { s, saves, at: (x) => { t = x; }, advance: (ms) => { t += ms; }, now: () => t };
}

test('a block starts, and asking again for the same block changes nothing', () => {
  const { s } = make();
  const a = s.begin(SPEC());
  assert.equal(a.ok, true);
  assert.equal(s.active(), true);
  const again = s.begin(SPEC({ pages: ['example.org'] }));       // the same id with a different list
  assert.equal(again.ok, true);
  assert.deepEqual(again.state.pages, ['codeadifference.ct.ws', 'desmos.com']);
});

test('a different block cannot replace a running one (so a looser list can\'t be swapped in)', () => {
  const { s } = make();
  s.begin(SPEC());
  const other = s.begin(SPEC({ id: 'b2', pages: ['youtube.com'] }));
  assert.deepEqual([other.ok, other.reason], [false, 'active']);
  assert.equal(s.isAllowedPage('https://youtube.com/'), false);
});

test('bad requests are refused', () => {
  const { s } = make();
  assert.equal(s.begin(null).ok, false);
  assert.equal(s.begin({ endsAt: 9_999_999 }).ok, false);                        // no id
  assert.equal(s.begin(SPEC({ endsAt: 1_000_000 - 5000 })).ok, false);            // already over
  assert.equal(s.begin(SPEC({ endsAt: 'soon' })).ok, false);
});

test('a block can never be longer than four hours', () => {
  const { s } = make();
  const r = s.begin(SPEC({ endsAt: 1_000_000 + 99 * 3_600_000 }));
  assert.equal(r.state.endsAt, 1_000_000 + MAX_BLOCK_MS);
});

test('the page cannot say the block is over before main\'s own clock agrees', () => {
  const { s, at } = make();
  s.begin(SPEC());
  assert.equal(s.end('natural').ok, false);
  assert.equal(s.end('whatever').ok, false);
  assert.equal(s.active(), true);
  at(1_000_000 + 25 * 60_000);
  assert.equal(s.end('natural').ok, true);
  assert.equal(s.active(), false);
});

test('time can be added but not taken away', () => {
  const { s } = make();
  s.begin(SPEC());
  assert.equal(s.extend(1_000_000 + 10 * 60_000).ok, false);
  assert.equal(s.extend(1_000_000 + 30 * 60_000).ok, true);
  assert.equal(s.get().endsAt, 1_000_000 + 30 * 60_000);
  assert.equal(s.extend(1_000_000 + 99 * 3_600_000).ok, false);
});

test('ending early waits out the countdown, and not for ever', () => {
  const { s, advance } = make();
  s.begin(SPEC());
  assert.equal(s.confirmExit().ok, false);                       // never asked
  s.requestExit();
  advance(29_000);
  assert.equal(s.confirmExit().ok, false);
  advance(1_000);
  assert.equal(s.exitStatus().phase, 'ready');
  assert.equal(s.confirmExit().ok, true);
  assert.equal(s.active(), false);
});

test('asking again does not restart the countdown, and a lapsed request can be started again', () => {
  const { s, advance } = make();
  s.begin(SPEC());
  s.requestExit();
  advance(20_000);
  s.requestExit();
  advance(10_000);
  assert.equal(s.exitStatus().canConfirm, true);                 // measured from the first request
  advance(CONFIRM_WINDOW_MS + 1000);
  assert.equal(s.exitStatus().phase, 'expired');
  assert.equal(s.confirmExit().ok, false);
  s.requestExit();
  assert.equal(s.exitStatus().phase, 'waiting');
});

test('cancelling clears the request', () => {
  const { s, advance } = make();
  s.begin(SPEC());
  s.requestExit();
  s.cancelExit();
  advance(60_000);
  assert.equal(s.confirmExit().ok, false);
});

test('main lets go by itself shortly after the planned end', () => {
  const { s, at } = make();
  s.begin(SPEC());
  at(1_000_000 + 25 * 60_000 + 1000);
  assert.equal(s.active(), true);
  at(1_000_000 + 25 * 60_000 + 4000);
  assert.equal(s.active(), false);
});

test('which pages and helper hosts are allowed', () => {
  const { s } = make();
  s.begin(SPEC());
  assert.equal(s.isAllowedPage('https://www.desmos.com/calculator'), true);
  assert.equal(s.isAllowedPage('https://codeadifference.ct.ws/projects/lock-in/'), true);
  assert.equal(s.isAllowedPage('https://evildesmos.com/'), false);
  assert.equal(s.isAllowedPage('https://desmos.com.evil.io/'), false);
  assert.equal(s.isAllowedPage('javascript:alert(1)'), false);
  assert.equal(s.isAllowedPage('file:///C:/secret.txt'), false);
  assert.equal(s.isAllowedPage('https://accounts.google.com/signin'), true);      // sign-in is reachable
  assert.equal(s.isAllowedPage('https://www.gstatic.com/x.js'), false);          // helper hosts are not places to go
  assert.equal(s.isAllowedSupport('www.gstatic.com'), true);
  assert.equal(s.isAllowedSupport('ads.example.com'), false);
});

test('nothing is allowed when no block is running', () => {
  const { s } = make();
  assert.equal(s.isAllowedPage('https://desmos.com/'), false);
  assert.equal(s.isAllowedSupport('desmos.com'), false);
});

test('a block carries on after a restart until its end, and a finished one does not', () => {
  const first = make();
  first.s.begin(SPEC());
  first.s.requestExit();
  const stored = first.saves.at(-1);
  assert.ok(stored && stored.id === 'b1');
  const again = make(1_000_000 + 60_000, { load: () => stored });
  assert.equal(again.s.active(), true);
  assert.equal(again.s.get().exitReqAt, null);                   // a pending exit does not survive a restart
  const late = make(1_000_000 + 26 * 60_000, { load: () => stored });
  assert.equal(late.s.active(), false);
});

test('anything saved is cleaned before it is believed', () => {
  const s = createStrict({ now: () => 5, load: () => ({ id: 'x', startedAt: 1, endsAt: 99_999, pages: ['ok.com', '<bad>', 7, 'ok.com'], delaySec: 9999, appList: ['Discord.exe', '$$'] }) });
  assert.deepEqual(s.get().pages, ['ok.com']);
  assert.equal(s.get().delaySec, 120);
  assert.deepEqual(s.get().appList, ['discord']);
});

test('blocked attempts are counted', () => {
  const { s } = make();
  s.begin(SPEC());
  s.noteBlocked(); s.noteBlocked();
  assert.equal(s.get().blocked, 2);
});

test('the matching rule agrees with the web app\'s', async () => {
  const web = await import('../../src/lib/strictFocus.js');
  const hosts = ['desmos.com', 'app.desmos.com', 'evildesmos.com', 'desmos.com.evil.io', 'DESMOS.COM.', 'desmos.co', '', 'a.b.desmos.com'];
  for (const h of hosts) for (const e of ['desmos.com', 'google.com', '']) {
    assert.equal(hostMatches(h, e), web.hostMatches(h, e), `${h} vs ${e}`);
  }
  assert.deepEqual(cleanHosts(['ok.com', 'localhost', 'a b.com', 'x.io']), ['ok.com', 'x.io']);
});
