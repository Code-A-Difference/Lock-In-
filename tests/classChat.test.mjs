import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, timedTranscript, classChatPrompt, NOTE_TEMPLATES, templateHow } from '../src/lib/classChat.js';
import { notesPrompt } from '../src/lib/lectureNotes.js';

const segs = [
  { start: 0, text: 'Today we start photosynthesis.' },
  { start: 15, text: '', error: 'busy' },
  { start: 30, text: 'Who can tell me what chlorophyll does?' },
];

test('timed transcript has clock stamps and skips failed parts', () => {
  const t = timedTranscript(segs);
  assert.match(t, /^\[0:00\] Today/);
  assert.match(t, /\[0:30\] Who can tell me/);
  assert.equal(t.split('\n').length, 2);
});

test('timed transcript keeps the newest lines when cut', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ start: i * 15, text: `line ${i} ` + 'x'.repeat(80) }));
  const t = timedTranscript(many, 2000);
  assert.ok(t.length < 2100);
  assert.match(t, /earlier part of the class left out/);
  assert.match(t, /line 199/);
  assert.doesNotMatch(t, /line 0 /);
});

test('live prompt says the class is happening and includes the question', () => {
  const r = RECIPES.find(x => x.id === 'answer');
  const { system, prompt } = classChatPrompt({ question: r.ask, segments: segs, live: true, elapsed: 45, className: 'Biology',
    history: [{ role: 'user', text: 'hi' }, { role: 'ai', text: 'hello' }] });
  assert.match(system, /happening right now/);
  assert.match(system, /0:45 in/);
  assert.match(prompt, /Class: Biology/);
  assert.match(prompt, /chlorophyll/);
  assert.match(prompt, /You: hello/);
  assert.ok(prompt.trim().endsWith(r.ask));
});

test('after class, live-only recipes are flagged and the prompt is not live', () => {
  assert.ok(RECIPES.some(r => r.live) && RECIPES.some(r => !r.live));
  const { system } = classChatPrompt({ question: 'what is due?', segments: segs });
  assert.match(system, /class they recorded/);
});

test('templates reach the notes prompt', () => {
  assert.equal(templateHow('nope'), NOTE_TEMPLATES[0].how);
  const p = notesPrompt({ transcript: 'abc', how: templateHow('problems') });
  assert.match(p, /Layout for this kind of class: For each method/);
  assert.doesNotMatch(notesPrompt({ transcript: 'abc' }), /Layout for this kind/);
});
