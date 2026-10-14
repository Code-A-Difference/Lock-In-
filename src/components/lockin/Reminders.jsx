import { useEffect, useMemo, useRef } from 'react';
import { useStudyData } from '@/lib/data';
import { usePlanner } from '@/lib/PlannerContext';
import { plannedReminders, DEFAULT_REMINDERS } from '@/lib/reminders';
import { isNativeApp, platform } from '@/lib/native';

const FIRED = 'lockin.reminders.fired';
const LATE_OK_MS = 90 * 60 * 1000;      // opened the app a little after a reminder was due: still show it

const readFired = () => { try { return JSON.parse(localStorage.getItem(FIRED) || '{}'); } catch (_) { return {}; } };
const writeFired = (m) => {
  const cut = Date.now() - 3 * 864e5;                       // forget what's long past
  const kept = Object.fromEntries(Object.entries(m).filter(([, t]) => t > cut));
  try { localStorage.setItem(FIRED, JSON.stringify(kept)); } catch (_) { /* private mode */ }
};

let native = null;
async function phoneNotifications() {
  if (!isNativeApp || platform !== 'android') return null;
  if (!native) native = import('@capacitor/local-notifications').then(m => m.LocalNotifications).catch(() => null);
  return native;
}

/** Ask to be allowed to notify. Resolves true if allowed. */
export async function allowReminders() {
  const phone = await phoneNotifications();
  if (phone) {
    const r = await phone.requestPermissions().catch(() => null);
    return r?.display === 'granted';
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission().catch(() => 'denied')) === 'granted';
}

/**
 * Shows deadline reminders. On Android they're handed to the phone, which shows them
 * even when the app is closed. On the desktop app and in a browser they are shown by
 * this page while it's running (the desktop app keeps running in the tray).
 */
export default function Reminders() {
  const { user, homework, tests } = useStudyData();
  const planner = usePlanner();
  const prefs = useMemo(() => ({ ...DEFAULT_REMINDERS, ...(user?.reminders || {}) }), [user?.reminders]);
  const plan = useMemo(() => plannedReminders({ homework, tests, schedule: planner.schedule, prefs }),
    [homework, tests, planner.schedule, prefs]);
  const timers = useRef([]);

  // Android: the phone schedules them all
  useEffect(() => {
    let live = true;
    (async () => {
      const phone = await phoneNotifications();
      if (!phone || !live) return;
      try {
        const pending = await phone.getPending();
        if (pending?.notifications?.length) await phone.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
        if (!prefs.on || !plan.length) return;
        const perm = await phone.checkPermissions();
        if (perm.display !== 'granted') return;
        await phone.schedule({
          notifications: plan.slice(0, 60).map(r => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true } })),
        });
      } catch (_) { /* the phone said no: nothing to do but try again next time */ }
    })();
    return () => { live = false; };
  }, [plan, prefs.on]);

  // Desktop and browser: timers for the next day, refreshed every half hour
  useEffect(() => {
    if (isNativeApp && platform === 'android') return undefined;
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    const arm = () => {
      clear();
      if (!prefs.on || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const fired = readFired();
      const now = Date.now();
      for (const r of plan) {
        const due = r.at.getTime();
        if (fired[r.key]) continue;
        if (due - now > 864e5) break;                       // sorted: the rest are further out
        const show = () => {
          const f = readFired();
          if (f[r.key]) return;
          f[r.key] = Date.now();
          writeFired(f);
          try {
            const n = new Notification(r.title, { body: r.body, tag: r.key, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` });
            n.onclick = () => { window.focus(); n.close(); };
          } catch (_) { /* the browser refused at the last moment */ }
        };
        if (due <= now) { if (now - due < LATE_OK_MS) show(); }
        else timers.current.push(setTimeout(show, due - now));
      }
    };
    arm();
    const again = setInterval(arm, 30 * 60 * 1000);
    return () => { clear(); clearInterval(again); };
  }, [plan, prefs.on]);

  return null;
}
