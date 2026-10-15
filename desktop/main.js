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
const FLOAT = { width: 130, height: 36 };   // the floating bar starts as a tiny timer pill and is sized to its content by the bar itself

// Computer-sound capture on a Mac goes through ScreenCaptureKit (macOS 13+).
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// A second copy for testing (LOCKIN_USER_DATA=<folder>) keeps its own settings and runs alongside the real one.
if (process.env.LOCKIN_USER_DATA) app.setPath('userData', process.env.LOCKIN_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('ws.ct.codeadifference.lockin');

/* ------------------------------------------------------------- settings */

const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const DEFAULTS = {
  bounds: null, floatPos: null, floatAnchor: null, offerRecordCalls: true, toldAboutTray: false,
  // turbo (Whisper large-v3 turbo) is the goal; base works while it downloads (see warmUp)
  transcription: { enabled: true, model: 'turbo', language: 'en' },
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

/**
 * Saved bounds, if a screen that's connected now still shows a good part of them. A window
 * last left on a monitor that has since been unplugged (or a laptop off its dock) would
 * otherwise open where nobody can see it, which looks exactly like the app not opening.
 */
function visibleBounds(b) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
  const seen = screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return w >= 200 && h >= 120;
  });
  return seen ? b : null;
}

/** Move the window onto the screen the mouse is on, if it isn't on any screen now. */
function bringOnScreen() {
  if (!win || win.isDestroyed() || visibleBounds(win.getBounds())) return;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { width, height } = win.getBounds();
  const w = Math.min(width, area.width), h = Math.min(height, area.height);
  win.setBounds({ x: Math.round(area.x + (area.width - w) / 2), y: Math.round(area.y + (area.height - h) / 2), width: w, height: h });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  bringOnScreen();
  win.show();
  win.focus();
}

function createWindow({ hidden = false } = {}) {
  const b = visibleBounds(settings.bounds) || { width: settings.bounds?.width, height: settings.bounds?.height };
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
  win.once('ready-to-show', () => { if (!hidden) showWindow(); });
  // The site can stall (a slow network, the host's browser check): after 30 s of nothing,
  // show the page that says so and has a Try again button, rather than a blank window.
  const stalled = setTimeout(() => {
    if (win && !win.isDestroyed() && win.webContents.isLoading()) {
      win.webContents.stop();
      win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: SITE } });
      if (!hidden) showWindow();
    }
  }, 30000);
  win.webContents.once('did-finish-load', () => clearTimeout(stalled));
  screen.on('display-removed', bringOnScreen);
  screen.on('display-metrics-changed', bringOnScreen);

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
    if (!mini) settings.bounds = win.getBounds();       // the floating bar keeps its own position
    saveSettings();
  };
  win.on('resized', remember);
  win.on('moved', remember);
  // coming back from the taskbar (or the tray) means the full window again, so the little bar goes away
  win.on('restore', () => { if (mini) setMini(false); });

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

/**
 * Float on top: a small bar over every app (and over full-screen ones) with what's
 * running, a recording or a focus block, and its buttons. It used to be the whole
 * app squeezed into a corner, which a maximized window could blow back up to full
 * size. Now it's its own little window: the main one hides, and keeps recording and
 * timing behind it; the bar shows what the main window reports and sends its
 * buttons back. Only where it sits is remembered, never a size.
 */
let floatWin = null;
let lastState = { recording: null, focus: null, music: null };

function floatPosition() {
  const a = settings.floatAnchor;            // where the pill's right edge sits: it grows and shrinks leftwards
  if (a && visibleBounds({ x: a.right - FLOAT.width, y: a.y, width: FLOAT.width, height: FLOAT.height })) return { x: a.right - FLOAT.width, y: a.y };
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return { x: area.x + area.width - FLOAT.width - 16, y: area.y + area.height - FLOAT.height - 16 };
}

