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
    version: '1.3.3',
    date: '2026-10-14',
    url: `${GH}/latest/download/LOCKIN-android.apk`,
    notes: [
      'Reminders before homework and tests are due, even when the app is closed. Turn them on in Settings → Reminders.',
      'Put your homework, tests and study plan in Google Calendar (Settings → Calendar).',
      'A Progress page, editable study plans with free time that repeats every week, and notes you can send to Google Docs, OneNote or Notion.',
    ],
  },
  desktop: {
    version: '1.0.5',
    date: '2026-10-14',
    urls: {
      windows: `${GH}/download/desktop-v1.0.5/LOCKIN-win-x64.exe`,
      macArm: `${GH}/download/desktop-v1.0.5/LOCKIN-mac-arm64.dmg`,
      macIntel: `${GH}/download/desktop-v1.0.5/LOCKIN-mac-x64.dmg`,
    },
    notes: [
      'Float on top is now a small bar that stays over every app, full-screen ones too: your recording or focus timer, with pause, stop and a button back to the full window. Drag it anywhere; it stays that small.',
      'Settings is organised into a short menu, like a phone’s.',
      'Reminders before homework and tests are due, and your deadlines in Google Calendar.',
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
