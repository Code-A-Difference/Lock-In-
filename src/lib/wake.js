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

/** { index, end } of the wake phrase in `text`, or null. */
export function findWake(text) {
  const t = String(text || '');
  const m = WAKE.exec(t);
  if (!m) return null;
  const lead = /^[\s,.!?]/.test(m[0]) ? 1 : 0;
  return { index: m.index + lead, end: m.index + m[0].length };
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
