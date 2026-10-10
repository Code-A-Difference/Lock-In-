/**
 * Practice quizzes: options, the rules every quiz prompt shares, tidying what
 * the AI sends back, grading written answers, scoring with part marks, and
 * asking about a question afterwards.
 *
 * Pure; tests/quizKit.test.mjs runs it.
 */

export const DIFFICULTIES = [
  { id: 'easier', label: 'Easier', how: 'Easier: check the basics, key definitions and one-step questions; written answers need only a sentence or two.' },
  { id: 'standard', label: 'Standard', how: 'Standard: like a typical class quiz, a mix of recall and applying ideas.' },
  { id: 'challenging', label: 'Challenging', how: 'Challenging: mostly applying and connecting ideas, multi-step problems, "why" and "what would happen if" questions, plausible wrong options.' },
  { id: 'exam', label: 'Exam-level', how: 'Exam-level: as hard as a final exam, multi-step problems that combine topics, careful distractors, written answers that need a full worked solution.' },
];
export const QUIZ_LENGTHS = [5, 10, 15, 20];
export const TIME_LIMITS = [0, 5, 10, 15, 20, 30, 45];   // minutes; 0 = no limit

export function difficultyHow(id) {
  return (DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[1]).how;
}

/** How many of `count` are written answers when the student asked for some. */
export function writtenCount(count, includeWritten) {
  return includeWritten ? Math.max(1, Math.round(count / 5)) : 0;
}

/** The rules every quiz prompt ends with, so all quizzes come back the same shape. */
export function quizRules({ difficulty = 'standard', count = 5, written = 0 } = {}) {
  const mc = Math.max(1, count - written);
  return `Difficulty, ${difficultyHow(difficulty)}

Make exactly ${mc} multiple-choice question${mc === 1 ? '' : 's'}${written ? ` and ${written} written (open-ended) question${written === 1 ? '' : 's'}` : ''}.
For every question, work it out FIRST, then write the answer from your working:
- "steps": the worked solution as a list of short steps, one idea or one line of working per step, in order, so a student can follow it, e.g. ["Rewrite the quotient as a product: $y = (4x^2-3)(x^2+2)^{-3}$", "Differentiate each factor: …", "Apply the product rule: …", "Simplify: …"]. For a recall question, 1–2 steps explaining why.
- Multiple choice: "options" are 4 answers written "A) …", "B) …", "C) …", "D) …"; "correct" is the index (0–3) of the right one; "explanation" is one sentence on why it's right; "wrong_explanations" has one short reason for each option (the right one can say "Correct").
- Written: "ideal_answer" is a short model answer (the final result); "key_points" are the 2–5 things a full-marks answer must contain.
- The answer MUST be the result of the last step: the correct option and the ideal_answer say exactly what the steps conclude. Check the arithmetic before you write it.
- Write ALL maths and science in LaTeX between single $ signs, everywhere, question, options, steps, answers ($x^2$, $\\frac{dy}{dx}$, $f'(1)$, $\\ce{H2O}$, $9.8\\,\\text{m/s}^2$). In JSON, double every backslash.`;
}

