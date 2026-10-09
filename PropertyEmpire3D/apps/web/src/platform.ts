/**
 * Where the game is running. The Android app (apps/android) loads the same
 * single-file build in a WebView and exposes a small `PEAndroid` bridge.
 */
export const androidApp = typeof (window as unknown as { PEAndroid?: unknown }).PEAndroid !== 'undefined';

/** App lifecycle events sent by the Android wrapper (window.peOnPause / peOnResume). */
export const APP_PAUSE = 'pe:app-pause';
export const APP_RESUME = 'pe:app-resume';
