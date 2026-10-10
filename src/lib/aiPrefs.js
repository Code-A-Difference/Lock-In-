/**
 * How far the AI may go beyond the student's own material.
 *
 * Off (the default): answers and notes come only from the transcript, the
 * student's notes and their slides. On: the AI may add background it knows,
 * always marked as going beyond the lecture. One switch, shared by the
 * assistant bar and note writing, remembered on this device.
 */
import { useEffect, useState } from 'react';

const KEY = 'lockin.ai.outside';
const listeners = new Set();

export function allowOutside() {
  try { return localStorage.getItem(KEY) === 'on'; } catch (_) { return false; }
}

export function setAllowOutside(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (_) { /* this session only */ }
  listeners.forEach(f => f(!!on));
}

export function useAllowOutside() {
  const [on, setOn] = useState(allowOutside);
  useEffect(() => { listeners.add(setOn); return () => listeners.delete(setOn); }, []);
  return [on, setAllowOutside];
}