export const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        // steps come before the answer fields: models fill JSON in order, so the answer follows the working
        properties: {
          type: { type: 'string', enum: ['multiple_choice', 'written'] },
          question: { type: 'string' },
          source: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          options: { type: 'array', items: { type: 'string' } },
          correct: { type: 'number' },
          explanation: { type: 'string' },
          wrong_explanations: { type: 'array', items: { type: 'string' } },
          ideal_answer: { type: 'string' },
          key_points: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const arr = (x) => (Array.isArray(x) ? x : []);
/* Text from the AI, tidied: inside $…$ maths, a stray \( or \) (a second set of
   maths markers) would break the rendering, inside maths they mean brackets. */
const str = (x) => (x == null ? '' : String(x)).trim()
  .replace(/\$[^$\n]+\$/g, (m) => m.replace(/\\\(/g, '(').replace(/\\\)/g, ')'));

/** Turn a paragraph into steps when the AI wrote one instead of a list. */
export function splitSteps(text) {
  return str(text)
    .split(/\n+|(?<=[.!?])\s+(?=(?:Then|Next|Now|So|Finally|First|Second|Third|Substitut|Apply|Using|Since|Therefore|This gives|We get)\b)/)
    .map(s => s.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean);
}

/** Whatever the AI sent, as questions the page can always render and grade. */
export function normaliseQuiz(raw) {
  const questions = arr(raw?.questions).map((q) => {
    const type = q?.type === 'written' || (!arr(q?.options).length && q?.ideal_answer) ? 'written' : 'multiple_choice';
    const base = { type, question: str(q?.question), source: str(q?.source) };
    let steps = arr(q?.steps).map(str).filter(Boolean);
    if (type === 'written') {
      const ideal = str(q?.ideal_answer);
      if (!steps.length) steps = splitSteps(ideal);
      return { ...base, ideal_answer: ideal, key_points: arr(q?.key_points).map(str).filter(Boolean), steps };
    }
    const options = arr(q?.options).map(str).filter(Boolean).slice(0, 6);
    const correct = Math.min(Math.max(0, Math.round(Number(q?.correct) || 0)), Math.max(0, options.length - 1));
    if (!steps.length && q?.explanation) steps = splitSteps(q.explanation);
    return { ...base, options, correct, explanation: str(q?.explanation), wrong_explanations: arr(q?.wrong_explanations).map(str), steps };
  }).filter(q => q.question && (q.type === 'written' || q.options.length >= 2));
  return { questions };
}

/* ------------------------------------------------- checking the answer key */

/*
 * A fast model sometimes writes the answer before working it out, so a
 * question's answer key can contradict its own worked solution, and a
 * student who gets it right is marked wrong. A second, short pass compares
 * each key with its steps and corrects the key (never the working) where
 * they disagree.
 */
export const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          correct: { type: 'number' },
          ideal_answer: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
  },
};

export function checkPrompt(questions) {
  const list = questions.map((q, i) => `Question ${i + 1}: ${q.question}
Worked solution:
${q.steps.map((s, k) => `  ${k + 1}. ${s}`).join('\n')}
${q.type === 'written' ? `Model answer: ${q.ideal_answer}` : `Options:\n${q.options.map((o, k) => `  [${k}] ${o}`).join('\n')}\nMarked correct: [${q.correct}]`}`).join('\n\n');
  return `You are checking a practice quiz's answer key against its own worked solutions.
For each question: redo the working carefully. The key must give the final answer the question asks for (a value at a point is a number, not a formula). If the answer key does not match the correct result, the option marked correct is a different value, or the model answer says something else, return a fix. If the right value isn't among the options at all, return "options" with the wrong one replaced by the right value (keep the "A) " style labels) and "correct" pointing at it. Fix the KEY only. Return an empty "fixes" list if every key is right. Write maths in LaTeX between $ signs.

${list}`;
}

/** Apply the checker's fixes to the questions it named; anything odd is ignored. */
export function applyChecks(questions, raw) {
  const out = questions.map(q => ({ ...q }));
  for (const f of arr(raw?.fixes)) {
    const i = Math.round(Number(f?.number)) - 1;
    const q = out[i];
    if (!q) continue;
    if (q.type === 'written') {
      if (str(f.ideal_answer)) q.ideal_answer = str(f.ideal_answer).replace(/^[A-D]\)\s*/, '');
    } else {
      const opts = arr(f.options).map(str).filter(Boolean);
      if (opts.length === q.options.length) q.options = opts;
      const c = Math.round(Number(f.correct));
      if (Number.isInteger(c) && c >= 0 && c < q.options.length) q.correct = c;
    }
    q.checked = str(f.reason) || 'Answer key corrected';
  }
  return out;
}

/* -------------------------------------------------------------- grading */

