import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-alert-dialog';
import { Lock } from 'lucide-react';
import { db, sync } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useFocus } from '@/lib/FocusContext';
import { desktop, isDesktop } from '@/lib/desktop';
import { newer } from '@/lib/releases';
import { isNativeApp } from '@/lib/native';
import { clock } from '@/lib/agenda';
import { termsStatus, TERMS_VERSION } from '@/lib/strictTerms';
import { canWatchApps, linkStatus, linkReady, startWatching, stopWatching, keepReady } from '@/lib/strictLink';
import {
  POLL_MS, getDeviceId, deviceKind, newSession, sessionLive, lockedHere, sessionExit, requestSessionExit, cancelSessionExit,
  confirmSessionExit, reactTo,
} from '@/lib/crossLock';

const KIND_WORDS = { desktop: 'computer', phone: 'phone', web: 'browser' };

/**
 * "Lock my other device too" (optional, off until the student has agreed to the notice in Settings).
 * A strict block started here writes a shared record; a device that finds a live record it did not
 * start shows the takeover screen. Either device can end it after the early-exit wait.
 */
export default function CrossLock() {
  const { user } = useAuth();
  const focus = useFocus();
  const deviceId = useMemo(getDeviceId, []);
  const kind = deviceKind({ desktop: isDesktop, native: isNativeApp });
  const enabled = !!focus.strictPrefs.lockOthers && termsStatus(user?.strictTerms) === 'ok';
  const session = user?.strictSession || null;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [now, setNow] = useState(() => Date.now());
  const live = sessionLive(session, now);
  const locked = enabled && lockedHere(session, { deviceId, now });
  const ownId = focus.strictOn && focus.startedAt ? `${focus.startedAt}-${deviceId}` : null;
  const published = useRef(null);
  const lastEndsAt = useRef(0);
  const wasStrict = useRef(false);
  const keep = useRef(null);

  const save = (rec) => db.auth.updateMe({ strictSession: rec }).catch(() => {});

  // look for a lock started elsewhere every few seconds (the usual check is every five minutes)
  useEffect(() => {
    if (!enabled && !live) return undefined;
    const id = setInterval(() => { sync.refresh().catch(() => {}); }, POLL_MS);
    sync.refresh().catch(() => {});
    return () => clearInterval(id);
  }, [enabled, live]);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [live]);

  // a strict block starts here: tell the other device
  useEffect(() => {
    if (!enabled || !ownId || focus.status !== 'running' || !focus.strictSnapshot || published.current === ownId) return;
    if (session?.id === ownId) { published.current = ownId; return; }
    published.current = ownId;
    const sn = focus.strictSnapshot;
    save(newSession({
      id: ownId, deviceId, kind, startedAt: focus.startedAt, endsAt: focus.endsAt,
      plannedMin: Math.round(focus.total / 60), pages: sn.pages, support: sn.support, music: sn.music, delaySec: sn.exitDelaySec,
      blockApps: sn.blockApps, appMode: sn.appMode, appList: sn.appList, appAllow: sn.appAllow,
    }));
  }, [enabled, ownId, focus.status, focus.strictSnapshot, focus.startedAt, focus.endsAt, focus.total, deviceId, kind, session?.id]);

  // time was added to the block here
  useEffect(() => {
    const s = sessionRef.current;
    if (enabled && ownId && s && s.id === ownId && !s.endedAt && focus.endsAt > s.endsAt + 1000) save({ ...s, endsAt: focus.endsAt });
  }, [enabled, ownId, focus.endsAt]);
  useEffect(() => { if (focus.endsAt) lastEndsAt.current = focus.endsAt; }, [focus.endsAt]);

  // the block here is over: mark the shared record, so the other device lets go
  useEffect(() => {
    if (wasStrict.current && !focus.strictOn) {
      const s = sessionRef.current;
      if (s && s.deviceId === deviceId && !s.endedAt) {
        const early = Date.now() < lastEndsAt.current - 2000;
        save({ ...s, exitReqAt: null, endedAt: Date.now(), endReason: early ? 'early' : 'done' });
      }
    }
    wasStrict.current = focus.strictOn;
  }, [focus.strictOn, deviceId]);

  // the other device ended the block that was started here, after its own wait
  useEffect(() => {
    if (!enabled) return;
    if (reactTo(session, { deviceId, ownSessionId: ownId, now: Date.now() }).action === 'release-own') focus.forceEnd();
  }, [enabled, session?.endedAt, session?.endReason, ownId, deviceId]);

  // the desktop app locks itself too (other sites blocked, programs minimised)
  const mainLinked = useRef(false);
  // (only from 1.0.11 on: older desktop apps would hold a lock the other device already ended, so they just show the screen)
  useEffect(() => {
    if (!isDesktop || !desktop?.strict || newer('1.0.11', desktop.version)) return;
    if (locked && session) {
      mainLinked.current = true;
      desktop.strict.begin({
        id: session.id, endsAt: session.endsAt, pages: session.pages, support: session.support, music: session.music, delaySec: session.delaySec,
        blockApps: session.blockApps, appMode: session.appMode, appList: session.appList, appAllow: session.appAllow, linked: true,
      }).catch(() => {});
    } else if (mainLinked.current) {
      mainLinked.current = false;
      desktop.strict.end('remote').catch(() => {});
    }
  }, [locked, session?.id, session?.endsAt]);

  // the Android app watches the front app for as long as a lock is on, from whichever device started it
  const watching = useRef('');
  useEffect(() => {
    if (!canWatchApps) return;
    const mine = enabled && live && session;
    if (!mine) { if (watching.current) { watching.current = ''; stopWatching(); } return; }
    if (watching.current === session.id) return;
    watching.current = session.id;
    linkStatus().then((s) => { if (linkReady(s)) startWatching({ id: session.id, endsAt: session.endsAt }); else watching.current = ''; });
  }, [enabled, live, session?.id, session?.endsAt]);
  // and, if the student chose it, keeps the link ready with the app closed
  useEffect(() => {
    if (!canWatchApps) return;
    let ready = false;
    try { ready = localStorage.getItem('lockin.linkReady') === '1'; } catch (_) { /* private mode */ }
    keepReady(enabled && ready, { deviceId, termsVersion: TERMS_VERSION });
  }, [enabled, deviceId]);

  if (!locked || !session) return null;

  const exit = sessionExit(session, now);
  const left = Math.max(0, Math.ceil((session.endsAt - now) / 1000));
  const from = KIND_WORDS[session.kind] || 'other device';
  const endNow = () => { const done = confirmSessionExit(session, Date.now()); if (done) save(done); };
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-slate-950" />
        <Dialog.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); keep.current?.focus(); }}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="fixed inset-0 z-[121] flex flex-col items-center justify-center gap-6 overflow-y-auto p-6 text-center text-slate-100">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-white/10"><Lock className="h-8 w-8" aria-hidden="true" /></span>
          <div className="max-w-md">
            <Dialog.Title className="text-2xl font-bold">Locked in from your {from}</Dialog.Title>
            <Dialog.Description className="mt-2 text-base text-slate-300">
              You started a strict focus block on your {from}, and this device is part of it. Calls, texts and emergency apps still work.
            </Dialog.Description>
          </div>
          <p className="text-6xl font-bold tabular-nums" role="timer" aria-label={`${Math.ceil(left / 60)} minutes left`}>{clock(left)}</p>

          {isDesktop && desktop?.strict && (
            <button type="button" onClick={() => desktop.strict.openSite('')}
              className="inline-flex min-h-11 items-center rounded-full border border-white/25 px-5 text-sm font-semibold hover:bg-white/10">
              Open approved sites
            </button>
          )}

          {exit.phase === 'waiting' && <p className="text-base">You can end it in <strong className="text-xl tabular-nums">{exit.secondsLeft}</strong> seconds.</p>}
          {exit.phase === 'ready' && <p className="text-base font-medium">The wait is over. Still want to stop?</p>}
          <p className="sr-only" role="status" aria-live="polite">{exit.phase === 'ready' ? 'You can end the lock now.' : ''}</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {exit.phase === 'idle' || exit.phase === 'expired' ? (
              <button type="button" onClick={() => save(requestSessionExit(session, Date.now()))}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/25 px-5 text-sm font-semibold hover:bg-white/10">
                End early (short wait)
              </button>
            ) : (
              <button type="button" onClick={endNow} disabled={exit.phase !== 'ready'}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/25 px-5 text-sm font-semibold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
                End early
              </button>
            )}
            <button ref={keep} type="button" onClick={() => { if (session.exitReqAt != null) save(cancelSessionExit(session)); }}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-bold text-slate-900 hover:bg-white/90">
              Keep focusing
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
