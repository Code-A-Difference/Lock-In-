/**
 * Listening. Two ways, both built on the browser's SpeechRecognition:
 *
 *   listenOnce()  push-to-talk: press the mic, say one thing, done.
 *   HandsFree     always listening for "Hey Lock In" (or Ambient Voice
 *                 Study's "Companion"), then acts on what follows.
 *
 * Ambient Voice Study listened continuously from the moment you pressed start
 * and acted on anything that matched — so a classmate saying "stop" across the
 * room stopped your timer. Here nothing happens without the wake phrase (or, for
 * a few seconds after the assistant has answered you, a follow-up). Hands-free is
 * asked about once, then stays on.
 *
 * Chrome and Edge send the audio to their own speech service to transcribe
 * it; Safari does it on the device. Settings says so where the switch is.
 */
import { afterWake } from './wake.js';
import { nativeSpeech } from './native.js';

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const canListen = !!SR || !!nativeSpeech;

const lang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

function friendly(err) {
  switch (err) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it in the address bar, then try again.';
    case 'no-speech': return "Didn't catch anything — try again a little closer to the mic.";
    case 'audio-capture': return 'No microphone was found.';
    case 'network': return 'Speech recognition needs an internet connection in this browser.';
    default: return 'Listening stopped unexpectedly.';
  }
}

/**
 * Push-to-talk. Resolves with the final transcript ('' if nothing was heard).
 * `onInterim` gets the words as they come, so the UI can show them live.
 * Returns { promise, stop }.
 */
export function listenOnce({ onInterim } = {}) {
  if (nativeSpeech) return nativeListenOnce({ onInterim });
  if (!SR) {
    return { promise: Promise.reject(new Error('This browser cannot listen. Chrome, Edge and Safari can.')), stop() {} };
  }
  const rec = new SR();
  rec.lang = lang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  let failed = null;
  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim?.((finalText + interim).trim());
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') failed = e.error; };
    rec.onend = () => (failed ? reject(new Error(friendly(failed))) : resolve(finalText.trim()));
  });
  try { rec.start(); } catch (e) { return { promise: Promise.reject(e), stop() {} }; }
  return { promise, stop: () => { try { rec.stop(); } catch (_) {} } };
}

/**
 * Hands-free: listens until stopped, and calls onCommand(text) for whatever
 * follows the wake phrase — or, for a few seconds after the assistant has
 * woken or answered, for anything said at all, so a conversation doesn't need
 * "Hey Lock In" before every sentence.
 *
 * What changed, and why the old one glitched:
 *  - It tore the recogniser down and rebuilt it whenever you tapped the mic or
 *    the assistant spoke. Each rebuild is a mic-on / mic-off blip (a beep, on
 *    some devices). Now one recogniser stays open and results are simply
 *    ignored while the assistant is talking, so it never hears itself.
 *  - When the browser kept ending the session straight away it reopened it
 *    every quarter-second, forever: on, off, on, off. Now it backs off, and
 *    after a handful of instant failures it stops and says so.
 *  - It waited for the recogniser to finish a sentence before noticing the
 *    wake phrase. Now it reacts to the interim words, so the "I'm listening"
 *    chime comes the moment you say it.
 */
export class HandsFree {
  constructor({ onCommand, onWake, onState, onError, onHeard, recognition } = {}) {
    this.SR = recognition || SR;
    this.onCommand = onCommand;
    this.onWake = onWake;
    this.onState = onState;
    this.onError = onError;
    this.onHeard = onHeard;
    this.running = false;
    this.armedUntil = 0;
    this.muted = false;
    this.mutedUntil = 0;
    this.rec = null;
    this.rapid = 0;
    this.openedAt = 0;
    this.timer = null;
  }

  get armed() { return Date.now() < this.armedUntil; }

  start() {
    if ((!this.SR && !nativeSpeech) || this.running) return false;
    this.running = true;
    this.rapid = 0;
    this._open();
    this.onState?.(true);
    return true;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (nativeSpeech) nativeSpeech.stop().catch(() => {});
    this.armedUntil = 0;
    const r = this.rec;
    this.rec = null;
    if (r) { r.onend = null; try { r.abort(); } catch (_) {} }
    this.onState?.(false);
  }

  /** While the assistant speaks, listen without hearing: results are dropped, the mic stays open. */
  setMuted(on) {
    this.muted = !!on;
    if (!on) this.mutedUntil = Date.now() + 700;   // its own voice echoes for a moment
  }

  /** Keep accepting plain speech (no wake phrase) for `ms` more. */
  extend(ms = 10000) { this.armedUntil = Math.max(this.armedUntil, Date.now() + ms); }

