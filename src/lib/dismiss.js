/**
 * "Stop", "that's all", "thanks": the ways of telling the assistant you are
 * done. Pure, so tests/dismiss.test.mjs runs it in Node.
 *
 * Without this, "stop" went to the AI like any other sentence (or was ignored
 * while the assistant was talking), and the mic stayed open for the next
 * ten seconds regardless.
 */

const WORDS = [
  'stop', 'stop it', 'stop talking', 'stop listening', 'stop now', 'stop please',
  'that is all', "that's all", 'that will be all', 'that is it', "that's it", 'that is enough', "that's enough", 'enough',
  'never mind', 'nevermind', 'forget it', 'cancel', 'cancel that',
  'be quiet', 'quiet', 'shush', 'hush', 'silence', 'go away', 'go to sleep', 'sleep',
  'thanks', 'thank you', 'thanks lock in', 'thank you lock in', 'thanks a lot', 'thank you very much',
  'bye', 'goodbye', 'good bye', 'see you', 'see you later', 'i am done', "i'm done", 'i am good', "i'm good", 'we are done', "we're done",
];
const SET = new Set(WORDS);

/** Is this utterance only a way of saying "I'm done"? A longer question that happens to contain "stop" is not. */
export function isDismissal(text) {
  const t = String(text || '').toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\b(?:ok|okay|alright|all right|please|hey lock in|lock in|lockin|now|just|yes|yeah|right)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const bare = t.replace(/\b(?:please|now)\b/g, '').replace(/\s+/g, ' ').trim();
  return SET.has(t) || SET.has(bare);
}

/** True when the assistant's reply is a question, so the person is expected to answer. */
export function expectsAnswer(reply) {
  const t = String(reply || '').trim();
  return /\?["”')\]]*$/.test(t);
}

/** The phrases worth adding to a streaming recogniser's grammar to catch a spoken "stop". */
export const STOP_PHRASES = ['stop', 'stop talking', 'stop listening', 'be quiet', 'that is all', 'never mind', 'thank you'];
