/**
 * Break it down — the Classroom Task Shredder, merged into LOCK IN!.
 *
 * The standalone Shredder made you pick a task type from a menu of sixteen,
 * then dealt out a fixed checklist. Here it works on the homework you
 * already entered: with the shared AI key the steps are written for that
 * specific assignment; without one, the Shredder's own checklists are the
 * fallback, chosen automatically from the title.
 *
 * The ten school checklists are the Shredder's, carried over. Its six
 * non-homework ones (puzzle, desk, workout, morning routine...) stayed with
 * the standalone tool, and the lab-report steps were rewritten — the
 * original read like machine paraphrase.
 */

export const TEMPLATES = {
  essay: {
    label: 'Essay or paper',
    steps: [
      ['Open your doc and type just the title', 2],
      ['Find 2 sources or quotes from your notes or the library', 10],
      ['Write 3 bullet points for your introduction', 5],
      ["Write paragraph 1 — don't worry if it's perfect, just type", 15],
      ['Take a 2-minute stretch break', 2],
      ['Write paragraph 2', 15],
      ['Write paragraph 3', 15],
      ['Write a 2-sentence conclusion', 5],
      ['Read it over once to fix spelling and flow', 5],
    ],
  },
  math: {
    label: 'Problem set',
    steps: [
      ['Clear your desk: pencil, scratch paper, calculator', 2],
      ['Look at the first problem and write down the formula you need', 3],
      ['Solve problems 1–3', 10],
      ['Solve problems 4–6', 10],
      ['Stand up and move for a minute', 1],
      ['Solve the remaining problems', 15],
      ['Check your answers — redo any that look off', 5],
    ],
  },
  reading: {
    label: 'Reading',
    steps: [
      ['Open the text to the right page and find somewhere quiet', 1],
      ['Skim the headings, bold terms and figures first', 3],
      ['Read the first half', 10],
      ['Write 3 bullet points on what you just read', 4],
      ['Read the second half', 10],
      ['Write 3 more bullet points', 4],
      ['Write one sentence summing up the whole thing', 3],
    ],
  },
  presentation: {
    label: 'Presentation',
    steps: [
      ['Open Slides or PowerPoint and pick a simple theme', 3],
      ['Write the title slide', 2],
      ['List the 4–5 main points — one per slide', 5],
      ['Fill in the slides, a few words each', 15],
      ['Add one image or chart where it helps', 8],
      ['Write speaker notes for each slide', 8],
      ['Run through it out loud once, timing yourself', 5],
    ],
  },
  language: {
    label: 'Language practice',
    steps: [
      ["Open your flashcards or today's lesson", 1],
      ['Review yesterday’s words for 5 minutes', 5],
      ['Learn 10 new words', 7],
      ['Say each new word out loud in a sentence', 5],
      ['Quiz yourself without looking', 5],
    ],
  },
  concept: {
    label: 'Understand a concept',
    steps: [
      ['Write the concept in the middle of a blank page', 1],
      ['Read your notes or textbook section on it', 8],
      ['Explain it in your own words, as if to a friend', 6],
      ['Draw a diagram or example of it', 6],
      ['Write down what still confuses you — ask about it', 4],
    ],
  },
  exam: {
    label: 'Exam or test review',
    steps: [
      ['Find the study guide or list of topics', 2],
      ['Gather your notes, past quizzes and a blank page', 3],
      ['Read through the most important topics', 15],
      ['Write a 5-question practice test from your notes', 10],
      ['Close your notes and answer it from memory', 15],
      ['Mark it — whatever you missed is what to study next', 5],
    ],
  },
  coding: {
    label: 'Coding assignment',
    steps: [
      ['Read the prompt and write down the inputs and outputs', 5],
      ['Sketch the steps in plain English (pseudocode)', 8],
      ['Write the smallest version that runs', 12],
      ['Test it with a normal case and an edge case', 8],
      ['Fix what broke, then tidy and comment the code', 8],
      ['Re-read the prompt and check you did everything it asks', 2],
    ],
  },
  group_project: {
    label: 'Group project',
    steps: [
      ['Make a shared doc and add everyone', 3],
      ['List every part of the project', 5],
      ['Split the parts between people, with dates', 7],
      ['Do your own part', 20],
      ['Set a check-in time before it is due', 2],
    ],
  },
  lab_report: {
    label: 'Lab report',
    steps: [
      ['Write the title, purpose and hypothesis', 5],
      ['List the materials you used', 4],
      ['Write the procedure, step by step, as you actually did it', 10],
      ['Put your measurements in a table', 12],
      ['Describe what the results show, and why, using the theory from class', 15],
      ['Write a short conclusion: was the hypothesis supported?', 5],
    ],
  },
};

