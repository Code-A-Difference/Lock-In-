/**
 * The optional "lock my other device too" feature, as pure rules (no React, no network).
 * A strict block started on one device writes a small shared record, `strictSession`, into the
 * student's profile. Every device that sees a live record it did not start shows the takeover screen.
 * Ending it from either device (after the early-exit countdown) ends it for both.
 */
import { exitStatus, exitRequest, MAX_BLOCK_MIN } from './strictFocus.js';

export const MAX_SESSION_MS = MAX_BLOCK_MIN * 60 * 1000;
export const POLL_MS = 10 * 1000;                  // how often a device looks for a lock started elsewhere

/** A short random id for this browser or app, kept so a device recognises its own lock. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem('lockin.deviceId');
    if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('lockin.deviceId', id); }
    return id;
  } catch (_) { return 'tmp-' + Math.random().toString(36).slice(2, 8); }
}

/** A short name for this device, kept per browser. */
export function deviceKind({ desktop = false, native = false } = {}) {
  return desktop ? 'desktop' : native ? 'phone' : 'web';
}

/** Build the shared record from a strict block that has just started on this device. */
export function newSession({ id, deviceId, kind, startedAt, endsAt, plannedMin, pages, support, music, delaySec, blockApps, appMode, appList, appAllow }) {
  const end = Math.min(Number(endsAt), Number(startedAt) + MAX_SESSION_MS);
  return {
    id: String(id), deviceId: String(deviceId), kind: String(kind || 'web'),
    startedAt: Number(startedAt), endsAt: end, plannedMin: Math.round(Number(plannedMin)) || Math.round((end - startedAt) / 60000),
    pages: Array.isArray(pages) ? pages.slice(0, 100) : [], support: Array.isArray(support) ? support.slice(0, 100) : [],
    music: music !== false, delaySec: Number(delaySec) || 30,
    blockApps: blockApps !== false, appMode: appMode === 'allowlist' ? 'allowlist' : 'blocklist',
    appList: Array.isArray(appList) ? appList : [], appAllow: Array.isArray(appAllow) ? appAllow : [],
    exitReqAt: null, endedAt: null,
  };
}

/** Is this record a lock that is still on? A record can never outlive its end time, whatever else is true. */
export function sessionLive(s, now = Date.now()) {
  if (!s || typeof s !== 'object' || !s.id || s.endedAt) return false;
  if (!(Number(s.endsAt) > now)) return false;
  if (Number(s.endsAt) - Number(s.startedAt) > MAX_SESSION_MS) return false;
  return true;
}

/**
 * Two devices started a block at nearly the same moment: the earlier start wins (ties go to the smaller id),
 * so neither device ends up with a looser or shorter lock than the one that was first.
 */
export function pickSession(a, b, now = Date.now()) {
  const la = sessionLive(a, now), lb = sessionLive(b, now);
  if (la && !lb) return a;
  if (lb && !la) return b;
  if (!la && !lb) return (a && b) ? (Number(a.endedAt || 0) >= Number(b.endedAt || 0) ? a : b) : (a || b || null);
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? a : b;
  return String(a.id) <= String(b.id) ? a : b;
}

/** Should this device show the takeover screen for the shared record? */
export function lockedHere(s, { deviceId, now = Date.now() } = {}) {
  return sessionLive(s, now) && s.deviceId !== deviceId;
}

/** The early-exit countdown, kept on the shared record so either device can run it. */
export function sessionExit(s, now = Date.now()) {
  return exitStatus({ exitReqAt: s?.exitReqAt ?? null }, now, s?.delaySec);
}
export function requestSessionExit(s, now = Date.now()) {
  const asked = exitRequest({ exitReqAt: s.exitReqAt ?? null }, now);
  return { ...s, exitReqAt: asked.exitReqAt };
}
export function cancelSessionExit(s) { return { ...s, exitReqAt: null }; }
/** Only once the countdown is over. Returns the record marked ended, or null if it is too soon. */
export function confirmSessionExit(s, now = Date.now()) {
  if (!sessionExit(s, now).canConfirm) return null;
  return { ...s, exitReqAt: null, endedAt: now, endReason: 'early' };
}

/** The record to store once a block ran its course. */
export function finishSession(s, now = Date.now()) {
  return { ...s, exitReqAt: null, endedAt: now, endReason: 'done' };
}

/** What a device does with the record it just read: nothing, lock, or let its own block go. */
export function reactTo(s, { deviceId, ownSessionId = null, now = Date.now() } = {}) {
  if (lockedHere(s, { deviceId, now })) return { action: 'lock', session: s };
  // the block this device started was ended from the other device
  if (s && ownSessionId && s.id === ownSessionId && s.endedAt && s.endReason === 'early') return { action: 'release-own', session: s };
  return { action: 'none' };
}
