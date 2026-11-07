/**
 * Choosing a microphone and checking it can hear the room, before a lecture
 * starts rather than after the first ten minutes turn out to be silence.
 *
 * Opening a stream is what asks for permission, so nothing here runs until
 * the person asks to check the microphone.
 */
import { micConstraints, classifyHearing } from './recorder.js';

const KEY = 'lockin.micId';

/** The microphone chosen last time on this device ('' = the default one). */
export function getMicPref() {
  try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; }
}
export function setMicPref(id) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (_) {}
}

/** The microphones on this device, [{ id, label }]. Names appear once the browser has been given access. */
export async function listMics() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch (_) { return []; }
}

/**
 * Listen on a microphone and report how loud the room is, about ten times a
 * second: onLevel(0..1, 'ok' | 'quiet' | 'silent'). Resolves { stop } once the
 * microphone is open; rejects with a message to show if it can't be.
 */
export async function startMicCheck({ deviceId = '', onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints({ deviceId }));
  } catch (e) {
    if (deviceId && /Overconstrained|NotFound/.test(e?.name || '')) stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    else throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it for LOCK IN!, then try again.' : 'No microphone could be opened.');
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const buf = new Float32Array(analyser.fftSize);
  const recent = [];
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const level = Math.sqrt(sum / buf.length);
    recent.push(level);
    if (recent.length > 40) recent.shift();                          // about the last four seconds
    const loud = [...recent].sort((a, b) => a - b)[Math.floor(recent.length * 0.9)] || 0;
    onLevel?.(Math.min(1, level * 6), classifyHearing(loud));
  }, 100);
  return {
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
