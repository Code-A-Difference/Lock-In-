/**
 * The assistant's brain, minus the network and React: what it is told about
 * the student's world, how it turns the model's JSON into app actions, and
 * which parts of their lectures to hand it. Pure, so tests/assistant.test.mjs
 * runs it in Node.
 *
 * It used to match a fixed list of phrases and treat everything else as a
 * one-off question with no memory. Now every sentence that isn't an obvious
 * one-word command goes to the model together with the recent conversation,
 * the timer, the agenda and the relevant lecture notes, and the model answers
 * AND says which actions to take, in its own words for each student.
 */
import { transcriptText, notesMarkdown } from './lectureNotes.js';

/* ------------------------------------------------------------ the reply */

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What to show in the chat. Markdown allowed.' },
    spoken: { type: 'string', description: 'The reply word for word as it should be read aloud: the same content and length, with maths and symbols said in words. Never shorter than the reply, never a summary. Leave out if the reply has no maths or symbols.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          minutes: { type: 'number' },
          delta: { type: 'number' },
          title: { type: 'string' },
          kind: { type: 'string' },
          date: { type: 'string' },
          className: { type: 'string' },
          topic: { type: 'string' },
          path: { type: 'string' },
          answer: { type: 'string' },
          newTitle: { type: 'string' },
          priority: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          on: { type: 'boolean' },
          notes: { type: 'string' },
          expressions: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
      },
    },
  },
  required: ['reply', 'actions'],
};

const PAGES = { today: '/', home: '/', classes: '/Classes', class: '/Classes', study: '/Study', practice: '/Study', quizzes: '/Study', notes: '/Notes', lectures: '/Notes', settings: '/Settings' };

