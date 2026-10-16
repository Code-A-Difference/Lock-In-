'use strict';
/**
 * Strict focus, as the desktop app's main process keeps it. The page that LOCK IN! loads from the
 * web can ask for things, but this is the copy that counts: it can't be told a block is over before
 * it is, can't be handed a looser list mid-block, and ends a block only after its own clock says so.
 * (If the page were tampered with, the lock would still hold; it is still a commitment device, not a
 * security boundary: Task Manager, another user account or setting the clock forward get past it.)
 *
 * No Electron in here, so it is tested on its own (desktop/test/strict.test.mjs).
 */

const MAX_BLOCK_MS = 4 * 60 * 60 * 1000;     // no strict block is ever longer than four hours
const RELEASE_GRACE_MS = 3000;               // after the planned end, main lets go by itself
const HARD_CEILING_MS = 5 * 60 * 1000;       // and a lock can never outlive endsAt by more than this, whatever else happens
const CONFIRM_WINDOW_MS = 60 * 1000;
const DELAY_MIN = 15;
const DELAY_MAX = 120;
const DELAY_DEFAULT = 30;
const MAX_HOSTS = 100;
const TOP_LEVEL_SUPPORT = ['accounts.google.com'];   // sign-in pages a student has to be able to reach, not just load from

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** "app.desmos.com" belongs to "desmos.com"; "evildesmos.com" does not. (Same rule as src/lib/strictFocus.js.) */
function hostMatches(host, entry) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const e = String(entry || '').toLowerCase();
  return !!h && !!e && (h === e || h.endsWith(`.${e}`));
}

function cleanHosts(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const h = String(x || '').trim().toLowerCase();
    if (HOST_RE.test(h) && !out.includes(h)) out.push(h);
    if (out.length >= MAX_HOSTS) break;
  }
  return out;
}

function cleanNames(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const n = String(x || '').toLowerCase().trim().replace(/\.exe$/, '');
    if (/^[a-z0-9 ._+-]{1,60}$/.test(n) && !out.includes(n)) out.push(n);
    if (out.length >= MAX_HOSTS) break;
  }
  return out;
}

