import React, { useEffect, useState } from 'react';

/** Every word here was approved one by one. Add new ones only with the same say-so. */
export const THINKING_WORDS = [
  // classics
  'Pondering', 'Mustering', 'Cogitating', 'Ruminating', 'Percolating', 'Simmering', 'Marinating',
  'Conjuring', 'Wrangling', 'Spelunking', 'Synthesizing',
  // study life
  'Cramming', 'Highlighting the good bits', 'Sharpening pencils', 'Caffeinating',
  // pop culture
  'Consulting the Force', 'Going Super Saiyan', 'Rolling for intelligence', 'Channeling Sherlock',
  'Hacking the mainframe', 'Leveling up', 'Assembling', 'Warming up the flux capacitor',
  // silly
  'Asking the hamsters', 'Untangling thoughts', 'Brewing brain juice',
];

const shuffled = () => {
  const a = [...THINKING_WORDS];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * The waiting message: a fresh word every couple of seconds, never the same one twice in a row.
 * Screen readers hear a plain "Thinking" once, not every change.
 */
export default function ThinkingWord({ every = 2400 }) {
  const [order] = useState(shuffled);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % order.length), every);
    return () => clearInterval(t);
  }, [every, order.length]);
  return (
    <>
      <span className="sr-only">Thinking</span>
      <span aria-hidden="true">{order[i]}…</span>
    </>
  );
}
