import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionToCommand, parsePlan, spokenVersion, fastCommand, lectureContext, buildSystem, buildPrompt, transcriptOf } from '../src/lib/assistant.js';
import { parseCommand } from '../src/lib/voiceCommands.js';

test('"start a focus session for 50 minutes" starts one — it does not just change the setting', () => {
  assert.deepEqual(actionToCommand({ name: 'startFocus', minutes: 50 }), { action: 'startFocus', minutes: 50, taskTitle: '' });
  assert.equal(actionToCommand({ name: 'setFocusLength', minutes: 50 }).action, 'setFocus');
  assert.equal(parseCommand("let's start a focus session for 50 min").action, 'startFocus');
});

test('model actions become app commands', () => {
  assert.deepEqual(actionToCommand({ name: 'addTest', title: 'Bio test', date: '2026-10-09', className: 'Biology' }).datePhrase, '2026-10-09');
  assert.equal(actionToCommand({ name: 'completeHomework', title: 'essay' }).action, 'completeItem');
  assert.equal(actionToCommand({ name: 'deleteItem', title: 'x', kind: 'Test' }).kind, 'test');
  assert.deepEqual(actionToCommand({ name: 'quizAnswer', answer: 'C' }), { action: 'quizAnswer', answer: 2 });
  assert.equal(actionToCommand({ name: 'openPage', path: 'Classes' }).path, '/Classes');
  assert.equal(actionToCommand({ name: 'sound', kind: 'rain' }).kind, 'rain');
  assert.equal(actionToCommand({ name: 'sound', kind: 'whale song' }).kind, 'last');
  assert.equal(actionToCommand({ name: 'setFocusLength' }), null);
  assert.equal(actionToCommand({ name: 'launchMissiles' }), null);
  assert.equal(actionToCommand(null), null);
});

test('the model replying badly still gives something', () => {
  assert.deepEqual(parsePlan({ reply: 'Hi', actions: [{ name: 'pause' }] }).actions.length, 1);
  assert.equal(parsePlan('just text').reply, 'just text');
  assert.deepEqual(parsePlan({ reply: 'x' }).actions, []);
  assert.equal(parsePlan(null).reply, '');
});

test('what gets spoken', () => {
  assert.equal(spokenVersion({ reply: 'long long', spoken: 'Short.' }), 'Short.');
  assert.equal(spokenVersion({ reply: 'Fine.', spoken: '' }), 'Fine.');
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`).join(' ');
  const s = spokenVersion({ reply: long, spoken: '' });
  assert.ok(s.length < 520 && s.endsWith('The rest is in the chat.'));
});

test('only tiny commands skip the model', () => {
  assert.equal(fastCommand('pause', parseCommand).action, 'pause');
  assert.equal(fastCommand('louder', parseCommand).action, 'volume');
  assert.equal(fastCommand('wait what does mitosis mean exactly', parseCommand), null);
  assert.equal(fastCommand('can you explain why the sky is blue', parseCommand), null);
  assert.equal(fastCommand('b', parseCommand), null);                          // a quiz answer, but no quiz
  assert.equal(fastCommand('b', parseCommand, { quizActive: true }).answer, 1);
  assert.equal(fastCommand('add homework read chapter four', parseCommand), null);
});

const lectures = [
  { id: 'a', title: 'Biology · Mon', class_name: 'Biology', date: '2026-10-01', started_at: '2026-10-01T10:00', notes: { summary: 'Photosynthesis happens in chloroplasts using light, water and carbon dioxide.', key_points: ['Light reactions', 'Calvin cycle'] }, segments: [{ start: 0, text: 'today we cover photosynthesis and the calvin cycle in detail' }] },
  { id: 'b', title: 'History · Tue', class_name: 'History', date: '2026-10-02', started_at: '2026-10-02T10:00', notes: { summary: 'The causes of the First World War.' }, segments: [{ start: 0, text: 'alliances and nationalism' }] },
  { id: 'c', title: 'Empty', segments: [] },
];

test('lecture material is chosen by the question', () => {
  assert.match(lectureContext('what is the calvin cycle in photosynthesis', lectures, []), /Photosynthesis/);
  assert.doesNotMatch(lectureContext('what is the calvin cycle in photosynthesis', lectures, []), /First World War/);
  assert.match(lectureContext('summarise the last lecture', lectures, []), /First World War/);          // newest
  assert.equal(lectureContext('what is for lunch', lectures, []), '');
  assert.match(lectureContext('anything', lectures, ['b']), /First World War/);                          // pinned wins
  assert.equal(lectureContext('x', [lectures[2]], []), '');
  assert.match(lectureContext('what exactly did they say about the calvin cycle', lectures, ['a']), /Transcript/);
});

test('the system prompt carries the live state', () => {
  const sys = buildSystem({
    now: new Date('2026-10-03T12:00:00'), via: 'voice',
    timer: { status: 'running', phase: 'focus', remaining: 1800, total: 3000, taskTitle: 'Essay' },
    prefs: { focusMin: 25, breakMin: 5, sound: 'rain' },
    homework: [{ title: 'Read ch 4', due_date: '2026-10-09', class_name: 'Biology', steps: [{ done: true }, { done: false }] }],
    tests: [{ title: 'Bio test', date: '2026-10-12' }], classes: [{ name: 'Biology' }], lectures,
    quiz: null, recording: false,
  });
  assert.match(sys, /RUNNING a focus block, 30 min left of 50/);
  assert.match(sys, /Read ch 4 \[Biology\] due 2026-10-09 \(1\/2 steps\)/);
  assert.match(sys, /This turn was SPOKEN/);
  assert.match(sys, /startFocus \{minutes/);
  assert.match(sys, /Saturday, October 3, 2026/);
});

test('the prompt is bounded and keeps the conversation', () => {
  const history = [{ role: 'user', text: 'explain mitosis' }, { role: 'assistant', text: 'Mitosis is cell division.' }];
  assert.match(transcriptOf(history), /Student: explain mitosis\nLock In: Mitosis/);
  const p = buildPrompt({ text: 'why?', history, material: 'x'.repeat(40000), limit: 12000 });
  assert.ok(p.length <= 12000);
  assert.match(p, /Student: why\?/);
  assert.match(p, /Conversation so far/);
});
