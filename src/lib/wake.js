/**
 * Finding "Hey Lock In" in what a speech recogniser wrote. Pure, so it is
 * tested in Node (tests/wake.test.mjs).
 *
 * The old pattern wanted exactly "hey lock in". Recognisers write what they
 * think they heard, and "lock in" is not a common phrase, so what arrives is
 * "hey locking", "hey lockin", "hey look in", "hay log in", "okay luck in"…
 * Missing those is why it only worked half the time. A greeting word is still
 * required, so ordinary talk about locks and logging in doesn't wake it.
 */

const NAME = '(?:lock\\s*-?\\s*in|lockin|locking|lock\\s*en|log\\s*in|login|logging|look\\s*in|looking|luck\\s*in|lucking|lock\\s*and|loc\\s*in|lockedin|locked\\s*in)';
// "a" is only a greeting when the name follows it directly and it starts the phrase
const WAKE = new RegExp(`(?:^|[\\s,.!?])(?:(?:hey|hay|hi|hello|ok|okay|okey|yo|oi)\\s*,?\\s*${NAME}|^\\s*a\\s+lock\\s*-?\\s*in)(?![a-z])|(?:^|[\\s,.!?])companion(?![a-z])`, 'i');

const GREETING = new Set(['hey', 'hay', 'hi', 'hello', 'ok', 'okay', 'okey', 'yo', 'oi', 'hej', 'hei', 'ay', 'eh']);

/** Edit distance, for the names no list can anticipate ("lochin", "lockinn", "lucken"). */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** A greeting followed by one or two words that sound like "lock in". */
function fuzzy(t) {
  const re = /[a-z']+/gi;
  const words = [];
  let m;
  while ((m = re.exec(t))) words.push({ w: m[0].toLowerCase().replace(/'/g, ''), i: m.index, end: m.index + m[0].length });
  for (let k = 0; k < words.length - 1; k++) {
    if (!GREETING.has(words[k].w)) continue;
    for (const n of [2, 1]) {
      const span = words.slice(k + 1, k + 1 + n);
      if (span.length < n) continue;
      const joined = span.map(x => x.w).join('');
      if (joined.length < 5 || joined.length > 8) continue;
      if (/^l/.test(joined) && distance(joined, 'lockin') <= 2) return { index: words[k].i, end: span[span.length - 1].end };
    }
  }
  return null;
}

/** { index, end } of the wake phrase in `text`, or null. */
export function findWake(text) {
  const t = String(text || '');
  const m = WAKE.exec(t);
  if (m) {
    const lead = /^[\s,.!?]/.test(m[0]) ? 1 : 0;
    return { index: m.index + lead, end: m.index + m[0].length };
  }
  return fuzzy(t);
}

/** The words after the wake phrase ('' if it was said alone), or null if it wasn't said. */
export function afterWake(text) {
  const t = String(text || '');
  const w = findWake(t);
  if (!w) return null;
  return t.slice(w.end).replace(/^[\s,.:;!?-]+/, '').trim();
}

// kept for callers that want the pattern itself
export const WAKE_RE = WAKE;
