/**
 * Lectures: transcribing the recording piece by piece, and turning the
 * transcript (plus whatever you jotted down yourself) into notes.
 *
 * The notes work like Granola's: your own rough notes are the outline, what
 * you thought mattered, and the transcript fills them out, rather than the
 * AI writing a generic summary over your head. Long lectures are summarised
 * in sections first (the AI proxy caps a prompt at 30,000 characters), then
 * combined.
 *
 * Prompt builders and parsers are pure; tests/lectures.test.mjs runs them.
 */

export const SECTION_CHARS = 16000;

/* ------------------------------------------------------------ transcripts */

/** The transcript as one string, in order. */
export function transcriptText(segments = []) {
  return segments.filter(s => s.text).map(s => s.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

/* Tags speech models write for sound they couldn't make out: [inaudible], (indistinct chatter), [BLANK_AUDIO]… */
const TAGS = /[[(*]\s*(?:inaudible|unintelligible|indistinct[^\])*]*|blank_audio|no speech|silence|music|noise|background noise|crosstalk|static)\s*[\])*]/gi;
/* Speech models sometimes "hear" a stock phrase in a quiet room. A piece that
   was nearly silent and came back as only such filler is treated as silence. */
const FILLER = /^(\W*(thank you( for watching)?|thanks|all ?right|okay|ok|right|you|bye|um+|uh+|hmm+|yeah|so|music|silence)\W*)+$/i;

/** One transcribed piece, tidied: no [inaudible]-style tags, no filler "heard" in silence. */
export function cleanPiece(text, loudness = 1) {
  const t = String(text || '').replace(TAGS, ' ').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  return loudness < 0.03 && FILLER.test(t) ? '' : t;
}

/** "12:05" for 725 seconds; "1:02:05" past the hour. */
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** Split a long transcript at sentence ends into pieces of at most `max` characters. */
export function sections(text, max = SECTION_CHARS) {
  if (text.length <= max) return text ? [text] : [];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    const at = cut > max * 0.5 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/* ------------------------------------------------------------------ notes */

export const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', properties: {
      heading: { type: 'string' }, points: { type: 'array', items: { type: 'string' } },
      graph: { type: 'object', properties: {
        title: { type: 'string' },
        expressions: { type: 'array', items: { type: 'string' } },
        xmin: { type: 'number' }, xmax: { type: 'number' }, ymin: { type: 'number' }, ymax: { type: 'number' },
        caption: { type: 'string' },
      } },
    } } },
    key_terms: { type: 'array', items: { type: 'object', properties: {
      term: { type: 'string' }, definition: { type: 'string' },
    } } },
    action_items: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string', enum: ['homework', 'test', 'reminder'] }, title: { type: 'string' }, due: { type: 'string' },
    } } },
    review_questions: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * How maths and science are written in notes, so they render as real notation
 * (KaTeX + mhchem in the app) instead of "x squared over two".
 */
export const STEM_RULES = `Maths and science notation (when the class has any):
- Write every formula, expression, number with a unit, and symbol in LaTeX between single dollar signs, inline: $x^2 + 3x - 4 = 0$. Never leave maths as words or plain text like x^2 or sqrt(x).
- Turn spoken maths into notation: "x squared" -> $x^2$, "two over three" -> $\\frac{2}{3}$, "square root of b squared minus four a c" -> $\\sqrt{b^2 - 4ac}$, "d y by d x" -> $\\frac{dy}{dx}$, "the integral from zero to one of x d x" -> $\\int_0^1 x\\,dx$, "limit as x goes to zero" -> $\\lim_{x \\to 0}$, "delta x" -> $\\Delta x$, "theta" -> $\\theta$, "f of x" -> $f(x)$, "less than or equal to" -> $\\le$.
- Chemistry in mhchem: formulas and equations as $\\ce{2H2 + O2 -> 2H2O}$, ions $\\ce{SO4^2-}$, states $\\ce{NaCl(aq)}$, equilibrium $\\ce{N2 + 3H2 <=> 2NH3}$.
- Physics: numbers with units as $9.8\\,\\text{m/s}^2$, scientific notation $3.0 \\times 10^8\\,\\text{m/s}$, vectors $\\vec{F}$, subscripts $v_0$, $F_{net}$.
- Calculus: $f'(x)$, $\\frac{d}{dx}\\left(x^3\\right) = 3x^2$, $\\int x^2\\,dx = \\frac{x^3}{3} + C$, $\\sum_{n=1}^{\\infty}$.
- Keep each worked step on its own point. In JSON, write every LaTeX backslash doubled (\\\\frac).`;

