import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createAppGuard, shouldMinimise, ALWAYS_OK } = createRequire(import.meta.url)('../appguard.js');

test('blocklist: the built-in list and the student\'s own are minimised, nothing else', () => {
  const cfg = { mode: 'blocklist', list: ['obs64'], allow: [] };
  assert.equal(shouldMinimise('steam', cfg), true);
  assert.equal(shouldMinimise('Discord.exe', cfg), true);
  assert.equal(shouldMinimise('obs64', cfg), true);
  assert.equal(shouldMinimise('notepad', cfg), false);
  assert.equal(shouldMinimise('Code', cfg), false);
});

test('the system, Task Manager and LOCK IN! are never touched, in either mode', () => {
  for (const mode of ['blocklist', 'allowlist']) {
    for (const n of ALWAYS_OK) assert.equal(shouldMinimise(n, { mode, list: [n], allow: [] }), false, `${mode} ${n}`);
  }
});

test('"never minimise" wins over the list, and allowlist mode minimises everything else', () => {
  assert.equal(shouldMinimise('steam', { mode: 'blocklist', list: [], allow: ['steam'] }), false);
  assert.equal(shouldMinimise('notepad', { mode: 'allowlist', list: [], allow: [] }), true);
  assert.equal(shouldMinimise('winword', { mode: 'allowlist', list: [], allow: ['winword'] }), false);
});

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.killed = false;
  c.kill = () => { c.killed = true; c.emit('exit', 0); };
  return c;
}

test('windows watcher: READY then BLOCK lines bring LOCK IN! forward and report the program', () => {
  const child = fakeChild();
  let args;
  const seen = []; let forward = 0;
  const g = createAppGuard({ platform: 'win32', spawnFn: (cmd, a, o) => { args = { cmd, a, o }; return child; }, onBlocked: (n) => seen.push(n), bringForward: () => { forward++; } });
  g.start({ mode: 'blocklist', list: ['obs64'], allow: ['firefox'], blockApps: true });
  assert.equal(args.cmd, 'powershell.exe');
  assert.ok(args.a.includes('-EncodedCommand'));
  assert.ok(args.o.windowsHide);
  const set = args.o.env.LK_SET.split(',');
  assert.ok(set.includes('steam') && set.includes('obs64'));
  assert.ok(args.o.env.LK_OK.split(',').includes('firefox') && args.o.env.LK_OK.split(',').includes('taskmgr'));
  child.stdout.emit('data', Buffer.from('READY\nBLOCK|chr'));
  child.stdout.emit('data', Buffer.from('ome\n'));
  assert.deepEqual(seen, ['chrome']);
  assert.equal(forward, 1);
  g.stop();
  assert.ok(child.killed);
});

test('windows watcher that dies before READY is reported once as unavailable', () => {
  const child = fakeChild();
  let told = 0;
  const g = createAppGuard({ platform: 'win32', spawnFn: () => child, onUnavailable: () => { told++; } });
  g.start({ mode: 'blocklist', blockApps: true });
  child.emit('exit', 1);
  child.emit('error', new Error('boom'));
  assert.equal(told, 1);
});

test('a spawn that throws is reported, not raised', () => {
  let told = 0;
  const g = createAppGuard({ platform: 'win32', spawnFn: () => { throw new Error('blocked by policy'); }, onUnavailable: () => { told++; } });
  assert.doesNotThrow(() => g.start({ mode: 'blocklist', blockApps: true }));
  assert.equal(told, 1);
});

test('switched off, or on a system it does not support, it does nothing', () => {
  let spawned = 0; let told = 0;
  const g = createAppGuard({ platform: 'win32', spawnFn: () => { spawned++; return fakeChild(); } });
  g.start({ mode: 'blocklist', blockApps: false });
  assert.equal(spawned, 0);
  const l = createAppGuard({ platform: 'linux', onUnavailable: () => { told++; } });
  l.start({ mode: 'blocklist', blockApps: true });
  assert.equal(told, 1);
});

test('browsers are judged by the address they show, not minimised outright', async () => {
  const { hostFromAddress, browserVerdict } = createRequire(import.meta.url)('../appguard.js');
  const cfg = { pages: ['myeducation.gov.bc.ca', 'docs.google.com'] };
  assert.equal(shouldMinimise('chrome', { mode: 'blocklist', pages: cfg.pages }), false);
  assert.equal(shouldMinimise('discord', { mode: 'blocklist', pages: cfg.pages }), true);
  assert.equal(browserVerdict('docs.google.com/document/d/1', cfg), 'allow');
  assert.equal(browserVerdict('https://www.youtube.com/watch?v=x', cfg), 'block');
  assert.equal(browserVerdict('accounts.google.com/v3/signin', cfg), 'allow');
  assert.equal(browserVerdict('logon7.gov.bc.ca/clp-cgi/x', cfg), 'allow');
  assert.equal(browserVerdict('', cfg), 'allow');
  assert.equal(browserVerdict('chrome://newtab', cfg), 'allow');
  assert.equal(browserVerdict('best pizza near me', cfg), 'allow');
  assert.equal(browserVerdict(null, cfg), 'unknown');
  assert.equal(hostFromAddress('user@evil.com:8080/x'), 'evil.com');
  assert.equal(browserVerdict('docs.google.com.evil.io/x', cfg), 'block');
});
