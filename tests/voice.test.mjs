import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, minutesIn, afterWake } from '../src/lib/voiceCommands.js';

const is = (said, action, extra = {}) => {
  const r = parseCommand(said);
  assert.equal(r.action, action, `"${said}" -> ${JSON.stringify(r)}`);
  for (const [k, v] of Object.entries(extra)) assert.equal(r[k], v, `"${said}" ${k}`);
};

test('spoken numbers', () => {
  assert.equal(minutesIn('twenty five minutes'), 25);
  assert.equal(minutesIn('twenty-five'), 25);
  assert.equal(minutesIn('an hour and a half'), 90);
  assert.equal(minutesIn('half an hour'), 30);
  assert.equal(minutesIn('2 hours'), 120);
  assert.equal(minutesIn('forty'), 40);
  assert.equal(minutesIn('fifteen'), 15);
  assert.equal(minutesIn('pause'), null);
});

test('timer control', () => {
  is('start', 'start');
  is("let's go", 'start');
  is('lock in', 'start');
  is('log in', 'start');                 // how recognition often hears it
  is('pause', 'pause');
  is('stop', 'pause');
  is('hold on', 'pause');
  is('skip', 'skip');
  is('start over', 'reset');
  is('restart', 'reset');
  is('take a break', 'startBreak');
  is('i need a break', 'startBreak');
});

test('lengths', () => {
  is('focus for 45 minutes', 'setFocus', { minutes: 45 });
  is('set the timer to thirty', 'setFocus', { minutes: 30 });
  is('an hour and a half of focus', 'setFocus', { minutes: 90 });
  is('break for 10', 'setBreak', { minutes: 10 });
  is('rest time fifteen minutes', 'setBreak', { minutes: 15 });
  is('twenty five minutes', 'setFocus', { minutes: 25 });
  is('five more minutes', 'adjust', { minutes: 5 });
  is('give me another ten', 'adjust', { minutes: 10 });
  is('take off 5 minutes', 'adjust', { minutes: -5 });
});

test('sound — and "stop the music" is not "stop the timer"', () => {
  is('stop the music', 'sound', { kind: 'off' });
  is('mute', 'sound', { kind: 'off' });
  is('play rain', 'sound', { kind: 'rain' });
  is('put the brown noise on', 'sound', { kind: 'brown' });
  is('play some music', 'sound', { kind: 'last' });
  is('louder', 'volume', { delta: 0.15 });
  is('turn it down', 'volume', { delta: -0.15 });
});

test('questions and steps', () => {
  is('how much time is left', 'timeLeft');
  is('how long until the break', 'timeLeft');
  is("what's next", 'readStep');
  is('what should i do now', 'readStep');
  is('done', 'completeStep');
  is("i'm done with that step", 'completeStep');
  is('check it off', 'completeStep');
  is('what can i say', 'help');
});

test('adding homework and tests by voice', () => {
  is('add homework read chapter 4 due friday', 'addHomework', { title: 'read chapter 4', datePhrase: 'friday' });
  is('add a biology test on october 12', 'addTest', { title: 'biology', datePhrase: 'october 12' });
  is('schedule an essay assignment for tomorrow', 'addHomework', { title: 'essay', datePhrase: 'tomorrow' });
  is('remember my chemistry homework', 'addHomework', { title: 'chemistry' });
});

test("what's due, marking things done, and deleting them", () => {
  is("what's due", 'agenda');
  is('what do i have this week', 'agenda');
  is('read my agenda', 'agenda');
  is('mark the biology homework done', 'completeItem', { title: 'biology' });
  is('check off my essay', 'completeItem', { title: 'essay' });
  is('im done with my essay', 'completeItem', { title: 'essay' });   // norm() strips the apostrophe
  is('delete the chemistry test', 'deleteItem', { title: 'chemistry', kind: 'test' });
  is('remove biology homework', 'deleteItem', { title: 'biology', kind: 'homework' });
  is('cancel my history test', 'deleteItem', { title: 'history', kind: 'test' });
  is('cancel the quiz', 'stopQuiz');   // not swallowed by the delete pattern
});

test('quizzes by voice', () => {
  is('quiz me on photosynthesis', 'createQuiz', { topic: 'photosynthesis' });
  is('test me on the french revolution', 'createQuiz', { topic: 'the french revolution' });
  is('a', 'quizAnswer', { answer: 0 });
  is('option c', 'quizAnswer', { answer: 2 });
  is('the answer is d', 'quizAnswer', { answer: 3 });
  is('stop the quiz', 'stopQuiz');
});

test('getting around by voice', () => {
  is('open focus', 'openFocus');
  is('go to the timer', 'openFocus');
  is('plan my week', 'openPlanner');
  is('go to classes', 'navigate', { path: '/Classes' });
  is('take me to settings', 'navigate', { path: '/Settings' });
  is('open practice', 'navigate', { path: '/Study' });
});

test('nonsense is unknown, silence is none', () => {
  is('purple elephant', 'unknown');
  is('   ', 'none');
});

test('wake phrase', () => {
  assert.equal(afterWake('hey lock in start a focus'), 'start a focus');
  assert.equal(afterWake('ok log in pause'), 'pause');
  assert.equal(afterWake('companion how much time is left'), 'how much time is left');
  assert.equal(afterWake('i was just talking'), null);
});
