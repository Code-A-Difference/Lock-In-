/**
 * The web host (InfinityFree) puts a JavaScript check in front of the whole
 * site: a request without its "__test" cookie gets a small HTML page (status
 * 200!) whose script sets the cookie and reloads. The cookie lasts six hours,
 * so an app left open longer — the desktop app in the tray, a long class —
 * suddenly gets that page instead of JSON from every API, and saving, the AI
 * and transcription all fail with "error (200)".
 *
 * gateFetch() spots that page, lets the host's own script renew the cookie in
 * a hidden frame, and retries once. Pure parts are exported for tests.
 */

/** Is this response body the host's check page rather than our API's answer? */
export function isGatePage(contentType, text) {
  return /text\/html/i.test(contentType || '') && /slowAES|\/aes\.js|__test=/.test(String(text || '').slice(0, 4000));
}

let renewing = null;

/** Run the host's check in a hidden frame so it sets a fresh cookie. Shared by concurrent callers. */
export function renewGate({ timeoutMs = 10000 } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  renewing ||= new Promise((resolve) => {
    const before = document.cookie;
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    // A PHP address (static files like robots.txt aren't checked): the check page appears
    // in its place, sets the cookie, then forwards to it — a tiny "use POST" reply.
    frame.src = `${location.origin}/api/ai.php?gate=${Date.now()}`;
    const started = Date.now();
    let loads = 0;
    let finished = false;
    const done = (ok) => { if (finished) return; finished = true; clearInterval(poll); frame.remove(); renewing = null; resolve(ok); };
    // first load: the check page; second: the file it forwards to, with the cookie set
    frame.onload = () => { if (++loads >= 2) setTimeout(() => done(true), 100); };
    const poll = setInterval(() => {
      const fresh = document.cookie !== before && /(^|;\s*)__test=/.test(document.cookie);
      if (fresh) done(true);
      else if (Date.now() - started > timeoutMs) done(false);
    }, 150);
    document.body.appendChild(frame);
  });
  return renewing;
}

/**
 * fetch() for the site's own APIs. If the host's check page comes back
 * instead of the API, renew the cookie and send the request again.
 */
export async function gateFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !/text\/html/i.test(type)) return r;
  const text = await r.clone().text().catch(() => '');
  if (!isGatePage(type, text)) return r;
  await renewGate();
  return fetch(url, opts);
}
