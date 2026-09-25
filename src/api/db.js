/**
 * db.js — LOCK IN!'s data layer.
 *
 * The app was exported from base44 with its data layer stubbed out: every
 * call returned nothing. This replaces it with the same interface the pages
 * already use —
 *
 *   db.auth.me() / updateMe() / logout() / isAuthenticated()
 *   db.entities.<Name>.list() / filter() / get() / create() / update() / delete()
 *   db.integrations.Core.UploadFile() / InvokeLLM()
 *
 * — backed by the student's account on the Code A Difference server
 * (/api/lockin.php). Signing in loads everything once; reads come from that
 * copy in memory, and every change goes up as a small operation ("create this
 * homework", "tick that step"), so a laptop and a phone signed in at once
 * never overwrite each other. The AI features go through the site's proxy,
 * which holds the AI keys so this app never has them.
 *
 * LOCK IN! used to keep all of this in the browser, encrypted (vault.js).
 * That copy is read one last time: the first sign-in to an empty account
 * with the same username and password carries it up, then deletes it here.
 */

import { store, deriveKey, openJson, KDF_ITERATIONS, b64url } from './vault';

const ENTITY_NAMES = ['Class', 'ClassGroup', 'Homework', 'Test', 'FocusSession', 'StudyHistory'];
export const LOCKIN_API = import.meta.env.VITE_LOCKIN_API || '/api/lockin.php';
export const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || '/api/ai.php';
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
const MAX_OPS_PER_REQUEST = 500;

/* ---------------------------------------------------------------- server */

async function call(action, body = {}) {
  let r;
  try {
    r = await fetch(LOCKIN_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-LockIn': '1' },
      body: JSON.stringify({ ...body, action }),
    });
  } catch (_) {
    throw Object.assign(new Error("Can't reach LOCK IN!'s server. Check your connection."), { status: 0, offline: true });
  }
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (r.ok && j && j.ok) return j;

  const err = Object.assign(
    new Error((j && j.error) || `LOCK IN!'s server had a problem (${r.status}). Try again in a moment.`),
    { status: j ? r.status : (r.status >= 400 ? r.status : 502) }
  );
  // Signed out underneath us: the password was changed on another device,
  // or the session ran out. Back to the sign-in page.
  if (err.status === 401 && action !== 'signin' && session) drop();
  throw err;
}

/* --------------------------------------------------------------- session */

let session = null;               // { username, user, data: { profile, entities }, rev }
const listeners = new Set();      // who is signed in
const dataListeners = new Set();  // the data changed on another device
const syncListeners = new Set();  // saving status

function emit() { listeners.forEach(fn => { try { fn(session ? publicUser() : null); } catch (_) {} }); }
function emitData() { dataListeners.forEach(fn => { try { fn(); } catch (_) {} }); }

function need() {
  if (!session) throw Object.assign(new Error('You are signed out.'), { status: 401 });
  return session;
}

function publicUser() {
  const s = need();
  return {
    ...s.data.profile,
    id: s.username,
    username: s.username,
    // Pages written for base44 key membership and authorship off `email`.
    // There is no email here; the username plays that part.
    email: s.username,
    full_name: s.data.profile.full_name || s.user?.displayName || s.username,
  };
}

function normalise(data) {
  const d = data || {};
  const entities = {};
  for (const n of ENTITY_NAMES) entities[n] = Array.isArray(d.entities?.[n]) ? d.entities[n] : [];
  return { profile: d.profile && typeof d.profile === 'object' && !Array.isArray(d.profile) ? d.profile : {}, entities };
}

function begin(j) {
  session = { username: j.user.username, user: j.user, data: normalise(j.data), rev: j.rev || 0 };
  emit();
  return publicUser();
}

function drop() {
  session = null;
  const left = outbox.splice(0);
  left.forEach(b => b.reject(Object.assign(new Error('You are signed out.'), { status: 401 })));
  clearTimeout(flushTimer);
  offline = false;
  stale = false;
  notifySync();
  emit();
}

/* ------------------------------------------------------------ saving */

/*
 * Every change is queued and sent in order. A change resolves once the
 * server has it. If the connection drops it stays queued, retried with a
 * back-off, and resolves straight away so the app doesn't hang — the saving
 * indicator says it's waiting. If the server refuses a change (too big, say)
 * it rejects, and the copy here is reloaded from the server so the two
 * never drift apart.
 */