export const GRAPH_RULES = `Graphs: when the class graphs, sketches or describes a plot of something with a known equation or data, a parabola, a line, a trig or exponential function, a derivative or area under a curve, a position/velocity–time relation, a supply/demand line, give that section a "graph" for Desmos:
- "expressions": Desmos LaTeX, one per item, in x and y (e.g. "y=x^2-4", "f(x)=\\\\sin(x)", "y=2x+1", "(2,0)", "y\\\\le x+1"). For physics or other axes, still use x and y and name the real axes in "caption" (e.g. "x is time in s, y is velocity in m/s").
- "xmin"/"xmax"/"ymin"/"ymax": a window that shows the interesting part (roots, vertex, intersections).
- "title": what the graph shows; "caption": one line on what to notice.
- Only when the equation or numbers were actually given or follow directly from the class. No graph is better than an invented one. Most sections have none.`;

export function sectionPrompt(part, index, total, className) {
  return `This is part ${index + 1} of ${total} of a transcript of a ${className ? `${className} ` : ''}class.
Write dense study notes for just this part: the ideas taught, in order, with examples, formulas, dates and definitions kept exactly. Bullet points. Note anything the teacher said is due, coming up on a test, or important to remember. Write maths and science in LaTeX between $ signs ($x^2$, $\\ce{H2O}$, $9.8\\,\\text{m/s}^2$), turning spoken maths into notation. If a graph is drawn or described, keep its equation and what it shows. No preamble. Only what this part of the transcript says, nothing from your own knowledge; if it says little, write little.

Transcript:
${part}`;
}

export function notesPrompt({ transcript, myNotes = '', className = '', title = '', date = '', how = '' }) {
  return `You are turning a recorded class into a student's study notes.
${className ? `Class: ${className}\n` : ''}${date ? `Date: ${date}\n` : ''}${title ? `Working title: ${title}\n` : ''}${how ? `Layout for this kind of class: ${how}\n` : ''}
${myNotes.trim()
    ? `The student took these rough notes during class. Treat them as the outline of what matters to them: keep their headings and points, correct and complete them from the transcript, and add what they missed beneath them.\n--- Student's notes ---\n${myNotes.trim().slice(0, 6000)}\n--- End ---\n`
    : 'The student took no notes of their own; organise the notes by topic, in the order taught.\n'}
