/**
 * Music recommendations, worked out on the student's own device from their own listening.
 * No AI and no other students' data: what they finished, skipped, liked or turned down, kept
 * apart for focus blocks and breaks, fading over a couple of weeks so it follows their taste.
 *
 * Pure: no React, no network. MusicContext feeds it songs it has already seen (search
 * results, things played) and plays what it ranks. tests/musicRecommend.test.mjs covers it.
 */

export const HALF_LIFE_DAYS = 14;
const DAY = 86400000;
const MAX_FEATURES = 250;
const MAX_RECENT = 60;
const MAX_BLOCKED = 200;

/** Words that say nothing about the music. */
const NOISE = new Set(['official', 'video', 'music', 'lyrics', 'lyric', 'audio', 'hd', '4k', 'hq', 'ft', 'feat', 'mv', 'remastered', 'remaster',
  'version', 'full', 'album', 'the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'my', 'your', 'you', 'me', 'is', 'it', 'at',
  'from', 'x', 'vs', 'new', 'song', 'songs', 'visualizer', 'topic', 'vevo', 'records', 'official video', 'oficial']);
/** Genres and moods worth matching on, with the words that name them. */
const LEXICON = {
  lofi: ['lofi', 'lo-fi', 'lo fi', 'chillhop'], jazz: ['jazz', 'bossa', 'swing'], piano: ['piano'], classical: ['classical', 'mozart', 'bach', 'beethoven', 'chopin', 'vivaldi', 'debussy', 'symphony', 'concerto', 'sonata'],
  ambient: ['ambient', 'drone', 'soundscape', 'meditation'], synthwave: ['synthwave', 'retrowave', 'vaporwave'], acoustic: ['acoustic', 'unplugged', 'guitar'],
  chill: ['chill', 'relax', 'relaxing', 'calm', 'mellow'], rain: ['rain', 'thunder', 'storm', 'nature sounds', 'white noise', 'brown noise'],
  rap: ['rap', 'hip hop', 'hip-hop', 'trap', 'drill'], pop: ['pop'], rock: ['rock', 'metal', 'punk', 'indie'], edm: ['edm', 'house', 'techno', 'dubstep', 'trance', 'dnb', 'drum and bass'],
  kpop: ['kpop', 'k-pop'], soundtrack: ['ost', 'soundtrack', 'score', 'theme', 'film music', 'game music'], study: ['study', 'focus', 'concentration', 'studying', 'work'],
  rnb: ['r&b', 'rnb', 'soul'], latin: ['reggaeton', 'latin', 'salsa', 'bachata'], country: ['country'], gospel: ['gospel', 'worship', 'nasheed'],
  upbeat: ['upbeat', 'party', 'dance', 'workout', 'hype', 'energy', 'energetic'],
};
const INSTRUMENTAL = new Set(['lofi', 'piano', 'classical', 'ambient', 'soundtrack', 'rain', 'synthwave', 'jazz']);
const VOCAL_HEAVY = new Set(['rap', 'kpop', 'pop', 'rock', 'latin', 'country']);
const JUNK = /\b(reaction|reacts?|interview|podcast|trailer|#shorts|shorts|tutorial|how to|review|unboxing|prank|vlog|live stream|livestream)\b/i;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const keyOf = (t) => t?.id || t?.uri || t?.list || '';
const now0 = () => Date.now();

/** What a song is, as features: its channel, genre tags, a few title words, instrumental or not. */
export function features(track) {
  const title = norm(track?.title);
  const channel = norm(track?.channel || track?.artist).replace(/\s*-\s*topic$/, '').trim();
  const text = `${title} ${channel}`;
  const tags = [];
  for (const [tag, words] of Object.entries(LEXICON)) {
    if (words.some(w => (w.length <= 3 ? new RegExp(`(^|[^a-z])${w.replace(/[-&]/g, '\\$&')}([^a-z]|$)`).test(text) : text.includes(w)))) tags.push(tag);
  }
  // "lofi hip hop" is lo-fi, not rap
  if (tags.includes('lofi') && tags.includes('rap') && !/\b(rap|trap|drill)\b/.test(text)) tags.splice(tags.indexOf('rap'), 1);
  if (/\binstrumental\b|\bbeats?\b|\bno vocals\b/.test(text) && !tags.includes('lofi')) tags.push('instrumental');
  const tokens = [...new Set(title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/[^a-z0-9']+/)
    .filter(w => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w)))].slice(0, 8);
  const instrumental = tags.some(t => INSTRUMENTAL.has(t)) || tags.includes('instrumental');
  const long = /\b(\d+\s*(hours?|hrs?)|1\s*hour|mix|compilation|playlist|non\s*stop|24\/7)\b/.test(title);
  return { channel, tags, tokens, instrumental, long, junk: JUNK.test(text) };
}

/** The feature keys a song adds to or reads from a taste bucket. */
function keys(f) {
  return [...(f.channel ? [`ch:${f.channel}`] : []), ...f.tags.map(t => `tag:${t}`), ...f.tokens.map(t => `tok:${t}`)];
}
const weightOf = (k) => (k.startsWith('tok:') ? 0.3 : 1);

export function emptyProfile(now = now0()) {
  return { v: 1, at: now, focus: {}, break: {}, any: {}, recent: [], blocked: [], counts: {} };
}

/** A profile made safe to use: the right shape, whatever arrived (an older device, a hand edit). */
export function cleanProfile(p, now = now0()) {
  if (!p || typeof p !== 'object' || p.v !== 1) return emptyProfile(now);
  const bucket = (b) => (b && typeof b === 'object' ? Object.fromEntries(Object.entries(b).filter(([k, w]) => typeof k === 'string' && Number.isFinite(w))) : {});
  return {
    v: 1, at: Number(p.at) || now, focus: bucket(p.focus), break: bucket(p.break), any: bucket(p.any),
    recent: (Array.isArray(p.recent) ? p.recent : []).filter(r => r && r.id).slice(0, MAX_RECENT),
    blocked: (Array.isArray(p.blocked) ? p.blocked : []).filter(x => typeof x === 'string').slice(0, MAX_BLOCKED),
    counts: p.counts && typeof p.counts === 'object' ? p.counts : {},
  };
}

/** Everything fades: half its weight every HALF_LIFE_DAYS. Applied when the profile is next touched. */
export function decay(p, now = now0()) {
  const days = Math.max(0, (now - (p.at || now)) / DAY);
  if (days < 0.01) return p;
  const k = Math.pow(0.5, days / HALF_LIFE_DAYS);
  const fade = (b) => Object.fromEntries(Object.entries(b).map(([f, w]) => [f, w * k]).filter(([, w]) => Math.abs(w) > 0.02));
  return { ...p, at: now, focus: fade(p.focus), break: fade(p.break), any: fade(p.any) };
}

const trim = (b) => Object.fromEntries(Object.entries(b).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1])).slice(0, MAX_FEATURES));

