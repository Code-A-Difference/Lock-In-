/**
 * Transcription on this computer, with whisper.cpp.
 *
 * whisper-server (shipped inside the app, under resources/whisper) is started
 * once and kept running with the model loaded, so each 15-second piece of a
 * class is a quick local HTTP call. The audio never leaves the computer and
 * no AI credit is used. Models are downloaded the first time they're needed
 * (they're too big to put in the installer) into the app's data folder.
 *
 * A small voice-activity model (Silero VAD) skips the silent stretches, which
 * is what stops speech models "hearing" words in a quiet room.
 */
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');

const HF = 'https://huggingface.co';
const MODELS = {
  base: { label: 'Fast (base)', file: 'ggml-base-q5_1.bin', url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin`, mb: 57 },
  small: { label: 'Accurate (small)', file: 'ggml-small-q5_1.bin', url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin`, mb: 181 },
  turbo: { label: 'Best (large-v3 turbo)', file: 'ggml-large-v3-turbo-q5_0.bin', url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`, mb: 547 },
};
const VAD = { file: 'ggml-silero-v5.1.2.bin', url: `${HF}/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin` };

const dir = () => path.join(app.getPath('userData'), 'models');
const modelPath = (id) => path.join(dir(), MODELS[id].file);
const has = (id) => { try { return fs.statSync(modelPath(id)).size > MODELS[id].mb * 0.9e6; } catch (_) { return false; } };
const hasVad = () => { try { return fs.statSync(path.join(dir(), VAD.file)).size > 100000; } catch (_) { return false; } };

function binDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'whisper')
    : path.join(__dirname, 'resources', 'whisper', `${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch}`);
}
function serverBin() {
  return path.join(binDir(), process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server');
}

let server = null;          // { proc, port, model }
let starting = null;
let downloading = null;     // { id, got, total }
const listeners = new Set();
const emit = () => { const s = status(); for (const f of listeners) { try { f(s); } catch (_) {} } };

function status() {
  return {
    available: fs.existsSync(serverBin()),
    models: Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, { label: m.label, mb: m.mb, installed: has(id) }])),
    running: server ? server.model : null,
    downloading: downloading && { id: downloading.id, progress: downloading.total ? downloading.got / downloading.total : 0 },
  };
}

async function download(url, dest, onBytes) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      onBytes?.(got, total);
    }
    await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  if (total && got !== total) { fs.rmSync(tmp, { force: true }); throw new Error('The download was cut short. Try again.'); }
  fs.renameSync(tmp, dest);
}

/** Fetch a model (and the small VAD model) if this computer doesn't have it yet. */
async function ensureModel(id) {
  if (!MODELS[id]) throw new Error('Unknown model.');
  fs.mkdirSync(dir(), { recursive: true });
  if (!hasVad()) await download(VAD.url, path.join(dir(), VAD.file));
  if (has(id)) return;
  if (downloading) throw new Error('Another model is still downloading.');
  downloading = { id, got: 0, total: MODELS[id].mb * 1e6 };
  emit();
  let last = 0;
  try {
    await download(MODELS[id].url, modelPath(id), (got, total) => {
      downloading = { id, got, total: total || downloading.total };
      if (Date.now() - last > 300) { last = Date.now(); emit(); }
    });
  } finally {
    downloading = null;
    emit();
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

async function waitForPort(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await new Promise(r => {
      const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); });
      c.on('error', () => r(false));
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function stop() {
  if (server) { try { server.proc.kill(); } catch (_) {} }
  server = null;
  emit();
}

async function start(id) {
  if (server && server.model === id && server.proc.exitCode === null) return server;
  if (starting) return starting;
  starting = (async () => {
    stop();
    if (!fs.existsSync(serverBin())) throw new Error('The transcription engine is missing from this install.');
    await ensureModel(id);
    const port = await freePort();
    const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
    const args = ['-m', modelPath(id), '--host', '127.0.0.1', '--port', String(port), '-t', threads, '-nt'];
    if (hasVad()) args.push('--vad', '-vm', path.join(dir(), VAD.file));
    const proc = spawn(serverBin(), args, { cwd: binDir(), windowsHide: true, stdio: 'ignore' });
    proc.on('exit', () => { if (server?.proc === proc) { server = null; emit(); } });
    if (!(await waitForPort(port, 60000))) { try { proc.kill(); } catch (_) {} throw new Error('The transcription engine did not start.'); }
    server = { proc, port, model: id };
    emit();
    return server;
  })();
  try { return await starting; } finally { starting = null; }
}

/**
 * One WAV piece -> its words. `language` is 'en', 'fr', … or 'auto'.
 * @returns {Promise<{ok:true,text:string,ms:number}|{ok:false,error:string}>}
 */
async function transcribe(wav, { model = 'base', language = 'en', hint = '' } = {}) {
  const t0 = Date.now();
  try {
    const s = await start(model);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'piece.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('language', language || 'en');
    if (hint) form.append('prompt', String(hint).slice(-300));
    const r = await fetch(`http://127.0.0.1:${s.port}/inference`, { method: 'POST', body: form });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error(j?.error || `The transcription engine answered ${r.status}.`);
    const text = String(j.text || '').replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]|\((music|silence|inaudible)\)/gi, '').replace(/\s+/g, ' ').trim();
    return { ok: true, text, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { MODELS, status, ensureModel, start, stop, transcribe, onStatus: (f) => { listeners.add(f); return () => listeners.delete(f); } };
