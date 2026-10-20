/**
 * Developer mode for the AI: every request LOCK IN! makes to the AI service (the Companion chat,
 * notes, transcription, the AI voice, flashcards, quizzes, the planner…) is written down here with
 * what was sent, what came back (raw), and how long it took. With developer mode on, the server
 * adds its own trace: each call it made to an AI provider, which key (by label and masked key),
 * the exact payload and the provider's raw reply.
 *
 * Only available to someone signed in to the site's /admin/ (the server checks, every time).
 * Nothing here is kept after a reload, and the full API keys never reach the browser.
 */
import { gateFetch } from '@/api/hostGate';

const KEY = 'lockin.aidev';
const MAX = 60;
let available = null;             // null: not asked yet; then true/false from the server
let availablePromise = null;
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch (_) { /* private mode */ }
let seq = 0;
const log = [];                   // newest last
const listeners = new Set();
const emit = () => listeners.forEach(fn => { try { fn(); } catch (_) { /* a listener's problem */ } });

/** Ask the server whether this browser may use developer mode (signed in to /admin/). */
export function checkDevAvailable(endpoint) {
  if (available !== null) return Promise.resolve(available);
  availablePromise = availablePromise || fetch(`${endpoint}?dev=1`, { credentials: 'same-origin' })
    .then(r => r.json()).then(j => { available = !!(j && j.ok && j.dev); emit(); return available; })
    .catch(() => { available = false; emit(); return false; });
  return availablePromise;
}
export const devAvailable = () => available === true;
export const devOn = () => on && available === true;
export function setDevOn(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* private mode */ }
  emit();
}
export const devSeq = () => seq;
export const devLog = () => log.slice();
export function devEntries(from, to) { return log.filter(e => e.id > from && e.id <= to); }
export function clearDevLog() { log.length = 0; emit(); }
export function onDevChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Pictures, recordings and other long base64 shown as their size; very long text cut. */
export function redact(v, depth = 0) {
  if (depth > 12) return '[…]';
  if (Array.isArray(v)) return v.map(x => redact(x, depth + 1));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = redact(v[k], depth + 1); return o; }
  if (typeof v === 'string') {
    if (v.length > 400 && /^(data:[\w/+.-]+;base64,)?[A-Za-z0-9+/=\r\n]+$/.test(v)) return `[base64, ${(v.length * 3 / 4 / 1024).toFixed(1)} KB]`;
    if (v.length > 20000) return `${v.slice(0, 20000)} […cut, ${v.length} characters in all]`;
  }
  return v;
}
function redactRaw(s) {
  const t = String(s || '').replace(/[A-Za-z0-9+/=]{800,}/g, (m) => `[base64, ${(m.length * 3 / 4 / 1024).toFixed(1)} KB]`);
  return t.length > 40000 ? `${t.slice(0, 40000)} […cut]` : t;
}

/**
 * The one way LOCK IN! talks to the AI service. Same as gateFetch, plus: in developer mode the
 * request asks the server for its trace, and the whole exchange is written to the log.
 * `feature` names what is asking ("assistant", "notes", "transcribe", "voice", …).
 */
export async function aiFetch(endpoint, init, feature = 'ai', lane = 0) {
  if (!devOn()) return gateFetch(endpoint, init);
  let sent = null;
  try { sent = JSON.parse(init.body); } catch (_) { sent = null; }
  const body = sent ? JSON.stringify({ ...sent, debug: true }) : init.body;
  const entry = { id: ++seq, feature, lane, at: Date.now(), ms: null, status: null, sent: redact(sent), raw: '', debug: null, error: '' };
  log.push(entry);
  if (log.length > MAX) log.shift();
  emit();
  const t0 = performance.now();
  try {
    const r = await gateFetch(endpoint, { ...init, body });
    entry.status = r.status;
    const text = await r.clone().text().catch(() => '');
    entry.ms = Math.round(performance.now() - t0);
    let j = null;
    try { j = JSON.parse(text); } catch (_) { j = null; }
    entry.debug = j && j.debug ? j.debug : null;
    if (j && j.debug) { const { debug, ...rest } = j; entry.raw = redactRaw(JSON.stringify(rest, null, 2)); }
    else entry.raw = redactRaw(text);
    entry.winner = j && j.provider ? { provider: j.provider, model: j.model || '', serverMs: j.ms ?? null } : null;
    emit();
    return r;
  } catch (e) {
    entry.ms = Math.round(performance.now() - t0);
    entry.error = e?.name === 'AbortError' ? 'Cancelled (another lane answered first, or the app gave up).' : String(e?.message || e);
    emit();
    throw e;
  }
}
