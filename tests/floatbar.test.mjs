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

test('there is no music player: song commands are not music commands, and the timer\'s own sounds still work', () => {
  for (const s of ['skip this song', 'next track', 'previous song', 'resume the music', 'play Blinding Lights', 'play lofi beats on spotify']) {
    assert.ok(!/^(music|playMusic)/.test(parseCommand(s).action), s);
  }
  assert.equal(parseCommand('play rain').action, 'sound');
  assert.equal(parseCommand('play some music').action, 'sound');
  assert.equal(parseCommand('stop the music').action, 'sound');
});

test('the model can ask for the floating bar, but not for music or the Music page', () => {
  assert.deepEqual(actionToCommand({ name: 'floatOnTop' }), { action: 'floatOn' });
  for (const name of ['playMusic', 'pauseMusic', 'resumeMusic', 'nextSong', 'previousSong']) {
    assert.equal(actionToCommand({ name, query: 'jazz' }), null, name);
  }
  assert.equal(actionToCommand({ name: 'openPage', path: 'music' }), null);
  assert.equal(actionToCommand({ name: 'openPage', path: 'notes' }).path, '/Notes');
});

test('the assistant is told what the app has, and whether this is the desktop app', () => {
  const base = { now: new Date(), via: 'text', timer: { status: 'idle', phase: 'focus', remaining: 0, total: 0 }, prefs: {}, homework: [], tests: [], classes: [], lectures: [] };
  const desk = buildSystem({ ...base, desktop: true });
  const web = buildSystem({ ...base, desktop: false });
  assert.match(desk, /floatOnTop/);
  assert.match(desk, /This IS the desktop app/);
  assert.match(web, /NOT the desktop app/);
  assert.doesNotMatch(desk, /Music page/);
  assert.match(desk, /There is no music player/);
  assert.match(desk, /floating bar/);
});
