/**
 * The bridge between the LOCK IN! page and the desktop app. Only these
 * functions are exposed — the page can't run anything else on the computer.
 */
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const f = (_e, data) => cb(data);
  ipcRenderer.on(channel, f);
  return () => ipcRenderer.removeListener(channel, f);
};

contextBridge.exposeInMainWorld('lockinDesktop', {
  version: (process.argv.find(a => a.startsWith('--lockin-version=')) || '').split('=')[1] || '0',
  platform: process.platform,
  /** One WAV piece (Uint8Array) -> {ok, text} | {ok:false, error}. */
  transcribe: (wav, hint) => ipcRenderer.invoke('whisper:transcribe', wav, hint || ''),
  hear: (wav, hint) => ipcRenderer.invoke('whisper:hear', wav, hint || ''),
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status'),
    set: (patch) => ipcRenderer.invoke('whisper:set', patch),
    download: (id) => ipcRenderer.invoke('whisper:download', id),
    onStatus: on('whisper:status'),
  },
  mini: {
    set: (onOff) => ipcRenderer.invoke('mini:set', onOff),
    get: () => ipcRenderer.invoke('mini:get'),
    onChange: on('mini'),
  },
  launchAtLogin: {
    get: () => ipcRenderer.invoke('login:get'),
    set: (onOff) => ipcRenderer.invoke('login:set', onOff),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
  },
  setRecording: (onOff) => ipcRenderer.send('recording', !!onOff),
  show: () => ipcRenderer.send('show'),
  /** {type:'assistant'|'catchup'|'record', source?, app?} from shortcuts, the tray and call detection. */
  onCommand: on('command'),
});