let outbox = [];                  // [{ op, resolve, reject }]
let flushing = null;
let flushTimer = null;
let retryIn = 0;
let offline = false;

function syncState() { return { pending: outbox.length + (flushing ? 1 : 0), offline }; }
function notifySync() { const st = syncState(); syncListeners.forEach(fn => { try { fn(st); } catch (_) {} }); }

function send(op) {
  return new Promise((resolve, reject) => {
    outbox.push({ op, resolve, reject });
    notifySync();
    schedule(offline ? retryIn : 60);
  });
}

function schedule(ms) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

/** Merge back-to-back profile edits (a slider drag) and back-to-back edits to one record. */
function coalesce(ops) {
  const out = [];
  for (const o of ops) {
    const prev = out[out.length - 1];
    if (prev && o.op === 'profile' && prev.op === 'profile') {
      out[out.length - 1] = { op: 'profile', patch: { ...prev.patch, ...o.patch } };
    } else if (prev && o.op === 'update' && prev.op === 'update' && prev.entity === o.entity && prev.id === o.id) {
      out[out.length - 1] = { ...prev, patch: { ...prev.patch, ...o.patch } };
    } else {
      out.push(o);
    }
  }
  return out;
}

function flush() {
  if (flushing || !outbox.length || !session) return flushing || Promise.resolve();
  const batch = outbox.splice(0, MAX_OPS_PER_REQUEST);
  const who = session.username;
  flushing = (async () => {
    try {
      const j = await call('ops', { ops: coalesce(batch.map(b => b.op)) });
      if (session?.username === who) {
        // Anything other than one step on means another device saved in between.
        if (j.rev !== session.rev + 1) stale = true;
        session.rev = j.rev;
      }
      offline = false;
      retryIn = 0;
      batch.forEach(b => b.resolve());
    } catch (e) {
      if (e.status === 401) {
        batch.forEach(b => b.reject(e));
      } else if (e.offline || e.status >= 500) {
        // Worth another go: put it back at the front, in order.
        outbox.unshift(...batch);
        offline = true;
        retryIn = Math.min(30000, retryIn ? retryIn * 2 : 2000);
        batch.forEach(b => b.resolve());
      } else {
        batch.forEach(b => b.reject(e));
        stale = true;
      }
    } finally {
      flushing = null;
      notifySync();
      if (outbox.length) schedule(offline ? retryIn : 0);
      else if (stale) refresh({ force: true });
    }
  })();
  return flushing;
}

/** Everything queued, sent — or given up on after a few seconds. */
async function settle(ms = 5000) {
  const until = Date.now() + ms;
  while (session && (outbox.length || flushing) && Date.now() < until) {
    await (flushing || flush());
    if (offline) await new Promise(r => setTimeout(r, 1000));
  }
}

/* ------------------------------------------------------ staying current */

let stale = false;
let refreshing = null;

/**
 * Pick up changes made on another device. Asks only for the revision
 * number first, and reloads the lot only if it moved. Never while this
 * device has changes of its own on the way up.
 */