  _deaf() { return this.muted || Date.now() < this.mutedUntil; }

  _open() {
    if (nativeSpeech && !this.SR) { this._openNative(); return; }
    const rec = new this.SR();
    rec.lang = lang();
    rec.continuous = true;
    rec.interimResults = true;
    const woken = new Set();                       // results the wake phrase was already announced for
    rec.onresult = (e) => {
      if (this._deaf()) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = String(r[0].transcript || '').trim();
        if (!text) continue;
        if (r.isFinal) { this._final(i, text, woken); woken.delete(i); }
        else this._interim(i, text, woken);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.onError?.(friendly(e.error));
        this.stop();
      }
    };
    // Browsers end "continuous" recognition after a minute or so of quiet, or
    // when the connection drops. Reopen it — but a session that dies at once,
    // again and again, is a fault, not a pause, so back off and then stop.
    rec.onend = () => {
      if (!this.running) return;
      const lived = Date.now() - this.openedAt;
      this.rapid = lived < 3000 ? this.rapid + 1 : 0;
      if (this.rapid >= 8) {
        this.onError?.('Voice recognition keeps cutting out in this browser, so hands-free is off. You can still tap the mic.');
        this.stop();
        return;
      }
      const wait = this.rapid === 0 ? 120 : Math.min(15000, 400 * 2 ** this.rapid);
      this.timer = setTimeout(() => {
        if (!this.running) return;
        try { this._open(); } catch (_) { this.rapid++; this.timer = setTimeout(() => this.running && this._open(), 2000); }
      }, wait);
    };
    this.rec = rec;
    this.openedAt = Date.now();   // when it was asked to start: a session that never gets going counts as a short one
    rec.start();
  }

  /** In the app: one utterance at a time from the phone's recogniser, reopened as it ends. */
  async _openNative() {
    try {
      const said = await nativeListenOnce({}).promise;
      if (said && !this._deaf()) this._final(0, said, new Set());
      this.rapid = 0;
    } catch (e) {
      if (/not allowed|denied|permission/i.test(e.message)) { this.onError?.(e.message); this.stop(); return; }
      this.rapid++;
    }
    if (!this.running) return;
    this.timer = setTimeout(() => { if (this.running) this._openNative(); }, this.rapid > 3 ? 5000 : 300);
  }

  _interim(i, text, woken) {
    const cmd = afterWake(text);
    if (cmd !== null) {
      if (!woken.has(i)) {
        woken.add(i);
        this.armedUntil = Date.now() + 8000;
        this.onWake?.({ inline: !!cmd });          // the chime plays now, not after the sentence ends
      }
      if (cmd) this.onHeard?.(cmd);
    } else if (this.armed) {
      this.onHeard?.(text);
    }
  }

  _final(i, text, woken) {
    const cmd = afterWake(text);
    if (cmd !== null) {
      if (!woken.has(i)) this.onWake?.({ inline: !!cmd });
      if (cmd) { this.armedUntil = 0; this.onCommand?.(cmd); }
      else this.armedUntil = Date.now() + 8000;
      return;
    }
    if (this.armed) {
      this.armedUntil = 0;
      this.onCommand?.(text);
    }
  }
}

/* ------------------------------------------------------- the app's recogniser */

let nativeAllowed = null;

/** listenOnce, through @capacitor-community/speech-recognition. */
function nativeListenOnce({ onInterim } = {}) {
  let latest = '';
  let handles = [];
  let settle;
  const cleanup = () => { handles.forEach(h => h?.remove?.()); handles = []; };
  const promise = new Promise((resolve, reject) => {
    settle = (err) => { cleanup(); err ? reject(err) : resolve(latest.trim()); };
    (async () => {
      try {
        if (nativeAllowed !== true) {
          const p = await nativeSpeech.requestPermissions();
          nativeAllowed = p?.speechRecognition === 'granted';
          if (!nativeAllowed) throw new Error(friendly('not-allowed'));
        }
        handles.push(await nativeSpeech.addListener('partialResults', (r) => {
          latest = r?.matches?.[0] || latest;
          onInterim?.(latest.trim());
        }));
        handles.push(await nativeSpeech.addListener('listeningState', (r) => {
          if (r?.status === 'stopped') settle();
        }));
        const r = await nativeSpeech.start({ language: lang(), partialResults: true, popup: false, maxResults: 1 });
        // iOS (and some Android versions) hand the result back from start() itself.
        if (r?.matches?.[0]) { latest = r.matches[0]; settle(); }
      } catch (e) {
        settle(e instanceof Error ? e : new Error(String(e?.message || e)));
      }
    })();
  });
  return { promise, stop: () => { nativeSpeech.stop().catch(() => {}); } };
}
