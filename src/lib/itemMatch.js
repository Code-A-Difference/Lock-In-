/**
 * Finding "the item they mean" from a spoken title. Pure, so
 * tests/itemMatch.test.mjs runs it in Node.
 *
 * Two things the first version got wrong:
 *  - Two items with exactly the same title ("Make a .tech domain" entered
 *    twice) were reported as "a few match, which one?", a question with no
 *    possible answer. They are the same thing: take the first, and say a
 *    duplicate existed.
 *  - The ambiguous question listed the same title again and again. It now says
 *    what tells them apart (the day, the class).
 */

const norm = (s) => String(s || '').toLowerCase().trim();

/** { matches, duplicates }: the items whose title fits `spoken`, identical titles collapsed to one. */
export function findByTitle(list, spoken, titleOf = (x) => x.title) {
  const q = norm(spoken);
  if (!q) return { matches: [], duplicates: 0 };
  const t = (x) => norm(titleOf(x));
  let matches = list.filter(x => t(x) === q);
  if (!matches.length) matches = list.filter(x => t(x).startsWith(q) || q.startsWith(t(x)));
  if (!matches.length) matches = list.filter(x => t(x) && (t(x).includes(q) || q.includes(t(x))));
  if (matches.length > 1 && matches.every(x => t(x) === t(matches[0]))) {
    return { matches: [matches[0]], duplicates: matches.length - 1 };
  }
  return { matches, duplicates: 0 };
}

/** "Chem lab (due Fri), Chem lab report (due Mon)": enough to tell items with similar titles apart. */
export function describeChoices(items, titleOf = (x) => x.title, max = 3) {
  return items.slice(0, max).map((x) => {
    const when = x.due_date || x.date || '';
    const extra = [x.class_name, when && `due ${when}`].filter(Boolean).join(', ');
    return extra ? `${titleOf(x)} (${extra})` : titleOf(x);
  }).join('; ');
}

/** The problems a run reported, each said once, however many actions hit the same one. */
export function uniqueNotes(notes) {
  return [...new Set(notes.map(n => String(n).trim()).filter(Boolean))];
}
