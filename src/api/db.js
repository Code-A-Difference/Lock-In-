/**
 * db.js — LOCK IN!'s own backend, and it runs in the browser.
 *
 * The app was exported from base44 with its data layer stubbed out: every
 * call returned nothing. This replaces it with the same interface the pages
 * already use —
 *
 *   db.auth.me() / updateMe() / logout() / isAuthenticated()
 *   db.entities.<Name>.list() / filter() / get() / create() / update() / delete()
 *   db.integrations.Core.UploadFile() / InvokeLLM()
 *
 * — backed by an encrypted vault in IndexedDB (see vault.js). No data leaves
 * the device except what the AI features send, and those go through the
 * Code A Difference proxy, which holds the Gemini key so this app never has it.
 *
 * What local storage cannot do is share data between people. There is no
 * common database to look anyone up in, so friends are gone; classes are
 * shared instead with a share code that carries the class itself
 * (see db.sharing).
 */

import {
  store, deriveKey, sealJson, openJson, exportRawKey, importRawKey,
  randomBytes, toB64, fromB64, b64url, KDF_ITERATIONS, requestPersistence,
} from './vault';

const ENTITY_NAMES = ['Class', 'ClassGroup', 'Homework', 'Test', 'StudyHistory'];
const SESSION_KEY = 'lockin.session';
export const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || '/api/ai.php';
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/* ------------------------------------------------------------- session */

let session = null;               // { username, key, data }
let writing = Promise.resolve();  // serialises saves so two edits can't race
const listeners = new Set();

function emit() { listeners.forEach(fn => { try { fn(session ? publicUser() : null); } catch (_) {} }); }

function emptyVault(displayName) {
  return {
    version: 1,
    profile: { full_name: displayName, dark_mode: false, theme_color: null, created_date: new Date().toISOString() },
    entities: Object.fromEntries(ENTITY_NAMES.map(n => [n, []])),
  };
}

function need() {
  if (!session) throw Object.assign(new Error('You are signed out.'), { status: 401 });
  return session;
}

function persist() {
  const s = need();
  writing = writing.catch(() => {}).then(async () => {
    const { iv, ct } = await sealJson(s.key, s.username, s.data);
    await store.putVault({ username: s.username, iv, ct, savedAt: new Date().toISOString() });
  });
  return writing;
}

async function remember(username, key, where) {
  const blob = JSON.stringify({ username, key: await exportRawKey(key) });
  // sessionStorage: survives reloads, gone when the tab closes.
  // localStorage (only if asked): survives closing the browser — which puts
  // the key next to the ciphertext, so the sign-in page only offers it for
  // a person's own device and says so.
  try { sessionStorage.setItem(SESSION_KEY, blob); } catch (_) {}
  try {
    if (where === 'device') localStorage.setItem(SESSION_KEY, blob);
    else localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

function forget() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
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
    full_name: s.data.profile.full_name || s.username,
  };
}

/* ------------------------------------------------------------- accounts */

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
export const MIN_PASSWORD = 8;

function cleanUsername(u) { return String(u || '').trim().toLowerCase(); }