function setMini(on) {
  if (!win || on === mini) { send('mini', false); return; }
  mini = on;
  if (on) {
    const { x, y } = floatPosition();
    floatWin = new BrowserWindow({
      x, y, width: FLOAT.width, height: FLOAT.height, minWidth: 60, minHeight: 28, useContentSize: true,
      frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, title: 'LOCK IN!',
      webPreferences: { preload: path.join(__dirname, 'mini-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // above everything, full-screen apps and presentations included
    floatWin.setAlwaysOnTop(true, 'screen-saver');
    floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    floatWin.loadFile(path.join(__dirname, 'mini.html'));
    floatWin.once('ready-to-show', () => {
      floatWin.webContents.send('floating:state', lastState);
      floatWin.showInactive();                       // doesn't take the keyboard from the app you're in
    });
    floatWin.on('moved', () => {
      if (!floatWin) return;
      const b = floatWin.getBounds();
      settings.floatAnchor = { right: b.x + b.width, y: b.y };
      saveSettings();
    });
    floatWin.on('closed', () => { floatWin = null; if (mini) setMini(false); });
    // minimised, not hidden: LOCK IN! stays in the taskbar, and clicking it there brings the full window back
    win.minimize();
  } else {
    const f = floatWin;
    floatWin = null;
    if (f && !f.isDestroyed()) f.destroy();
    showWindow();
  }
  send('mini', false);                               // the page itself is never "the mini window" any more
  updateTray();
}

/* ----------------------------------------------------------------- tray */

function appIcon(size) {
  return nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: size, height: size });
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(recording ? 'LOCK IN!, recording' : 'LOCK IN!');
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
  ['CommandOrControl+Alt+R', 'record', 'Start recording a class'],
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
    if (patch.model && whisper.MODELS[patch.model]) { t.model = patch.model; t.chosen = true; }   // their choice: no more auto-switching
    if (typeof patch.language === 'string' && /^(auto|[a-z]{2})$/.test(patch.language)) t.language = patch.language;
    saveSettings();
    if (!t.enabled) whisper.stop();
    else if (whisper.status().models[t.model]?.installed) whisper.start(t.model).catch(() => {});
    else warmUp().catch(() => {});
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
    const r = await whisper.transcribe(Buffer.from(wav), { model: t.model, language: t.language, hint });
    if (r.ok) autoTune();
    return r;
  });
  // "Hey Lock In" and the assistant: a short phrase that needs an answer now (see earModel)
  ipcMain.handle('whisper:hear', async (_e, wav, hint) => {
    const t = settings.transcription;
    if (!t.enabled) return { ok: false, error: 'off' };
    const model = earModel();
    if (!model) return { ok: false, error: 'no-model' };
    return whisper.transcribe(Buffer.from(wav), { model, language: t.language, hint, lane: model === t.model ? 'notes' : 'ear' });
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
  // the page tells the floating bar what's running; the bar's buttons come back as commands
  ipcMain.on('floating:report', (_e, state) => {
    lastState = state && typeof state === 'object' ? state : lastState;
    if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send('floating:state', lastState);
  });
  // dragging the pill: the bar moves itself (a drag region would swallow the click that opens the app)
  ipcMain.on('floating:move', (_e, dx, dy) => {
    if (!floatWin || floatWin.isDestroyed()) return;
    dx = Math.round(Number(dx) || 0); dy = Math.round(Number(dy) || 0);
    if (!dx && !dy) return;
    const [x, y] = floatWin.getPosition();
    floatWin.setPosition(x + dx, y + dy);
  });
  ipcMain.on('floating:drop', () => {
    if (!floatWin || floatWin.isDestroyed()) return;
    const b = floatWin.getBounds();
    settings.floatAnchor = { right: b.x + b.width, y: b.y };
    saveSettings();
  });
  // the bar is only as wide as its pill; it grows and shrinks leftwards, so its right edge stays where it was put
  ipcMain.on('floating:size', (_e, w, h) => {
    if (!floatWin || floatWin.isDestroyed()) return;
    w = Math.max(60, Math.min(520, Math.round(Number(w) || 0)));
    h = Math.max(28, Math.min(60, Math.round(Number(h) || 0)));
    const b = floatWin.getBounds();
    if (b.width === w && b.height === h) return;
    const area = screen.getDisplayMatching(b).workArea;
    const x = Math.max(area.x, Math.min(b.x + b.width - w, area.x + area.width - w));
    floatWin.setBounds({ x, y: b.y, width: w, height: h });
  });
  ipcMain.on('floating:act', (_e, action) => {
    if (action === 'expand') { setMini(false); return; }
    if (action === 'assistant') { setMini(false); send('command', { type: 'assistant' }); return; }
    if (['focus-toggle', 'record-pause', 'record-resume', 'record-stop', 'music-toggle', 'music-next', 'music-previous'].includes(action)) send('command', { type: action });
  });
}

/**
 * Whisper large-v3 turbo is used for everything, classes, "Hey Lock In" and
 * the assistant, unless the student chose a model themselves, or this
 * computer has shown it can't keep up with turbo live (over 0.8 s of work per
 * second of class). Then it steps down to small, and from small to base.
 */
let tuning = false;
function autoTune() {
  const t = settings.transcription;
  if (t.chosen || tuning) return;
  const fast = (id) => { const s = whisper.speed(id); return s && s.n >= 3 ? s.rtf : null; };
  const down = { turbo: 'small', small: 'base' }[t.model];
  if (down && fast(t.model) > 0.8) {
    if (t.model === 'turbo') t.turboSlow = true;          // don't climb back up on this computer
    tuning = true;
    whisper.ensureModel(down)
      .then(() => { t.model = down; saveSettings(); return whisper.start(down); })
      .catch(() => {})
      .finally(() => { tuning = false; });
  }
}

/**
 * What hears "Hey Lock In" and the assistant. Turbo too, when this computer
 * does a 15-second piece of class in under about 2 s (a fast processor, or
 * Apple's GPU), then a phrase is understood in about 2 s. Otherwise small:
 * measured on a Ryzen 7 laptop on battery, turbo took 5-6 s per phrase, small
 * about 1 s, and small still caught "Hey Lock In" every time.
 */
function earModel() {
  const t = settings.transcription;
  const have = (id) => whisper.status().models[id]?.installed;
  const s = whisper.speed(t.model);
  if (have(t.model) && (t.model !== 'turbo' || (s && s.n >= 3 && s.rtf <= 0.15))) return t.model;
  return ['small', 'base', t.model].find(have) || null;
}

/** The model to aim for: turbo, unless they chose one or turbo proved too slow here. */
function goal() {
  const t = settings.transcription;
  if (t.chosen) return t.model;
  return t.turboSlow ? (t.model === 'base' ? 'base' : 'small') : 'turbo';
}

/**
 * Start listening straight away with a model that's already here (or the
 * 57 MB fast one), and fetch the goal model (547 MB for turbo) behind it,
 * switching over when it arrives.
 */
async function warmUp() {
  const t = settings.transcription;
  if (!t.enabled || !whisper.status().available) return;
  const want = goal();
  const have = (id) => whisper.status().models[id]?.installed;
  if (have(want)) {
    t.model = want;
    saveSettings();
    await whisper.start(want);
    if (want === 'turbo') await whisper.ensureModel('small');   // the ear, on computers turbo is slow on
    return;
  }
  // small (190 MB) first: it hears "Hey Lock In" on most computers, and takes notes until turbo arrives
  const now = want === 'base' ? 'base' : 'small';
  await whisper.ensureModel(now);
  t.model = now;
  saveSettings();
  await whisper.start(now);
  await whisper.ensureModel(want);
  if (settings.transcription.chosen && settings.transcription.model !== want) return;   // they picked another meanwhile
  t.model = want;
  saveSettings();
  await whisper.start(want);
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
  // Warm the transcription engine so the first piece of a class (and the first
  // "Hey Lock In") isn't slow, fetching turbo in the background the first time.
  warmUp().catch(() => {});
});