function refresh({ force = false } = {}) {
  if (refreshing) return refreshing;
  if (!session || outbox.length || flushing) return Promise.resolve(false);
  const who = session.username;
  refreshing = (async () => {
    try {
      if (!force) {
        const { rev } = await call('rev');
        if (!session || rev === session.rev) return false;
      }
      const j = await call('me');
      if (session?.username !== who || outbox.length || flushing) return false;
      stale = false;
      session = { ...session, user: j.user, data: normalise(j.data), rev: j.rev || 0 };
      emit();
      emitData();
      return true;
    } catch (_) {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

if (typeof window !== 'undefined') {
  const wake = () => { if (!session) return; if (outbox.length) flush(); else refresh(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  window.addEventListener('online', () => { retryIn = 0; wake(); });
  // A light check now and then while the tab is in front, for a phone and a
  // laptop open side by side. Just the revision number, so it costs nothing.
  setInterval(() => { if (document.visibilityState === 'visible') wake(); }, 5 * 60 * 1000);
  window.addEventListener('beforeunload', (e) => {
    if (session && (outbox.length || flushing)) { flush(); e.preventDefault(); e.returnValue = ''; }
  });
}

export const sync = {
  state: syncState,
  onChange(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); },
  /** Called when another device's changes have been loaded. */
  onData(fn) { dataListeners.add(fn); return () => dataListeners.delete(fn); },
  refresh,
  flush,
};

/* ---------------------------------------------- from before the server */

/**
 * Accounts made while LOCK IN! was browser-only. The sign-in page mentions
 * them, so a student knows their work is still here to bring across.
 */
async function legacyAccounts() {
  try {
    return (await store.listAccounts()).map(a => ({ username: a.username, displayName: a.displayName || a.username }));
  } catch (_) {
    return [];
  }
}

/**
 * Open the old in-browser vault with the password just typed and carry it
 * up into the (empty) server account. Only for the same username: a vault
 * is sealed to its username. A different password, or no vault, and this
 * quietly does nothing.
 */
async function importLegacy(username, password) {
  let acct, vault;
  try {
    acct = await store.getAccount(username);
    vault = acct && await store.getVault(username);
  } catch (_) { return null; }
  if (!vault) return null;

  let old;
  try {
    const key = await deriveKey(password, acct.salt, acct.iterations || KDF_ITERATIONS);
    old = await openJson(key, username, vault);
  } catch (_) { return null; }

  const data = normalise(old);
  const j = await call('import', { data });
  try { await store.deleteBoth(username); } catch (_) {}
  return j;
}

const isEmpty = (data) => ENTITY_NAMES.every(n => !(data?.entities?.[n] || []).length);

/* -------------------------------------------------------------- accounts */

function cleanUsername(u) { return String(u || '').trim().toLowerCase(); }

async function welcome(j, password) {
  // A brand-new (or never-used) account, and this browser still holds work
  // from before: bring it across before the app opens, so nothing flashes empty.
  if (isEmpty(j.data)) {
    try {
      const moved = await importLegacy(j.user.username, password);
      if (moved) j = moved;
    } catch (_) { /* leave the old copy where it is; the next sign-in tries again */ }
  }
  return begin(j);
}

export const accounts = {
  async signUp({ username, displayName, password, rememberDevice }) {
    const u = cleanUsername(username);
    if (!USERNAME_RE.test(u)) {
      throw new Error('Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.');
    }
    if (String(password || '').length < MIN_PASSWORD) {
      throw new Error(`Use at least ${MIN_PASSWORD} characters for your password.`);
    }
    const j = await call('signup', {
      username: u, password, displayName: String(displayName || '').trim() || u, remember: !!rememberDevice,
    });
    return welcome(j, password);
  },

  async signIn({ username, password, rememberDevice }) {
    const u = cleanUsername(username);
    if (!u || !password) throw new Error('Type your username and password.');
    let j;
    try {
      j = await call('signin', { username: u, password, remember: !!rememberDevice });
    } catch (e) {
      // They had an account here before accounts moved to the server.
      if (e.status === 401 && (await legacyAccounts()).some(a => a.username === u)) {
        throw new Error(`LOCK IN! now saves to an account online. Your work from this browser is still here: choose Create account with the username "${u}" and the same password, and it comes across.`);
      }
      throw e;
    }
    return welcome(j, password);
  },

  /** Pick up a signed-in session after a reload. Null if signed out; throws if the server can't be reached. */
  async resume() {
    try {
      return begin(await call('me'));
    } catch (e) {
      if (e.status === 401) return null;
      throw e;
    }
  },

  async signOut() {
    await settle();
    try { await call('signout'); } catch (_) {}
    drop();
  },

  async changePassword(current, next) {
    need();
    if (String(next || '').length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
    await call('password', { current, next });
  },

  /** Deletes the account and everything in it, on the server. */
  async deleteCurrent(password) {
    need();
    await settle();
    await call('delete', { password });
    drop();
  },

  legacyAccounts,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  current() { return session ? publicUser() : null; },
};

/* ------------------------------------------------------------- entities */

const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const now = () => new Date().toISOString();

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function sorter(sort) {
  if (!sort || typeof sort !== 'string') return null;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return (a, b) => {
    const x = a?.[field], y = b?.[field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;          // blanks last either way
    if (y == null) return -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return desc ? -c : c;
  };
}

function matches(rec, query) {
  return Object.entries(query || {}).every(([k, v]) => {
    const have = rec?.[k];
    if (Array.isArray(have) && !Array.isArray(v)) return have.includes(v);
    return JSON.stringify(have) === JSON.stringify(v);
  });
}

function rowsOf(name) {
  const s = need();
  if (!ENTITY_NAMES.includes(name)) throw new Error(`LOCK IN! doesn't store "${name}".`);
  return s.data.entities[name];
}

/** Add a record here and queue it for the server. */
function add(name, data) {
  const s = need();
  const t = now();
  const rec = { ...clone(data), id: newId(), created_date: t, updated_date: t, created_by: s.username };
  rowsOf(name).push(rec);
  return { rec, saved: send({ op: 'create', entity: name, record: rec }) };
}

function table(name) {
  const shape = (list, sort, limit) => {
    let out = list.slice();
    const cmp = sorter(sort);
    if (cmp) out.sort(cmp);
    if (typeof limit === 'number') out = out.slice(0, limit);
    return clone(out);
  };

  return {
    async list(sort, limit) { return shape(rowsOf(name), sort, limit); },
    async filter(query, sort, limit) { return shape(rowsOf(name).filter(r => matches(r, query)), sort, limit); },
    async get(id) {
      const r = rowsOf(name).find(x => x.id === id);
      if (!r) throw Object.assign(new Error(`${name} not found.`), { status: 404 });
      return clone(r);
    },
    async create(data) {
      const { rec, saved } = add(name, data);
      await saved;
      return clone(rec);
    },
    async bulkCreate(list) {
      const made = (list || []).map(d => add(name, d));
      await Promise.all(made.map(m => m.saved));
      return clone(made.map(m => m.rec));
    },
    async update(id, patch) {
      const r = rowsOf(name).find(x => x.id === id);
      if (!r) throw Object.assign(new Error(`${name} not found.`), { status: 404 });
      const p = { ...clone(patch), updated_date: now() };
      delete p.id; delete p.created_by;
      Object.assign(r, p);
      await send({ op: 'update', entity: name, id, patch: p });
      return clone(r);
    },
    async delete(id) {
      const list = rowsOf(name);
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list.splice(i, 1);
      await send({ op: 'delete', entity: name, id });
      return { id };
    },
  };
}

const userTable = {
  async list() { return [publicUser()]; },
  async get(id) { if (id !== need().username) throw new Error('Not found.'); return publicUser(); },
  async update(id, patch) { if (id !== need().username) throw new Error('Not found.'); return auth.updateMe(patch); },
  async delete() { throw new Error('Delete your account from Settings.'); },
};

const entities = new Proxy({}, {
  get(_, name) {
    if (name === 'User') return userTable;
    return table(String(name));
  },
});

/* ------------------------------------------------------------------ auth */

const auth = {
  async me() { return publicUser(); },
  async isAuthenticated() { return !!session; },
  async updateMe(patch) {
    const s = need();
    const p = clone(patch) || {};
    delete p.id; delete p.username; delete p.email;
    Object.assign(s.data.profile, p);
    emit();
    await send({ op: 'profile', patch: p });
    return publicUser();
  },
  async logout() {
    await accounts.signOut();
    window.location.assign(import.meta.env.BASE_URL || '/');
  },
  redirectToLogin() {
    accounts.signOut().then(() => window.location.assign(import.meta.env.BASE_URL || '/'));
  },
};

/* ---------------------------------------------------------- integrations */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

function dataUrlToPart(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  const data = m[2] ? m[3] : btoa(unescape(encodeURIComponent(decodeURIComponent(m[3]))));
  return { mimeType: m[1], data };
}

function parseJsonReply(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (_) {}
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (_) {}
  }
  throw new Error('The AI answered, but not in a form the app could read. Try again.');
}

const integrations = {
  Core: {
    /**
     * No file server — the file becomes a data: URL held in memory, which is
     * all the AI features need. Capped so a phone photo of a worksheet fits
     * but a whole textbook does not.
     */
    async UploadFile({ file }) {
      if (!file) throw new Error('No file chosen.');
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`);
      }
      return { file_url: await readAsDataUrl(file) };
    },

    /**
     * Goes to the Code A Difference AI proxy, which attaches the AI keys
     * server-side. Returns a string, or a parsed object when the caller
     * asked for JSON — the same contract the pages were written against.
     */
    async InvokeLLM({ prompt, response_json_schema, add_context_from_internet, file_urls } = {}) {
      const files = (file_urls || []).map(dataUrlToPart).filter(Boolean);
      const wantJson = !!response_json_schema;
      const body = {
        prompt: wantJson
          ? `${prompt}\n\nReply with JSON only — no prose, no code fences — matching this JSON Schema:\n${JSON.stringify(response_json_schema)}`
          : prompt,
        json: wantJson,
        search: !!add_context_from_internet && !wantJson,
        files,
      };

      let r;
      try {
        r = await fetch(AI_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (_) {
        throw new Error('Could not reach the AI service. Check your connection.');
      }
      let j = null;
      try { j = await r.json(); } catch (_) {}
      if (!j || !j.ok) {
        throw new Error((j && j.error) || `The AI service returned an error (${r.status}).`);
      }
      return wantJson ? parseJsonReply(j.text) : j.text;
    },
  },
};

/* --------------------------------------------------------------- sharing */

/**
 * Sharing a class: the share code IS the class. It carries the class and its
 * homework and tests, compressed, so a classmate pastes it and gets their own
 * copy. Importing the same code again later merges in anything new, which is
 * how updates travel.
 */
const SHARE_PREFIX = 'LOCKIN1.';

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return { z: false, bytes };
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return { z: true, bytes: new Uint8Array(await new Response(s).arrayBuffer()) };
}
async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// eslint-disable-next-line no-unused-vars
const strip = ({ id, created_date, updated_date, created_by, members, class_id, ...rest }) => rest;

export const sharing = {
  async encodeClass(classId) {
    const s = need();
    const E = s.data.entities;
    const cls = E.Class.find(c => c.id === classId);
    if (!cls) throw new Error('Class not found.');
    const payload = {
      v: 1,
      class: strip(cls),
      homework: E.Homework.filter(h => h.class_name === cls.name).map(strip),
      tests: E.Test.filter(t => t.class_name === cls.name).map(strip),
      from: s.data.profile.full_name || s.username,
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const { z, bytes } = await deflate(raw);
    return SHARE_PREFIX + (z ? 'z' : 'j') + b64url.encode(bytes);
  },

  async importClass(code) {
    const s = need();
    const c = String(code || '').replace(/\s+/g, '');
    if (!c.startsWith(SHARE_PREFIX)) throw new Error('That is not a LOCK IN! share code.');
    let payload;
    try {
      const body = c.slice(SHARE_PREFIX.length);
      let bytes = b64url.decode(body.slice(1));
      if (body[0] === 'z') bytes = await inflate(bytes);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      throw new Error('That share code is damaged or incomplete — ask for it again.');
    }
    if (!payload?.class?.name) throw new Error('That share code has no class in it.');

    const E = s.data.entities;
    const saves = [];
    let cls = E.Class.find(x => x.name === payload.class.name);
    const isNew = !cls;
    if (!cls) {
      const made = add('Class', { ...payload.class, members: [s.username] });
      cls = made.rec;
      saves.push(made.saved);
    }

    const key = x => `${x.title}|${x.due_date || x.date || ''}`;
    const haveHw = new Set(E.Homework.filter(h => h.class_name === cls.name).map(key));
    const haveTs = new Set(E.Test.filter(t => t.class_name === cls.name).map(key));
    let added = 0;
    for (const h of payload.homework || []) {
      if (haveHw.has(key(h))) continue;
      saves.push(add('Homework', { ...h, class_name: cls.name, class_id: cls.id, is_completed: false }).saved);
      added++;
    }
    for (const t of payload.tests || []) {
      if (haveTs.has(key(t))) continue;
      saves.push(add('Test', { ...t, class_name: cls.name, class_id: cls.id }).saved);
      added++;
    }
    await Promise.all(saves);
    return { className: cls.name, isNew, added, from: payload.from || null };
  },
};

/* ----------------------------------------------------------------- export */

export const db = {
  auth,
  entities,
  integrations,
  appLogs: { async logUserInApp() {} },
  accounts,
  sharing,
  sync,
};

export default db;
