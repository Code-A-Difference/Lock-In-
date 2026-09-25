import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTemplate, stepsFromTemplate, stepsFromAi, stepProgress, TEMPLATES } from '../src/lib/shredder.js';

test('titles pick the right checklist', () => {
  const cases = {
    'Density lab report': 'lab_report',
    'Unit 2 test': 'exam',
    'Macbeth essay': 'essay',
    'Hamlet reflection': 'essay',
    'Group presentation on climate': 'presentation',
    'Assignment 3': 'concept',
    'Read chapter 4': 'reading',
    'French vocab list': 'language',
    'Quadratics worksheet': 'math',
    'CPSC 110 problem set': 'coding',
  };
  for (const [title, want] of Object.entries(cases)) assert.equal(detectTemplate(title), want, title);
});

test('the class name helps when the title is vague', () => {
  assert.equal(detectTemplate('Assignment 3', 'Math 10'), 'math');
});

test('templates become fresh steps with unique ids', () => {
  const s = stepsFromTemplate('essay');
  assert.equal(s.length, TEMPLATES.essay.steps.length);
  assert.equal(new Set(s.map(x => x.id)).size, s.length);
  assert.ok(s.every(x => x.done === false && x.minutes >= 1));
});

test('AI replies are validated and clamped', () => {
  assert.equal(stepsFromAi(null), null);
  assert.equal(stepsFromAi({ steps: [{ text: 'only one', minutes: 5 }] }), null);   // too few to be a plan
  const s = stepsFromAi({ steps: [{ text: 'Open the doc', minutes: 2 }, { text: 'Write intro', minutes: 999 }, { text: '   ', minutes: 3 }] });
  assert.equal(s.length, 2);
  assert.equal(s[1].minutes, 90);
});

test('progress counts done steps and minutes left', () => {
  const s = stepsFromTemplate('math');
  s[0].done = true; s[1].done = true;
  const p = stepProgress(s);
  assert.equal(p.done, 2);
  assert.equal(p.next.id, s[2].id);
  assert.equal(p.minutesLeft, s.slice(2).reduce((a, x) => a + x.minutes, 0));
});