/** One of the model's actions -> the command object the app already executes, or null. */
export function actionToCommand(a) {
  if (!a || typeof a.name !== 'string') return null;
  const name = a.name.trim();
  const mins = Number.isFinite(Number(a.minutes)) && a.minutes !== undefined && a.minutes !== null ? Number(a.minutes) : null;
  switch (name) {
    case 'startFocus': return { action: 'startFocus', minutes: mins, taskTitle: a.title || '' };
    case 'startBreak': return { action: 'startBreak', minutes: mins };
    case 'resume': case 'start': return { action: 'start' };
    case 'pause': case 'skip': case 'reset': case 'timeLeft': case 'completeStep': case 'readStep': case 'stopRecording': case 'stopQuiz':
      return { action: name };
    case 'setFocusLength': return mins ? { action: 'setFocus', minutes: mins } : null;
    case 'setBreakLength': return mins ? { action: 'setBreak', minutes: mins } : null;
    case 'addTime': return mins ? { action: 'adjust', minutes: mins } : null;
    case 'sound': return { action: 'sound', kind: ['rain', 'brown', 'drone', 'off', 'last'].includes(a.kind) ? a.kind : 'last' };
    case 'volume': return { action: 'volume', delta: Math.max(-1, Math.min(1, Number(a.delta) || 0.15)) };
    case 'addHomework': return { action: 'addHomework', title: a.title || '', datePhrase: a.date || '', className: a.className || '', source: `${a.title || ''} ${a.className || ''}`.toLowerCase() };
    case 'addTest': return { action: 'addTest', title: a.title || '', datePhrase: a.date || '', className: a.className || '', source: `${a.title || ''} ${a.className || ''}`.toLowerCase() };
    case 'completeHomework': return a.title ? { action: 'completeItem', title: a.title } : null;
    case 'deleteItem': return a.title ? { action: 'deleteItem', title: a.title, kind: /test|exam/i.test(a.kind || '') ? 'test' : /home|assign/i.test(a.kind || '') ? 'homework' : '' } : null;
    case 'recordLecture': return { action: 'recordLecture', className: a.className || '' };
    case 'createQuiz': return a.topic ? { action: 'createQuiz', topic: a.topic } : null;
    case 'quizAnswer': {
      const i = 'abcd'.indexOf(String(a.answer || '').trim().toLowerCase().slice(0, 1));
      return i >= 0 ? { action: 'quizAnswer', answer: i } : null;
    }
    case 'openPlanner': return { action: 'openPlanner' };
    // the planner
    case 'addFreeTime': return a.start && a.end ? { action: 'addFreeTime', date: a.date || 'today', start: a.start, end: a.end } : null;
    case 'removeFreeTime': return { action: 'removeFreeTime', date: a.date || '', start: a.start || '' };
    case 'clearFreeTime': return { action: 'clearFreeTime', date: a.date || '' };
    case 'makePlan': return { action: 'makePlan', notes: a.notes || '' };
    case 'clearPlan': return { action: 'clearPlan' };
    // editing what's there
    case 'updateHomework': return a.title ? { action: 'updateHomework', title: a.title, newTitle: a.newTitle || '', date: a.date || '', priority: a.priority || '', className: a.className || '' } : null;
    case 'updateTest': return a.title ? { action: 'updateTest', title: a.title, newTitle: a.newTitle || '', date: a.date || '', className: a.className || '' } : null;
    case 'breakDown': return a.title ? { action: 'breakDown', title: a.title } : null;
    case 'addClass': return (a.title || a.className) ? { action: 'addClass', name: a.title || a.className } : null;
    case 'renameClass': return a.title && a.newTitle ? { action: 'renameClass', name: a.title, newName: a.newTitle } : null;
    case 'deleteClass': return (a.title || a.className) ? { action: 'deleteClass', name: a.title || a.className } : null;
    // settings and tools
    case 'setGoal': return mins ? { action: 'setGoal', minutes: mins } : null;
    case 'setDarkMode': return { action: 'setDarkMode', on: a.on !== false };
    case 'setAutoBreak': return { action: 'setAutoBreak', on: a.on !== false };
    case 'graph': return { action: 'graph', expressions: (Array.isArray(a.expressions) ? a.expressions : [a.title]).filter(Boolean).map(String).slice(0, 10) };
    case 'openPractice': return { action: 'openPractice', topic: a.topic || '', tab: a.kind === 'grading' ? 'grading' : 'quiz' };
    case 'pauseRecording': case 'resumeRecording': case 'openCamera': return { action: name };
    case 'openFocus': return { action: 'openFocus' };
    case 'openPage': {
      const path = PAGES[String(a.path || a.title || '').toLowerCase().replace(/^\//, '').trim()];
      return path ? { action: 'navigate', path } : null;
    }
    default: return null;
  }
}

/** The model's JSON (or plain text, if it ignored the format) -> { reply, spoken, actions }. */
export function parsePlan(raw) {
  if (raw && typeof raw === 'object') {
    const actions = Array.isArray(raw.actions) ? raw.actions.filter(a => a && typeof a === 'object') : [];
    const reply = String(raw.reply ?? raw.text ?? raw.response ?? '').trim();
    return { reply, spoken: String(raw.spoken || '').trim(), actions };
  }
  return { reply: String(raw || '').trim(), spoken: '', actions: [] };
}

/** What to say aloud: the model's short version, else the start of the reply. */
/**
 * What is read aloud: the whole reply. The model's "spoken" is used only when
 * it really is the reply read aloud (maths in words); a "spoken" that is much
 * shorter is a summary, and summaries left out the parts that mattered.
 */
export function spokenVersion(plan) {
  const reply = plan.reply.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  const s = (plan.spoken || '').trim();
  if (s && s.length >= reply.length * 0.75) return s;
  return reply || s;
}

/* ----------------------------------------------------------- fast path */

const SAFE_FAST = new Set(['pause', 'start', 'skip', 'reset', 'timeLeft', 'sound', 'volume', 'stopRecording', 'stopQuiz', 'quizAnswer', 'completeStep', 'readStep']);

/**
 * Plain one-to-four word commands skip the model, so "pause" is instant.
 * Anything longer is language, and goes to the model, "wait, what does
 * mitosis mean" must not pause the timer.
 */
export function fastCommand(text, parse, { quizActive = false } = {}) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  const cmd = parse(text);
  if (!SAFE_FAST.has(cmd.action)) return null;
  if (cmd.action === 'quizAnswer' && !quizActive) return null;
  return cmd;
}

/* ------------------------------------------------------------- context */

const STOP = new Set('the and for are but not you your with that this from have has had was were what when where which who whom how why can could would should will about into over then than them they their there here some any all out off one two our its his her him she does did doing done tell explain give show please just like want need know make let lets also very much more most been being while after before again once only own same such too'.split(' '));

const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];

/** What a lecture is, as one block of text the model can read. */
function lectureText(l, { transcript = true, budget = 9000 } = {}) {
  const head = `# ${l.title || 'Lecture'}${l.class_name ? `, ${l.class_name}` : ''}${l.date ? ` (${l.date})` : ''}`;
  const notes = l.notes ? notesMarkdown(l.notes) : '';
  const mine = l.my_notes ? `Student's own notes:\n${l.my_notes}` : '';
  const said = transcript ? transcriptText(l.segments || []) : '';
  const parts = [head, notes, mine];
  let text = parts.filter(Boolean).join('\n\n');
  const room = budget - text.length;
  if (said && room > 800) text += `\n\nTranscript:\n${said.slice(0, room)}${said.length > room ? ' …' : ''}`;
  return text.slice(0, budget + 400);
}

