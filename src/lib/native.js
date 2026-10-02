/**
 * Running inside the Android/iPhone app (Capacitor) rather than a browser.
 *
 * The app shell loads this same web app from the server and injects
 * Capacitor's native bridge, so these plugins talk to the phone there. In a
 * normal browser `isNativeApp` is false and every helper does nothing.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export const isNativeApp = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();   // 'android' | 'ios' | 'web'

/** A light tap of the vibration motor for confirmations. */
export function haptic(style = 'Light') {
  if (!isNativeApp) return;
  Haptics.impact({ style: ImpactStyle[style] || ImpactStyle.Light }).catch(() => {});
}

/** Status bar to match the page: dark icons on light, light on dark. */
export function syncStatusBar(dark) {
  if (!isNativeApp) return;
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  if (platform === 'android') StatusBar.setBackgroundColor({ color: dark ? '#0f172a' : '#ffffff' }).catch(() => {});
}

/**
 * The phone's own speech recogniser. Android's web view has no speech API
 * at all, and the iPhone's only partly, so in the app the voice assistant
 * listens through this instead (lib/listen.js).
 */
export const nativeSpeech = isNativeApp ? SpeechRecognition : null;

if (isNativeApp && typeof document !== 'undefined') {
  document.documentElement.classList.add('native-app', `native-${platform}`);
}
