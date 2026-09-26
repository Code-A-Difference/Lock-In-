/**
 * Listening. Two ways, both built on the browser's SpeechRecognition:
 *
 *   listenOnce()  push-to-talk: press the mic, say one thing, done.
 *   HandsFree     always listening for "Hey Lock In" (or Ambient Voice
 *                 Study's "Companion"), then acts on what follows.
 *
 * Ambient Voice Study listened continuously from the moment you pressed start
 * and acted on anything that matched — so a classmate saying "stop" across the
 * room stopped your timer. Here hands-free is off until you turn it on, and
 * even then nothing happens without the wake phrase.
 *
 * Chrome and Edge send the audio to their own speech service to transcribe
 * it; Safari does it on the device. Settings says so where the switch is.
 */
import { afterWake } from './voiceCommands.js';

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const canListen = !!SR;

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
 * follows the wake phrase. "Hey Lock In" on its own arms it for a few seconds,
 * so "Hey Lock In … pause" works with a pause in between, the way people
 * actually talk to assistants.
 */
export class HandsFree {
  constructor({ onCommand, onWake, onState, onError } = {}) {
    this.onCommand = onCommand;
    this.onWake = onWake;
    this.onState = onState;
    this.onError = onError;
    this.running = false;
    this.armedUntil = 0;
    this.rec = null;
    this.restarts = 0;
  }

  start() {
    if (!SR || this.running) return false;
    this.running = true;
    this.restarts = 0;
    this._open();
    this.onState?.(true);
    return true;
  }

  stop() {
    this.running = false;
    this.armedUntil = 0;
    const r = this.rec;
    this.rec = null;
    if (r) { r.onend = null; try { r.abort(); } catch (_) {} }
    this.onState?.(false);
  }

  _open() {
    const rec = new SR();
    rec.lang = lang();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        this._heard(e.results[i][0].transcript);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.onError?.(friendly(e.error));
        this.stop();
      }
    };
    // Browsers end "continuous" recognition after a minute or so of quiet.
    // Reopen it, but back off if it keeps dying straight away (no network).
    rec.onend = () => {
      if (!this.running) return;
      this.restarts++;
      const wait = this.restarts > 5 ? 5000 : 250;
      setTimeout(() => {
        if (!this.running) return;
        try { this._open(); } catch (_) { this.stop(); }
      }, wait);
    };
    rec.onaudiostart = () => { this.restarts = 0; };
    this.rec = rec;
    rec.start();
  }

  _heard(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return;
    const cmd = afterWake(text);
    if (cmd !== null) {
      this.onWake?.({ inline: !!cmd });
      if (cmd) { this.armedUntil = 0; this.onCommand?.(cmd); }
      else this.armedUntil = Date.now() + 6000;
      return;
    }
    if (Date.now() < this.armedUntil) {
      this.armedUntil = 0;
      this.onCommand?.(text);
    }
  }
}
