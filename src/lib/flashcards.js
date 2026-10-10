/**
 * Flashcards: making a deck from a student's own material, and the order
 * cards come up in while studying. Pure, so tests/flashcards.test.mjs runs
 * it in Node.
 *
 * A deck comes from the notes' key terms instantly (no AI needed), or from
 * the AI reading the class's material, which is told to use that material
 * only. Studying is a simple loop: a card marked "Again" comes back a few
 * cards later; "Got it" retires it for this round.
 */

export const CARDS_SCHEMA = {
  type: 'object',
  properties: {
    cards: { type: 'array', items: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' } } } },
  },
};

export function cardsPrompt(material, { count = 20, outside = false } = {}) {
  return `Make ${count} flashcards from this class material for a student to study with.
- Each card has a "front" (a term, or a short question) and a "back" (the answer in one or two sentences).
- Cover the important ideas, definitions, formulas and facts, one idea per card, no repeats.
- ${outside ? 'Base the cards on the material; you may add a little background to make a card clear.' : 'Use ONLY what is in the material. Do not add facts from your own knowledge.'}
- Write maths in LaTeX between $ signs. Plain language, no em dashes.

Material:
${material}`;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Cards from the AI, tidied: both sides filled, no duplicate fronts, at most `max`. */
export function normaliseCards(raw, max = 60) {
  const list = Array.isArray(raw?.cards) ? raw.cards : Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const front = clean(c?.front), back = clean(c?.back);
    if (!front || !back) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
    if (out.length >= max) break;
  }
  return out;
}

/** An instant deck from notes already written: each key term becomes a card. */
export function cardsFromNotes(lectures = []) {
  const out = [];
  for (const l of lectures) {
    for (const k of l?.notes?.key_terms || []) {
      if (k?.term && k?.definition) out.push({ front: clean(k.term), back: clean(k.definition) });
    }
  }
  return normaliseCards({ cards: out }, 200);
}

/**
 * The study loop. `state` is { queue: [index...], known: Set-like array, again: count map }.
 * start(n) -> a fresh state over n cards (shuffled with `rand` for tests).
 */
export function startRound(n, rand = Math.random) {
  const queue = Array.from({ length: n }, (_, i) => i);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  return { queue, known: [], missed: [] };
}

/** "Got it": the current card leaves the round. */
export function gotIt(state) {
  const [cur, ...rest] = state.queue;
  return { ...state, queue: rest, known: state.known.includes(cur) ? state.known : [...state.known, cur] };
}

/** "Again": the current card comes back after `gap` more cards (or at the end). */
export function again(state, gap = 3) {
  const [cur, ...rest] = state.queue;
  const at = Math.min(gap, rest.length);
  return { ...state, queue: [...rest.slice(0, at), cur, ...rest.slice(at)], missed: state.missed.includes(cur) ? state.missed : [...state.missed, cur] };
}
