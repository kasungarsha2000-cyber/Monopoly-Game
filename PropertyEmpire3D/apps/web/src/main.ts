/**
 * Property Empire 3D browser entry point.
 */
import './styles/main.css';
import { App } from './app';
import { settings } from './settings';
import { audio } from './audio';
import { h } from './ui/dom';
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

  requestAnimationFrame(() => {
    app.ensureRenderer();
    const room = new URLSearchParams(location.search).get('room');
    window.setTimeout(() => app.show(room ? joinScreen : menuScreen), app.e2e ? 0 : 350);
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext && !app.e2e) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }

  window.addEventListener('error', (e) => console.error('[property-empire]', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[property-empire] unhandled', e.reason));
}

boot();
