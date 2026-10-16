/**
 * The Android side of "lock my other device too" (android/.../StrictLinkPlugin.java). Everything here
 * is a no-op outside the Android app, and on an Android app too old to have the plugin.
 */
import { registerPlugin } from '@capacitor/core';
import { isNativeApp, platform } from './native';

const plugin = isNativeApp && platform === 'android' ? registerPlugin('StrictLink') : null;

export const canWatchApps = !!plugin;
export const isIPhone = isNativeApp && platform === 'ios';

const safe = async (fn, fallback = null) => { try { return await fn(); } catch (_) { return fallback; } };

/** { available, usageAccess, overlay, notifications, dnd, watching } or null if this app has no such plugin. */
export const linkStatus = () => (plugin ? safe(() => plugin.status()) : Promise.resolve(null));

/** Both of these have to be on before anything can be watched. */
export const linkReady = (s) => !!(s && s.usageAccess && s.overlay);

export const openUsageAccess = () => (plugin ? safe(() => plugin.openUsageAccess()) : null);
export const openOverlay = () => (plugin ? safe(() => plugin.openOverlay()) : null);
export const openDnd = () => (plugin ? safe(() => plugin.openDnd()) : null);
export const askNotifications = () => (plugin ? safe(() => plugin.requestNotifications()) : null);

/** Watch the front app until `endsAt`. `allow` = package names the student never wants to be brought back from. */
export const startWatching = ({ id, endsAt, allow = [] }) => (plugin ? safe(() => plugin.start({ id, endsAt, allow })) : null);
export const stopWatching = () => (plugin ? safe(() => plugin.stop()) : null);

/** Keep the link running with the app closed, so a lock started on the computer reaches this phone. */
export const keepReady = (on, { deviceId, termsVersion }) => (plugin
  ? safe(() => plugin.listen({ on: !!on, deviceId, termsVersion, api: new URL('/api/lockin.php', window.location.origin).href }))
  : null);
