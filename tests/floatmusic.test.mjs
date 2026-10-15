import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/lib/voiceCommands.js';
import { fastCommand, actionToCommand, buildSystem } from '../src/lib/assistant.js';

test('"float on top" and its everyday wordings turn the floating bar on', () => {
  for (const s of ['float on top.', 'Float on top', 'floating bar', 'keep it on top', 'always on top', 'mini window', 'put the timer on top', 'picture in picture']) {
    assert.equal(parseCommand(s).action, 'floatOn', s);
  }
});

test('"float on top" is an instant command, no model needed', () => {
  assert.equal(fastCommand('float on top.', parseCommand)?.action, 'floatOn');
});

test('words that merely contain those letters are not the floating bar', () => {
  for (const s of ['add a mini quiz on cells', 'quiz me on topology', 'I have a test on floating point numbers']) {
    assert.notEqual(parseCommand(s).action, 'floatOn', s);
  }
});

test('music controls', () => {
  assert.equal(parseCommand('skip this song').action, 'musicNext');
  assert.equal(parseCommand('next track').action, 'musicNext');
  assert.equal(parseCommand('previous song').action, 'musicPrevious');
  assert.equal(parseCommand('resume the music').action, 'musicResume');
});

test('"play …" a song starts music; the timer\'s own sounds still work', () => {
  assert.deepEqual(parseCommand('play Blinding Lights'), { action: 'playMusic', query: 'blinding lights', source: '' });
  assert.deepEqual(parseCommand('play lofi beats on spotify'), { action: 'playMusic', query: 'lofi beats', source: 'spotify' });
  assert.equal(parseCommand('play rain').action, 'sound');
  assert.equal(parseCommand('play some music').action, 'sound');
  assert.equal(parseCommand('stop the music').action, 'sound');
});

test('the model can ask for them too', () => {
  assert.deepEqual(actionToCommand({ name: 'floatOnTop' }), { action: 'floatOn' });
  assert.deepEqual(actionToCommand({ name: 'playMusic', query: 'jazz', source: 'youtube' }), { action: 'playMusic', query: 'jazz', source: 'youtube' });
  assert.equal(actionToCommand({ name: 'playMusic' }), null);
  assert.equal(actionToCommand({ name: 'nextSong' }).action, 'musicNext');
  assert.equal(actionToCommand({ name: 'openPage', path: 'music' }).path, '/Music');
});

test('the assistant is told what the app has, and whether this is the desktop app', () => {
  const base = { now: new Date(), via: 'text', timer: { status: 'idle', phase: 'focus', remaining: 0, total: 0 }, prefs: {}, homework: [], tests: [], classes: [], lectures: [] };
  const desk = buildSystem({ ...base, desktop: true });
  const web = buildSystem({ ...base, desktop: false });
  assert.match(desk, /floatOnTop/);
  assert.match(desk, /This IS the desktop app/);
  assert.match(web, /NOT the desktop app/);
  assert.match(desk, /Music page/);
  assert.match(desk, /floating bar/);
});
