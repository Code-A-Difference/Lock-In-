/**
 * Asking about a class while it's happening (and afterwards) — Granola's
 * chat, for a classroom. The transcript is handed over with timestamps, so
 * "catch me up" and "what was I just asked?" can look at the last few
 * minutes rather than the whole hour.
 *
 * Pure; tests/classChat.test.mjs runs it.
 */
import { clock } from './lectureNotes.js';

/** Quick asks, shown as chips. `live` ones only make sense mid-class. */
export const RECIPES = [
  { id: 'catchup', label: 'Catch me up', live: true,
    ask: 'I zoned out for a bit. Catch me up on the last few minutes: what is being explained right now, and what did I miss? Short bullets, newest last.' },
  { id: 'answer', label: 'I got asked a question', live: true,
    ask: 'The teacher just asked me (or the class) a question. Find the most recent question in the transcript and give me an answer I can say out loud right now: one or two plain sentences first, then one line of why, if it helps.' },
  { id: 'explain', label: 'Explain that', live: true,
    ask: 'Explain the thing being taught right now in simple words, with a quick example. Keep it short.' },
  { id: 'summary', label: 'Summary so far',
    ask: 'Summarise the class so far as short bullets by topic.' },
  { id: 'test', label: 'What’s on the test?',
    ask: 'What from this class is most likely to be tested or that the teacher stressed? Include anything said to be due, on a quiz or test, or "important". Bullets.' },
  { id: 'question', label: 'Give me a smart question',
    ask: 'Suggest one good question I could ask the teacher about what is being taught right now, to show I am following. Just the question.' },
];

/** Segments -> "[12:30] words…" lines, newest kept when it must be cut. */
export function timedTranscript(segments = [], maxChars = 18000) {
  const lines = segments.filter(s => s && s.text).map(s => `[${clock(s.start)}] ${s.text.trim()}`);
  let total = 0;
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > maxChars) break;
    kept.unshift(lines[i]);
  }
  return (kept.length < lines.length ? '[…earlier part of the class left out…]\n' : '') + kept.join('\n');
}

/**
 * The prompt for one question about a lecture.
 * @param {object} o {question, segments, myNotes, notes(markdown), className, title, live, elapsed, history:[{role,text}]}
 */
export function classChatPrompt({ question, segments = [], myNotes = '', notes = '', className = '', title = '', live = false, elapsed = 0, history = [] }) {
  const hist = history.slice(-6).map(m => `${m.role === 'user' ? 'Student' : 'You'}: ${String(m.text).slice(0, 800)}`).join('\n');
  const transcript = timedTranscript(segments, notes ? 12000 : 18000);
  const system = `You are LOCK IN!, a student's quick helper ${live ? 'during a class that is happening right now' : 'for a class they recorded'}.
${live ? `The class is ${clock(elapsed)} in. The transcript below is live and may lag by a few seconds; the newest lines are at the bottom and are what is happening now.\n` : ''}Answer fast and short — the student is reading on a phone${live ? ' in class' : ''}. Use the transcript (and their notes) as the source: if it doesn't cover something, say so in one line and then give your best general answer, marked as such. Plain text with short bullets; LaTeX in $…$ for maths. No preamble.`;
  const prompt = `${className ? `Class: ${className}\n` : ''}${title ? `Lecture: ${title}\n` : ''}${myNotes.trim() ? `\nThe student's own notes:\n${myNotes.trim().slice(0, 3000)}\n` : ''}${notes ? `\nNotes written from this class:\n${notes.slice(0, 6000)}\n` : ''}
Transcript:
${transcript || '(nothing transcribed yet)'}
${hist ? `\nConversation so far:\n${hist}\n` : ''}
Student: ${question}`;
  return { system, prompt };
}

/* ---------------------------------------------------------------- templates */

/** How the notes are laid out — like Granola's templates, for kinds of class. */
export const NOTE_TEMPLATES = [
  { id: 'lecture', label: 'Lecture', how: 'Organise by topic in the order taught.' },
  { id: 'problems', label: 'Maths & problem solving',
    how: 'For each method or problem type: the steps as a numbered list inside the points, every formula in LaTeX, and each worked example the teacher did written out step by step. Note common mistakes the teacher warned about.' },
  { id: 'science', label: 'Science & labs',
    how: 'Group by concept; keep definitions, units, equations (LaTeX; chemistry with \\ce{}) and processes in order. For a lab: aim, method, observations, results and conclusion as sections.' },
  { id: 'discussion', label: 'Discussion & seminar',
    how: 'Sections for each question discussed: the main viewpoints and arguments, who argued what if names were said, evidence or quotes used, and where the class ended up.' },
  { id: 'humanities', label: 'History & English',
    how: 'Keep names, dates, events, quotes and themes exact. Sections by period, text or theme; note cause and effect, and any essay or thesis ideas the teacher gave.' },
  { id: 'language', label: 'Language class',
    how: 'Sections for vocabulary (word — meaning), grammar rules with examples, phrases, and pronunciation notes. Keep the target-language words exactly as said.' },
];

export function templateHow(id) {
  return (NOTE_TEMPLATES.find(t => t.id === id) || NOTE_TEMPLATES[0]).how;
}
