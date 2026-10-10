import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsample, encodeWav, rms, isSilent, toBase64, SAMPLE_RATE } from '../src/lib/recorder.js';
import {
  transcriptText, clock, sections, notesPrompt, normaliseNotes, notesMarkdown,
} from '../src/lib/lectureNotes.js';

test('downsampling 48 kHz to 16 kHz keeps the duration and the level', () => {
  const second = new Float32Array(48000).fill(0.5);
  const out = downsample(second, 48000);
  assert.equal(out.length, SAMPLE_RATE);
  assert.ok(Math.abs(out[100] - Math.round(0.5 * 32767)) <= 1);
});

test('a WAV piece is a complete, standalone file', () => {
  const wav = encodeWav(new Int16Array(SAMPLE_RATE));       // one second
  const v = new DataView(wav.buffer);
  const tag = (o) => String.fromCharCode(...wav.slice(o, o + 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(36), 'data');
  assert.equal(v.getUint32(24, true), SAMPLE_RATE);          // sample rate
  assert.equal(v.getUint16(22, true), 1);                    // mono
  assert.equal(v.getUint32(40, true), SAMPLE_RATE * 2);      // data bytes
  assert.equal(wav.length, 44 + SAMPLE_RATE * 2);
});

test('silence is recognised so quiet stretches are not sent', () => {
  assert.ok(isSilent(new Int16Array(16000)));
  const speech = Int16Array.from({ length: 16000 }, (_, i) => Math.round(Math.sin(i / 8) * 6000));
  assert.ok(!isSilent(speech));
  assert.ok(rms(speech) > 0.1);
});

test('base64 of a large buffer matches Node', () => {
  const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('transcript pieces join in order, skipping failed ones', () => {
  assert.equal(transcriptText([{ text: 'Hello  class.' }, { text: '', error: 'x' }, { text: ' Today:  cells.' }]), 'Hello class. Today: cells.');
});

test('clock reads like a recorder', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(725), '12:05');
  assert.equal(clock(3725), '1:02:05');
});

test('long transcripts split at sentence ends, within the limit', () => {
  const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is about photosynthesis.`).join(' ');
  const parts = sections(text, 2000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.length <= 2000));
  assert.ok(parts.slice(0, -1).every(p => p.endsWith('.')));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text);
  assert.deepEqual(sections('short.'), ['short.']);
  assert.deepEqual(sections(''), []);
});

test("the student's own notes become the outline", () => {
  const p = notesPrompt({ transcript: 'T', myNotes: 'Krebs cycle!!', className: 'Biology 11' });
  assert.match(p, /Krebs cycle!!/);
  assert.match(p, /outline/);
  assert.match(p, /Biology 11/);
  assert.match(notesPrompt({ transcript: 'T' }), /took no notes/);
});

test('notes from the AI are normalised, never trusted to be complete', () => {
  const n = normaliseNotes({ summary: 'S', sections: [{ heading: 'A', points: ['x', ''] }, {}], action_items: [{ kind: 'thing', title: 'Bring a calculator' }, { title: '' }] });
  assert.deepEqual(n.sections, [{ heading: 'A', points: ['x'] }]);
  assert.deepEqual(n.action_items, [{ kind: 'reminder', title: 'Bring a calculator', due: '' }]);
  assert.deepEqual(n.key_terms, []);
  assert.equal(normaliseNotes(null).summary, '');
});

test('the kinds of things teachers mention map to homework or tests', () => {
  const n = normaliseNotes({ action_items: [
    { kind: 'quiz', title: 'Chapter 4 quiz' }, { kind: 'assignment', title: 'Read pp. 40-52' },
    { kind: 'reminder', title: 'Lab report' }, { kind: 'reminder', title: 'Bring goggles' },
  ] });
  assert.deepEqual(n.action_items.map(a => a.kind), ['test', 'homework', 'homework', 'reminder']);
});

test('notes export as Markdown', () => {
  const md = notesMarkdown({
    title: 'Photosynthesis', summary: 'Light to sugar.',
    sections: [{ heading: 'Light reactions', points: ['Thylakoids'] }],
    key_terms: [{ term: 'ATP', definition: 'energy carrier' }],
    action_items: [{ kind: 'homework', title: 'Lab report', due: 'Friday' }],
  }, { className: 'Bio', date: '2026-10-02' });
  assert.match(md, /^# Photosynthesis/);
  assert.match(md, /_Bio · 2026-10-02_/);
  assert.match(md, /## Light reactions\n- Thylakoids/);
  assert.match(md, /- \*\*ATP\*\*, energy carrier/);
  assert.match(md, /- \[ \] Lab report \(Friday\)/);
});
