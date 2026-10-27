import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairDollars, normaliseMath, latexToSpeech, chemToSpeech, speakMath } from '../src/lib/mathText.js';
import katex from 'katex';
import { speakable } from '../src/lib/speakable.js';

test('every way models write maths ends up as $…$ for KaTeX', () => {
  assert.equal(normaliseMath('so \\(x^2\\) is'), 'so $x^2$ is');
  assert.match(normaliseMath('\\[\\frac{a}{b}\\]'), /\$\$\\frac\{a\}\{b\}\$\$/);
  assert.equal(normaliseMath('water is \\ce{H2O}.'), 'water is $\\ce{H2O}$.');
  assert.equal(normaliseMath('already $\\ce{H2O}$ fine'), 'already $\\ce{H2O}$ fine');
  assert.equal(normaliseMath('take \\frac{1}{2} of it'), 'take $\\frac{1}{2}$ of it');
  assert.equal(normaliseMath('plain text'), 'plain text');
});

test('maths read aloud', () => {
  assert.equal(latexToSpeech('\\frac{1}{2}'), '1 over 2');
  assert.equal(latexToSpeech('x^2 + 3x - 4 = 0'), 'x squared plus 3x minus 4 equals 0');
  assert.equal(latexToSpeech('\\sqrt{x+1}'), 'the square root of x plus 1');
  assert.equal(latexToSpeech('e^{i\\pi}'), 'e to the power of i pi');
  assert.equal(latexToSpeech('a \\le b'), 'a is less than or equal to b');
  assert.equal(latexToSpeech('v_0'), 'v sub 0');
  assert.equal(latexToSpeech('\\sin\\theta'), 'sine theta');
});

test('chemistry read aloud', () => {
  assert.equal(chemToSpeech('2H2 + O2 -> 2H2O'), '2 H 2 plus O 2 yields 2 H 2 O');
  assert.match(chemToSpeech('Na+ (aq)'), /aqueous/);
  assert.match(latexToSpeech('\\ce{N2 + 3H2 <=> 2NH3}'), /equilibrium/);
});

test('no dollar signs or backslashes reach the voice', () => {
  const s = speakable('The answer is $\\frac{3}{4}$, and \\(x^2\\) grows. Also 5 √ 9 ≈ 3.');
  assert.doesNotMatch(s, /[$\\{}]/);
  assert.match(s, /3 over 4/);
  assert.match(s, /x squared/);
  assert.match(s, /square root/);
  assert.equal(speakMath('none here'), 'none here');
});

/** The maths in a reply: $$…$$ and $…$, not counting escaped dollars. */
function formulas(s) {
  return [...s.matchAll(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\$([^$\n]+)(?<!\\)\$/g)].map((m) => m[1] ?? m[2]);
}

test('stray dollar signs are paired, so maths renders and prose stays prose', () => {
  assert.equal(repairDollars('The energy is $$E_1 = $\\frac{2}{3}$ \\approx 1$$ here.'),
    'The energy is $$E_1 = \\frac{2}{3} \\approx 1$$ here.');
  assert.equal(repairDollars('Then $$x = 1$$$ and more.'), 'Then $$x = 1$$ and more.');
  assert.equal(repairDollars('where n is the quantum number, and L$ is the length.'),
    'where n is the quantum number, and L\\$ is the length.');
  assert.equal(repairDollars('It costs $5 today.'), 'It costs \\$5 today.');
});

test('valid maths, code and escaped dollars are left alone', () => {
  for (const s of [
    'The force is $F = ma$, and $$E = mc^2$$ too.',
    'Use `$HOME` and costs \\$5 and $x$.',
    'Work:\n$$\nE = \\frac{a}{b}\n$$\nDone $x$',
    '```\necho $HOME $\n```',
  ]) assert.equal(repairDollars(s), s);
});

test('a formula from a broken reply still parses in KaTeX', () => {
  const step2 = 'Substitute: $$E_1 = $\\frac{(1)^2 (6.626 \\times 10^{-34},\\text{J}\\cdot\\text{s})^2}{8 (9.11 \\times 10^{-31},\\text{kg}) (1 \\times 10^{-9},\\text{m})^2}$$$';
  const step3 = 'Calculate: $$E_1 = $\\frac{4.39\\times 10^{-67}}{7.288\\times 10^{-48}}$ \\approx 6.02 \\times 10^{-20}\\,\\text{Joules}$$';
  for (const line of [step2, step3]) {
    const maths = formulas(normaliseMath(line));
    assert.ok(maths.length > 0);
    for (const f of maths) katex.renderToString(f, { throwOnError: true });   // throws on anything KaTeX can't draw
  }
});

test('a formula that never closes is shown as text, and the prose after it is not maths', () => {
  const out = normaliseMath('are: $$E_n = \\frac{n^2 h^2}{8mL^2}$ where n is the quantum number (1, 2, 3, \\dots), h is Planck\'s constant, and L$ is the length of the box.');
  assert.deepEqual(formulas(out), ['\\frac{n^2 h^2}{8mL^2}']);
  assert.match(out, /where n is the quantum number \(1, 2, 3, \\dots\), h is Planck's constant, and L is the length of the box\./);
});

test('dollar signs that do not pair are spoken as dollars', () => {
  assert.equal(speakMath('It costs $5.'), 'It costs $5.');
});
