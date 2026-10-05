import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMath, latexToSpeech, chemToSpeech, speakMath } from '../src/lib/mathText.js';
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