/** How much an event says about liking a song. */
export function eventWeight(kind, listened = 0, duration = 0) {
  if (kind === 'more') return 1.5;
  if (kind === 'less') return -2;
  if (kind === 'finish') return 1;
  if (kind === 'skip') return listened < 30 ? -0.8 : duration && listened / duration >= 0.5 ? 0.6 : -0.2;
  if (kind === 'listen') return duration && listened / duration >= 0.5 ? 0.6 : 0;
  return 0;
}

/**
 * Learn from one thing that happened: kind 'finish' | 'skip' | 'listen' | 'more' | 'less' | 'play'.
 * `phase` is the timer's: 'focus', 'break' or anything else.
 */
export function learn(profile, track, kind, { phase = '', listened = 0, duration = 0, now = now0() } = {}) {
  const id = keyOf(track);
  if (!id) return profile;
  let p = decay(cleanProfile(profile, now), now);
  const f = features(track);
  const w = eventWeight(kind, listened, duration);
  const bucketName = phase === 'focus' || phase === 'break' ? phase : null;
  if (w) {
    const add = (b) => { const o = { ...b }; for (const k of keys(f)) o[k] = (o[k] || 0) + w * weightOf(k); return trim(o); };
    p = { ...p, any: add(p.any), ...(bucketName ? { [bucketName]: add(p[bucketName]) } : {}) };
  }
  const counts = { ...p.counts };
  if (kind === 'finish' && f.channel) counts[f.channel] = (counts[f.channel] || 0) + 1;
  let blocked = p.blocked;
  if (kind === 'less') blocked = [id, ...blocked.filter(x => x !== id)].slice(0, MAX_BLOCKED);
  const recent = kind === 'play' || kind === 'finish'
    ? [{ id, at: now }, ...p.recent.filter(r => r.id !== id)].slice(0, MAX_RECENT)
    : p.recent;
  return { ...p, counts: trimCounts(counts), blocked, recent };
}
const trimCounts = (c) => Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 60));

/** How well a song fits this student right now. -Infinity for something they turned down. */
export function score(track, profile, { phase = '', now = now0(), mode = 'mix' } = {}) {
  const id = keyOf(track);
  if (!id) return -Infinity;
  const p = profile;
  const f = features(track);
  if (p.blocked.includes(id)) return -Infinity;
  const bucket = phase === 'focus' || phase === 'break' ? p[phase] : null;
  const val = (k) => (bucket && k in bucket ? bucket[k] : 0) * 1 + (p.any[k] || 0) * (bucket ? 0.5 : 1);
  let s = 0;
  for (const k of keys(f)) s += val(k) * weightOf(k);
  const known = f.channel && (p.any[`ch:${f.channel}`] !== undefined);
  if (phase === 'focus' || mode === 'focus') s += f.instrumental ? 0.8 : 0, s -= f.tags.some(t => VOCAL_HEAVY.has(t)) ? 0.5 : 0;
  if (mode === 'break') s += f.tags.includes('upbeat') ? 0.6 : 0;
  if (mode === 'new') s += known ? -0.5 : 1.2;
  else if (!known) s += 0.15;
  if (f.junk) s -= 2;
  const last = p.recent.find(r => r.id === id);
  if (last) s -= now - last.at < 2 * 3600000 ? 3 : now - last.at < DAY ? 1 : 0;
  return s;
}

