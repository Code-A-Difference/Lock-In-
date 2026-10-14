/**
 * Whether "Hey Companion" is on, shared by Settings (where it is switched) and
 * the assistant (which listens). Kept per device, since it's about this
 * computer's or phone's microphone, and announced with an event so a change in
 * Settings reaches the assistant at once.
 */
import { useEffect, useState } from 'react';
import { WAKE_PHRASE } from './wake.js';
import { isNativeApp, platform } from './native.js';
import { installedApp, newer } from './releases.js';

const KEY = 'lockin.handsfree';                 // 'on' | 'off' | null (never decided)
const SNOOZE = 'lockin.handsfree.snooze';       // when "Not now" was last chosen
const EVENT = 'lockin:handsfree';
const SNOOZE_DAYS = 7;

export function readHandsFree() {
  try { return localStorage.getItem(KEY); } catch (_) { return null; }
}

export function setHandsFree(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (_) { /* private mode: this visit only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on ? 'on' : 'off' }));
}

/** 'on' | 'off' | null, kept current when Settings or the assistant changes it. */
export function useHandsFree() {
  const [pref, setPref] = useState(readHandsFree);
  useEffect(() => {
    const sync = () => setPref(readHandsFree());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return pref;
}

/** Should the assistant suggest turning it on? Not when it's on, and not for a week after "Not now". */
export function shouldSuggest(pref) {
  if (pref === 'on') return false;
  try {
    const at = Number(localStorage.getItem(SNOOZE) || 0);
    return Date.now() - at > SNOOZE_DAYS * 864e5;
  } catch (_) { return true; }
}

export function snoozeSuggestion() {
  try { localStorage.setItem(SNOOZE, String(Date.now())); } catch (_) { /* fine */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Training asks every listener to let go of the microphone, then to pick it up again. */
export const TRAINING_EVENT = 'lockin:voice-training';

/**
 * What to say. Android apps older than 1.3.2 listen for the old phrase in their own code,
 * so they're told the old phrase until they update.
 */
export function useWakePhrase() {
  const [phrase, setPhrase] = useState(WAKE_PHRASE);
  useEffect(() => {
    if (!isNativeApp || platform !== 'android') return;
    let live = true;
    installedApp().then((app) => { if (live && app?.version && newer('1.3.2', app.version)) setPhrase('Hey Lock In'); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return phrase;
}
