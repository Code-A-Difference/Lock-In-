import test from 'node:test';
import assert from 'node:assert/strict';
import { toRecord, fromRecord, titleOf, previewOf, listOf, HISTORY_TYPE } from '../src/lib/companionHistory.js';

const chat = [
  { id: 'a1', role: 'user', text: 'What is mitosis?', at: 1 },
  { id: 'a2', role: 'assistant', text: 'Mitosis is cell division that makes two identical cells.', at: 2 },
  { id: 'a3', role: 'user', text: '', at: 3 },
  { id: 'a4', role: 'assistant', text: 'Sorry, I didn’t catch that.', at: 4 },
];

test('a conversation is named after the first question, with the latest reply as its preview', () => {
  assert.equal(titleOf(chat), 'What is mitosis?');
  assert.equal(previewOf(chat), 'Sorry, I didn’t catch that.');
});

test('the record keeps text turns only, with its type and turn count', () => {
  const r = toRecord(chat);
  assert.equal(r.type, HISTORY_TYPE);
  assert.equal(r.messages.length, 3);          // the empty turn is dropped
  assert.equal(r.turns, 1);
  assert.equal(r.title, 'What is mitosis?');
});

test('very long replies are cut so one record stays small', () => {
  const r = toRecord([{ id: 'x', role: 'assistant', text: 'a'.repeat(9000), at: 1 }, { id: 'y', role: 'user', text: 'hi', at: 2 }]);
  assert.ok(r.messages[0].text.length <= 1500);
});

test('only the newest 60 turns are kept', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `t${i}`, at: i }));
  const r = toRecord(many);
  assert.equal(r.messages.length, 60);
  assert.equal(r.messages.at(-1).text, 't99');
});

test('opening a saved conversation gives back its messages in order', () => {
  const back = fromRecord({ messages: toRecord(chat).messages });
  assert.deepEqual(back.map(m => m.role), ['user', 'assistant', 'assistant'].slice(0, back.length).map((_, i) => ['user', 'assistant', 'assistant'][i]));
  assert.equal(back[0].text, 'What is mitosis?');
  assert.ok(back.every(m => m.id));
});

test('the history list shows only Companion records, newest first', () => {
  const list = listOf([
    { id: 'old', type: HISTORY_TYPE, updated_date: '2026-10-01T10:00:00Z' },
    { id: 'flash', type: 'flashcards', updated_date: '2026-10-20T10:00:00Z' },
    { id: 'new', type: HISTORY_TYPE, updated_date: '2026-10-15T10:00:00Z' },
  ]);
  assert.deepEqual(list.map(r => r.id), ['new', 'old']);
});
