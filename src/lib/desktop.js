/**
 * Running inside the LOCK IN! desktop app (Windows / Mac, desktop/ in this
 * repo) rather than a browser. The app's preload script puts
 * window.lockinDesktop on the page; in a browser it's absent and everything
 * here reports "not available".
 */
import { RELEASES, newer } from './releases.js';

export const desktop = typeof window !== 'undefined' ? window.lockinDesktop || null : null;
export const isDesktop = !!desktop;

/** The newest desktop app (lib/releases.js). Older ones still work (the page is loaded live); UpdatePrompt offers the update. */
export const DESKTOP_VERSION = RELEASES.desktop.version;
export const DESKTOP_DOWNLOADS = RELEASES.desktop.urls;
export const desktopNeedsUpdate = isDesktop && newer(DESKTOP_VERSION, desktop.version);

/** What this computer is, for picking the right download. */
export function guessOS() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  return 'other';
}

/**
 * Transcribe one WAV piece on this device (computer or Android phone). Resolves to the text, or null
 * when on-device transcription isn't set up (no model yet, switched off) so
 * the caller uses the online service instead. Throws on a real failure.
 */
export async function transcribeLocally(wav, hint) {
  // the desktop app's engine, or whisper.cpp in the Android app (localEar.js)
  const { transcribeOnDevice } = await import('./localEar.js');
  return transcribeOnDevice(wav, hint);
}

if (isDesktop && typeof document !== 'undefined') {
  document.documentElement.classList.add('desktop-app', `desktop-${desktop.platform}`);
}
