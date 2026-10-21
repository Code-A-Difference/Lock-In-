import test from 'node:test';
import assert from 'node:assert/strict';
import { features, learn, decay, score, rank, reason, nextQuery, mixes, emptyProfile, cleanProfile, eventWeight, HALF_LIFE_DAYS } from '../src/lib/music/recommend.js';

const T0 = 1_800_000_000_000;
const song = (id, title, channel) => ({ id, title, channel });
const LOFI = [song('l1', 'lofi hip hop radio - beats to relax/study to', 'Lofi Girl'), song('l2', 'Rainy lofi beats for studying', 'Lofi Girl'), song('l3', 'chillhop morning lofi mix', 'Chillhop Music')];
const PIANO = [song('p1', 'Relaxing Piano Music for Studying (1 hour)', 'Piano Dreams'), song('p2', 'Chopin Nocturnes - Classical Piano', 'Classical Hub')];
const RAP = [song('r1', 'Drill Rap Mix 2026 (Official Video)', 'Rap Nation'), song('r2', 'Trap hip hop hits', 'Rap Nation')];
const JUNK = song('j1', 'Reacting to lofi beats - REACTION video', 'Some Streamer');

test('features: channel, genre tags, title words, instrumental and long', () => {
  const f = features(LOFI[0]);
  assert.equal(f.channel, 'lofi girl');
  assert.ok(f.tags.includes('lofi') && f.tags.includes('study'), f.tags.join());
  assert.equal(f.instrumental, true);
  assert.ok(!f.tokens.includes('official'));
  assert.equal(features(PIANO[0]).long, true);
  assert.ok(features(RAP[0]).tags.includes('rap'));
  assert.equal(features(RAP[0]).instrumental, false);
  assert.equal(features(JUNK).junk, true);
  assert.equal(features(song('x', 'Topic song', 'Taylor Swift - Topic')).channel, 'taylor swift');
});

test('finishing a song counts for its channel and genre; an early skip counts against', () => {
  let p = emptyProfile(T0);
  p = learn(p, LOFI[0], 'finish', { phase: 'focus', now: T0 });
  p = learn(p, RAP[0], 'skip', { phase: 'focus', listened: 8, duration: 180, now: T0 });
  assert.ok(p.any['ch:lofi girl'] > 0 && p.focus['tag:lofi'] > 0);
  assert.ok(p.any['tag:rap'] < 0);
  assert.equal(p.counts['lofi girl'], 1);
  assert.equal(eventWeight('skip', 120, 180), 0.6, 'a skip after most of the song still counts as liked');
});

test('focus and break are learned separately', () => {
  let p = emptyProfile(T0);
  p = learn(p, PIANO[0], 'finish', { phase: 'focus', now: T0 });
  p = learn(p, RAP[0], 'finish', { phase: 'break', now: T0 });
  assert.ok(p.focus['tag:piano'] > 0 && !p.focus['tag:rap']);
  assert.ok(p.break['tag:rap'] > 0 && !p.break['tag:piano']);
  const pool = [...PIANO, ...RAP];
  assert.equal(rank(pool, p, { phase: 'focus', now: T0 + 3 * 3600000 }, 1)[0].channel, PIANO[0].channel === 'Piano Dreams' ? 'Piano Dreams' : 'Classical Hub');
  assert.equal(rank(pool, p, { phase: 'break', now: T0 + 3 * 3600000 }, 1)[0].channel, 'Rap Nation');
});

test('everything fades with a half-life', () => {
  let p = learn(emptyProfile(T0), LOFI[0], 'finish', { now: T0 });
  const w = p.any['ch:lofi girl'];
  p = decay(p, T0 + HALF_LIFE_DAYS * 86400000);
  assert.ok(Math.abs(p.any['ch:lofi girl'] - w / 2) < 1e-9);
});

