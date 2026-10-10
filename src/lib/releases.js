/**
 * The newest Android and desktop apps, and what's new in them.
 *
 * Both apps load this web app live from the site, so the moment the site is
 * deployed every installed copy knows about a new release: UpdatePrompt
 * compares the version it's running in against these and, if it's older,
 * shows "An update is available" with the notes below and a download button.
 *
 * Releasing a new app version? Update it here (and deploy the site) — see
 * RELEASING.md. Notes are for students, not developers: what they'll notice.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const GH = 'https://github.com/Code-A-Difference/Lock-In-/releases';

export const RELEASES = {
  android: {
    version: '1.3.0',
    date: '2026-10-09',
    url: `${GH}/latest/download/LOCKIN-android.apk`,
    notes: [
      'Speech is understood on your phone with Whisper — what you say to the assistant and your class recordings no longer go to Google, and work without a connection. Choose the model in Settings → This phone.',
      '“Hey Lock In” answers the moment you say it, with a chime and a glow around the screen, instead of after a pause.',
      'Asking the assistant something by voice no longer makes the phone beep.',
    ],
  },
  desktop: {
    version: '1.0.2',
    date: '2026-10-09',
    urls: {
      windows: `${GH}/download/desktop-v1.0.2/LOCKIN-win-x64.exe`,
      macArm: `${GH}/download/desktop-v1.0.2/LOCKIN-mac-arm64.dmg`,
      macIntel: `${GH}/download/desktop-v1.0.2/LOCKIN-mac-x64.dmg`,
    },
    notes: [
      'Classes are transcribed with Whisper large-v3 turbo, the most accurate model, on computers fast enough for it (it steps down by itself if yours isn’t).',
      '“Hey Lock In” and the assistant now listen on your computer too — nothing is sent anywhere — and answer in about a second.',
      'A chime and a glow around the screen the moment it hears you.',
    ],
  },
};

/** Is version a newer than b? ("1.10.0" > "1.9.2") */
export function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

/**
 * Which app this page is running in, and its version: { kind: 'android'|'desktop', version }
 * or null in a browser. Android apps before 1.3.0 can't say their version, so it's
 * worked out from the speech plugins they shipped with.
 */
export async function installedApp() {
  if (typeof window !== 'undefined' && window.lockinDesktop) return { kind: 'desktop', version: window.lockinDesktop.version || '1.0.0' };
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  if (Capacitor.isPluginAvailable('App')) {
    try { const info = await registerPlugin('App').getInfo(); if (info?.version) return { kind: 'android', version: info.version }; } catch (_) { /* fall through */ }
  }
  return { kind: 'android', version: Capacitor.isPluginAvailable('Whisper') ? '1.3.0' : Capacitor.isPluginAvailable('WakeWord') ? '1.2.0' : '1.1.0' };
}

/** The download for this computer. */
export function desktopDownload(platform, arch) {
  const u = RELEASES.desktop.urls;
  if (platform === 'darwin') return arch === 'x64' ? u.macIntel : u.macArm;
  return u.windows;
}
