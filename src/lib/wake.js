/**
 * Finding "Hey Companion" in what a speech recogniser wrote. Pure, so it is
 * tested in Node (tests/wake.test.mjs).
 *
 * It used to be "Hey Lock In". "Lock in" is a phrase students say all the time
 * ("ok, lock in"), and the recognisers turned "looking", "log in" and "locking"
 * into it too, so it woke when nobody had asked. "Companion" is rarely said by
 * accident and hard to mishear as anything else. A greeting is still required,
 * so talking about a companion doesn't wake it, and on devices that support it
 * the voice has to match the one trained in Settings (voiceprint.js).
 */

export const WAKE_PHRASE = 'Hey Companion';

const NAME = '(?:companions?|compan(?:y|i)on|campanion|compagnon|kompanion|company\\s+on|come\\s*panion)';
const WAKE = new RegExp(`(?:^|[\\s,.!?])(?:hey|hay|hi|hello|ok|okay|okey)\\s*,?\\s*${NAME}(?![a-z])`, 'i');

const GREETING = new Set(['hey', 'hay', 'hi', 'hello', 'ok', 'okay', 'okey', 'hei', 'ay']);

/** Edit distance, for the names no list can anticipate ("companyan", "compainion"). */
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

/** A greeting followed by one or two words that sound like "companion". */
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
      if (joined.length < 7 || joined.length > 11) continue;
      if (/^[ck]/.test(joined) && distance(joined, 'companion') <= 2) return { index: words[k].i, end: span[span.length - 1].end };
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

/**
 * The request with the wake phrase taken off the front, however it was written down.
 * By the time something is sent, the wake-up has already happened, so a loose read is
 * safe here: "Hey, Compagnion." or "Companions, what's due?" lose their first words,
 * and "Hey Companion" on its own becomes '' (nothing to send yet). Without a greeting,
 * only a word very close to the name is removed, so "Company of Heroes" survives.
 */
export function stripWake(text) {
  const t = String(text || '').trim();
  const exact = afterWake(t);
  if (exact !== null) return exact;
  const m = /^(?:(hey|hi|hello|ok|okay|okey|hay|hei|ay|a)[\s,.!]+)?([a-z']+)(?:[\s,.!?:;-]+|$)/i.exec(t);
  if (m) {
    const w = m[2].toLowerCase().replace(/'/g, '');
    const near = w.length >= 6 && /^[ck]/.test(w) && distance(w, 'companion') <= (m[1] ? 3 : 2);
    if (near) return t.slice(m[0].length).trim();
  }
  // a greeting alone ("Hey.") is what's left when the name was lost in the noise
  return /^(?:hey|hi|hello|ok|okay)[\s,.!?]*$/i.test(t) ? '' : t;
}
