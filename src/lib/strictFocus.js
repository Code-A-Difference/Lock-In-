/**
 * Strict focus mode: the rules, with no React and no browser in them, so they are tested in Node
 * (tests/strictFocus.test.mjs). A strict block is a commitment device, not a security boundary:
 * it keeps a student on task inside LOCK IN! and (in the desktop app) inside its approved-sites
 * window. It can't stop other devices, a VPN, or Task Manager, and the app says so.
 */

export const EXIT_DELAY_DEFAULT = 30;      // seconds a student waits before ending a strict block early
export const EXIT_DELAY_MIN = 15;
export const EXIT_DELAY_MAX = 120;
export const CONFIRM_WINDOW_SEC = 60;      // how long "ready" lasts before the countdown must be started again
export const MAX_BLOCK_MIN = 240;          // no strict block is ever longer than four hours
export const MAX_SITES = 100;
export const MAX_APPS = 100;

/** Places that are the web host, not one site: an entry like "github.io" would allow every project on it. */
export const PUBLIC_SUFFIXES = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'info', 'biz', 'io', 'ca', 'us', 'uk', 'co', 'app', 'dev', 'me', 'tv', 'xyz', 'ai',
  'co.uk', 'ac.uk', 'org.uk', 'gov.uk', 'com.au', 'co.nz', 'co.in', 'co.za',
  'github.io', 'gitlab.io', 'ct.ws', 'rf.gd', 'epizy.com', 'infinityfreeapp.com', 'great-site.net', 'free.nf', 'wuaze.com',
  'blogspot.com', 'wordpress.com', 'tumblr.com', 'weebly.com', 'wixsite.com', 'herokuapp.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'azurewebsites.net', 'appspot.com', 'repl.co', 'glitch.me',
  'onrender.com', 'fly.dev', 'surge.sh', 'notion.site', 'carrd.co',
]);

/** What can always be reached, and can't be removed: LOCK IN! itself and the Code A Difference site. */
export const ALWAYS_ALLOWED_HOSTS = ['codeadifference.ct.ws'];

/**
 * Ready-made lists. `hosts` is what the student sees; `support` is what has to be reachable for those
 * sites to work at all (sign-in, scripts, fonts, images) and is shown as "also allows ...".
 */
export const PRESETS = [
  { id: 'gdocs', label: 'Google Docs, Sheets, Slides and Drive', hosts: ['docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com'],
    support: ['accounts.google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com'] },
  { id: 'classroom', label: 'Google Classroom', hosts: ['classroom.google.com'],
    support: ['accounts.google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com'] },
  { id: 'desmos', label: 'Desmos', hosts: ['desmos.com'], support: [] },
  { id: 'khan', label: 'Khan Academy', hosts: ['khanacademy.org'], support: ['kasandbox.org', 'kastatic.org', 'cloudfront.net'] },
  { id: 'wikipedia', label: 'Wikipedia', hosts: ['wikipedia.org'], support: ['wikimedia.org'] },
];

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/**
 * "https://Docs.Google.com/document/d/1?x=2" -> "docs.google.com". Null if it isn't one site a student
 * can approve (an address, a bare ending like "com", a hosting domain, a wildcard, nonsense).
 */
export function normalizeHost(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s || s.length > 300 || /[\s*]/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let host;
  try { host = new URL(s).hostname; } catch (_) { return null; }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (!host || host.length > 253 || !host.includes('.')) return null;
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return null;      // an address, not a site
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (!HOST_RE.test(host)) return null;
  if (PUBLIC_SUFFIXES.has(host)) return null;
  return host;
}

/** Why a typed entry was refused, in words a student can act on. */
export function whyRefused(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return 'Type a website, like desmos.com.';
  if (/[*]/.test(raw)) return 'Wildcards aren’t needed. Typing desmos.com already includes its subpages.';
  const lowered = raw.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  if (PUBLIC_SUFFIXES.has(lowered)) return 'That’s a whole hosting service, not one site. Type the exact site you need, like yourproject.github.io.';
  if (/^\d+(\.\d+){3}$/.test(lowered) || lowered === 'localhost') return 'Use a website name, not an address.';
  if (!lowered.includes('.')) return 'Add the ending too, like khanacademy.org.';
  return 'That doesn’t look like a website. Try something like docs.google.com.';
}