function createStrict({ now = Date.now, load = () => null, save = () => {}, onChange = () => {} } = {}) {
  let s = null;

  const publicCopy = () => (s ? JSON.parse(JSON.stringify(s)) : null);
  const changed = () => { try { save(s ? publicCopy() : null); } catch (_) { /* a full disk must not break the lock */ } try { onChange(publicCopy()); } catch (_) { /* a listener's problem */ } };

  function clear(reason) {
    if (!s) return;
    s = null;
    changed();
    return reason;
  }

  /** Let go of anything that has outlived its time (called often, and once when starting up). */
  function tick() {
    if (!s) return false;
    const t = now();
    if (t > s.endsAt + RELEASE_GRACE_MS || t > s.startedAt + MAX_BLOCK_MS + HARD_CEILING_MS) { clear('expired'); return true; }
    return false;
  }

  // a lock saved by the last run carries on until its end, if it still has one
  const saved = load();
  if (saved && typeof saved === 'object' && saved.id && Number(saved.endsAt) > now() && Number(saved.startedAt) > 0) {
    s = {
      id: String(saved.id), startedAt: Number(saved.startedAt), endsAt: Number(saved.endsAt),
      pages: cleanHosts(saved.pages), support: cleanHosts(saved.support), music: saved.music !== false,
      delaySec: Math.min(DELAY_MAX, Math.max(DELAY_MIN, Math.round(Number(saved.delaySec)) || DELAY_DEFAULT)),
      blockApps: saved.blockApps !== false, appMode: saved.appMode === 'allowlist' ? 'allowlist' : 'blocklist',
      appList: cleanNames(saved.appList), appAllow: cleanNames(saved.appAllow),
      exitReqAt: null, blocked: Number(saved.blocked) || 0,
    };
    tick();
  }

  return {
    active: () => { tick(); return !!s; },
    get: () => { tick(); return publicCopy(); },

    /** Start a block. Asking again for the same block changes nothing; a different one is refused while one runs. */
    begin(spec) {
      tick();
      const t = now();
      if (!spec || typeof spec !== 'object') return { ok: false, reason: 'bad' };
      const id = String(spec.id || '').slice(0, 80);
      if (!id) return { ok: false, reason: 'bad' };
      if (s) return s.id === id ? { ok: true, state: publicCopy() } : { ok: false, reason: 'active' };
      const endsAt = Math.min(Number(spec.endsAt), t + MAX_BLOCK_MS);
      if (!Number.isFinite(endsAt) || endsAt <= t + 1000) return { ok: false, reason: 'time' };
      s = {
        id, startedAt: t, endsAt,
        pages: cleanHosts(spec.pages), support: cleanHosts(spec.support), music: spec.music !== false,
        delaySec: Math.min(DELAY_MAX, Math.max(DELAY_MIN, Math.round(Number(spec.delaySec)) || DELAY_DEFAULT)),
        blockApps: spec.blockApps !== false, appMode: spec.appMode === 'allowlist' ? 'allowlist' : 'blocklist',
        appList: cleanNames(spec.appList), appAllow: cleanNames(spec.appAllow),
        exitReqAt: null, blocked: 0,
      };
      changed();
      return { ok: true, state: publicCopy() };
    },

    /** Adding time is fine. Shortening is not, and nothing goes past four hours in all. */
    extend(endsAt) {
      tick();
      const e = Number(endsAt);
      if (!s || !Number.isFinite(e) || e <= s.endsAt || e > s.startedAt + MAX_BLOCK_MS) return { ok: false, reason: 'refused' };
      s.endsAt = e;
      changed();
      return { ok: true, state: publicCopy() };
    },

    exitStatus() {
      tick();
      if (!s || s.exitReqAt == null) return { phase: 'idle', secondsLeft: 0, canConfirm: false };
      const age = now() - s.exitReqAt;
      const delay = s.delaySec * 1000;
      if (age < 0) return { phase: 'waiting', secondsLeft: s.delaySec, canConfirm: false };
      if (age < delay) return { phase: 'waiting', secondsLeft: Math.ceil((delay - age) / 1000), canConfirm: false };
      if (age < delay + CONFIRM_WINDOW_MS) return { phase: 'ready', secondsLeft: 0, canConfirm: true };
      return { phase: 'expired', secondsLeft: 0, canConfirm: false };
    },

    requestExit() {
      tick();
      if (!s) return { ok: false, reason: 'none' };
      const st = this.exitStatus();
      if (st.phase === 'idle' || st.phase === 'expired') { s.exitReqAt = now(); changed(); }
      return { ok: true, status: this.exitStatus() };
    },
    cancelExit() {
      if (s && s.exitReqAt != null) { s.exitReqAt = null; changed(); }
      return { ok: true };
    },
    /** Ending early: only once main's own countdown has run out. */
    confirmExit() {
      tick();
      if (!s) return { ok: true, ended: true };
      if (!this.exitStatus().canConfirm) return { ok: false, reason: 'wait', status: this.exitStatus() };
      clear('early');
      return { ok: true, ended: true };
    },
    /** The block ran its course. Main only believes it once its own clock agrees. */
    end(reason = 'natural') {
      tick();
      if (!s) return { ok: true, ended: true };
      if (reason !== 'natural') return { ok: false, reason: 'refused' };
      if (now() < s.endsAt - 1500) return { ok: false, reason: 'early' };
      clear('natural');
      return { ok: true, ended: true };
    },

    noteBlocked() { if (s) { s.blocked += 1; changed(); } },

    /** May a student go to this page (top-level, or a frame)? */
    isAllowedPage(url) {
      tick();
      if (!s) return false;
      let u; try { u = new URL(url); } catch (_) { return false; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      return s.pages.some(e => hostMatches(u.hostname, e)) || TOP_LEVEL_SUPPORT.some(e => hostMatches(u.hostname, e));
    },
    /** May an approved page load things (scripts, images, fonts) from this host? */
    isAllowedSupport(host) {
      tick();
      if (!s) return false;
      return s.pages.some(e => hostMatches(host, e)) || s.support.some(e => hostMatches(host, e));
    },
    pages: () => (s ? s.pages.slice() : []),
    tick,
  };
}

module.exports = { createStrict, hostMatches, cleanHosts, cleanNames, MAX_BLOCK_MS, DELAY_MIN, DELAY_MAX, DELAY_DEFAULT, CONFIRM_WINDOW_MS, HARD_CEILING_MS, RELEASE_GRACE_MS };
