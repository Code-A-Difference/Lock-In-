import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lectureMarkdown, lectureHtml, bundle, wordDocument, fileName } from '../src/lib/noteExport.js';

const lec = {
  title: 'Photosynthesis', class_name: 'Biology', date: '2026-10-13',
  notes: {
    title: 'Photosynthesis: light reactions', summary: 'Plants turn light into <sugar> & oxygen.',
    sections: [{ heading: 'Where', points: ['Thylakoid membranes', 'Make ATP'] }],
    key_terms: [{ term: 'ATP', definition: 'Energy carrier' }],
    action_items: [{ title: 'Lab report', due: 'Friday' }],
    review_questions: ['Where do the light reactions happen?'],
  },
  my_notes: 'Ask about NADPH\nin class',
};

test('Markdown keeps the notes and adds my own', () => {
  const md = lectureMarkdown(lec);
  assert.match(md, /^# Photosynthesis: light reactions/);
  assert.match(md, /## Where\n- Thylakoid membranes/);
  assert.match(md, /## My notes\n\nAsk about NADPH/);
});

test('HTML is escaped and structured', () => {
  const h = lectureHtml(lec);
  assert.match(h, /<h1>Photosynthesis: light reactions<\/h1>/);
  assert.match(h, /&lt;sugar&gt; &amp; oxygen/);
  assert.match(h, /<li><strong>ATP<\/strong>: Energy carrier<\/li>/);
  assert.match(h, /<ol><li>Where do the light reactions happen\?<\/li><\/ol>/);
  assert.match(h, /NADPH<br>in class/);
});

test('a lecture with only my own notes still exports', () => {
  const md = lectureMarkdown({ title: 'Week 3', my_notes: 'Read chapter 4' });
  assert.match(md, /# Week 3/);
  assert.match(md, /Read chapter 4/);
});

test('a class becomes one document, oldest lecture first, headings stepped down', () => {
  const b = bundle([{ ...lec, date: '2026-10-20', notes: { ...lec.notes, title: 'Second' } }, { ...lec, date: '2026-10-01', notes: { ...lec.notes, title: 'First' } }], 'Biology notes');
  assert.ok(b.md.indexOf('First') < b.md.indexOf('Second'));
  assert.match(b.html, /^<h1>Biology notes<\/h1>/);
  assert.match(b.html, /<h2>First<\/h2>/);
  assert.match(b.html, /<h3>Where<\/h3>/);
});

test('Word document and file names', () => {
  assert.match(wordDocument('<p>x</p>', 'Bio'), /<title>Bio<\/title>[\s\S]*<p>x<\/p>/);
  assert.equal(fileName('Photosynthesis: light reactions', 'md'), 'Photosynthesis-light-reactions.md');
  assert.equal(fileName('', 'doc'), 'notes.doc');
});
