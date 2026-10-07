/**
 * Lectures: transcribing the recording piece by piece, and turning the
 * transcript (plus whatever you jotted down yourself) into notes.
 *
 * The notes work like Granola's: your own rough notes are the outline — what
 * you thought mattered — and the transcript fills them out, rather than the
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

export const GRAPH_RULES = `Graphs: when the class graphs, sketches or describes a plot of something with a known equation or data — a parabola, a line, a trig or exponential function, a derivative or area under a curve, a position/velocity–time relation, a supply/demand line — give that section a "graph" for Desmos:
- "expressions": Desmos LaTeX, one per item, in x and y (e.g. "y=x^2-4", "f(x)=\\\\sin(x)", "y=2x+1", "(2,0)", "y\\\\le x+1"). For physics or other axes, still use x and y and name the real axes in "caption" (e.g. "x is time in s, y is velocity in m/s").
- "xmin"/"xmax"/"ymin"/"ymax": a window that shows the interesting part (roots, vertex, intersections).
- "title": what the graph shows; "caption": one line on what to notice.
- Only when the equation or numbers were actually given or follow directly from the class. No graph is better than an invented one. Most sections have none.`;

export function sectionPrompt(part, index, total, className) {
  return `This is part ${index + 1} of ${total} of a transcript of a ${className ? `${className} ` : ''}class.
Write dense study notes for just this part: the ideas taught, in order, with examples, formulas, dates and definitions kept exactly. Bullet points. Note anything the teacher said is due, coming up on a test, or important to remember. Write maths and science in LaTeX between $ signs ($x^2$, $\\ce{H2O}$, $9.8\\,\\text{m/s}^2$), turning spoken maths into notation. If a graph is drawn or described, keep its equation and what it shows. No preamble.

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
- Only use what the transcript says. Don't invent facts, dates or deadlines.
- "summary" is 2-3 sentences a student could read the night before a test.
- "sections" follow the lesson's own structure; points are short, specific, and keep numbers, formulas and names exact.
- "key_terms" are terms the teacher defined or emphasised.
- "action_items" are only things the teacher actually said: homework, a test or quiz, or something to bring or do. "due" is the date exactly as said ("next Friday", "Oct 12"), or "".
- "review_questions" are 3-5 questions that check understanding of this class.
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
    if (s.graph) lines.push(`- Graph${s.graph.title ? ` (${s.graph.title})` : ''}: ${s.graph.expressions.map(e => `$${e}$`).join(', ')}${s.graph.caption ? ` — ${s.graph.caption}` : ''}`);
  }
  if (n.key_terms.length) {
    lines.push('', '## Key terms');
    for (const k of n.key_terms) lines.push(`- **${k.term}** — ${k.definition}`);
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