export const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    verdict: { type: 'string', enum: ['correct', 'partly correct', 'incorrect'] },
    what_was_right: { type: 'string' },
    what_was_missing: { type: 'string' },
    missing_points: { type: 'array', items: { type: 'string' } },
  },
};

export function gradePrompt(q, answer) {
  return `Grade a student's written answer to a practice quiz question. Be fair and specific, like a good teacher.
Question: ${q.question}
Model answer: ${q.ideal_answer || '(none given)'}
Worked solution:
${(q.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || '(none given)'}
Key points a full-marks answer contains: ${(q.key_points || []).join('; ') || '(use the model answer)'}

Student's answer:
${answer}

Give "score" out of 10 (a correct final answer with sound reasoning, even in different words or a different valid method, is 10). "verdict": correct, partly correct or incorrect. "what_was_right": one or two sentences. "what_was_missing": one or two sentences on the gap or mistake, empty if none. "missing_points": the key points they left out. Write maths in LaTeX between $ signs.`;
}

/** A grade from the AI, made safe: a number 0–10 and the text fields always present. */
export function normaliseGrade(g) {
  const score = Math.max(0, Math.min(10, Math.round((Number(g?.score) || 0) * 2) / 2));
  const verdict = ['correct', 'partly correct', 'incorrect'].includes(g?.verdict) ? g.verdict : score >= 9 ? 'correct' : score >= 4 ? 'partly correct' : 'incorrect';
  return { score, verdict, what_was_right: str(g?.what_was_right), what_was_missing: str(g?.what_was_missing), missing_points: arr(g?.missing_points).map(str).filter(Boolean) };
}

/**
 * Points for the quiz: a multiple-choice question is 1 point; a written one
 * earns its score / 10. Ungraded written answers aren't counted yet.
 * @param grades {[index]: {score}|{error}|undefined}
 */
export function scoreQuiz(questions, answers = {}, grades = {}) {
  let points = 0, total = 0, pending = 0;
  const per = questions.map((q, i) => {
    if (q.type === 'written') {
      const g = grades[i];
      if (g && typeof g.score === 'number') { points += g.score / 10; total += 1; return { points: g.score / 10, max: 1 }; }
      if (!str(answers[`w${i}`])) { total += 1; return { points: 0, max: 1, blank: true }; }
      pending++;
      return { points: null, max: 1 };
    }
    total += 1;
    const ok = answers[i] === q.correct;
    if (ok) points += 1;
    return { points: ok ? 1 : 0, max: 1, correct: ok, chosen: answers[i] };
  });
  return { points: Math.round(points * 10) / 10, total, pending, percent: total ? Math.round((points / total) * 100) : 0, per };
}

/** "4:05" */
export function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------- asking about a question */

/** The tutor's view of one question: what was asked, what they answered, the solution, the grade. */
export function askPrompt({ q, number, answer, grade, history = [], message }) {
  const yours = q.type === 'written'
    ? (str(answer) || '(left blank)')
    : (answer == null ? '(not answered)' : q.options[answer] || '(not answered)');
  const system = `You are LOCK IN!, a patient tutor going over a practice-quiz question with a student after they answered it. Explain clearly and step by step, starting from where they are. Be encouraging but honest about mistakes. Use short numbered steps for working, and LaTeX between $ signs for all maths. Keep answers focused; offer a similar practice question if it would help.`;
  const prompt = `Question ${number}: ${q.question}
${q.type === 'multiple_choice' ? `Options:\n${q.options.join('\n')}\nCorrect answer: ${q.options[q.correct]}\n` : `Model answer: ${q.ideal_answer}\n`}Worked solution:
${(q.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}
The student's answer: ${yours}
${grade && typeof grade.score === 'number' ? `Their grade: ${grade.score}/10 (${grade.verdict}). ${grade.what_was_missing}\n` : ''}${history.length ? `\nConversation so far:\n${history.slice(-8).map(m => `${m.role === 'user' ? 'Student' : 'You'}: ${m.text}`).join('\n')}\n` : ''}
Student: ${message}`;
  return { system, prompt };
}
