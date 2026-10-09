import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseQuiz, normaliseGrade, scoreQuiz, quizRules, gradePrompt, askPrompt, splitSteps, mmss, writtenCount, checkPrompt, applyChecks } from '../src/lib/quizKit.js';

test('written questions without key points or steps still grade (the Q5 bug)', () => {
  const { questions } = normaliseQuiz({ questions: [
    { type: 'written', question: 'Differentiate $y=\\frac{4x^2-3}{(x^2+2)^3}$', ideal_answer: 'Rewrite as a product. Then apply the product rule. Finally simplify.' },
  ] });
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].key_points, []);
  assert.ok(questions[0].steps.length >= 2, JSON.stringify(questions[0].steps));
  assert.doesNotThrow(() => gradePrompt(questions[0], 'my answer'));
});

test('multiple choice is tidied: correct index kept in range, steps present', () => {
  const { questions } = normaliseQuiz({ questions: [
    { question: 'Q?', options: ['A) 1', 'B) 2', 'C) 3', 'D) 4'], correct: 9, explanation: 'Because.', steps: ['Step one', '', 'Step two'] },
    { question: '', options: ['A', 'B'] },                     // dropped: no question
    { question: 'Only one option', options: ['A) x'] },         // dropped: not a real choice
  ] });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].type, 'multiple_choice');
  assert.equal(questions[0].correct, 3);
  assert.deepEqual(questions[0].steps, ['Step one', 'Step two']);
});

test('maths markers doubled up inside $…$ are fixed', () => {
  const { questions } = normaliseQuiz({ questions: [{ type: 'written', question: String.raw`Find the tangent to $y = (x^2+1)\(x^2-1\)$ at $x=1$`, ideal_answer: 'y = 4x - 4' }] });
  assert.equal(questions[0].question, 'Find the tangent to $y = (x^2+1)(x^2-1)$ at $x=1$');
});

test('a paragraph becomes steps; numbered lines lose their numbers', () => {
  assert.deepEqual(splitSteps('1. Find $f\'(x)$\n2. Substitute $x=1$'), ["Find $f'(x)$", 'Substitute $x=1$']);
  assert.ok(splitSteps('Use the chain rule. Then substitute the values. So the answer is 4.').length >= 2);
});

test('scores give part marks for written answers and wait for ungraded ones', () => {
  const qs = [{ type: 'multiple_choice', correct: 1, options: ['a', 'b'] }, { type: 'multiple_choice', correct: 0, options: ['a', 'b'] }, { type: 'written' }, { type: 'written' }, { type: 'written' }];
  const answers = { 0: 1, 1: 1, w2: 'x', w3: 'y', w4: '' };
  let s = scoreQuiz(qs, answers, { 2: { score: 7.5 } });
  assert.equal(s.pending, 1);                     // Q4 answered, not graded yet
  assert.equal(s.total, 4);                       // the blank one counts as 0 of 1
  assert.equal(s.points, 1.8);                    // 1 + 0 + 0.75 (+0 blank), rounded to tenths
  s = scoreQuiz(qs, answers, { 2: { score: 7.5 }, 3: { score: 10 } });
  assert.equal(s.pending, 0);
  assert.equal(s.total, 5);
  assert.equal(s.percent, Math.round((2.75 / 5) * 100));
});

test('grades are made safe', () => {
  assert.deepEqual(normaliseGrade({ score: '12', verdict: 'nope' }).score, 10);
  assert.equal(normaliseGrade({ score: 6.3 }).score, 6.5);
  assert.equal(normaliseGrade({}).verdict, 'incorrect');
  assert.deepEqual(normaliseGrade({ score: 8 }).missing_points, []);
});

test('quiz rules carry difficulty, counts, steps and LaTeX', () => {
  const r = quizRules({ difficulty: 'exam', count: 10, written: 2 });
  assert.match(r, /Exam-level/);
  assert.match(r, /exactly 8 multiple-choice questions and 2 written/);
  assert.match(r, /"steps"/);
  assert.ok(r.includes(String.raw`$\frac{dy}{dx}$`));
  assert.equal(writtenCount(10, true), 2);
  assert.equal(writtenCount(5, false), 0);
});

test('asking about a question gives the tutor the question, the answer, the solution and the chat', () => {
  const q = { type: 'multiple_choice', question: 'What is $2+2$?', options: ['A) 3', 'B) 4'], correct: 1, steps: ['Add them'] };
  const { system, prompt } = askPrompt({ q, number: 3, answer: 0, history: [{ role: 'user', text: 'why?' }, { role: 'ai', text: 'because' }], message: 'explain step 1' });
  assert.match(system, /tutor/);
  assert.match(prompt, /Question 3/);
  assert.match(prompt, /student's answer: A\) 3/);
  assert.match(prompt, /Correct answer: B\) 4/);
  assert.match(prompt, /You: because/);
  assert.ok(prompt.trim().endsWith('Student: explain step 1'));
});

test('the answer-key check corrects keys that contradict their own working, and ignores nonsense', () => {
  const qs = [
    { type: 'multiple_choice', question: 'f(2)?', options: ['A) 1', 'B) 2', 'C) 3', 'D) 4'], correct: 1, steps: ['…so 3'] },
    { type: 'written', question: 'Tangent?', ideal_answer: '$y = 0$', steps: ['…$y = 4x - 4$'] },
    { type: 'multiple_choice', question: 'g?', options: ['A) 5', 'B) 6'], correct: 0, steps: ['…so 7'] },
  ];
  const p = checkPrompt(qs);
  assert.match(p, /Question 1: f\(2\)\?/);
  assert.match(p, /Marked correct: \[1\]/);
  assert.match(p, /Model answer: \$y = 0\$/);
  const fixed = applyChecks(qs, { fixes: [
    { number: 1, correct: 2, reason: 'steps give 3' },
    { number: 2, ideal_answer: '$y = 4x - 4$' },
    { number: 3, options: ['A) 7', 'B) 6'], correct: 0 },
    { number: 9, correct: 0 },                // no such question
    { number: 1, correct: 17 },               // out of range: ignored
  ] });
  assert.equal(fixed[0].correct, 2);
  assert.equal(fixed[1].ideal_answer, '$y = 4x - 4$');
  assert.deepEqual(fixed[2].options, ['A) 7', 'B) 6']);
  assert.equal(qs[0].correct, 1, 'the original is not changed');
  assert.deepEqual(applyChecks(qs, null).map(q => q.correct), [1, undefined, 0]);
});

test('mm:ss', () => {
  assert.equal(mmss(245), '4:05');
  assert.equal(mmss(-3), '0:00');
});
