import React, { useCallback, useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { canWatchApps, isIPhone, linkStatus, linkReady, openUsageAccess, openOverlay, openDnd, askNotifications, keepReady } from '@/lib/strictLink';
import { TERMS_VERSION } from '@/lib/strictTerms';

const btn = 'inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold text-foreground hover:bg-secondary';

/** The permissions the Android app needs to watch other apps for a lock, one plain-language row at a time. */
export default function PhoneLinkSettings({ deviceId }) {
  const [s, setS] = useState(undefined);       // undefined = asking, null = this app can't do it
  const [ready, setReady] = useState(() => { try { return localStorage.getItem('lockin.linkReady') === '1'; } catch (_) { return false; } });
  const refresh = useCallback(() => { linkStatus().then(setS); }, []);
  useEffect(() => {
    refresh();
    const on = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [refresh]);

  if (isIPhone) {
    return <p className="text-sm text-muted-foreground">On iPhone and iPad, LOCK IN! shows its focus screen but Apple does not let any app watch other apps. For a full lock, also turn on Do Not Disturb or a Focus in Control Center.</p>;
  }
  if (!canWatchApps || s === null) {
    return <p className="text-sm text-muted-foreground">This phone app is too old to watch other apps. Update the LOCK IN! app, then come back here. Until then it still shows the focus screen.</p>;
  }
  if (s === undefined) return <p className="text-sm text-muted-foreground" role="status">Checking this phone…</p>;

  const row = (id, title, why, ok, action, label, optional) => (
    <li key={id} className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}{optional && <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>}</p>
        <p className="text-xs text-muted-foreground">{why}</p>
      </div>
      {ok ? <span className="flex-none text-sm font-semibold text-emerald-700 dark:text-emerald-400">On</span> : <button type="button" className={btn} onClick={action}>{label}</button>}
    </li>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">To bring you back when another app opens, this phone needs your permission. Phone, messages and emergency apps are never touched. You can switch any of these off in your phone’s settings; the lock then just stops working.</p>
      <ul className="divide-y rounded-lg border" aria-label="Phone permissions">
        {row('usage', 'Usage access', 'Lets LOCK IN! see which app is in front (never what you do in it).', s.usageAccess, openUsageAccess, 'Open settings')}
        {row('overlay', 'Display over other apps', 'Lets LOCK IN! come back to the front.', s.overlay, openOverlay, 'Open settings')}
        {row('notif', 'Notifications', 'Shows a notice while a lock is on.', s.notifications, async () => { await askNotifications(); refresh(); }, 'Allow')}
        {row('dnd', 'Do Not Disturb access', 'Lets a lock quiet other alerts.', s.dnd, openDnd, 'Open settings', true)}
      </ul>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor="linkReady" className="min-w-0 text-sm text-foreground">
          <span className="block font-medium">Keep the link ready when the app is closed</span>
          <span className="block text-xs text-muted-foreground">So a lock started on your computer reaches this phone even if LOCK IN! isn’t open. Shows a small notice all the time. May not work if the phone has been idle a long time.</span>
        </label>
        <Switch id="linkReady" checked={ready && linkReady(s)} disabled={!linkReady(s)}
          onCheckedChange={(v) => {
            setReady(v);
            try { localStorage.setItem('lockin.linkReady', v ? '1' : '0'); } catch (_) { /* private mode */ }
            keepReady(v, { deviceId, termsVersion: TERMS_VERSION });
          }} />
      </div>
    </div>
  );
}
