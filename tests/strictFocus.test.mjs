import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHost, whyRefused, hostMatches, normalizeStrictPrefs, compileAllowlist, classifyLink, presetHosts,
  exitRequest, exitStatus, exitCancel, exitConfirm, gateAction, isStrictActive, capMinutes,
  EXIT_DELAY_DEFAULT, CONFIRM_WINDOW_SEC, EXIT_DELAY_MIN, EXIT_DELAY_MAX, MAX_BLOCK_MIN, MAX_SITES,
} from '../src/lib/strictFocus.js';

test('a pasted address becomes one site name', () => {
  assert.equal(normalizeHost('https://Docs.Google.com/document/d/1AbC?usp=sharing'), 'docs.google.com');
  assert.equal(normalizeHost('www.desmos.com'), 'desmos.com');
  assert.equal(normalizeHost('khanacademy.org:443/math'), 'khanacademy.org');
  assert.equal(normalizeHost('  Wikipedia.org  '), 'wikipedia.org');
});

test('things that are not one site are refused', () => {
  for (const bad of ['', '   ', 'com', 'localhost', '192.168.1.5', 'http://127.0.0.1:3000', '*.google.com', 'two words.com', 'github.io', 'ct.ws', 'blogspot.com', 'co.uk', 'nodots', 'https://']) {
    assert.equal(normalizeHost(bad), null, `"${bad}"`);
  }
  assert.equal(normalizeHost('yourproject.github.io'), 'yourproject.github.io');
});

test('the refusal says what to do instead', () => {
  assert.match(whyRefused(''), /Type a website/);
  assert.match(whyRefused('*.google.com'), /Wildcards/);
  assert.match(whyRefused('github.io'), /hosting service/);
  assert.match(whyRefused('khanacademy'), /ending/);
  assert.match(whyRefused('192.168.0.1'), /website name/);
});

test('a site includes its own pages but not look-alikes', () => {
  assert.equal(hostMatches('desmos.com', 'desmos.com'), true);
  assert.equal(hostMatches('app.desmos.com', 'desmos.com'), true);
  assert.equal(hostMatches('evildesmos.com', 'desmos.com'), false);
  assert.equal(hostMatches('desmos.com.evil.io', 'desmos.com'), false);
  assert.equal(hostMatches('desmos.co', 'desmos.com'), false);
});

test('settings from the server are cleaned before use', () => {
  const p = normalizeStrictPrefs({
    enabled: 1, exitDelaySec: 3, allowedSites: ['https://Desmos.com/calculator', 'desmos.com', 'github.io', { host: 'khanacademy.org' }, 42, null],
    presets: ['gdocs', 'nonsense', 'gdocs'], allowMusic: 'yes', appMode: 'weird', appList: ['Discord.exe', 'Discord', '<script>'],
  });
  assert.equal(p.enabled, true);
  assert.equal(p.exitDelaySec, EXIT_DELAY_MIN);
  assert.deepEqual(p.allowedSites, ['desmos.com', 'khanacademy.org']);
  assert.deepEqual(p.presets, ['gdocs']);
  assert.equal(p.allowMusic, true);
  assert.equal(p.appMode, 'blocklist');
  assert.deepEqual(p.appList, ['discord']);
  assert.equal(normalizeStrictPrefs({ exitDelaySec: 9999 }).exitDelaySec, EXIT_DELAY_MAX);
  assert.equal(normalizeStrictPrefs(undefined).exitDelaySec, EXIT_DELAY_DEFAULT);
  assert.equal(normalizeStrictPrefs('garbage').allowedSites.length, 0);
});

test('long lists are capped', () => {
  const many = Array.from({ length: 500 }, (_, i) => `site${i}.com`);
  assert.equal(normalizeStrictPrefs({ allowedSites: many }).allowedSites.length, MAX_SITES);
});

