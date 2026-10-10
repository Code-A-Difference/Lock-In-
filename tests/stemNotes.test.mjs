import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeLatexInJson } from '../src/lib/mathText.js';
import { normaliseGraph, normaliseNotes, notesMarkdown, notesPrompt, STEM_RULES } from '../src/lib/lectureNotes.js';

const parse = (raw) => JSON.parse(escapeLatexInJson(raw));

test('single-backslash LaTeX in JSON survives parsing', () => {
  // \f \t \b \n \r would otherwise become control characters; \s \c \i make JSON.parse throw
  const raw = String.raw`{"p":"$\frac{1}{2} \times \theta + \beta \neq \rho \sqrt{x} \ce{H2O} \int_0^1 \text{m/s}$"}`;
  assert.equal(parse(raw).p, String.raw`$\frac{1}{2} \times \theta + \beta \neq \rho \sqrt{x} \ce{H2O} \int_0^1 \text{m/s}$`);
});

test('spacing and symbol escapes (\\, \\; \\{) and unknown commands parse too', () => {
  const raw = String.raw`{"p":"$9.8\,\text{m/s}^2$ and $a\;b \{x\} \qty{3}{m} 50\%$ é"}`;
  assert.equal(parse(raw).p, String.raw`$9.8\,\text{m/s}^2$ and $a\;b \{x\} \qty{3}{m} 50\%$ ` + 'é');
});

test('a real model reply (single backslashes everywhere) parses to clean LaTeX', () => {
  const raw = String.raw`{"points":["For $f(x) = x^2 - 4$, $f'(x) = 2x$.","$\frac{d}{dx}(x^n) = nx^{n-1}$","$v = gt$, $g = 9.8\,\text{m/s}^2$","$\ce{2H2 + O2 -> 2H2O}$","$\int_0^2 x^2\,dx = \frac{8}{3}$"]}`;
  const v = parse(raw);
  assert.equal(v.points[1], String.raw`$\frac{d}{dx}(x^n) = nx^{n-1}$`);
  assert.equal(v.points[2], String.raw`$v = gt$, $g = 9.8\,\text{m/s}^2$`);
  assert.equal(v.points[4], String.raw`$\int_0^2 x^2\,dx = \frac{8}{3}$`);
  assert.doesNotMatch(JSON.stringify(v), /\\[fbt](?![a-z])/);
});

test('correctly escaped JSON and real escapes are untouched', () => {
  const ok = String.raw`{"p":"$\\frac{a}{b}$","q":"line one\nThe next line","r":"say \"hi\"\tok"}`;
  const v = parse(ok);
  assert.equal(v.p, String.raw`$\frac{a}{b}$`);
  assert.equal(v.q, 'line one\nThe next line');
  assert.equal(v.r, 'say "hi"\tok');
});

test('graphs are checked: expressions trimmed and capped, bad windows dropped', () => {
  assert.equal(normaliseGraph(null), null);
  assert.equal(normaliseGraph({ expressions: [] }), null);
  const g = normaliseGraph({ title: 'Parabola', expressions: ['$y=x^2-4$', '', 'y=0', 'a', 'b', 'c', 'd', 'e'], xmin: -5, xmax: 5, ymin: 3, ymax: 1 });
  assert.deepEqual(g.expressions, ['y=x^2-4', 'y=0', 'a', 'b', 'c', 'd']);
  assert.equal(g.xmin, -5);
  assert.equal(g.xmax, 5);
  assert.ok(!('ymin' in g));
  assert.equal(normaliseGraph({ expressions: ['y=x'], xmin: '-2', xmax: '2' }).xmin, -2);
});

test('notes keep a section graph and it reaches the Markdown', () => {
  const n = normaliseNotes({ sections: [{ heading: 'Quadratics', points: ['Vertex at $(0,-4)$'], graph: { title: 'y = x² − 4', expressions: ['y=x^2-4'], caption: 'roots at ±2' } }, { heading: 'No graph', points: ['x'] }] });
  assert.equal(n.sections[0].graph.expressions[0], 'y=x^2-4');
  assert.ok(!('graph' in n.sections[1]));
  assert.match(notesMarkdown(n), /- Graph \(y = x² − 4\): \$y=x\^2-4\$, roots at ±2/);
});

test('the notes prompt carries the notation and graph rules, with real backslashes', () => {
  const p = notesPrompt({ transcript: 'x squared' });
  assert.ok(p.includes(STEM_RULES));
  assert.ok(p.includes(String.raw`$\frac{2}{3}$`));
  assert.ok(p.includes(String.raw`$\ce{2H2 + O2 -> 2H2O}$`));
  assert.match(p, /"graph" for Desmos/);
  assert.doesNotMatch(p, /[\f\b]/);
});