test('"Not for me" never comes back; songs played in the last couple of hours wait', () => {
  let p = emptyProfile(T0);
  p = learn(p, LOFI[0], 'finish', { now: T0 });
  p = learn(p, LOFI[1], 'less', { now: T0 });
  const r = rank([...LOFI, ...PIANO], p, { now: T0 + 60000 }, 5);
  assert.ok(!r.some(t => t.id === 'l2'), 'blocked song left out');
  assert.equal(score(LOFI[1], cleanProfile(p), { now: T0 }), -Infinity);
  assert.ok(score(LOFI[0], p, { now: T0 + 60000 }) < score(LOFI[0], p, { now: T0 + 3 * 86400000 }), 'just-played waits');
  assert.ok(score(JUNK, p, { now: T0 }) < score(LOFI[2], p, { now: T0 }), 'reaction videos rank low');
});

test('variety: at most two from one channel in ten, and a slot for something new', () => {
  let p = emptyProfile(T0);
  for (let i = 0; i < 6; i++) p = learn(p, song(`g${i}`, `lofi beats ${i}`, 'Lofi Girl'), 'finish', { now: T0 });
  const pool = [...Array(8)].map((_, i) => song(`n${i}`, `lofi study beats ${i}`, 'Lofi Girl')).concat([song('o1', 'Jazz piano cafe', 'Cafe Jazz'), song('o2', 'Ambient focus', 'Ambient Lab'), song('o3', 'Rain sounds', 'Nature')]);
  const r = rank(pool, p, { now: T0 + 3 * 86400000 }, 5);
  assert.ok(r.filter(t => t.channel === 'Lofi Girl').length <= 2, r.map(t => t.channel).join());
  assert.ok(r.slice(0, 5).some(t => t.channel !== 'Lofi Girl'));
});

test('excluded ids (already played this session) are skipped; duplicates collapse', () => {
  const r = rank([LOFI[0], LOFI[0], LOFI[1]], emptyProfile(T0), { now: T0 }, 5, new Set(['l1']));
  assert.deepEqual(r.map(t => t.id), ['l2']);
});

test('reasons read naturally', () => {
  let p = emptyProfile(T0);
  p = learn(p, LOFI[0], 'finish', { now: T0 });
  p = learn(p, LOFI[1], 'finish', { now: T0 });
  assert.match(reason(LOFI[2], p, { now: T0 }), /lo-fi/);
  assert.match(reason(song('z', 'something', 'Lofi Girl'), p, { now: T0 }), /finished 2 songs by Lofi Girl/);
  assert.equal(reason(PIANO[0], emptyProfile(T0), { phase: 'focus', now: T0 }), 'Instrumental, good for focus');
});

test('the next search comes from what they like and never repeats within a day', () => {
  let p = emptyProfile(T0);
  for (const s of PIANO) p = learn(p, s, 'finish', { phase: 'focus', now: T0 });
  const q1 = nextQuery(p, { mode: 'focus', now: T0 });
  assert.match(q1, /piano|classical/);
  const q2 = nextQuery(p, { mode: 'focus', now: T0, asked: { [q1]: T0 } });
  assert.notEqual(q1, q2);
  assert.equal(nextQuery(emptyProfile(T0), { mode: 'focus', now: T0 }), 'lofi study beats', 'a new student gets the starter');
});

test('profiles stay small and survive bad data', () => {
  let p = emptyProfile(T0);
  for (let i = 0; i < 400; i++) p = learn(p, song(`s${i}`, `word${i} other${i} lofi`, `Channel ${i}`), 'finish', { now: T0 });
  assert.ok(Object.keys(p.any).length <= 250);
  assert.ok(p.recent.length <= 60);
  assert.ok(JSON.stringify(p).length < 40000, `${JSON.stringify(p).length} bytes`);
  assert.deepEqual(cleanProfile({ v: 9 }, T0), emptyProfile(T0));
  assert.deepEqual(cleanProfile(null, T0).any, {});
  assert.equal(mixes({ phase: 'break' })[0].id, 'break');
  assert.equal(mixes({ phase: 'focus' })[0].id, 'focus');
});