test('presets bring their helper sites, and the list is the sum of everything', () => {
  const { hosts, support } = presetHosts(['gdocs', 'classroom']);
  assert.ok(hosts.includes('docs.google.com') && hosts.includes('classroom.google.com'));
  assert.ok(support.includes('accounts.google.com'));
  assert.equal(new Set(support).size, support.length);
  const a = compileAllowlist({ presets: ['desmos'], allowedSites: ['example.org'] });
  assert.ok(a.isAllowedHost('desmos.com') && a.isAllowedHost('www.example.org') && a.isAllowedHost('codeadifference.ct.ws'));
  assert.equal(a.isAllowedHost('youtube.com'), false);
  assert.equal(a.isAllowedUrl('https://app.desmos.com/calculator'), true);
  assert.equal(a.isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(a.isAllowedUrl('ftp://desmos.com/'), false);
});

test('helper hosts load things but are not places to go', () => {
  const a = compileAllowlist({ presets: ['gdocs'] });
  assert.equal(a.isAllowedHost('accounts.google.com'), false);
  assert.equal(a.isAllowedSupport('accounts.google.com'), true);
  assert.equal(a.isAllowedSupport('www.gstatic.com'), true);
  assert.equal(a.isAllowedSupport('tracker.example'), false);
});

test('links are sorted into stays-here, approved and blocked', () => {
  const allow = compileAllowlist({ presets: ['desmos'] });
  const opts = { pageHost: 'codeadifference.ct.ws', allow };
  assert.equal(classifyLink('#section', opts), 'internal');
  assert.equal(classifyLink('/Notes', opts), 'internal');
  assert.equal(classifyLink('https://codeadifference.ct.ws/lockin/Study', opts), 'internal');
  assert.equal(classifyLink('https://codeadifference.ct.ws/projects/lock-in/', { pageHost: 'localhost', allow }), 'allowed');
  assert.equal(classifyLink('https://www.desmos.com/calculator', opts), 'allowed');
  assert.equal(classifyLink('https://www.youtube.com/watch?v=x', opts), 'blocked');
  assert.equal(classifyLink('javascript:alert(1)', opts), 'blocked');
  assert.equal(classifyLink('mailto:a@b.com', opts), 'blocked');
  assert.equal(classifyLink('data:text/html,hi', opts), 'blocked');
  assert.equal(classifyLink('http://[bad', opts), 'blocked');
});

test('ending early: the wait, the ready window, and expiry', () => {
  const t0 = 1_000_000;
  let s = { exitReqAt: null };
  assert.equal(exitStatus(s, t0).phase, 'idle');
  s = exitRequest(s, t0);
  assert.equal(exitStatus(s, t0).phase, 'waiting');
  assert.equal(exitStatus(s, t0 + 10_000).secondsLeft, 20);
  assert.equal(exitConfirm(s, t0 + 29_000).ok, false);
  assert.equal(exitStatus(s, t0 + 30_000).phase, 'ready');
  assert.equal(exitConfirm(s, t0 + 30_000).ok, true);
  assert.equal(exitStatus(s, t0 + 30_000 + CONFIRM_WINDOW_SEC * 1000 - 1).phase, 'ready');
  assert.equal(exitStatus(s, t0 + 30_000 + CONFIRM_WINDOW_SEC * 1000).phase, 'expired');
  assert.equal(exitConfirm(s, t0 + 3_600_000).ok, false);
});

test('mashing the button does not restart or skip the wait', () => {
  const t0 = 5_000;
  let s = exitRequest({ exitReqAt: null }, t0);
  s = exitRequest(s, t0 + 5_000);
  s = exitRequest(s, t0 + 20_000);
  assert.equal(s.exitReqAt, t0);
  assert.equal(exitConfirm(s, t0 + 20_000).ok, false);
});

test('an expired request can be started again', () => {
  const t0 = 1_000;
  let s = exitRequest({ exitReqAt: null }, t0);
  const later = t0 + (EXIT_DELAY_DEFAULT + CONFIRM_WINDOW_SEC + 5) * 1000;
  assert.equal(exitStatus(s, later).phase, 'expired');
  s = exitRequest(s, later);
  assert.equal(s.exitReqAt, later);
  assert.equal(exitStatus(s, later).phase, 'waiting');
});

test('cancelling clears it, a confirmed exit clears it, the clock going backwards starts over', () => {
  const s = exitRequest({ exitReqAt: null }, 10_000);
  assert.equal(exitCancel(s).exitReqAt, null);
  assert.equal(exitConfirm(s, 10_000 + 30_000).state.exitReqAt, null);
  assert.equal(exitStatus(s, 1_000).canConfirm, false);
});

test('a longer wait setting is respected', () => {
  const s = exitRequest({ exitReqAt: null }, 0);
  assert.equal(exitConfirm(s, 45_000, 60).ok, false);
  assert.equal(exitConfirm(s, 60_000, 60).ok, true);
});

test('what a running strict block refuses', () => {
  const strict = { strict: true, phase: 'focus', status: 'running' };
  for (const a of ['pause', 'reset', 'skip', 'startBreak', 'startFocus']) {
    assert.deepEqual(gateAction(strict, a), { ok: false, reason: 'strict', exit: true }, a);
  }
  assert.equal(gateAction(strict, 'toggle').ok, false);
  assert.equal(gateAction(strict, 'adjust', -5).ok, false);
  assert.equal(gateAction(strict, 'adjust', 0).ok, false);
  assert.equal(gateAction(strict, 'adjust', 5).ok, true);
  for (const a of ['start', 'lockIn', 'setTask', 'setDurations', 'setSound', 'completeStep']) assert.equal(gateAction(strict, a).ok, true, a);
});

test('strict only binds while a focus block is actually under way', () => {
  assert.equal(gateAction({ strict: false, phase: 'focus', status: 'running' }, 'pause').ok, true);
  assert.equal(gateAction({ strict: true, phase: 'focus', status: 'idle' }, 'startFocus').ok, true);
  assert.equal(gateAction({ strict: true, phase: 'break', status: 'running' }, 'skip').ok, true);
  assert.equal(gateAction({ strict: true, phase: 'focus', status: 'paused' }, 'toggle').ok, true);
  assert.equal(isStrictActive(null), false);
});

test('block length is capped', () => {
  assert.equal(capMinutes(25), 25);
  assert.equal(capMinutes(9999), MAX_BLOCK_MIN);
  assert.equal(capMinutes('x'), 25);
  assert.equal(capMinutes(-3), 25);
});

import { buildSystem } from '../src/lib/assistant.js';

test('the assistant is told when a strict block is running', () => {
  const base = { now: new Date(), via: 'text', prefs: {}, homework: [], tests: [], classes: [], lectures: [] };
  const on = buildSystem({ ...base, timer: { strict: true, status: 'running', phase: 'focus', remaining: 600, total: 1500 } });
  const off = buildSystem({ ...base, timer: { strict: false, status: 'running', phase: 'focus', remaining: 600, total: 1500 } });
  assert.match(on, /STRICT block/);
  assert.doesNotMatch(off, /STRICT block/);
});