Rules:
- Use ONLY what the transcript (and the student's notes) actually say. Never add facts, examples, definitions, formulas, dates or deadlines from your own knowledge of the subject, not even standard textbook ones. The class name is context for spelling, not a topic to write about.
- Match the notes to how much was said: a short or off-topic recording gets short notes. Empty "sections", "key_terms", "action_items" or "review_questions" are correct when nothing in the transcript fits them, never fill them in to look complete.
- "summary" is 2-3 sentences a student could read the night before a test (one sentence, or a plain statement that little was covered, for a short recording).
- "sections" follow the lesson's own structure; points are short, specific, and keep numbers, formulas and names exact.
- "key_terms" are terms the teacher defined or emphasised.
- "action_items" are only things the teacher actually said: homework, a test or quiz, or something to bring or do. "due" is the date exactly as said ("next Friday", "Oct 12"), or "".
- "review_questions" are up to 5 questions about what was actually taught (none if nothing was).
- "title" is a short name for this class's topic.
- Write "summary", points, definitions and review questions with the notation rules below.

${STEM_RULES}

${GRAPH_RULES}

Transcript:
${transcript}`;
}

/** Models say "quiz", "exam", "assignment"…; the app has homework and tests. */
export function actionKind(kind, title = '') {
  const k = `${kind || ''} ${title || ''}`.toLowerCase();
  if (/\b(test|quiz|exam|midterm|final|assessment)\b/.test(k)) return 'test';
  if (/\b(homework|assignment|lab|essay|report|reading|worksheet|project|problem set)\b/.test(k)) return 'homework';
  return 'reminder';
}

/**
 * A section's Desmos graph, checked: a few short expressions and a sane
 * window, or null. Bad bounds are dropped (Desmos picks its own).
 */
export function normaliseGraph(g) {
  if (!g || typeof g !== 'object') return null;
  const expressions = (Array.isArray(g.expressions) ? g.expressions : [])
    .map(e => String(e ?? '').trim().replace(/^\$+|\$+$/g, ''))
    .filter(e => e && e.length <= 200).slice(0, 6);
  if (!expressions.length) return null;
  const num = (v) => (typeof v === 'number' ? v : Number(v));
  const [xmin, xmax, ymin, ymax] = [g.xmin, g.xmax, g.ymin, g.ymax].map(num);
  const out = { title: String(g.title || '').trim(), caption: String(g.caption || '').trim(), expressions };
  if ([xmin, xmax].every(Number.isFinite) && xmin < xmax) Object.assign(out, { xmin, xmax });
  if ([ymin, ymax].every(Number.isFinite) && ymin < ymax) Object.assign(out, { ymin, ymax });
  return out;
}

/** Fill in anything the AI left out, so the page never has to guard. */
export function normaliseNotes(n) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    title: String(n?.title || '').trim(),
    summary: String(n?.summary || '').trim(),
    sections: arr(n?.sections).map(s => {
      const out = { heading: String(s?.heading || '').trim(), points: arr(s?.points).map(String).filter(Boolean) };
      const g = normaliseGraph(s?.graph);
      if (g) out.graph = g;
      return out;
    }).filter(s => s.heading || s.points.length),
    key_terms: arr(n?.key_terms).map(k => ({ term: String(k?.term || '').trim(), definition: String(k?.definition || '').trim() })).filter(k => k.term),
    action_items: arr(n?.action_items).map(a => ({
      kind: actionKind(a?.kind, a?.title),
      title: String(a?.title || '').trim(),
      due: String(a?.due || '').trim(),
    })).filter(a => a.title),
    review_questions: arr(n?.review_questions).map(String).filter(Boolean),
  };
}

/** The notes as Markdown, for copying or sharing. */
export function notesMarkdown(notes, { title, className, date } = {}) {
  const n = normaliseNotes(notes);
  const lines = [`# ${n.title || title || 'Lecture notes'}`];
  const meta = [className, date].filter(Boolean).join(' · ');
  if (meta) lines.push(`_${meta}_`);
  if (n.summary) lines.push('', n.summary);
  for (const s of n.sections) {
    lines.push('', `## ${s.heading || 'Notes'}`);
    for (const p of s.points) lines.push(`- ${p}`);
    if (s.graph) lines.push(`- Graph${s.graph.title ? ` (${s.graph.title})` : ''}: ${s.graph.expressions.map(e => `$${e}$`).join(', ')}${s.graph.caption ? `, ${s.graph.caption}` : ''}`);
  }
  if (n.key_terms.length) {
    lines.push('', '## Key terms');
    for (const k of n.key_terms) lines.push(`- **${k.term}**, ${k.definition}`);
  }
  if (n.action_items.length) {
    lines.push('', '## To do');
    for (const a of n.action_items) lines.push(`- [ ] ${a.title}${a.due ? ` (${a.due})` : ''}`);
  }
  if (n.review_questions.length) {
    lines.push('', '## Check yourself');
    for (const q of n.review_questions) lines.push(`- ${q}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------- staying grounded */
/*
 * The model is asked for a summary, sections, key terms and review questions.
 * Given almost nothing, five seconds of "what the hell" in a class called
 * Probability, it filled every one of them from what it knows about
 * probability. Two guards:
 *   1. Too little was said: don't ask it at all (MIN_WORDS).
 *   2. Afterwards, every point, term and question is checked against what was
 *      actually said (and the student's own notes): one whose key words mostly
 *      never came up is dropped, and the notes say so.
 */

/** Below this many spoken words there is nothing to make notes from. */
export const MIN_WORDS = 40;

export function spokenWords(text) {
  return (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

const STOP = new Set(('about above after again against also because been before being below between both but called could does doing down during each even every from further have having here hers herself himself into itself just like make made many more most much must myself only other ought ours over same should some such than that their theirs them themselves then there these they this those through under until very want were what when where which while whom with would your yours yourself thing things means mean used using uses use example examples called known way ways part parts also first second third number numbers between important note notes class lesson teacher today said says explained explains discussed covered introduced talked will can may might lecture lectures topic topics concept concepts idea ideas basic basics fundamental fundamentals including include includes introduce introduces introduction define defined defines definition represent represented representation describe described explain understand understanding calculate calculated calculating formula formulas key main simple overview review question questions answer one two three each the and for are was not you all any how its our out who why get got let put see set too').split(' '));

function stemWord(w) {
  return w.length > 4 ? w.replace(/(ations|ation|ings|ing|ers|er|ies|es|s|ed|ly|al)$/, '') || w : w;
}

/** The meaningful words of a piece of text (LaTeX commands stripped), stemmed. */
export function contentWords(text) {
  const plain = String(text || '')
    .replace(/\\[a-zA-Z]+/g, ' ')        // \frac, \text, \Delta …
    .replace(/[{}$^_\\]/g, ' ')
    .toLowerCase();
  const words = plain.match(/[a-z]{4,}|\d+(?:\.\d+)?/g) || [];
  return words.filter(w => !STOP.has(w)).map(stemWord);
}

/** 0..1: how much of `text` is made of words that occur in the source. */
export function support(text, sourceSet) {
  const w = contentWords(text);
  if (!w.length) return 1;                           // nothing to judge ("Q1", "x = 2")
  if (w.length < 3) return w.some(x => sourceSet.has(x)) ? 1 : 0;   // short ("Due Friday"): one of its words was said
  return w.filter(x => sourceSet.has(x)).length / w.length;
}

/**
 * Drop what the recording doesn't back up. Returns the notes with a
 * `checked: { kept, dropped }` record, and a `warning` when much was dropped.
 */
export function groundNotes(notes, source, { min = 0.34 } = {}) {
  const set = new Set(contentWords(source));
  let kept = 0, dropped = 0;
  const keep = (text) => { const ok = support(text, set) >= min; if (ok) kept++; else dropped++; return ok; };
  const out = { ...notes };
  out.sections = notes.sections
    .map(s => ({ ...s, points: s.points.filter(keep) }))
    .filter(s => s.points.length);
  out.key_terms = notes.key_terms.filter(k => keep(`${k.term} ${k.definition}`));
  out.review_questions = notes.review_questions.filter(keep);
  out.action_items = notes.action_items.filter(a => keep(a.title));
  if (notes.summary && !keep(notes.summary)) out.summary = '';
  out.checked = { kept, dropped };
  if (dropped && dropped >= (kept + dropped) * 0.3) {
    out.warning = 'Some of what the AI wrote wasn’t in the recording, so it was left out. Check these notes against the transcript.';
  }
  if (!out.summary && !out.sections.length) {
    out.summary = 'Nothing in the recording could be turned into notes, the transcript is below.';
  }
  return out;
}

/** The notes for a recording with too little in it to make any. */
export function tooShortNotes(words) {
  return normaliseNotes({
    summary: words
      ? `Only ${words} word${words === 1 ? ' was' : 's were'} recorded, not enough to make notes from. The transcript is below.`
      : 'Nothing was heard in this recording, so there are no notes. If the class was quiet or far away, try recording closer to the speaker.',
  });
}