/** Does this host belong to that approved entry? "app.desmos.com" yes, "evildesmos.com" no. */
export function hostMatches(host, entry) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const e = String(entry || '').toLowerCase();
  return !!h && !!e && (h === e || h.endsWith(`.${e}`));
}

/** The settings, with anything malformed dropped, clamped or capped. */
export function normalizeStrictPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const unique = (list, f, cap) => {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      const v = f(x);
      if (v && !out.includes(v)) out.push(v);
      if (out.length >= cap) break;
    }
    return out;
  };
  const delay = Math.round(Number(r.exitDelaySec));
  const procName = (x) => {
    const s = String(x ?? '').toLowerCase().trim().replace(/\.exe$/, '');
    return /^[a-z0-9 ._+-]{1,60}$/.test(s) ? s : null;
  };
  return {
    enabled: !!r.enabled,
    exitDelaySec: Number.isFinite(delay) ? Math.min(EXIT_DELAY_MAX, Math.max(EXIT_DELAY_MIN, delay)) : EXIT_DELAY_DEFAULT,
    allowedSites: unique(r.allowedSites, (x) => normalizeHost(typeof x === 'string' ? x : x?.host), MAX_SITES),
    presets: unique(r.presets, (x) => (PRESETS.some(p => p.id === x) ? x : null), PRESETS.length),
    allowMusic: r.allowMusic !== false,
    blockApps: r.blockApps !== false,
    appMode: r.appMode === 'allowlist' ? 'allowlist' : 'blocklist',
    appList: unique(r.appList, procName, MAX_APPS),
    appAllow: unique(r.appAllow, procName, MAX_APPS),
  };
}

export const DEFAULT_STRICT = normalizeStrictPrefs({});

/** The sites a preset (or several) opens up, and the helper hosts that come with them. */
export function presetHosts(ids) {
  const hosts = []; const support = [];
  for (const id of ids || []) {
    const p = PRESETS.find(x => x.id === id);
    if (!p) continue;
    p.hosts.forEach(h => { if (!hosts.includes(h)) hosts.push(h); });
    p.support.forEach(h => { if (!support.includes(h)) support.push(h); });
  }
  return { hosts, support };
}

/**
 * Everything compiled into one plain object, safe to send to the desktop app.
 * `pages` are sites a student can open; `support` are only for what those pages load.
 */
export function compileAllowlist(prefs) {
  const p = normalizeStrictPrefs(prefs);
  const fromPresets = presetHosts(p.presets);
  const pages = [...new Set([...ALWAYS_ALLOWED_HOSTS, ...fromPresets.hosts, ...p.allowedSites])];
  const support = [...new Set(fromPresets.support)].filter(h => !pages.includes(h));
  const matchAny = (host, list) => list.some(e => hostMatches(host, e));
  return {
    pages, support, music: p.allowMusic,
    isAllowedHost: (host) => matchAny(host, pages),
    isAllowedSupport: (host) => matchAny(host, pages) || matchAny(host, support),
    isAllowedUrl(url) {
      let u; try { u = new URL(url); } catch (_) { return false; }
      return (u.protocol === 'https:' || u.protocol === 'http:') && matchAny(u.hostname, pages);
    },
  };
}

/**
 * A link on the page: 'internal' (stays in LOCK IN!), 'allowed' (an approved site) or 'blocked'.
 * `pageHost` is the host LOCK IN! is running on; `allow` is a compiled allowlist.
 */
