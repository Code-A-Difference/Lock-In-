import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakable, chunks, voiceScore } from '../src/lib/speakable.js';

test('markdown is read as words, not symbols', () => {
  const md = '## Key idea\n\n**Photosynthesis** turns *light* into energy.\n- Uses `chlorophyll`\n- See [this page](https://example.com)\n\n```js\nconsole.log(1)\n```';
  const s = speakable(md);
  assert.ok(!/[*#`\[\]]/.test(s), s);
  assert.ok(s.includes('Photosynthesis turns light into energy'), s);
  assert.ok(s.includes('Uses chlorophyll'), s);
  assert.ok(s.includes('See this page'), s);
  assert.ok(!s.includes('https'), s);
  assert.ok(s.includes('code omitted'), s);
});

test('emoji are dropped, numbered lists survive', () => {
  assert.equal(speakable('Great job! 🎉🔥'), 'Great job!');
  assert.ok(speakable('1. First\n2. Second').includes('1. First'));
});

test('long text is split at sentence ends, never mid-word, under the limit', () => {
  const long = 'This is sentence one. '.repeat(30) + 'And ' + 'word '.repeat(80) + 'end.';
  const parts = chunks(long, 220);
  assert.ok(parts.length > 3);
  for (const p of parts) assert.ok(p.length <= 221, `${p.length}: ${p}`);
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), long.replace(/\s+/g, ' ').trim());
});

test('natural voices beat default ones; novelty voices never win', () => {
  const v = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });
  const ranked = [
    v('Microsoft David - English (United States)'),
    v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
    v('Google US English', 'en-US', false),
    v('Zarvox'),
    v('Google français', 'fr-FR', false),
  ].sort((a, b) => voiceScore(b, 'en-US') - voiceScore(a, 'en-US')).map(x => x.name);
  assert.match(ranked[0], /Aria.*Natural/);
  assert.equal(ranked[1], 'Google US English');
  assert.ok(voiceScore(v('Zarvox'), 'en-US') < -10);
  assert.ok(voiceScore(v('Google français', 'fr-FR'), 'en-US') < voiceScore(v('Microsoft David'), 'en-US'));
});

test('a Canadian browser prefers en-CA, then any English', () => {
  const ca = { name: 'Google English (Canada)', lang: 'en-CA', localService: false };
  const us = { name: 'Google US English', lang: 'en-US', localService: false };
  assert.ok(voiceScore(ca, 'en-CA') > voiceScore(us, 'en-CA'));
});
