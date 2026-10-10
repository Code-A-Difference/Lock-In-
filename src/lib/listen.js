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
 * In the desktop app both go through Whisper on the computer instead
 * (localEar.js), once its model is downloaded.
 */
import { afterWake } from './wake.js';
import { nativeSpeech, wakeWord } from './native.js';
import { canHearLocally, localReady, LocalEar, hearLocally, listenOnceLocally } from './localEar.js';

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const canListen = !!SR || !!nativeSpeech || canHearLocally;

/** Hands-free "Hey Lock In": the browser's recogniser on the web, the on-device wake-word model on Android, Whisper on the desktop. */
export const canHandsFree = !!wakeWord || (!!SR && !nativeSpeech) || canHearLocally;

/** Wait for a promise, but hand back a stop() that works before it settles. */
function deferredListen(choose) {
  let inner = null, stopped = false;
  const promise = choose().then((l) => { inner = l; if (stopped) l.stop(); return l.promise; });
  return { promise, stop: () => { stopped = true; inner?.stop(); } };
}

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
export function listenOnce({ onInterim, onSpeech, recognition, pauseMs = 1600, quietMs = 8000 } = {}) {
  const Rec = recognition || SR;
  if (nativeSpeech && !recognition && !canHearLocally) return nativeListenOnce({ onInterim, onSpeech });
  if (canHearLocally && !recognition) {
    return deferredListen(() => localReady().then(ok => (ok
      ? listenOnceLocally({ onInterim, onSpeech, quietMs })
      : nativeSpeech ? nativeListenOnce({ onInterim, onSpeech })
      : SR ? listenOnce({ onInterim, onSpeech, recognition: SR, pauseMs, quietMs })
        : { promise: Promise.reject(new Error('Turn on on-device transcription in Settings to talk to Lock In.')), stop() {} })));
  }
  if (!Rec) {
    return { promise: Promise.reject(new Error('This browser cannot listen. Chrome, Edge and Safari can.')), stop() {} };
  }
  // Non-continuous recognition ends at the first breath, and whatever was still
  // "interim" at that moment was thrown away: you'd see your whole sentence on
  // screen and only half of it was sent. Now it keeps listening until you've
  // been quiet for `pauseMs`, and everything it showed you is what it sends.
  const rec = new Rec();
  rec.lang = lang();
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;

  const finals = new Map();        // result index -> text, so a revised result replaces rather than repeats
  let interim = '';
  let failed = null;
  let timer = null;
  let ended = false;
  const text = () => [...finals.values(), interim].join(' ').replace(/\s+/g, ' ').trim();
  const finish = () => { if (!ended) { ended = true; clearTimeout(timer); try { rec.stop(); } catch (_) {} } };
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(finish, ms); };

  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.set(i, r[0].transcript.trim());
        else interim += ` ${r[0].transcript}`;
      }
      onInterim?.(text());
      arm(pauseMs);
    };
    rec.onspeechstart = () => { onSpeech?.(true); arm(pauseMs * 3); };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') failed = e.error; };
    rec.onend = () => {
      clearTimeout(timer);
      ended = true;
      onSpeech?.(false);
      const said = text();
      if (failed && !said) reject(new Error(friendly(failed)));
      else resolve(said);                    // the interim words count too: they were on screen
    };
  });
  try { rec.start(); } catch (e) { return { promise: Promise.reject(e), stop() {} }; }
  arm(quietMs);                              // nobody said anything at all
  return { promise, stop: finish };
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
  constructor({ onCommand, onWake, onState, onError, onHeard, onNote, recognition } = {}) {
    // In the Android app the web view may expose a speech API that doesn't really work; the
    // on-device model is what hands-free uses there.
    this.SR = recognition || (wakeWord ? null : SR);
    this.onNote = onNote;                    // progress of the wake-word model's first download
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
    // desktop: Whisper on this computer, if it's set up. (On Android the always-on part stays
    // with the small wake-word model; Whisper hears what's said after it — see _runNative.)
    this.local = !recognition && canHearLocally && !wakeWord;
  }

  get armed() { return Date.now() < this.armedUntil; }

  start() {
    if ((!this.SR && !wakeWord && !this.local) || this.running) return false;
    this.running = true;
    this.rapid = 0;
    if (this.local) this._runLocal();
    else this._open();
    this.onState?.(true);
    return true;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.flushTimer);
    this.buffer = '';
    this.collecting = false;
    this._wakeOutcome?.('stopped');
    if (wakeWord && !this.SR) wakeWord.stop().catch(() => {});
    this.ear?.stop();
    this.ear = null;
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
    if (!this.SR && wakeWord) { this._runNative(); return; }
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

  /**
   * Android: the on-device model waits silently for the wake phrase and stops
   * itself when it hears it. Then the phone's own recogniser (which beeps, once,
   * which is fine now) takes the command, the answer is spoken, and the
   * conversation carries on until two quiet turns, when it goes back to waiting.
   */
  async _runNative() {
    const handles = [];
    try {
      handles.push(await wakeWord.addListener('wake', () => this._wakeOutcome?.('wake')));
      handles.push(await wakeWord.addListener('error', (e) => this._wakeOutcome?.({ error: e?.message || 'Wake-word listening failed.' })));
      handles.push(await wakeWord.addListener('state', (s) => this.onNote?.(s)));
      let failures = 0;
      while (this.running) {
        const outcome = new Promise((resolve) => { this._wakeOutcome = resolve; });
        try { await wakeWord.start(); } catch (e) { this.onError?.(e?.message || String(e)); this.stop(); break; }
        const r = await outcome;
        this._wakeOutcome = null;
        if (!this.running) break;
        if (r && r.error) {
          if (++failures >= 3) { this.onError?.(r.error); this.stop(); break; }
          await new Promise(res => setTimeout(res, 1500 * failures));
          continue;
        }
        failures = 0;
        this.onWake?.({ inline: false });
        await new Promise(res => setTimeout(res, 200));        // the mic is released; the blip plays
        let quiet = 0;
        while (this.running && quiet < 2) {
          let said = '';
          // Whisper on the phone when it's set up: no beep, nothing sent to Google
          const once = (await localReady()) ? listenOnceLocally : nativeListenOnce;
          try { said = await once({ onInterim: (t) => this.onHeard?.(t) }).promise; }
          catch (e) { this.onError?.(e?.message || String(e)); this.stop(); break; }
          if (!this.running) break;
          if (!said) { quiet++; continue; }
          quiet = 0;
          await this.onCommand?.(said);                         // answered and spoken before it returns
        }
      }
    } catch (e) {
      this.onError?.(`Hands-free couldn't start: ${e?.message || e}`);
      this.stop();
    } finally {
      handles.forEach(h => h?.remove?.());
      this._wakeOutcome = null;
    }
  }

  /**
   * Desktop: the microphone is cut into utterances and each is transcribed by
   * Whisper on this computer, then handled exactly like a recogniser's final
   * result. If the engine isn't set up (switched off, no model yet), the
   * browser's recogniser is used as before.
   */
  async _runLocal() {
    if (!(await localReady())) {
      this.local = false;
      if (!this.running) return;
      if (this.SR) this._open();
      else { this.onError?.('Hands-free needs on-device transcription: download a model in Settings.'); this.stop(); }
      return;
    }
    if (!this.running) return;
    this.pauseMs = 300;                    // an utterance arrives already finished: no need to wait for more
    let seq = 0, queue = Promise.resolve(), failures = 0;
    const woken = new Set();
    this.ear = new LocalEar({
      // The first ~1.3 s of speech: if it's "Hey Lock In", chime now, while they're still talking.
      onPeek: (pcm) => {
        if (this._deaf() || this.collecting || this.armed) return;
        const i = seq;
        hearLocally(pcm).then((text) => {
          if (!this.running || woken.has(i) || this.collecting || afterWake(text) === null) return;
          woken.add(i);
          this.armedUntil = Date.now() + 8000;
          this.onWake?.({ inline: true });
        }).catch(() => {});
      },
      onUtterance: (pcm) => {
        if (this._deaf()) return;           // the assistant talking, or its echo
        const i = seq++;
        queue = queue.then(async () => {
          if (!this.running) return;
          let text = '';
          try { text = await hearLocally(pcm); failures = 0; }
          catch (e) {
            if (e.off || ++failures >= 3) { this.onError?.(e.off ? 'On-device listening was switched off.' : e.message); this.stop(); }
            return;
          }
          if (text && this.running && !this._deaf()) this._final(i, text, woken);
        });
      },
    });
    try { await this.ear.start(); }
    catch (e) { this.onError?.(e.message); this.stop(); }
  }

  /*
   * A long sentence reaches us as several "final" pieces. The old code sent the
   * first piece as the command and dropped the rest, which is why it showed
   * everything you said but acted on half of it. Now every piece after the wake
   * phrase is collected, and the whole thing is sent once you pause.
   */
  _collect(piece, interim = '') {
    if (piece) this.buffer = `${this.buffer || ''} ${piece}`.replace(/\s+/g, ' ').trim();
    this.collecting = true;
    const live = `${this.buffer || ''} ${interim}`.trim();
    if (live) this.onHeard?.(live);
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this._flush(), interim ? this.pauseMs * 2 : this.pauseMs);
  }

  _flush() {
    clearTimeout(this.flushTimer);
    const said = (this.buffer || '').trim();
    this.buffer = '';
    this.collecting = false;
    if (said) { this.armedUntil = 0; this.onCommand?.(said); }
    else this.armedUntil = Date.now() + 8000;        // the wake phrase alone: wait for the request
  }

  get pauseMs() { return this._pauseMs || 1000; }
  set pauseMs(v) { this._pauseMs = v; }

  _interim(i, text, woken) {
    const cmd = afterWake(text);
    if (cmd !== null) {
      if (!woken.has(i) && !this.collecting) {
        woken.add(i);
        this.armedUntil = Date.now() + 8000;
        this.onWake?.({ inline: !!cmd });          // the chime plays now, not after the sentence ends
      }
      woken.add(i);
      this._collect('', cmd);
    } else if (this.collecting || this.armed) {
      this._collect('', text);
    }
  }

  _final(i, text, woken) {
    const cmd = afterWake(text);
    if (cmd !== null) {
      if (!woken.has(i) && !this.collecting) this.onWake?.({ inline: !!cmd });
      this._collect(cmd);
      return;
    }
    if (this.collecting || this.armed) this._collect(text);
  }
}

/* ------------------------------------------------------- the app's recogniser */

let nativeAllowed = null;

/** listenOnce, through @capacitor-community/speech-recognition. */
function nativeListenOnce({ onInterim, onSpeech } = {}) {
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
          if (!latest) onSpeech?.(true);
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