export const accounts = {
  /** Who has an account in this browser — shown on the sign-in page. */
  async list() {
    const all = await store.listAccounts();
    return all
      .map(a => ({ username: a.username, displayName: a.displayName, createdAt: a.createdAt }))
      .sort((a, b) => a.username.localeCompare(b.username));
  },

  async signUp({ username, displayName, password, rememberDevice }) {
    const u = cleanUsername(username);
    if (!USERNAME_RE.test(u)) {
      throw new Error('Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.');
    }
    if (String(password || '').length < MIN_PASSWORD) {
      throw new Error(`Use at least ${MIN_PASSWORD} characters for your password.`);
    }
    if (await store.getAccount(u)) throw new Error(`There is already an account called "${u}" in this browser.`);

    const salt = randomBytes(16);
    const key = await deriveKey(password, salt, KDF_ITERATIONS);
    const data = emptyVault(String(displayName || '').trim() || u);
    const { iv, ct } = await sealJson(key, u, data);

    await store.putBoth(
      { username: u, displayName: data.profile.full_name, salt, iterations: KDF_ITERATIONS, createdAt: new Date().toISOString(), version: 1 },
      { username: u, iv, ct, savedAt: new Date().toISOString() }
    );
    session = { username: u, key, data };
    await remember(u, key, rememberDevice ? 'device' : 'tab');
    requestPersistence();
    emit();
    return publicUser();
  },

  async signIn({ username, password, rememberDevice }) {
    const u = cleanUsername(username);
    const acct = await store.getAccount(u);
    if (!acct) throw new Error(`No account called "${u}" in this browser. Data stays on the device it was made on — restore a backup to bring it here.`);
    const vault = await store.getVault(u);
    if (!vault) throw new Error('This account has no data in this browser. Restore a backup to fill it.');

    const key = await deriveKey(password, acct.salt, acct.iterations || KDF_ITERATIONS);
    let data;
    try { data = await openJson(key, u, vault); }
    catch (_) { throw new Error('That password is not right.'); }

    session = { username: u, key, data };
    await remember(u, key, rememberDevice ? 'device' : 'tab');
    requestPersistence();
    emit();
    return publicUser();
  },

  /** Resume a signed-in tab after a reload, if there is one. */
  async resume() {
    let raw = null;
    try { raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch (_) {}
    if (!raw) return null;
    try {
      const { username, key: k } = JSON.parse(raw);
      const vault = await store.getVault(username);
      if (!vault) throw new Error('gone');
      const key = await importRawKey(k);
      const data = await openJson(key, username, vault);
      session = { username, key, data };
      emit();
      return publicUser();
    } catch (_) {
      forget();          // stale or tampered — just ask them to sign in
      session = null;
      return null;
    }
  },

  async signOut() {
    await writing.catch(() => {});
    session = null;
    forget();
    emit();
  },

  async changePassword(current, next) {
    const s = need();
    if (String(next || '').length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
    const acct = await store.getAccount(s.username);
    const check = await deriveKey(current, acct.salt, acct.iterations || KDF_ITERATIONS);
    try { await openJson(check, s.username, await store.getVault(s.username)); }
    catch (_) { throw new Error('Your current password is not right.'); }

    const salt = randomBytes(16);
    const key = await deriveKey(next, salt, KDF_ITERATIONS);
    const { iv, ct } = await sealJson(key, s.username, s.data);
    await store.putBoth(
      { ...acct, salt, iterations: KDF_ITERATIONS },
      { username: s.username, iv, ct, savedAt: new Date().toISOString() }
    );
    session = { ...s, key };
    const kept = (() => { try { return !!localStorage.getItem(SESSION_KEY); } catch (_) { return false; } })();
    await remember(s.username, key, kept ? 'device' : 'tab');
  },

  /** Deletes the account and everything in it from this browser. */
  async deleteCurrent() {
    const s = need();
    await writing.catch(() => {});
    await store.deleteBoth(s.username);
    session = null;
    forget();
    emit();
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  current() { return session ? publicUser() : null; },
};

/* ------------------------------------------------------------- backups */

export const backup = {
  /**
   * The account and its vault, still encrypted. Safe to email to yourself or
   * keep in Drive: without the password it is noise. Restoring it is also
   * how you move LOCK IN! to another computer.
   */
  async export() {
    const s = need();
    await persist();
    const acct = await store.getAccount(s.username);
    const vault = await store.getVault(s.username);
    return JSON.stringify({
      format: 'lockin-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      account: { username: acct.username, displayName: acct.displayName, salt: toB64(acct.salt), iterations: acct.iterations, createdAt: acct.createdAt },
      vault: { iv: toB64(vault.iv), ct: toB64(vault.ct) },
    });
  },

  /** Returns the username so the sign-in form can fill it in. */
  async import(text, { overwrite = false } = {}) {
    let j;
    try { j = JSON.parse(text); } catch (_) { throw new Error('That file is not a LOCK IN! backup.'); }
    if (j?.format !== 'lockin-backup' || !j.account?.username || !j.vault?.ct) {
      throw new Error('That file is not a LOCK IN! backup.');
    }
    const u = cleanUsername(j.account.username);
    if (!USERNAME_RE.test(u)) throw new Error('That backup has an invalid username in it.');
    if (!overwrite && await store.getAccount(u)) {
      throw Object.assign(new Error(`There is already an account called "${u}" in this browser.`), { code: 'exists', username: u });
    }
    await store.putBoth(
      { username: u, displayName: j.account.displayName || u, salt: fromB64(j.account.salt), iterations: j.account.iterations || KDF_ITERATIONS, createdAt: j.account.createdAt || new Date().toISOString(), version: 1 },
      { username: u, iv: fromB64(j.vault.iv), ct: fromB64(j.vault.ct), savedAt: new Date().toISOString() }
    );
    return u;
  },
};

/* ------------------------------------------------------------- entities */

const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

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

function table(name) {
  const rows = () => {
    const s = need();
    s.data.entities[name] = s.data.entities[name] || [];
    return s.data.entities[name];
  };
  const shape = (list, sort, limit) => {
    let out = list.slice();
    const cmp = sorter(sort);
    if (cmp) out.sort(cmp);
    if (typeof limit === 'number') out = out.slice(0, limit);
    return clone(out);
  };

  return {
    async list(sort, limit) { return shape(rows(), sort, limit); },
    async filter(query, sort, limit) { return shape(rows().filter(r => matches(r, query)), sort, limit); },
    async get(id) {
      const r = rows().find(x => x.id === id);
      if (!r) throw Object.assign(new Error(`${name} not found.`), { status: 404 });
      return clone(r);
    },
    async create(data) {
      const now = new Date().toISOString();
      const rec = { ...clone(data), id: crypto.randomUUID(), created_date: now, updated_date: now, created_by: session.username };
      rows().push(rec);
      await persist();
      return clone(rec);
    },
    async bulkCreate(list) {
      const out = [];
      for (const d of list || []) {
        const now = new Date().toISOString();
        const rec = { ...clone(d), id: crypto.randomUUID(), created_date: now, updated_date: now, created_by: session.username };
        rows().push(rec);
        out.push(rec);
      }
      await persist();
      return clone(out);
    },
    async update(id, patch) {
      const r = rows().find(x => x.id === id);
      if (!r) throw Object.assign(new Error(`${name} not found.`), { status: 404 });
      Object.assign(r, clone(patch), { id, updated_date: new Date().toISOString() });
      await persist();
      return clone(r);
    },
    async delete(id) {
      const list = rows();
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list.splice(i, 1);
      await persist();
      return { id };
    },
  };
}

const userTable = {
  async list() { return [publicUser()]; },
  async get(id) { if (id !== need().username) throw new Error('Not found.'); return publicUser(); },
  async update(id, patch) { if (id !== need().username) throw new Error('Not found.'); return auth.updateMe(patch); },
  async delete(id) { if (id !== need().username) throw new Error('Not found.'); await accounts.deleteCurrent(); return { id }; },
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
    await persist();
    if (typeof p.full_name === 'string' && p.full_name.trim()) {
      const acct = await store.getAccount(s.username);
      if (acct) await store.putAccount({ ...acct, displayName: p.full_name.trim() });
    }
    emit();
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
     * Goes to the Code A Difference AI proxy, which attaches the shared Gemini
     * key server-side. Returns a string, or a parsed object when the caller
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
 * Sharing a class without a server: the share code IS the class. It carries
 * the class and its homework and tests, compressed, so a classmate pastes
 * it and gets their own copy. Importing the same code again later merges in
 * anything new, which is how updates travel.
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

const strip = ({ id, created_date, updated_date, created_by, members, class_id, ...rest }) => rest;

export const sharing = {
  async encodeClass(classId) {
    const s = need();
    const cls = (s.data.entities.Class || []).find(c => c.id === classId);
    if (!cls) throw new Error('Class not found.');
    const payload = {
      v: 1,
      class: strip(cls),
      homework: (s.data.entities.Homework || []).filter(h => h.class_name === cls.name).map(strip),
      tests: (s.data.entities.Test || []).filter(t => t.class_name === cls.name).map(strip),
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

    const now = new Date().toISOString();
    const E = s.data.entities;
    E.Class = E.Class || []; E.Homework = E.Homework || []; E.Test = E.Test || [];

    let cls = E.Class.find(x => x.name === payload.class.name);
    const isNew = !cls;
    if (!cls) {
      cls = { ...payload.class, id: crypto.randomUUID(), members: [s.username], created_date: now, updated_date: now, created_by: s.username };
      E.Class.push(cls);
    }

    const key = x => `${x.title}|${x.due_date || x.date || ''}`;
    const haveHw = new Set(E.Homework.filter(h => h.class_name === cls.name).map(key));
    const haveTs = new Set(E.Test.filter(t => t.class_name === cls.name).map(key));
    let added = 0;
    for (const h of payload.homework || []) {
      if (haveHw.has(key(h))) continue;
      E.Homework.push({ ...h, class_name: cls.name, class_id: cls.id, is_completed: false, id: crypto.randomUUID(), created_date: now, updated_date: now, created_by: s.username });
      added++;
    }
    for (const t of payload.tests || []) {
      if (haveTs.has(key(t))) continue;
      E.Test.push({ ...t, class_name: cls.name, class_id: cls.id, id: crypto.randomUUID(), created_date: now, updated_date: now, created_by: s.username });
      added++;
    }
    await persist();
    return { className: cls.name, isNew, added, from: payload.from || null };
  },
};

/* ----------------------------------------------------------------- export */

export const db = {
  auth,
  entities,
  integrations,
  appLogs: { async logUserInApp() {} },   // nothing to report to — it's all local
  accounts,
  backup,
  sharing,
};

export default db;