/**
 * The best `n` songs from a pool, varied: at most two from one channel in each run of ten,
 * and one in every five slots goes to the best channel the student hasn't heard yet.
 * `exclude` is a Set of ids not to suggest (already played this session).
 */
export function rank(pool, profile, ctx = {}, n = 10, exclude = new Set()) {
  const p = cleanProfile(profile, ctx.now);
  const seen = new Set();
  const scored = [];
  for (const t of pool || []) {
    const id = keyOf(t);
    if (!id || seen.has(id) || exclude.has(id)) continue;
    seen.add(id);
    const s = score(t, p, ctx);
    if (s === -Infinity) continue;
    scored.push({ t, s, f: features(t) });
  }
  scored.sort((a, b) => b.s - a.s);
  if (ctx.mode === 'favourites') {
    const fav = scored.filter(x => (p.counts[x.f.channel] || 0) > 0);
    if (fav.length >= Math.min(n, 3)) scored.splice(0, scored.length, ...fav, ...scored.filter(x => !fav.includes(x)));
  }
  const out = [];
  const perChannel = new Map();
  const isNew = (x) => x.f.channel && p.any[`ch:${x.f.channel}`] === undefined;
  const take = (x) => { out.push(x.t); perChannel.set(x.f.channel, (perChannel.get(x.f.channel) || 0) + 1); x.used = true; };
  while (out.length < n) {
    const slot = out.length;
    const window = Math.floor(slot / 10);
    const ok = (x) => !x.used && (!x.f.channel || (perChannel.get(x.f.channel) || 0) < 2 * (window + 1));
    let pick = null;
    if (slot % 5 === 4 && ctx.mode !== 'favourites') pick = scored.find(x => ok(x) && isNew(x));
    pick = pick || scored.find(ok) || scored.find(x => !x.used);
    if (!pick) break;
    take(pick);
  }
  return out;
}

/** A few words on why a song was picked. */
export function reason(track, profile, ctx = {}) {
  const p = cleanProfile(profile, ctx.now);
  const f = features(track);
  const n = f.channel ? p.counts[f.channel] || 0 : 0;
  if (n >= 2) return `You finished ${n} songs by ${track.channel || track.artist}`;
  const liked = f.tags.filter(t => (p.any[`tag:${t}`] || 0) > 0.5).sort((a, b) => p.any[`tag:${b}`] - p.any[`tag:${a}`]);
  if (liked.length) return `Because you like ${LABEL[liked[0]] || liked[0]}`;
  if ((ctx.phase === 'focus' || ctx.mode === 'focus') && f.instrumental) return 'Instrumental, good for focus';
  if (f.channel && p.any[`ch:${f.channel}`] === undefined) return 'New for you';
  return 'Picked for you';
}
const LABEL = { lofi: 'lo-fi', rnb: 'R&B', edm: 'electronic', kpop: 'K-pop', soundtrack: 'soundtracks', study: 'study music', upbeat: 'upbeat music', rain: 'rain sounds' };

/** The ready-made mixes, best first for the moment (Deep focus leads during a focus block). */
export function mixes(ctx = {}) {
  const list = [
    { id: 'focus', title: 'Deep focus', mode: 'focus', phase: 'focus' },
    { id: 'break', title: 'Break time', mode: 'break', phase: 'break' },
    { id: 'favourites', title: 'Favourites', mode: 'favourites', phase: '' },
    { id: 'new', title: 'Something new', mode: 'new', phase: '' },
  ];
  return ctx.phase === 'break' ? [list[1], list[0], list[2], list[3]] : list;
}

/** Starting points for someone with no history yet (cached on the server, so cheap for everyone). */
export const STARTER_QUERIES = { focus: 'lofi study beats', break: 'chill upbeat songs', favourites: 'piano study music', new: 'jazz for studying' };

/**
 * The one search to make when the pool runs thin: built from the student's strongest features,
 * never repeating a query made in the last day (`asked` maps query -> time).
 */
export function nextQuery(profile, { mode = 'mix', phase = '', asked = {}, now = now0() } = {}) {
  const p = cleanProfile(profile, now);
  const bucket = phase === 'focus' || phase === 'break' ? { ...p.any, ...p[phase] } : p.any;
  const top = Object.entries(bucket).filter(([, w]) => w > 0.3).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const tagsTop = top.filter(k => k.startsWith('tag:')).map(k => k.slice(4));
  const chTop = top.filter(k => k.startsWith('ch:')).map(k => k.slice(3));
  const suffix = mode === 'focus' || phase === 'focus' ? ' study music' : mode === 'break' ? ' upbeat' : ' music';
  const candidates = [
    ...tagsTop.slice(0, 4).map(t => `${LABEL[t] || t}${suffix}`),
    ...chTop.slice(0, 4),
    ...(tagsTop.length > 1 ? [`${tagsTop[0]} ${tagsTop[1]}${suffix}`] : []),
    STARTER_QUERIES[mode] || STARTER_QUERIES.focus,
  ];
  const fresh = candidates.find(q => !(asked[q] && now - asked[q] < DAY));
  return fresh || null;
}
