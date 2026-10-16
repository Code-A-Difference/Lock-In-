/**
 * The newest Android and desktop apps, and what's new in them.
 *
 * Both apps load this web app live from the site, so the moment the site is
 * deployed every installed copy knows about a new release: UpdatePrompt
 * compares the version it's running in against these and, if it's older,
 * shows "An update is available" with the notes below and a download button.
 *
 * Releasing a new app version? Update it here (and deploy the site), see
 * RELEASING.md. Notes are for students, not developers: what they'll notice.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const GH = 'https://github.com/Code-A-Difference/Lock-In-/releases';

export const RELEASES = {
  android: {
    version: '1.3.5',
    date: '2026-10-16',
    url: `${GH}/latest/download/LOCKIN-android.apk`,
    notes: [
      'Optional: lock your phone while you lock in on your computer, or the other way round (Settings → Strict focus). You agree to a short notice first and choose the permissions. Calls, texts and emergency apps are never blocked.',
      'Strict focus: a focus block that can’t be paused, with approved sites only. You can still end it early after a short wait.',
      'While LOCK IN! works on your answer it now shows playful words (Pondering, Mustering, Consulting the Force…) instead of plain “Thinking…”.',
      'Reminders before homework and tests are due, even when the app is closed. Turn them on in Settings → Reminders.',
      'Put your homework, tests and study plan in Google Calendar (Settings → Calendar).',
    ],
  },
  desktop: {
    version: '1.0.11',
    date: '2026-10-16',
    urls: {
      windows: `${GH}/download/desktop-v1.0.11/LOCKIN-win-x64.exe`,
      macArm: `${GH}/download/desktop-v1.0.11/LOCKIN-mac-arm64.dmg`,
      macIntel: `${GH}/download/desktop-v1.0.11/LOCKIN-mac-x64.dmg`,
    },
    notes: [
      'Optional: lock your other device too. Start a strict block on your computer and your phone locks, or the other way round (Settings → Strict focus). You agree to a short notice first. Ending it from either device ends it for both.',
      'Strict focus now also minimises browsers, chat and games that come to the front during a block (you can edit the list in Settings → Strict focus). Nothing is closed, so no work is lost.',
      'Strict focus: during a strict block, links that are not on your approved list are blocked, and approved ones open in a separate Approved sites window that can only visit those sites. The block survives a restart and quitting LOCK IN! goes through the same short wait as ending early.',
      'Click the little floating bar to open LOCK IN! again. LOCK IN! now stays in your taskbar while the bar floats, and clicking it there brings the full window back.',
      'Music: search suggestions as you type, a song position bar you can drag to skip ahead, and Skip always finds the next song.',
      'Say “float on top” and the timer becomes the tiny floating bar.',
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
