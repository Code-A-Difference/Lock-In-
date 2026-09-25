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
  ['"Start" / "Pause" / "Skip" / "Reset"', 'control the timer'],
  ['"Focus for 45 minutes"', 'set the focus length'],
  ['"Break for 10"', 'set the break length'],
  ['"Five more minutes"', 'add time to this block'],
  ['"How much time is left?"', 'hear the time remaining'],
  ['"What\'s next?" / "Done"', 'hear or tick off your next step'],
  ['"Play rain" / "Stop the music"', 'change the background sound'],
];
