/**
 * What a spoken command means. Pure — no audio, no React — so it is tested
 * in Node (tests/voice.test.mjs).
 *
 * Ambient Voice Study understood a fixed set of phrases ("focus block",
 * "break time", "stop music"...). This takes what people actually say:
 * "give me twenty five minutes", "an hour and a half of focus", "put the rain
 * on", "what's next", "I'm done with that step". Speech recognition often
 * writes "lock in" as "log in", so both mean the same thing.
 */

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function norm(s) {
  return ` ${String(s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\blog in\b/g, 'lock in')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Spoken or written minutes in a phrase, or null. */
export function minutesIn(text) {
  const t = norm(text);
  if (/\b(an|one) hour and a half\b|\bhour and a half\b|\b(one and a half|1\.5) hours?\b/.test(t)) return 90;
  if (/\bhalf (an )?hour\b/.test(t)) return 30;
  if (/\b(a )?quarter (of an )?hour\b/.test(t)) return 15;
  let m = /\b(\d+(?:\.\d+)?) ?(hours?|hrs?)\b/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  if (/\b(an|one) hour\b/.test(t)) return 60;
  m = /\b(\d{1,3})\b/.exec(t);
  if (m) return Number(m[1]);
  // "twenty five", "forty", "fifteen"
  m = new RegExp(`\\b(${Object.keys(TENS).join('|')})(?: (${Object.keys(UNITS).join('|')}))?\\b`).exec(t);
  if (m) return TENS[m[1]] + (m[2] ? UNITS[m[2]] : 0);
  m = new RegExp(`\\b(${Object.keys(UNITS).join('|')})\\b`).exec(t);
  if (m && UNITS[m[1]] > 0) return UNITS[m[1]];
  return null;
}

const SOUNDS = [
  ['rain', /\b(rain|rainy|storm)\b/],
  ['brown', /\bbrown( noise)?\b/],
  ['drone', /\b(drone|ambient|hum|pad|space)\b/],
];

/**
 * @returns {{action: string, minutes?: number, kind?: string, delta?: number}}
 * actions: start, pause, skip, reset, startBreak, setFocus, setBreak, adjust,
 * timeLeft, sound, volume, completeStep, readStep, help, unknown, none
 */
export function parseCommand(raw) {
  const t = norm(raw);
  if (!t.trim()) return { action: 'none' };
  const mins = minutesIn(t);

  // A spoken quiz is an interactive voice flow; recognize its answer shapes
  // before the general assistant fallback gets a chance to treat them as a
  // new question.
  if (/^(?:(?:the|my) answer is |i choose |option )?(?:a|b|c|d|1|2|3|4|first|second|third|fourth)[.! ]*$/.test(t.trim())) {
    const answer = t.trim().match(/(?:option )?(a|b|c|d|1|2|3|4|first|second|third|fourth)[.! ]*$/);
    const index = answer ? ({ a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3, first: 0, second: 1, third: 2, fourth: 3 })[answer[1]] : null;
    if (index != null) return { action: 'quizAnswer', answer: index };
  }
  if (/\b(stop|cancel|end|quit) (the )?(quiz|quizzing)\b/.test(t)) return { action: 'stopQuiz' };

  const quizMatch = /\b(?:quiz me on|quiz me about|test me on|make (?:me )?(?:a )?quiz (?:on|about|for)|create (?:me )?(?:a )?quiz (?:on|about|for)|generate (?:me )?(?:a )?quiz (?:on|about|for)|quiz on)\s+(.+)$/.exec(t);
  if (quizMatch) return { action: 'createQuiz', topic: quizMatch[1].replace(/[.!?]+$/, '').trim() };

  // Add homework/tests with ordinary spoken wording. Date phrases are kept
  // separate so the data layer can understand "tomorrow" and weekdays.
  const wantsTask = /\b(add|create|schedule|put|remember|i have|there is|there's)\b/.test(t);
  const entity = /\b(homework|assignment|test|exam)\b/.exec(t);
  if (wantsTask && entity) {
    const kind = /^(test|exam)$/.test(entity[1]) ? 'test' : 'homework';
    const dateRe = /\b(?:due\s+|by\s+|on\s+|for\s+)?(today|tomorrow|(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})\b/i;
    const after = t.slice(entity.index + entity[0].length).replace(/^\s*(?:assignment|exam)\b/, '').trim();
    const dateInTitle = dateRe.exec(after);
    const date = dateInTitle || dateRe.exec(t);
    const datePhrase = date ? date[1].trim() : '';
    let title = dateInTitle ? after.slice(0, dateInTitle.index).trim() : after;
    title = title.replace(/^[:\s]+/, '').replace(/^\s*(?:for|in|called|named|about|to do|is|on)\s+/, '').replace(/[.!?,]+$/, '').trim();
    if (!title) {
      title = t.slice(0, entity.index).replace(/\b(add|create|schedule|put|remember|i have|there is|there's|a|an|the|my)\b/g, '').trim();
    }
    return { action: kind === 'test' ? 'addTest' : 'addHomework', title, datePhrase, source: t };
  }

  // What's on the agenda, read aloud.
  if (/\b(what'?s (due|on my (plate|list)|coming up|next up)|what (do|did) i have|read (me )?my agenda|anything due)\b/.test(t)) {
    return { action: 'agenda' };
  }

  // Mark a specific homework item done — different from completeStep, which
  // ticks off the next checklist item of whatever's currently locked in.
  {
    // norm() strips apostrophes, so "I'm" arrives as "im". "I'm done with
    // that step" / "check it off" means the current task's next checklist
    // item (completeStep, below) — only a named item is completeItem.
    const markDone = /\b(?:check off|tick off)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete|finished))?\s*$/.exec(t)
      || /\bmark\s+(?:my\s+|the\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|finished)\b/.exec(t)
      || /\bi(?:m| am)?\s+(?:done|finished)\s+with\s+(?:my\s+|the\s+)?(.+?)\s*$/.exec(t);
    if (markDone) {
      const title = markDone[1].replace(/\s+(homework|assignment)$/, '').replace(/[.!?]+$/, '').trim();
      if (title && !/^(?:it|that|this)(?:\s+(?:step|one|task))?$/.test(title)) return { action: 'completeItem', title };
    }
  }

  // Delete a homework item or a test by name.
  {
    const del = /\b(?:delete|remove|cancel|get rid of)\s+(?:my\s+|the\s+)?(.+?)\s*(homework|assignment|test|exam)?\s*$/.exec(t);
    if (del && del[1] && del[1].trim() && !/^(the|it|that|this)$/.test(del[1].trim())) {
      const kind = /^(test|exam)$/.test(del[2] || '') ? 'test' : /^(homework|assignment)$/.test(del[2] || '') ? 'homework' : '';
      return { action: 'deleteItem', title: del[1].trim(), kind };
    }
  }

  // Navigation and home-page tools are handled by the persistent assistant
  // component, while timer/data actions remain in FocusContext.
  if (/\b(open|show|go to|take me to) (the )?(focus|timer)\b/.test(t)) return { action: 'openFocus' };
  if (/\b(plan my week|make (me )?a study plan|open (the )?(study )?planner|show (the )?(study )?planner)\b/.test(t)) return { action: 'openPlanner' };
  if (/\b(go|take me|open) (to )?(home|today)\b/.test(t)) return { action: 'navigate', path: '/' };
  if (/\b(go|take me|open) (to )?(classes|my classes)\b/.test(t)) return { action: 'navigate', path: '/Classes' };
  if (/\b(go|take me|open) (to )?(settings|my settings)\b/.test(t)) return { action: 'navigate', path: '/Settings' };
  if (/\b(go|take me|open) (to )?(practice|quizzes|quiz page)\b/.test(t)) return { action: 'navigate', path: '/Study' };

  // ---- sound, before plain "stop" so "stop the music" isn't "stop the timer"
  if (/\b(stop|silence|mute|kill|pause|no|turn off|switch off|cut)( the)? (music|sound|sounds|noise|ambient|rain|audio)\b|\b(music|sound|noise|audio) off\b|\bmute\b/.test(t)) {
    return { action: 'sound', kind: 'off' };
  }
  for (const [kind, re] of SOUNDS) if (re.test(t)) return { action: 'sound', kind };
  if (/\b(play|start|turn on|put on|switch on)( some| the| my)? (music|sound|sounds|noise|audio)\b|\b(music|sound) on\b/.test(t)) {
    return { action: 'sound', kind: 'last' };
  }
  if (/\b(louder|volume up|turn it up|turn up|raise the volume|more volume)\b/.test(t)) return { action: 'volume', delta: 0.15 };
  if (/\b(quieter|softer|volume down|turn it down|turn down|lower the volume|less volume)\b/.test(t)) return { action: 'volume', delta: -0.15 };

  // ---- questions
  if (/\b(how (much|long)|time left|time remaining|how many minutes|when (is|does) (the )?(break|focus))\b/.test(t)) return { action: 'timeLeft' };
  if (/\b(what can i say|what do i say|commands|help me with (the )?voice|voice help)\b/.test(t)) return { action: 'help' };

  // ---- steps
  if (/\b(next step|whats next|what is next|what should i do( next| now)?|read (me )?(the |my )?(next )?step|what am i (doing|on))\b/.test(t)) {
    return { action: 'readStep' };
  }
  if (/\b(done|finished|complete|completed|check (it|that|this) off|tick (it|that|this) off)( (with )?(the|that|this) step)?\b|\bstep (is )?(done|finished|complete)\b/.test(t)) {
    return { action: 'completeStep' };
  }

  // ---- lengths
  if (mins != null) {
    if (/\b(add|give me|another|plus|extend|more|extra)\b/.test(t) && !/\b(focus|break) (for|to)\b/.test(t)) {
      return { action: 'adjust', minutes: mins };
    }
    if (/\b(remove|subtract|minus|take off|cut|reduce|less|shorter)\b/.test(t)) return { action: 'adjust', minutes: -mins };
    if (/\b(break|rest)\b/.test(t)) return { action: 'setBreak', minutes: mins };
    if (/\b(focus|work|study|studying|timer|session|block|lock in|pomodoro)\b/.test(t) || /^\s*(\d+|\w+( \w+)?) (minutes?|mins?)\s*$/.test(t)) {
      return { action: 'setFocus', minutes: mins };
    }
  }

  // ---- control
  if (/\b(take a break|break now|start (a |my |the )?break|time for a break|i need a break)\b/.test(t)) return { action: 'startBreak' };
  if (/\b(reset|restart|start over|start again)\b/.test(t)) return { action: 'reset' };
  if (/\b(skip|next phase|advance|move on|fast forward)\b/.test(t)) return { action: 'skip' };
  if (/\b(pause|hold on|hold up|wait|stop|freeze|halt)\b/.test(t)) return { action: 'pause' };
  if (/\b(start|begin|resume|go|continue|unpause|lock in|lets go|lets do (this|it)|focus)\b/.test(t)) return { action: 'start' };

  return { action: 'unknown' };
}

/** Wake phrases for hands-free mode. "companion" is Ambient Voice Study's. */
export const WAKE_RE = /\b(hey|ok|okay) (lock|log) in\b|\bcompanion\b/;

/** Split a transcript at the wake phrase; returns the command after it, or null. */
export function afterWake(transcript) {
  const t = String(transcript || '').toLowerCase();
  const m = WAKE_RE.exec(t);
  if (!m) return null;
  return t.slice(m.index + m[0].length).trim();
}

export const VOICE_HELP = [
  ['"Add homework: read chapter 4 due Friday"', 'save an assignment to your agenda'],
  ['"Add a biology test on October 12"', 'schedule a test'],
  ['"What\'s due?" / "What do I have this week?"', 'hear your agenda'],
  ['"Mark the biology homework done"', 'check off an assignment'],
  ['"Delete the chemistry test"', 'remove something from your agenda'],
  ['"Quiz me on photosynthesis"', 'create and take a spoken quiz'],
  ['"What is mitosis?"', 'ask Lock In a study question'],
  ['"Start" / "Pause" / "Skip" / "Reset"', 'control the timer'],
  ['"Focus for 45 minutes"', 'set the focus length'],
  ['"Break for 10"', 'set the break length'],
  ['"Five more minutes"', 'add time to this block'],
  ['"How much time is left?"', 'hear the time remaining'],
  ['"What\'s next?" / "Done"', 'hear or tick off your next step'],
  ['"Play rain" / "Stop the music"', 'change the background sound'],
  ['"Plan my week" / "Open focus" / "Go to classes"', 'move around the app'],
];
