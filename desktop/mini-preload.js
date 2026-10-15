/** The floating bar's only link to the app: what's running in, button presses out. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floating', {
  onState: (cb) => ipcRenderer.on('floating:state', (_e, s) => cb(s)),
  size: (w, h) => ipcRenderer.send('floating:size', Number(w), Number(h)),
  move: (dx, dy) => ipcRenderer.send('floating:move', Number(dx), Number(dy)),
  drop: () => ipcRenderer.send('floating:drop'),
  act: (action) => ipcRenderer.send('floating:act', String(action)),
});
