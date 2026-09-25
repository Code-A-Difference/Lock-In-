/**
 * Background sound for focus blocks, generated live with Web Audio — no
 * audio files, nothing to download, works offline.
 *
 * Ambient Voice Study had one sound: a low synth drone that started and
 * stopped abruptly. This keeps that drone (same oscillators) but lets its
 * filter drift slowly so it doesn't grate over a 50-minute block, and adds
 * the two sounds people actually study to most: rain and brown noise.
 * Everything fades in and out instead of cutting.
 */

export const SOUNDS = [
  { id: 'off', label: 'Off' },
  { id: 'rain', label: 'Rain' },
  { id: 'brown', label: 'Brown noise' },
  { id: 'drone', label: 'Deep drone' },
];

let ctx = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** A looping noise buffer: white, pink or brown. */
function noiseBuffer(c, color, seconds = 6) {
  const len = c.sampleRate * seconds;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else if (color === 'pink') {
        // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        d[i] = w;
      }
    }
    // crossfade the loop point so there is no click every few seconds
    const fade = Math.floor(c.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      d[i] = d[i] * g + d[len - fade + i] * (1 - g);
    }
  }
  return buf;
}

class Soundscape {
  constructor() {
    this.kind = 'off';
    this.volume = 0.5;
    this.master = null;
    this.parts = [];      // { stop(): void }
    this.timers = [];
  }

  _master(c) {
    if (!this.master) {
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.connect(c.destination);
    }
    return this.master;
  }

  _level() {
    // perceived loudness is roughly logarithmic; square keeps the low end usable
    return Math.max(0, Math.min(1, this.volume)) ** 2 * 0.6;
  }

  play(kind, volume = this.volume) {
    if (kind === 'off' || !kind) return this.stop();
    this.volume = volume;
    const c = audio();
    if (!c) return;
    const m = this._master(c);
    if (kind === this.kind && this.parts.length) {
      m.gain.setTargetAtTime(this._level(), c.currentTime, 0.2);
      return;
    }
    // fade the old sound out under the new one
    this._teardown(0.6);
    this.kind = kind;
    const bus = c.createGain();
    bus.gain.value = 1;
    bus.connect(m);
    if (kind === 'rain') this._rain(c, bus);
    else if (kind === 'brown') this._brown(c, bus);
    else if (kind === 'drone') this._drone(c, bus);
    this.parts.push({ stop: () => { try { bus.disconnect(); } catch (_) {} } });
    m.gain.cancelScheduledValues(c.currentTime);
    m.gain.setTargetAtTime(this._level(), c.currentTime, 0.8);   // ~2s fade in
  }

  setVolume(v) {
    this.volume = v;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.kind === 'off' ? 0 : this._level(), ctx.currentTime, 0.15);
  }

  /** Fade out and let it go quiet, keeping the kind so it can resume. */
  pause() {
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  }

  resume() {
    if (this.kind === 'off' || !this.parts.length) return;
    const c = audio();
    this.master.gain.setTargetAtTime(this._level(), c.currentTime, 0.6);
  }

  stop() {
    this._teardown(0.6);
    this.kind = 'off';
  }

  _teardown(fadeSeconds) {
    const parts = this.parts, timers = this.timers;
    this.parts = []; this.timers = [];
    timers.forEach(clearInterval);
    if (!parts.length) return;
    if (ctx && this.master) this.master.gain.setTargetAtTime(0, ctx.currentTime, fadeSeconds / 3);
    setTimeout(() => parts.forEach(p => p.stop()), fadeSeconds * 1000 + 50);
  }

  _loop(c, buf, dest) {
    const s = c.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.connect(dest);
    s.start();
    this.parts.push({ stop: () => { try { s.stop(); } catch (_) {} } });
    return s;
  }

  _brown(c, bus) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(bus);
    this._loop(c, noiseBuffer(c, 'brown'), lp);
  }

  _rain(c, bus) {
    // steady hiss
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const hiss = c.createGain(); hiss.gain.value = 0.55;
    hp.connect(lp); lp.connect(hiss); hiss.connect(bus);
    this._loop(c, noiseBuffer(c, 'pink'), hp);
    // low rumble underneath
    const rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 180;
    const rg = c.createGain(); rg.gain.value = 0.5;
    rl.connect(rg); rg.connect(bus);
    this._loop(c, noiseBuffer(c, 'brown'), rl);
    // individual drops on the window
    const white = noiseBuffer(c, 'white', 1);
    const drop = () => {
      const now = c.currentTime;
      const n = c.createBufferSource(); n.buffer = white;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 4200; bp.Q.value = 6;
      const g = c.createGain();
      const peak = 0.04 + Math.random() * 0.09;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06 + Math.random() * 0.08);
      n.connect(bp); bp.connect(g); g.connect(bus);
      n.start(now, Math.random() * 0.8, 0.2);
    };
    this.timers.push(setInterval(() => { if (Math.random() < 0.65) drop(); }, 45));
  }

  _drone(c, bus) {
    // Ambient Voice Study's pad: 55 Hz sub, two detuned 110 Hz voices, lowpassed
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 0.7;
    const pad = c.createGain(); pad.gain.value = 0.35;
    f.connect(pad); pad.connect(bus);
    const osc = (type, freq, gain) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = c.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(f); o.start();
      this.parts.push({ stop: () => { try { o.stop(); } catch (_) {} } });
      return o;
    };
    osc('sine', 55, 0.9);
    osc('sine', 110, 0.5);
    osc('triangle', 110.4, 0.35);
    osc('sine', 164.8, 0.12);            // a soft fifth, new
    // the original's breathing: a slow swell on the pad
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08;
    const depth = c.createGain(); depth.gain.value = 0.12;
    lfo.connect(depth); depth.connect(pad.gain); lfo.start();
    // new: the filter opens and closes over ~40 seconds, so it never sits still
    const sweep = c.createOscillator(); sweep.frequency.value = 0.025;
    const sd = c.createGain(); sd.gain.value = 140;
    sweep.connect(sd); sd.connect(f.frequency); sweep.start();
    this.parts.push({ stop: () => { try { lfo.stop(); sweep.stop(); } catch (_) {} } });
  }
}

export const soundscape = new Soundscape();

/**
 * Call from a click. Safari only lets audio start inside a user gesture, and
 * a phase change or a voice command later is not one, so the context is
 * opened while the user's click is still on the stack.
 */
export function unlockAudio() { audio(); }

/**
 * A short bell for phase changes. The original used a square-wave beep; a
 * struck-bell partial set is noticeable without being jarring.
 */
export function chime(kind = 'focusEnd', volume = 0.35) {
  const c = audio();
  if (!c) return;
  const notes = kind === 'breakEnd' ? [523.25, 783.99] : [783.99, 659.25];   // up to go, down to rest
  notes.forEach((freq, i) => {
    const t = c.currentTime + i * 0.22;
    [1, 2.76, 5.4].forEach((ratio, j) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq * ratio;
      const g = c.createGain();
      const peak = volume * [0.5, 0.18, 0.06][j];
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 - j * 0.4);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 1.7);
    });
  });
}
