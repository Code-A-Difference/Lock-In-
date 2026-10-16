/** The approved-sites window's bar: pick an approved site, go back and forward, reload, or close. Nothing else. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sites', {
  hosts: () => ipcRenderer.invoke('sites:hosts'),
  go: (host) => ipcRenderer.send('sites:go', String(host)),
  back: () => ipcRenderer.send('sites:back'),
  forward: () => ipcRenderer.send('sites:forward'),
  reload: () => ipcRenderer.send('sites:reload'),
  done: () => ipcRenderer.send('sites:done'),
  onState: (cb) => ipcRenderer.on('sites:state', (_e, s) => cb(s)),
});
