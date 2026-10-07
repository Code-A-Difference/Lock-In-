/**
 * Seamless AI answers: if the answer is taking clearly longer than answers
 * usually do, quietly ask again on a second "lane" — the server starts that
 * request from a different key or model — and use whichever answers first.
 * The other request is cancelled. The usual time is learned on this device.
 *
 * The web host can't run two AI requests at once inside one server call, but
 * two calls from the browser do run side by side, so the race lives here.
 * Pure apart from the optional storage; tests/aiRace.test.mjs runs it.
 */

/** How long to wait before racing a second request: about twice the usual time, within bounds. */
export function hedgeDelay(usualMs, long = false) {
  const [def, floor, ceil] = long ? [9000, 6000, 20000] : [3500, 2500, 9000];
  return Math.round(Math.max(floor, Math.min(ceil, usualMs == null ? def : 2 * usualMs)));
}

const SPEED_KEY = 'lockin.aiSpeed';
function readSpeed(store) {
  try { return JSON.parse(store?.getItem(SPEED_KEY) || '{}') || {}; } catch (_) { return {}; }
}
/** This device's running average answer time, ms, for short ('s') or long ('l') answers. */
export function usualTime(kind, store = globalThis.localStorage) {
  const v = readSpeed(store)[kind];
  return typeof v === 'number' && v > 0 ? v : null;
}
export function noteTime(kind, ms, store = globalThis.localStorage) {
  try {
    const s = readSpeed(store);
    s[kind] = Math.round(s[kind] ? 0.7 * s[kind] + 0.3 * ms : ms);
    store?.setItem(SPEED_KEY, JSON.stringify(s));
  } catch (_) { /* private mode: just don't learn */ }
}

/**
 * @param {(lane:number, signal:AbortSignal) => Promise<any>} send  one request; resolves to the
 *        answer, or rejects. A rejection with `.final` set (the server already tried every key)
 *        ends the race unless the other lane is still running.
 * @param {{long?:boolean, usualMs?:number|null, hedge?:boolean, now?:()=>number}} opts
 * @returns {Promise<{value:any, lane:number, ms:number}>}
 */
export function raceAI(send, { long = false, usualMs = null, hedge = true, now = () => Date.now() } = {}) {
  return new Promise((resolve, reject) => {
    const lanes = [];
    let done = false;
    let timer = null;
    const errors = [];

    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const l of lanes) if (!l.settled) l.ctrl.abort();
      fn(arg);
    };
    const start = (lane) => {
      const ctrl = new AbortController();
      const entry = { lane, ctrl, settled: false, t0: now() };
      lanes.push(entry);
      Promise.resolve().then(() => send(lane, ctrl.signal)).then(
        (value) => { entry.settled = true; finish(resolve, { value, lane, ms: now() - entry.t0 }); },
        (err) => {
          entry.settled = true;
          if (done) return;
          errors.push(err);
          const othersRunning = lanes.some(l => !l.settled);
          if (othersRunning) return;                               // the other lane may still answer
          // The first lane failed outright before any race began: the server has already gone
          // through every key, so asking again on another lane would only repeat that — unless
          // it was a dropped connection, which a second lane can survive.
          if (lanes.length === 1 && hedge && !err?.final) { clearTimeout(timer); start(1); return; }
          finish(reject, errors[0]);
        },
      );
    };

    start(0);
    if (hedge) timer = setTimeout(() => { if (!done && lanes.length === 1) start(1); }, hedgeDelay(usualMs, long));
  });
}