/**
 * Lecture material relevant to this question. Lectures the student pinned
 * come first; otherwise the ones whose title, class or notes share words with
 * the question; "the last lecture" means the newest. Returns text, or ''.
 */
export function lectureContext(question, lectures, pinnedIds = [], budget = 14000) {
  const ready = (lectures || []).filter(l => l && (l.notes || (l.segments || []).some(s => s.text)));
  if (!ready.length) return '';
  const byNew = [...ready].sort((a, b) => String(b.started_at || b.date || '').localeCompare(String(a.started_at || a.date || '')));
  const chosen = [];
  for (const id of pinnedIds) { const l = ready.find(x => x.id === id); if (l) chosen.push(l); }

  if (chosen.length === 0) {
    const q = new Set(words(question).filter(w => !STOP.has(w)));
    if (/\b(last|latest|recent|today'?s?|yesterday'?s?|that) (lecture|class|lesson|recording|video)\b/i.test(question)) chosen.push(byNew[0]);
    const scored = ready.map(l => {
      const hay = new Set(words(`${l.title} ${l.class_name} ${l.notes ? notesMarkdown(l.notes) : ''} ${transcriptText(l.segments || [])}`));
      let hits = 0;
      for (const w of q) if (hay.has(w)) hits++;
      const titleWords = words(`${l.title} ${l.class_name}`);
      const named = titleWords.some(w => !STOP.has(w) && q.has(w)) ? 3 : 0;   // naming the lecture or class counts for more
      return { l, score: hits + named };
    }).filter(x => x.score >= 2).sort((a, b) => b.score - a.score);
    for (const { l } of scored.slice(0, 2)) if (!chosen.includes(l)) chosen.push(l);
  }
  if (!chosen.length) return '';
  const each = Math.floor(budget / chosen.length);
  return chosen.map(l => lectureText(l, { budget: each })).join('\n\n---\n\n');
}

/** The last few turns, as a script the model can continue. */
export function transcriptOf(messages, turns = 12) {
  return (messages || []).filter(m => m && m.text && (m.role === 'user' || m.role === 'assistant')).slice(-turns)
    .map(m => `${m.role === 'user' ? 'Student' : 'Lock In'}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 900)}`).join('\n');
}

/**
 * The instructions plus a snapshot of the student's world.
 * @param {object} s {now:Date, timer, prefs, homework, tests, classes, lectures, quiz, via, recording}
 */
