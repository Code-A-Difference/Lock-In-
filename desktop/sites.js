'use strict';
/**
 * The approved-sites window: during a strict block this is the only place in LOCK IN! to browse.
 * The page itself is a separate view with no preload and its own saved sign-in (so Google stays
 * signed in between blocks), and every request, redirect, new window and download is checked against
 * the block's list in main. The little bar on top can only pick from approved sites; there is no
 * address box. Nothing here exists outside a strict block.
 */
const { BrowserWindow, WebContentsView, session, ipcMain } = require('electron');
const path = require('path');

const BAR = 56;
const PARTITION = 'persist:lockin-strict';

function createSites({ strict, onBlocked = () => {} }) {
  let w = null;
  let view = null;
  let wired = false;
  const lastReport = new Map();

  const report = (kind, host) => {
    const key = `${kind}:${host}`;
    const t = Date.now();
    if (t - (lastReport.get(key) || 0) < 4000) return;
    lastReport.set(key, t);
    strict.noteBlocked();
    try { onBlocked({ kind, host }); } catch (_) { /* a listener's problem */ }
  };
  const hostOf = (url) => { try { return new URL(url).hostname; } catch (_) { return ''; } };

  function wireSession() {
    if (wired) return;
    wired = true;
    const ses = session.fromPartition(PARTITION);
    // every request: pages and frames must be approved; scripts, images and fonts may also come from helper hosts
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
      if (!strict.active()) return cb({ cancel: true });
      const host = hostOf(d.url);
      const top = d.resourceType === 'mainFrame' || d.resourceType === 'subFrame';
      const ok = /^wss?:/i.test(d.url) ? strict.isAllowedSupport(host) : top ? strict.isAllowedPage(d.url) : strict.isAllowedSupport(host);
      if (!ok && top) report('page', host);
      cb({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());

    // the little bar on top: it may only ask for approved sites, and only the window's own bar may ask
    const mine = (e) => !!w && !w.isDestroyed() && e.sender === w.webContents;
    ipcMain.handle('sites:hosts', (e) => (mine(e) && strict.active() ? strict.pages() : []));
    ipcMain.on('sites:go', (e, host) => {
      if (!mine(e) || !strict.active()) return;
      const h = String(host || '').toLowerCase();
      if (strict.pages().includes(h) && view) view.webContents.loadURL(`https://${h}/`).catch(() => {});
    });
    ipcMain.on('sites:back', (e) => { if (mine(e) && view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); });
    ipcMain.on('sites:forward', (e) => { if (mine(e) && view?.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward(); });
    ipcMain.on('sites:reload', (e) => { if (mine(e)) view?.webContents.reload(); });
    ipcMain.on('sites:done', (e) => { if (mine(e)) w.hide(); });
  }

  function layout() {
    if (!w || w.isDestroyed() || !view) return;
    const [width, height] = w.getContentSize();
    view.setBounds({ x: 0, y: BAR, width, height: Math.max(0, height - BAR) });
  }

  function pushState() {
    if (!w || w.isDestroyed() || !view) return;
    const wc = view.webContents;
    w.webContents.send('sites:state', {
      url: wc.getURL(), host: hostOf(wc.getURL()), title: wc.getTitle(),
      canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading(),
    });
  }

  function create() {
    wireSession();
    w = new BrowserWindow({
      width: 1100, height: 780, minWidth: 560, minHeight: 420, show: false, title: 'Approved sites, LOCK IN!',
      backgroundColor: '#16181d', autoHideMenuBar: true,
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'sites-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    w.removeMenu();
    w.loadFile(path.join(__dirname, 'sites.html'));
    view = new WebContentsView({
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false },
    });
    w.contentView.addChildView(view);
    layout();
    w.on('resize', layout);
    w.on('closed', () => { w = null; view = null; });

    const wc = view.webContents;
    const guard = (e, url) => {
      const u = (e && e.url) || url;
      if (!strict.isAllowedPage(u)) { e.preventDefault(); report('page', hostOf(u)); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-frame-navigate', guard);
    wc.setWindowOpenHandler(({ url }) => {
      if (strict.isAllowedPage(url)) wc.loadURL(url).catch(() => {});      // one window: a "new tab" opens here instead
      else report('page', hostOf(url));
      return { action: 'deny' };
    });
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, pushState);
  }

  /** Show the window on an approved address (or the first approved site). Nothing opens outside a strict block. */
  function open(url) {
    if (!strict.active()) return false;
    if (!w || w.isDestroyed()) create();
    const first = strict.pages().find(h => h !== 'codeadifference.ct.ws') || strict.pages()[0];
    const target = url && strict.isAllowedPage(url) ? url : (first ? `https://${first}/` : null);
    if (target && view) view.webContents.loadURL(target).catch(() => {});
    w.show();
    w.focus();
    return true;
  }

  function close() {
    if (w && !w.isDestroyed()) w.destroy();
    w = null; view = null;
  }

  return { open, close, isOpen: () => !!w && !w.isDestroyed(), partition: PARTITION };
}

module.exports = { createSites, PARTITION };
