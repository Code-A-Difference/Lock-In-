/**
 * Running inside the LOCK IN! desktop app (Windows / Mac, desktop/ in this
 * repo) rather than a browser. The app's preload script puts
 * window.lockinDesktop on the page; in a browser it's absent and everything
 * here reports "not available".
 */
export const desktop = typeof window !== 'undefined' ? window.lockinDesktop || null : null;
export const isDesktop = !!desktop;

/** The newest desktop app. Older ones still work (the page is loaded live); this just offers the update. */
export const DESKTOP_VERSION = '1.0.1';
const REL = 'https://github.com/Code-A-Difference/Lock-In-/releases/download/desktop-v1.0.1';
export const DESKTOP_DOWNLOADS = {
  windows: `${REL}/LOCKIN-win-x64.exe`,
  macArm: `${REL}/LOCKIN-mac-arm64.dmg`,
  macIntel: `${REL}/LOCKIN-mac-x64.dmg`,
};

function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
export const desktopNeedsUpdate = isDesktop && newer(DESKTOP_VERSION, desktop.version);

/** What this computer is, for picking the right download. */
export function guessOS() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  return 'other';
}

/**
 * Transcribe one WAV piece on this computer. Resolves to the text, or null
 * when on-device transcription isn't set up (no model yet, switched off) so
 * the caller uses the online service instead. Throws on a real failure.
 */
export async function transcribeLocally(wav, hint) {
  if (!isDesktop) return null;
  const r = await desktop.transcribe(wav, hint);
  if (r?.ok) return r.text;
  if (r?.error === 'off' || r?.error === 'no-model') return null;
  throw new Error(r?.error || 'On-device transcription failed.');
}

if (isDesktop && typeof document !== 'undefined') {
  document.documentElement.classList.add('desktop-app', `desktop-${desktop.platform}`);
}
