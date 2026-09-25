/**
 * The assistant's voice.
 *
 * Before: `new SpeechSynthesisUtterance(reply)` with the browser's default
 * voice — usually the flat, robotic one — reading the raw markdown ("asterisk
 * asterisk important asterisk asterisk"), and Chrome silently stops long
 * utterances after about 15 seconds, so long answers were cut off mid-word.
 *
 * Now, in order:
 *   1. Gemini's neural text-to-speech, through the Code A Difference AI proxy
 *      (same shared key, never sent to the browser). Genuinely human-sounding.
 *   2. If that isn't available, the most natural voice this browser has:
 *      Edge's "Natural" voices, Chrome's Google voices, Apple's enhanced ones,
 *      and never the novelty voices macOS ships.
 * Either way the text is cleaned of markdown first and spoken a sentence at a
 * time, so nothing is read literally and nothing gets cut off.
 */
import { AI_ENDPOINT } from '@/api/db';
import { speakable, chunks, voiceScore } from './speakable.js';

export { speakable, chunks, voiceScore };

export const AI_VOICES = [
  { id: 'Aoede', label: 'Aoede', hint: 'warm, easygoing' },
  { id: 'Puck', label: 'Puck', hint: 'upbeat' },
  { id: 'Kore', label: 'Kore', hint: 'clear, steady' },
  { id: 'Charon', label: 'Charon', hint: 'calm, deeper' },
];

let settings = { engine: 'auto', aiVoice: 'Aoede', browserVoice: '', rate: 1 };
let aiUnavailable = false;        // this session, the proxy said it can't do speech
let playToken = 0;
let currentAudio = null;
const cache = new Map();          // "voice|text" -> object URL, for repeated cues

export function configureVoice(prefs = {}) {
  settings = { ...settings, ...Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined)) };
}

/* ------------------------------------------------------ browser voices */

function lang() {
  return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}

export function listBrowserVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  const l = lang();
  return speechSynthesis.getVoices()
    .filter(v => voiceScore(v, l) > -10)
    .sort((a, b) => voiceScore(b, l) - voiceScore(a, l));
}

/** Chrome loads its voice list asynchronously. */
export function onVoicesReady(cb) {
  if (typeof speechSynthesis === 'undefined') return () => {};
  if (speechSynthesis.getVoices().length) cb();
  const h = () => cb();
  speechSynthesis.addEventListener?.('voiceschanged', h);
  return () => speechSynthesis.removeEventListener?.('voiceschanged', h);
}

function pickBrowserVoice() {
  const list = listBrowserVoices();
  return list.find(v => v.name === settings.browserVoice) || list[0] || null;
}

function speakBrowser(text, token, onStart, onEnd) {
  if (typeof speechSynthesis === 'undefined') { onEnd?.(); return; }
  speechSynthesis.cancel();
  const voice = pickBrowserVoice();
  const parts = chunks(text);
  let i = 0, started = false;
  const next = () => {
    if (token !== playToken) return;
    if (i >= parts.length) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = settings.rate || 1;
    u.pitch = 1;
    u.onstart = () => { if (!started) { started = true; onStart?.('browser', voice?.name); } };
    u.onend = next;
    u.onerror = next;
    speechSynthesis.speak(u);
  };
  next();
}

/* ------------------------------------------------------------ AI voice */

function pcmToWav(b64, sampleRate) {
  const bin = atob(b64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sampleRate, true); h.setUint32(28, sampleRate * 2, true);
  h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, pcm], { type: 'audio/wav' });
}

async function aiAudioUrl(text) {
  const key = `${settings.aiVoice}|${text}`;
  if (cache.has(key)) return cache.get(key);
  let r;
  try {
    r = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'speak', text, voice: settings.aiVoice }),
    });
  } catch (_) {
    throw Object.assign(new Error('offline'), { permanent: false });
  }
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (!j || !j.ok || !j.audio) {
    // no key, or this key/model can't speak: stop asking for the session
    const permanent = r.status === 503 || r.status === 400 || r.status === 404 || r.status === 403;
    throw Object.assign(new Error((j && j.error) || `speech failed (${r.status})`), { permanent });
  }
  const mime = String(j.mimeType || '');
  const rate = Number((/rate=(\d+)/.exec(mime) || [])[1]) || Number(j.sampleRate) || 24000;
  const blob = /wav|mpeg|mp3|ogg/.test(mime)
    ? new Blob([Uint8Array.from(atob(j.audio), c => c.charCodeAt(0))], { type: mime })
    : pcmToWav(j.audio, rate);
  const url = URL.createObjectURL(blob);
  cache.set(key, url);
  if (cache.size > 40) {
    const [oldKey, oldUrl] = cache.entries().next().value;
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

function playUrl(url, token) {
  return new Promise((resolve, reject) => {
    if (token !== playToken) return resolve();
    const a = new Audio(url);
    currentAudio = a;
    a.onended = () => resolve();
    a.onerror = () => reject(new Error('playback failed'));
    a.play().catch(reject);
  });
}

/**
 * Throws only if the FIRST piece can't be had — that is the caller's cue to
 * use the browser voice instead. Anything that fails after that has already
 * been partly spoken, so the rest continues in the browser voice rather than
 * starting the answer over.
 */
async function speakAi(text, token, onStart, onEnd) {
  const parts = chunks(text, 600);
  const fetchPart = (i) => { const p = aiAudioUrl(parts[i]); p.catch(() => {}); return p; };
  let next = fetchPart(0);
  for (let i = 0; i < parts.length; i++) {
    let url;
    try {
      url = await next;
    } catch (e) {
      if (i === 0) throw e;
      if (token === playToken) speakBrowser(parts.slice(i).join(' '), token, null, onEnd);
      return;
    }
    if (token !== playToken) return;
    if (i + 1 < parts.length) next = fetchPart(i + 1);   // fetch ahead while this one plays
    if (i === 0) onStart?.('ai', settings.aiVoice);
    try {
      await playUrl(url, token);
    } catch (e) {
      if (i === 0) throw e;                                // e.g. autoplay blocked
      if (token === playToken) speakBrowser(parts.slice(i).join(' '), token, null, onEnd);
      return;
    }
  }
  if (token === playToken) onEnd?.();
}

/* ---------------------------------------------------------------- API */

/**
 * Speak `text` in the most natural voice available.
 * onStart(engine, voiceName) tells the caller which one it got.
 */
export async function speak(text, { onStart, onEnd } = {}) {
  stopSpeaking();
  const token = ++playToken;
  const clean = speakable(text);
  if (!clean) { onEnd?.(); return; }

  const tryAi = settings.engine === 'ai' || (settings.engine === 'auto' && !aiUnavailable);
  if (tryAi && typeof fetch !== 'undefined') {
    try {
      await speakAi(clean, token, onStart, onEnd);
      return;
    } catch (e) {
      if (e.permanent) aiUnavailable = true;
      if (token !== playToken) return;
    }
  }
  speakBrowser(clean, token, onStart, onEnd);
}

export function stopSpeaking() {
  playToken++;
  if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** Which voice the next `speak()` will use, for Settings to show. */
export function voiceStatus() {
  const b = pickBrowserVoice();
  return {
    aiAvailable: !aiUnavailable,
    engine: settings.engine === 'browser' || aiUnavailable ? 'browser' : 'ai',
    browserVoice: b ? b.name : null,
  };
}