const DETECT = [
  ['lab_report', /\blab\b|\blab report\b|experiment/i],
  ['exam', /\b(test|quiz|exam|midterm|final|review|study for)\b/i],
  ['essay', /\b(essay|paper|paragraph|thesis|response|reflection|report|analysis|write[- ]?up)\b/i],
  ['presentation', /\b(presentation|slides?|slideshow|powerpoint|pitch|speech)\b/i],
  ['coding', /\b(code|coding|program|script|lab \d+|cpsc|comp ?sci|python|java|function)\b/i],
  ['group_project', /\b(group|team|partner)\b/i],
  ['reading', /\b(read|reading|chapter|ch\.? ?\d+|pages?|novel|article)\b/i],
  ['language', /\b(vocab|vocabulary|french|spanish|german|mandarin|japanese|conjugat|flashcards?)\b/i],
  ['math', /\b(math|worksheet|problems?|problem set|pset|exercises?|calc|algebra|geometry|stats?)\b/i],
  ['concept', /\b(concept|understand|learn|notes?)\b/i],
];

/** Best-guess template for a homework title (and its class name). */
export function detectTemplate(title = '', className = '') {
  const t = `${title} ${className}`;
  for (const [key, re] of DETECT) if (re.test(t)) return key;
  return 'concept';
}

let seq = 0;
const stepId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeStep(text, minutes = 5) {
  return { id: stepId(), text: String(text).trim(), minutes: Math.max(1, Math.round(Number(minutes) || 5)), done: false };
}

export function stepsFromTemplate(key) {
  const t = TEMPLATES[key] || TEMPLATES.concept;
  return t.steps.map(([text, minutes]) => makeStep(text, minutes));
}

/** What the AI is asked. Kept short: it is a checklist, not an essay. */
export function breakdownRequest(hw) {
  return {
    prompt:
      `Break this school assignment into 4 to 8 small, concrete steps a high school or university student can tick off one at a time.\n` +
      `Assignment: ${hw.title}\n` +
      (hw.class_name ? `Class: ${hw.class_name}\n` : '') +
      (hw.description ? `Details: ${hw.description}\n` : '') +
      (hw.due_date ? `Due: ${hw.due_date}\n` : '') +
      `Each step starts with a verb, is under 90 characters, and takes 2 to 25 minutes. ` +
      `Put a short break in the middle if the total is over 45 minutes. ` +
      `Make the first step tiny, so starting is easy.`,
    response_json_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, minutes: { type: 'number' } },
            required: ['text', 'minutes'],
          },
        },
      },
      required: ['steps'],
    },
  };
}

/** Validate what came back from the AI; null if unusable. */
export function stepsFromAi(reply) {
  const list = Array.isArray(reply?.steps) ? reply.steps : Array.isArray(reply) ? reply : null;
  if (!list) return null;
  const steps = list
    .filter(s => s && typeof s.text === 'string' && s.text.trim())
    .slice(0, 12)
    .map(s => makeStep(s.text.slice(0, 160), Math.min(90, Math.max(1, Number(s.minutes) || 5))));
  return steps.length >= 2 ? steps : null;
}

export function stepProgress(steps = []) {
  const total = steps.length;
  const done = steps.filter(s => s.done).length;
  const minutesLeft = steps.filter(s => !s.done).reduce((a, s) => a + (s.minutes || 0), 0);
  return { total, done, minutesLeft, next: steps.find(s => !s.done) || null };
}
