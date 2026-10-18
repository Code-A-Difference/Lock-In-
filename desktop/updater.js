'use strict';
/**
 * Updating LOCK IN! from inside the app (Windows): no browser, no download page, no installer to click.
 * The page says which version it wants; this downloads that release's installer from GitHub, checks its
 * hash against the release's own latest.yml, quits, installs quietly over the old version and starts the
 * new one. It will not do this in the middle of a strict focus block.
 *
 * Macs can't update themselves this way without a paid Apple signing certificate, so they keep the
 * download button.
 */
const { app } = require('electron');

const REPO = 'https://github.com/Code-A-Difference/Lock-In-/releases/download';
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function createUpdater({ send, canInstall = () => true, prepareQuit = () => {}, feedFor = (v) => process.env.LOCKIN_UPDATE_FEED || `${REPO}/desktop-v${v}` }) {
  let autoUpdater = null;
  let busy = false;
  const emit = (s) => { try { send('update:state', s); } catch (_) { /* window gone */ } };

  function load() {
    if (autoUpdater) return autoUpdater;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('download-progress', (p) => emit({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent || 0))) }));
    autoUpdater.on('update-downloaded', () => {
      emit({ phase: 'installing' });
      setTimeout(() => {
        prepareQuit();
        autoUpdater.quitAndInstall(true, true);     // silent, and start the new version afterwards
      }, 900);
    });
    autoUpdater.on('error', (e) => { busy = false; emit({ phase: 'error', message: String((e && e.message) || e).slice(0, 200) }); });
    return autoUpdater;
  }

  /** Can this computer update itself? (Windows installs only.) */
  const supported = () => process.platform === 'win32' && (app.isPackaged || !!process.env.LOCKIN_UPDATE_FEED);

  async function install(version) {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    if (!VERSION_RE.test(String(version))) return { ok: false, reason: 'bad' };
    if (!canInstall()) return { ok: false, reason: 'strict' };
    if (busy) return { ok: true };
    busy = true;
    try {
      const u = load();
      u.setFeedURL({ provider: 'generic', url: feedFor(version) });
      const r = await u.checkForUpdates();
      if (!r || !r.isUpdateAvailable) { busy = false; return { ok: false, reason: 'none' }; }
      emit({ phase: 'downloading', percent: 0 });
      u.downloadUpdate().catch((e) => { busy = false; emit({ phase: 'error', message: String((e && e.message) || e).slice(0, 200) }); });
      return { ok: true };
    } catch (e) {
      busy = false;
      return { ok: false, reason: 'error', message: String((e && e.message) || e).slice(0, 200) };
    }
  }

  return { install, supported, VERSION_RE };
}

module.exports = { createUpdater };
