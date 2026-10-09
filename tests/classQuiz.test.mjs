import test from 'node:test';
import assert from 'node:assert/strict';
import { classSources, gatherMaterial, classQuizPrompt, lectureMaterialText } from '../src/lib/classQuiz.js';

const lec = (id, extra) => ({ id, title: `L${id}`, date: `2026-10-0${id}`, class_name: 'Bio', ...extra });

test('a class quiz draws on notes, added material and transcripts — only for that class', () => {
  const lectures = [
    lec('1', { notes: { summary: 'Cells are the unit of life.', sections: [{ heading: 'Cells', points: ['Membranes control what enters.'] }] } }),
    lec('2', { source: 'material', title: 'Handout', material_text: 'Mitosis has four phases: prophase, metaphase, anaphase, telophase.' }),
    lec('3', { segments: [{ start: 0, text: 'Today we cover osmosis, the movement of water across a membrane.' }] }),
    lec('4', { segments: [] }),                                       // nothing to quiz on
    { ...lec('5', { notes: { summary: 'Supply and demand curves.', sections: [{ heading: 'x', points: ['y'] }] } }), class_name: 'Econ' },
  ];
  const s = classSources(lectures, 'Bio');
  assert.deepEqual(s.map(x => x.id), ['3', '2', '1']);           // newest first, empty and other classes left out
  assert.equal(s.find(x => x.id === '2').kind, 'material');
  assert.match(lectureMaterialText(lectures[0]), /Membranes control/);
});

test('the budget is shared fairly: short items whole, long ones trimmed', () => {
  const sources = [
    { id: 'a', title: 'Short', text: 'x'.repeat(500) },
    { id: 'b', title: 'Long 1', text: 'y'.repeat(50000) },
    { id: 'c', title: 'Long 2', text: 'z'.repeat(50000) },
  ];
  const { text, used } = gatherMaterial(sources, 10000);
  assert.ok(text.length <= 10000, `got ${text.length}`);
  const by = Object.fromEntries(used.map(u => [u.id, u]));
  assert.equal(by.a.cut, false);
  assert.ok(by.b.cut && by.c.cut);
  assert.ok(Math.abs(by.b.chars - by.c.chars) < 50, 'the two long ones get equal room');
  assert.match(text, /### Lecture: Short/);
});

test('everything fits untouched when there is room', () => {
  const { text, used } = gatherMaterial([{ id: 'a', title: 'A', kind: 'material', text: 'alpha' }, { id: 'b', title: 'B', text: 'beta' }], 5000);
  assert.ok(used.every(u => !u.cut));
  assert.match(text, /### Material: A\nalpha/);
});

test('the prompt asks for spread, sources and the right mix of questions', () => {
  const p = classQuizPrompt({ className: 'Bio', focus: 'cell division', material: 'MATERIAL', count: 10, written: 2 });
  assert.match(p, /"Bio" class/);
  assert.match(p, /Make 8 multiple-choice questions and 2 written/);
  assert.match(p, /ALL of the lectures and materials/);
  assert.match(p, /"source"/);
  assert.match(p, /Focus especially on: cell division/);
  assert.ok(p.trim().endsWith('MATERIAL'));
  assert.ok(p.includes(String.raw`$\frac{a}{b}$`));
});
