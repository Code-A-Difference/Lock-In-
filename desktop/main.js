/**
 * LOCK IN! for Windows and Mac.
 *
 * Like the phone apps, the window loads LOCK IN! from the Code A Difference
 * site, so the app is always the latest version and the account is the same
 * everywhere. What the desktop shell adds (exposed to the page as
 * window.lockinDesktop by preload.js):
 *
 *  - transcription on this computer (whisper.cpp): private, free, no AI quota
 *  - a small floating window that stays on top of other apps while you work
 *  - recording the computer's own sound (an online class, a lecture video)
 *  - global shortcuts that work from any app, a tray icon, start with the computer
 *  - noticing a Zoom / Teams / browser call starting and offering to record it
 */
const {
  app, BrowserWindow, Menu, Tray, Notification, globalShortcut, ipcMain, nativeImage, screen, session, shell, desktopCapturer,
} = require('electron');
const fs = require('fs');
const path = require('path');
const whisper = require('./whisper');
const meetings = require('./meetings');

const SITE = process.env.LOCKIN_URL || 'https://codeadifference.ct.ws/lockin/';
const ORIGIN = new URL(SITE).origin;
const MINI = { width: 380, height: 600 };

// Computer-sound capture on a Mac goes through ScreenCaptureKit (macOS 13+).
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('ws.ct.codeadifference.lockin');

/* ------------------------------------------------------------- settings */

const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const DEFAULTS = {
  bounds: null, miniBounds: null, offerRecordCalls: true, toldAboutTray: false,
  transcription: { enabled: true, model: 'base', language: 'en' },
};
let settings = { ...DEFAULTS };
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...s, transcription: { ...DEFAULTS.transcription, ...(s.transcription || {}) } };
  } catch (_) { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {}
}

/* --------------------------------------------------------------- window */

let win = null;
let tray = null;
let mini = false;
let quitting = false;
let recording = false;

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow({ hidden = false } = {}) {
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1200, height: b.height || 820, x: b.x, y: b.y,
    minWidth: 340, minHeight: 420,
    show: false,
    title: 'LOCK IN!',
    backgroundColor: '#16181d',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,      // keep recording, timers and "Hey Lock In" running while it's in the background
      additionalArguments: [`--lockin-version=${app.getVersion()}`],
    },
  });
  win.removeMenu();
  win.loadURL(SITE);
  win.once('ready-to-show', () => { if (!hidden) win.show(); });

  // Only LOCK IN! itself loads inside the window; other links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: SITE } });
  });

  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    if (mini) settings.miniBounds = win.getBounds(); else settings.bounds = win.getBounds();
    saveSettings();
  };
  win.on('resized', remember);
  win.on('moved', remember);

  // Closing keeps LOCK IN! in the tray, so shortcuts, timers and recordings carry on.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!settings.toldAboutTray && Notification.isSupported()) {
      settings.toldAboutTray = true;
      saveSettings();
      new Notification({ title: 'LOCK IN! is still running', body: 'It’s in the tray, so your shortcuts and recordings keep working. Quit from the tray icon.' }).show();
    }
  });
}

/** The floating mini window: small, on top of everything, in the corner. */
function setMini(on) {
  if (!win || on === mini) { send('mini', mini); return; }
  if (on) {
    settings.bounds = win.getBounds();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const m = settings.miniBounds || { ...MINI, x: area.x + area.width - MINI.width - 16, y: area.y + area.height - MINI.height - 16 };
    mini = true;
    if (win.isMaximized()) win.unmaximize();
    win.setMinimumSize(300, 360);
    win.setBounds(m);
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    settings.miniBounds = win.getBounds();
    mini = false;
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
    win.setMinimumSize(340, 420);
    if (settings.bounds) win.setBounds(settings.bounds);
  }
  saveSettings();
  showWindow();
  send('mini', mini);
  updateTray();
}

/* ----------------------------------------------------------------- tray */

function appIcon(size) {
  return nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: size, height: size });
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(recording ? 'LOCK IN! — recording' : 'LOCK IN!');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open LOCK IN!', click: () => { setMini(false); showWindow(); } },
    { label: mini ? 'Full window' : 'Float on top (mini)', click: () => setMini(!mini) },
    { type: 'separator' },
    { label: recording ? 'Recording…' : 'Record a class', enabled: !recording, click: () => { showWindow(); send('command', { type: 'record' }); } },
    { label: 'Ask the assistant', click: () => { showWindow(); send('command', { type: 'assistant' }); } },
    { type: 'separator' },
    { label: 'Start with my computer', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => setLaunchAtLogin(i.checked) },
    { label: 'Offer to record calls and online classes', type: 'checkbox', checked: settings.offerRecordCalls, click: (i) => { settings.offerRecordCalls = i.checked; saveSettings(); } },
    { type: 'separator' },
    { label: 'Quit LOCK IN!', click: () => { quitting = true; app.quit(); } },
  ]));
}

function setLaunchAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'], openAsHidden: true });
  updateTray();
}

/* ------------------------------------------------------------ shortcuts */

const SHORTCUTS = [
  ['CommandOrControl+Shift+L', 'assistant', 'Open LOCK IN!’s assistant'],
  ['CommandOrControl+Shift+K', 'catchup', 'Catch me up on the class being recorded'],
  ['CommandOrControl+Shift+R', 'record', 'Start recording a class'],
];
function registerShortcuts() {
  for (const [accel, type] of SHORTCUTS) {
    globalShortcut.register(accel, () => {
      if (type === 'catchup' && !win.isVisible()) setMini(true); else showWindow();
      send('command', { type });
    });
  }
}

/* ---------------------------------------------------------- permissions */

function setupSession() {
  const ses = session.defaultSession;
  const ours = (url) => { try { return new URL(url).origin === ORIGIN; } catch (_) { return false; } };
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'display-capture', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.has(perm) && ours(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((_wc, perm, origin) => allowed.has(perm) && ours(origin));
  // "Record computer audio": the page asks for a display stream; hand it the
  // main screen plus the system's sound (the page keeps only the sound).
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const [src] = await desktopCapturer.getSources({ types: ['screen'] });
      cb(src ? { video: src, audio: 'loopback' } : {});
    } catch (_) { cb({}); }
  });
}

/* ------------------------------------------------------------------ IPC */

function wireIpc() {
  const tStatus = () => ({ ...whisper.status(), settings: settings.transcription });
  ipcMain.handle('whisper:status', () => tStatus());
  ipcMain.handle('whisper:set', (_e, patch = {}) => {
    const t = settings.transcription;
    if (typeof patch.enabled === 'boolean') t.enabled = patch.enabled;
    if (patch.model && whisper.MODELS[patch.model]) t.model = patch.model;
    if (typeof patch.language === 'string' && /^(auto|[a-z]{2})$/.test(patch.language)) t.language = patch.language;
    saveSettings();
    if (!t.enabled) whisper.stop();
    else if (whisper.status().models[t.model]?.installed) whisper.start(t.model).catch(() => {});
    return tStatus();
  });
  ipcMain.handle('whisper:download', async (_e, id) => {
    try { await whisper.ensureModel(id || settings.transcription.model); whisper.start(settings.transcription.model).catch(() => {}); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('whisper:transcribe', async (_e, wav, hint) => {
    const t = settings.transcription;
    if (!t.enabled) return { ok: false, error: 'off' };
    if (!whisper.status().models[t.model]?.installed) return { ok: false, error: 'no-model' };
    return whisper.transcribe(Buffer.from(wav), { model: t.model, language: t.language, hint });
  });
  whisper.onStatus(s => send('whisper:status', { ...s, settings: settings.transcription }));

  ipcMain.handle('mini:set', (_e, on) => { setMini(!!on); return mini; });
  ipcMain.handle('mini:get', () => mini);
  ipcMain.handle('login:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('login:set', (_e, on) => { setLaunchAtLogin(on); return app.getLoginItemSettings().openAtLogin; });
  ipcMain.handle('prefs:get', () => ({ offerRecordCalls: settings.offerRecordCalls, shortcuts: SHORTCUTS.map(([a, t, d]) => ({ keys: a.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl'), type: t, label: d })) }));
  ipcMain.handle('prefs:set', (_e, patch = {}) => {
    if (typeof patch.offerRecordCalls === 'boolean') settings.offerRecordCalls = patch.offerRecordCalls;
    saveSettings();
    updateTray();
    return { offerRecordCalls: settings.offerRecordCalls };
  });
  ipcMain.on('recording', (_e, on) => { recording = !!on; updateTray(); });
  ipcMain.on('show', () => showWindow());
}

/* ------------------------------------------------------------- meetings */

function watchCalls() {
  meetings.watch({
    onStart: (name) => {
      if (!settings.offerRecordCalls || recording || !Notification.isSupported()) return;
      const n = new Notification({ title: `A call started in ${name}`, body: 'Record it with LOCK IN! for a live transcript, quick catch-ups and notes. Click to start.' });
      n.on('click', () => { showWindow(); send('command', { type: 'record', source: 'both', app: name }); });
      n.show();
    },
  });
}

/* ---------------------------------------------------------------- start */

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); whisper.stop(); });
app.on('activate', () => showWindow());

app.whenReady().then(() => {
  loadSettings();
  setupSession();
  wireIpc();
  createWindow({ hidden: process.argv.includes('--hidden') });
  tray = new Tray(appIcon(process.platform === 'darwin' ? 18 : 16));
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  updateTray();
  registerShortcuts();
  watchCalls();
  // Warm the transcription engine so the first piece of a class isn't slow. The
  // first time, fetch the model in the background so it just works (57 MB).
  const t = settings.transcription;
  if (t.enabled && whisper.status().available) {
    whisper.ensureModel(t.model).then(() => whisper.start(t.model)).catch(() => {});
  }
});
