/**
 * Badges: small rewards for keeping at it. Pure, so tests/badges.test.mjs
 * runs it in Node.
 *
 * Most badges are milestones worked out from the student's own data (their
 * 1st, 10th, 50th and 100th lecture, a 7-day focus streak, ...). A few are
 * "firsts": the first student on LOCK IN! to do something. Those are claimed
 * on the server (action "firsts" in /api/lockin.php), which decides who got
 * there first; this file only says which ones a student qualifies to claim.
 */

/** Ladders: one badge per step. `icon` is a lucide icon name. */
export const LADDERS = [
  { key: 'lectures', icon: 'Mic', unit: 'lecture', steps: [
    [1, 'First lecture', 'Recorded your first lecture'],
    [10, 'Regular', 'Recorded 10 lectures'],
    [50, 'Note machine', 'Recorded 50 lectures'],
    [100, 'Centurion', 'Recorded 100 lectures'],
  ] },
  { key: 'streak', icon: 'Flame', unit: 'day streak', steps: [
    [3, 'Warming up', 'Focused 3 days in a row'],
    [7, 'One week', 'Focused 7 days in a row'],
    [30, 'Unstoppable', 'Focused 30 days in a row'],
  ] },
  { key: 'hours', icon: 'Timer', unit: 'hour focused', steps: [
    [10, '10 hours', 'Focused for 10 hours in all'],
    [50, '50 hours', 'Focused for 50 hours in all'],
    [100, '100 hours', 'Focused for 100 hours in all'],
  ] },
  { key: 'homework', icon: 'CheckCircle2', unit: 'homework done', steps: [
    [10, 'On it', 'Finished 10 pieces of homework'],
    [50, 'Never late', 'Finished 50 pieces of homework'],
  ] },
  { key: 'quizzes', icon: 'Target', unit: 'quiz', steps: [
    [1, 'Tested', 'Took your first quiz'],
    [25, 'Quiz whiz', 'Took 25 quizzes'],
  ] },
  { key: 'decks', icon: 'Layers', unit: 'flashcard deck', steps: [
    [1, 'Card shark', 'Made your first flashcard deck'],
  ] },
  { key: 'slides', icon: 'Presentation', unit: 'lecture with slides', steps: [
    [1, 'Slide in', 'Added slides to a lecture'],
  ] },
];

/** Firsts: the first student anywhere to reach `needs`. Keys must match FIRSTS in api/lockin.php. */
export const FIRSTS = [
  { key: 'first-100-lectures', icon: 'Crown', title: 'First to 100', desc: 'The first student on LOCK IN! to record 100 lectures', needs: ['lectures', 100] },
  { key: 'first-30-streak', icon: 'Crown', title: 'First to 30 days', desc: 'The first student to focus 30 days in a row', needs: ['streak', 30] },
  { key: 'first-deck', icon: 'Crown', title: 'First deck', desc: 'The first student to make a flashcard deck', needs: ['decks', 1] },
  { key: 'first-slides', icon: 'Crown', title: 'First slides', desc: 'The first student to add lecture slides', needs: ['slides', 1] },
];

/** The founding badge: one of the first 100 accounts. The server says who. */
export const FOUNDER = { key: 'founder', icon: 'Sparkles', title: 'Founding student', desc: 'One of the first 100 students on LOCK IN!' };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The longest run of consecutive days with focus time, ever (a badge, once earned, stays). */
export function bestStreak(sessions = []) {
  const days = [...new Set(sessions.filter(s => s?.day && Number(s.minutes) > 0).map(s => s.day))].sort();
  let best = 0, run = 0, prev = null;
  for (const day of days) {
    const d = new Date(`${day}T12:00:00`);
    if (prev) {
      const next = new Date(prev); next.setDate(next.getDate() + 1);
      run = ymd(next) === day ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** The counts every ladder is measured on. */
export function tallies({ lectures = [], sessions = [], homework = [], history = [] } = {}) {
  const recorded = lectures.filter(l => l && l.source !== 'material');
  return {
    lectures: recorded.length,
    streak: bestStreak(sessions),
    hours: Math.floor(sessions.reduce((a, s) => a + (Number(s?.minutes) || 0), 0) / 60),
    homework: homework.filter(h => h?.is_completed).length,
    quizzes: history.filter(h => h && /quiz/i.test(String(h.type || ''))).length,
    decks: history.filter(h => h?.type === 'flashcards').length,
    slides: lectures.filter(l => Array.isArray(l?.slides) && l.slides.length).length,
  };
}

/**
 * Every badge, earned or not, with progress toward the next one.
 * `firsts` is the server's answer: { [key]: true } for the ones this student holds.
 */
export function badges(data, firsts = {}) {
  const t = tallies(data);
  const out = [];
  for (const l of LADDERS) {
    for (const [n, title, desc] of l.steps) {
      out.push({ id: `${l.key}-${n}`, icon: l.icon, title, desc, earned: t[l.key] >= n, have: Math.min(t[l.key], n), need: n });
    }
  }
  if (firsts[FOUNDER.key]) out.push({ id: FOUNDER.key, icon: FOUNDER.icon, title: FOUNDER.title, desc: FOUNDER.desc, earned: true, first: true, have: 1, need: 1 });
  for (const f of FIRSTS) {
    if (firsts[f.key]) out.push({ id: f.key, icon: f.icon, title: f.title, desc: f.desc, earned: true, first: true, have: 1, need: 1 });
  }
  return out;
}

/** Firsts this student has reached and could claim (the server decides if they were first). */
export function claimable(data) {
  const t = tallies(data);
  return FIRSTS.filter(f => t[f.needs[0]] >= f.needs[1]).map(f => f.key);
}

/** The unearned ladder badge closest to done, for a "next up" line. */
export function nextUp(list) {
  return list.filter(b => !b.earned && !b.first)
    .sort((a, b) => (b.have / b.need) - (a.have / a.need) || a.need - b.need)[0] || null;
}
