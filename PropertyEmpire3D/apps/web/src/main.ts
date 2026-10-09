/**
 * Property Empire 3D browser entry point.
 */
import '@fontsource-variable/outfit';
import '@fontsource-variable/figtree';
import './styles/main.css';
import { App } from './app';
import { settings } from './settings';
import { audio } from './audio';
import { closeTopModal, h } from './ui/dom';
import { APP_PAUSE, APP_RESUME } from './platform';
import { logo } from './screens/common';
import { menuScreen } from './screens/menu';
import { joinScreen } from './screens/lan';

function splash(app: App): void {
  app.root.append(h('div', { class: 'screen splash', 'data-testid': 'splash' }, logo('Loading the board...'), h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));
}

function boot(): void {
  settings.load();
  const app = new App();
  app.show(splash);
  // Browsers only allow audio after a user gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });

  // The board texture paints text on a canvas, so the fonts must be ready first
  // (never wait more than a moment: system fonts are a fine fallback).
  const fonts = Promise.all(['700 32px "Outfit Variable"', '600 32px "Figtree Variable"'].map((f) => document.fonts?.load(f).catch(() => undefined)));
  const ready = Promise.race([fonts, new Promise((r) => window.setTimeout(r, 1200))]);
  void ready.then(() => requestAnimationFrame(() => {
    app.ensureRenderer();
    const room = new URLSearchParams(location.search).get('room');
    window.setTimeout(() => app.show(room ? joinScreen : menuScreen), app.e2e ? 0 : 350);
  }));

  if (import.meta.env.PROD && import.meta.env.MODE !== 'standalone' && 'serviceWorker' in navigator && window.isSecureContext && !app.e2e) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }

  // Hooks for the Android wrapper: the system back button and app pause/resume.
  const hooks = window as unknown as Record<string, unknown>;
  hooks.peHandleBack = (): boolean => {
    if (closeTopModal()) return true;
    if (app.backHandler) {
      app.backHandler();
      return true;
    }
    if (app.current && app.current !== menuScreen) {
      app.show(menuScreen);
      return true;
    }
    return false; // on the main menu: let the app close
  };
  hooks.peOnPause = () => window.dispatchEvent(new Event(APP_PAUSE));
  hooks.peOnResume = () => window.dispatchEvent(new Event(APP_RESUME));

  window.addEventListener('error', (e) => console.error('[property-empire]', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[property-empire] unhandled', e.reason));
}

boot();
