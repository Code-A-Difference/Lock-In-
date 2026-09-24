/**
 * vault.js — where LOCK IN! keeps its data: in this browser, encrypted.
 *
 * Nothing is sent to a server. Each account's data lives in IndexedDB as one
 * encrypted blob, and the key that opens it is derived from that account's
 * password. That matters on a shared school computer: every student using
 * the same browser shares the same IndexedDB, so a sign-in screen on its own
 * would only hide the data, not protect it — anyone could read it in
 * devtools. Encrypted, all they can read is ciphertext.
 *
 * The cost of that is real and the sign-up page says so: there is no
 * "forgot password". The password is the key. Lose it and the data is gone,
 * which is why backups (see exportBackup) exist.
 *
 *   PBKDF2-SHA256, 600k iterations  ->  AES-GCM-256 key
 *   AES-GCM, fresh 96-bit IV on every save, username bound as associated
 *   data so one account's vault cannot be swapped in for another's.
 */

const DB_NAME = 'lockin';
const DB_VERSION = 1;
export const KDF_ITERATIONS = 600000;   // OWASP's current figure for PBKDF2-SHA256

const te = new TextEncoder();
const td = new TextDecoder();

/* ---------------------------------------------------------------- IndexedDB */

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('accounts')) d.createObjectStore('accounts', { keyPath: 'username' });
      if (!d.objectStoreNames.contains('vaults'))   d.createObjectStore('vaults',   { keyPath: 'username' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => reject(new Error('LOCK IN! is open in another tab that is blocking an upgrade. Close it and reload.'));
  });
  return dbPromise;
}

/** Run fn(stores) inside one transaction across the named stores. */
async function tx(storeNames, mode, fn) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map(n => [n, t.objectStore(n)]));
    let result;
    Promise.resolve(fn(stores)).then(r => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted.'));
  });
}

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const store = {
  listAccounts: () => tx(['accounts'], 'readonly', s => req(s.accounts.getAll())),
  getAccount:   (u) => tx(['accounts'], 'readonly', s => req(s.accounts.get(u))),
  getVault:     (u) => tx(['vaults'],   'readonly', s => req(s.vaults.get(u))),
  putVault:     (v) => tx(['vaults'],   'readwrite', s => req(s.vaults.put(v))),
  putAccount:   (a) => tx(['accounts'], 'readwrite', s => req(s.accounts.put(a))),
  /** Account and vault are written together or not at all. */
  putBoth: (account, vault) => tx(['accounts', 'vaults'], 'readwrite', async s => {
    await req(s.accounts.put(account));
    await req(s.vaults.put(vault));
  }),
  deleteBoth: (u) => tx(['accounts', 'vaults'], 'readwrite', async s => {
    await req(s.accounts.delete(u));
    await req(s.vaults.delete(u));
  }),
};

/** Ask the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch (_) { return false; }
}

/* ------------------------------------------------------------------ crypto */

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey(
    'raw', te.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,                       // extractable, so a signed-in tab survives a reload
    ['encrypt', 'decrypt']
  );
}

export async function sealJson(key, username, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(username) },
    key,
    te.encode(JSON.stringify(obj))
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** Throws if the key is wrong or the data was tampered with — GCM checks both. */
export async function openJson(key, username, { iv, ct }) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(username) },
    key,
    ct
  );
  return JSON.parse(td.decode(pt));
}

export async function exportRawKey(key) {
  return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export function importRawKey(b64) {
  return crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/* ----------------------------------------------------------------- base64 */

// Chunked, because String.fromCharCode(...bigArray) blows the call stack
// once a vault holds a few uploaded images.
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const b64url = {
  encode: bytes => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: s => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)),
};
