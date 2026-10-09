/**
 * Quizzing on a whole class: every lecture's notes plus the material the
 * student added themselves (a teacher's PDF, a photo of the board, a study
 * guide, pasted text) — gathered fairly within the AI's size limit, so one
 * long lecture can't crowd the rest out, and each question says where it
 * came from.
 *
 * Pure; tests/classQuiz.test.mjs runs it.
 */
import { notesMarkdown, transcriptText } from './lectureNotes.js';
import { quizRules } from './quizKit.js';

export const QUIZ_MATERIAL_CHARS = 20000;    // the AI proxy takes 30,000 characters per prompt; the rest is instructions

/** What a lecture or added material has to offer a quiz, best first: its notes, its own text, its transcript. */
export function lectureMaterialText(l) {
  if (l?.notes && (l.notes.sections?.length || l.notes.summary)) return notesMarkdown(l.notes, { title: l.title });
  if (l?.material_text) return String(l.material_text);
  return transcriptText(l?.segments || []);
}

/** A class's lectures and materials that have something to quiz on, newest first. */
export function classSources(lectures = [], className = '') {
  return lectures
    .filter(l => l && (className ? l.class_name === className : true))
    .map(l => ({ id: l.id, title: l.title || 'Untitled', date: l.date || '', kind: l.source === 'material' ? 'material' : 'lecture', text: lectureMaterialText(l) }))
    .filter(s => s.text.trim().length >= 40)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * The chosen sources as one block of text within `budget` characters. Each
 * gets an equal share; what a short one doesn't use is handed on to the
 * longer ones, so nothing is cut that didn't have to be.
 * @returns {{text:string, used:{id,title,chars,cut:boolean}[]}}
 */
export function gatherMaterial(sources = [], budget = QUIZ_MATERIAL_CHARS) {
  const list = sources.filter(s => s.text && s.text.trim());
  if (!list.length) return { text: '', used: [] };
  const headerOf = (s) => `### ${s.kind === 'material' ? 'Material' : 'Lecture'}: ${s.title}${s.date ? ` (${s.date})` : ''}\n`;
  let left = budget - list.reduce((n, s) => n + headerOf(s).length + 4, 0);   // + the blank line between, + the "…" line if cut
  const share = new Map();
  const pending = [...list].sort((a, b) => a.text.length - b.text.length);   // shortest first: they free up room
  while (pending.length) {
    const each = Math.max(0, Math.floor(left / pending.length));
    const s = pending.shift();
    const take = Math.min(s.text.length, each);
    share.set(s.id, take);
    left -= take;
  }
  const used = [];
  const parts = list.map((s) => {
    const n = share.get(s.id) || 0;
    const cut = n < s.text.length;
    let body = s.text.slice(0, n);
    if (cut) { const at = body.lastIndexOf('\n'); if (at > n * 0.6) body = body.slice(0, at); body += '\n…'; }
    used.push({ id: s.id, title: s.title, chars: body.length, cut });
    return headerOf(s) + body.trim();
  });
  return { text: parts.join('\n\n'), used };
}

/** The quiz request for a class's material. */
export function classQuizPrompt({ className = '', focus = '', material = '', count = 10, written = 0, difficulty = 'standard' }) {
  return `Write a practice quiz for a student's ${className ? `"${className}" ` : ''}class, from their own notes and class material below.
${focus ? `Focus especially on: ${focus}\n` : ''}
- Spread the questions across ALL of the lectures and materials below, not just the first one — roughly in proportion to how much each covers.
- Only ask about what the material actually says. Test understanding, not trivia: definitions, how and why, worked problems, cause and effect.
- Every question has a "source": the exact title after "Lecture:" or "Material:" that it came from.

${quizRules({ difficulty, count, written })}

Material:
${material}`;
}

export const CLASS_QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['multiple_choice', 'written'] },
          question: { type: 'string' },
          source: { type: 'string' },
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

/* ------------------------------------------------- adding your own material */

/** The prompt that reads an uploaded file (PDF, photo, text) into text the app can keep. */
export const EXTRACT_PROMPT = `This is study material a student added for a class (a handout, slides, a textbook page, a photo of the board or of notes).
Write out everything it teaches, faithfully and completely: all the text, in order, with headings kept. Describe each diagram, graph or table in words, including the numbers and labels on it. Write maths and science in LaTeX between $ signs. No commentary before or after — just the content.`;

/** Keep what an account can hold: material text is capped well under the per-record limit. */
export const MATERIAL_MAX_CHARS = 60000;