export function buildSystem(s) {
  const t = s.timer || {};
  const mins = (sec) => Math.round(sec / 60);
  const timer = t.status === 'running'
    ? `RUNNING a ${t.phase} block, ${mins(t.remaining)} min left of ${mins(t.total)}${t.taskTitle ? `, on "${t.taskTitle}"` : ''}`
    : t.status === 'paused' ? `PAUSED ${t.phase} block, ${mins(t.remaining)} min left`
    : `not running (next: ${t.phase || 'focus'} block of ${mins(t.total || 0)} min)`;
  const p = s.prefs || {};
  const open = (s.homework || []).filter(h => !h.is_completed).slice(0, 18)
    .map(h => `- ${h.title}${h.class_name ? ` [${h.class_name}]` : ''}${h.due_date ? ` due ${h.due_date}` : ''}${(h.steps || []).length ? ` (${h.steps.filter(x => x.done).length}/${h.steps.length} steps)` : ''}`).join('\n');
  const tests = (s.tests || []).slice(0, 10).map(x => `- ${x.title}${x.class_name ? ` [${x.class_name}]` : ''} on ${x.date}`).join('\n');
  const lect = (s.lectures || []).slice(0, 12).map(l => `- ${l.title}${l.class_name ? ` [${l.class_name}]` : ''}${l.date ? ` ${l.date}` : ''}${l.notes ? ' (notes ready)' : l.segments?.length ? ' (transcript)' : ''}`).join('\n');
  const day = s.now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `You are Lock In, the voice-and-chat study assistant inside the LOCK IN! student app. You talk like a warm, sharp tutor, not a menu: understand what the student MEANS even if they phrase it badly, mishear-prone speech included ("log in" is "lock in", "tests" may be "tess"). Today is ${day}.

You do two things in every turn: answer in "reply", and DO what they asked by listing "actions". Never say you did something unless you listed the action that does it, and never list an action that wasn't asked for. If a request is unclear, ask one short question and list no actions.

Be a real study partner: help with homework by explaining, working through steps, checking their reasoning and giving worked examples; give hints first when they are practising, and the full answer when they ask for it. Hold a continuous conversation: use the recent conversation, so "why?" or "do another one" means what it meant a moment ago. When lecture notes, a transcript or an attached file is provided below or attached, answer detailed questions from it, quote or point to the part you used, and say plainly when the material doesn't cover something instead of guessing. You can't open links or watch videos from a URL: if they paste one, tell them to use the paperclip ("Add a video" for a file, or attach a PDF/photo) or paste the transcript.

${s.via === 'voice' ? 'This turn was SPOKEN, and the whole reply is read out. Keep "reply" short and direct (a few sentences, no tables), but complete: everything the student needs is in it. "spoken" is that same reply read aloud, word for word, with maths in words.' : 'This turn was TYPED. "spoken" can be left empty.'}

Actions (name and fields; use only these):
- startFocus {minutes, title?}, start a NEW focus block of that length right now ("start a focus session for 50 minutes"). This starts the timer; it does not change the default. title = homework to lock in on.
- startBreak {minutes?}   pause   resume   skip   reset   completeStep
- setFocusLength {minutes} / setBreakLength {minutes}, change the DEFAULT length of future blocks (only when asked to change the setting, not when asked to start).
- addTime {minutes}, add (positive) or remove (negative) minutes from the running block.
- sound {kind: rain|brown|drone|off|last}   volume {delta: -0.15 quieter … 0.15 louder}
- addHomework {title, date (YYYY-MM-DD), className?}   addTest {title, date (YYYY-MM-DD, required), className?}
- completeHomework {title}   deleteItem {title, kind: homework|test}
- recordLecture {className?}   stopRecording
- createQuiz {topic}   quizAnswer {answer: a|b|c|d}   stopQuiz
- openPage {path: today|classes|study|notes|settings}   openPlanner   openFocus   openCamera (to photograph homework)
- updateHomework {title, newTitle?, date?, priority? (low|medium|high|asap), className?}   updateTest {title, newTitle?, date?, className?}
- breakDown {title}, split a homework item into small steps
- addClass {title}   renameClass {title, newTitle}   deleteClass {title}
- Planner: addFreeTime {date, start, end} (24-hour HH:MM; "after school" ≈ 15:30)   removeFreeTime {date, start}   clearFreeTime {date?}   makePlan {notes?}   clearPlan
  When they tell you when they're free, add it AND, if they want a plan, also makePlan in the same turn.
- graph {expressions: ["y=x^2-4", "y=2x+1"]}, opens Desmos with these (Desmos LaTeX, one equation per item). Use it whenever a graph helps.
- openPractice {topic?, kind?: quiz|grading}   setGoal {minutes} (daily focus goal)   setDarkMode {on}   setAutoBreak {on}
- pauseRecording   resumeRecording
Write maths in LaTeX between $…$ (inline) or $$…$$ (display), chemistry with \\ce{…} inside $…$ (e.g. $\\ce{2H2 + O2 -> 2H2O}$), never bare LaTeX. In "spoken", say maths in words ("x squared over two"), no symbols.
Resolve dates yourself from today's date ("Friday", "next week", "the 12th") into YYYY-MM-DD. Match titles to the student's real items below.

${s.plan ? `Free time: ${s.plan.slots || 'none added'}. ${s.plan.today ? `Today's plan: ${s.plan.today}.` : 'No plan made yet.'}
` : ''}Timer: ${timer}. Defaults: focus ${p.focusMin || 25} min, break ${p.breakMin || 5} min. Sound: ${p.sound || 'off'}.${s.recording ? ' A lecture is being recorded right now.' : ''}${s.quiz ? ` A spoken quiz on "${s.quiz.topic}" is running (question ${s.quiz.index + 1} of ${s.quiz.total}).` : ''}
Classes: ${(s.classes || []).map(c => c.name).join(', ') || 'none yet'}. Daily focus goal: ${p.dailyGoal || 120} min. Dark mode: ${s.dark ? 'on' : 'off'}.
Open homework:
${open || '(none)'}
Tests:
${tests || '(none)'}
Lectures on file:
${lect || '(none)'}`;
}

/** The whole prompt for one turn, trimmed to fit what the server accepts. */
export function buildPrompt({ text, history, material, attachments = [], limit = 24000 }) {
  const parts = [];
  if (material) parts.push(`Relevant lecture material:\n${material}`);
  if (attachments.length) parts.push(`The student has attached: ${attachments.map(a => a.name).join(', ')}. Use them to answer.`);
  const script = transcriptOf(history);
  if (script) parts.push(`Conversation so far:\n${script}`);
  parts.push(`Student: ${String(text).slice(0, 4000)}\n\nReply as JSON.`);
  let out = parts.join('\n\n');
  if (out.length > limit && material) {   // the material is what can be shortened
    const over = out.length - limit;
    parts[0] = `Relevant lecture material:\n${material.slice(0, Math.max(1500, material.length - over))} …`;
    out = parts.join('\n\n');
  }
  return out.slice(-limit);
}