export function classifyLink(href, { pageHost = '', allow } = {}) {
  const raw = String(href ?? '').trim();
  if (!raw || raw.startsWith('#')) return 'internal';
  let u;
  try { u = new URL(raw, `https://${pageHost || 'localhost'}/`); } catch (_) { return 'blocked'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'blocked';        // javascript:, mailto:, data:, tel:
  const host = u.hostname.toLowerCase();
  if (pageHost && host === pageHost.toLowerCase()) return 'internal';
  if (ALWAYS_ALLOWED_HOSTS.some(e => hostMatches(host, e))) return 'allowed';
  return allow && allow.isAllowedHost(host) ? 'allowed' : 'blocked';
}

/* ------------------------------------------------------------ ending a block early */

/** Start the countdown. Asking again while it is running changes nothing, so mashing the button can't restart it. */
export function exitRequest(state, now) {
  const s = exitStatus(state, now, EXIT_DELAY_DEFAULT);
  return { ...state, exitReqAt: state?.exitReqAt != null && s.phase !== 'expired' ? state.exitReqAt : now };
}

/** Where the countdown is: idle, waiting (secondsLeft), ready (can confirm), or expired (start again). */
export function exitStatus(state, now, delaySec = EXIT_DELAY_DEFAULT) {
  const at = state?.exitReqAt;
  if (at == null) return { phase: 'idle', secondsLeft: 0, canConfirm: false };
  const delay = Math.min(EXIT_DELAY_MAX, Math.max(EXIT_DELAY_MIN, Math.round(delaySec) || EXIT_DELAY_DEFAULT)) * 1000;
  const age = now - at;
  if (age < 0) return { phase: 'waiting', secondsLeft: Math.ceil(delay / 1000), canConfirm: false };   // the clock moved back: start over
  if (age < delay) return { phase: 'waiting', secondsLeft: Math.ceil((delay - age) / 1000), canConfirm: false };
  if (age < delay + CONFIRM_WINDOW_SEC * 1000) return { phase: 'ready', secondsLeft: 0, canConfirm: true };
  return { phase: 'expired', secondsLeft: 0, canConfirm: false };
}

export function exitCancel(state) { return { ...state, exitReqAt: null }; }

/** Confirm ending early. Only works once the whole wait has passed, and not long after. */
export function exitConfirm(state, now, delaySec = EXIT_DELAY_DEFAULT) {
  const s = exitStatus(state, now, delaySec);
  if (!s.canConfirm) return { ok: false, state, reason: s.phase };
  return { ok: true, state: { ...state, exitReqAt: null } };
}

/* ------------------------------------------------------------ what a strict block allows */

const LOCKED_WHILE_STRICT = new Set(['pause', 'reset', 'skip', 'startBreak', 'startFocus']);

/**
 * May this timer action happen right now? While a strict focus block is running, anything that would
 * stop, shorten or replace it is refused (it has to go through the early-exit countdown).
 * Adding time, starting, and the task label are fine.
 */
export function isStrictActive(timer) {
  return !!(timer && timer.strict && timer.phase === 'focus' && timer.status !== 'idle');
}

export function gateAction(timer, action, arg) {
  if (!isStrictActive(timer)) return { ok: true };
  if (action === 'toggle') return timer.status === 'running' ? { ok: false, reason: 'strict', exit: true } : { ok: true };
  if (action === 'adjust') return Number(arg) > 0 ? { ok: true } : { ok: false, reason: 'strict', exit: true };
  if (LOCKED_WHILE_STRICT.has(action)) return { ok: false, reason: 'strict', exit: true };
  return { ok: true };
}

/** The sentence said or shown when something is refused. */
export function refusalText(delaySec = EXIT_DELAY_DEFAULT) {
  return `Strict mode is on, so that’s locked until the block ends. If you really need out, use End early: there’s a ${delaySec}-second wait first.`;
}

/** A block longer than the ceiling is trimmed to it. */
export function capMinutes(minutes) {
  const m = Math.round(Number(minutes));
  return Number.isFinite(m) && m > 0 ? Math.min(m, MAX_BLOCK_MIN) : 25;
}
