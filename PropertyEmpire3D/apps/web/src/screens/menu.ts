import { createGame, PLAYER_COLORS, TOKENS, type GameState, type TokenId } from '@pe/game-core';
import type { App } from '../app';
import { button, h } from '../ui/dom';
import { logo } from './common';
import { soloSetupScreen } from './soloSetup';
import { lanCreateScreen, joinScreen } from './lan';
import { continueScreen } from './continue';
import { settingsScreen } from './settingsScreen';
import { howToScreen } from './howto';
import { hasSaves } from '../storage';
import { loadLanSession } from '../session/LanClient';

let demoState: GameState | null = null;

/** A decorative board state for the animated menu background. */
function demo(app: App): GameState {
  if (demoState) return demoState;
  const { state } = createGame(
    {
      players: TOKENS.slice(0, 5).map((t, i) => ({ id: `d${i}`, name: `Demo ${i}`, kind: 'bot' as const, token: t as TokenId, color: PLAYER_COLORS[i] as string })),
      seed: 7
    },
    app.ctx
  );
  const own: [number, number, number][] = [
    [16, 0, 3],
    [18, 0, 3],
    [19, 0, 2],
    [37, 1, 5],
    [39, 1, 5],
    [6, 2, 1],
    [8, 2, 1],
    [9, 2, 1],
    [5, 3, 0],
    [25, 4, 0],
    [12, 3, 0]
  ];
  for (const [s, p, houses] of own) {
    const prop = state.properties[s];
    if (prop) {
      prop.owner = `d${p}`;
      prop.houses = houses;
    }
  }
  [0, 11, 24, 31, 10].forEach((pos, i) => {
    const pl = state.players[i];
    if (pl) pl.position = pos;
  });
  demoState = state;
  return state;
}

export function menuScreen(app: App): () => void {
  const r = app.ensureRenderer();
  if (r) {
    r.setInsets({ left: 0, right: 0, top: 0, bottom: 0 }, 0.82);
    r.syncState(demo(app));
    r.setSelected(null);
    r.setHighlights([]);
    r.setAttract(true);
  }
  const continueBtn = button('Continue Saved Game', () => app.show(continueScreen), { block: true, disabled: true, testid: 'menu-continue' });
  void hasSaves().then((has) => {
    if (has || loadLanSession()) continueBtn.disabled = false;
  });
  const fsBtn = document.fullscreenEnabled
    ? button(
        'Fullscreen',
        () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen().catch(() => undefined);
        },
        { variant: 'ghost', small: true }
      )
    : null;
  // The standalone page (claude.ai artifact) has no host server, so LAN play is unavailable there.
  const standalone = import.meta.env.MODE === 'standalone';
  const card = h(
    'div',
    { class: 'card menu-card', 'data-testid': 'main-menu' },
    logo('Buy streets. Build a skyline. Outsmart your friends.'),
    h(
      'div',
      { class: 'menu-buttons' },
      button('Play Solo', () => app.show(soloSetupScreen), { variant: 'primary', block: true, testid: 'menu-solo' }),
      button('Create LAN Game', () => app.show(lanCreateScreen), { variant: 'success', block: true, testid: 'menu-create-lan', disabled: standalone }),
      button('Join LAN Game', () => app.show(joinScreen), { block: true, testid: 'menu-join-lan', disabled: standalone }),
      standalone
        ? h('p', { class: 'muted small-text', style: 'margin:0;text-align:center' }, 'LAN games need the host server. Run "npm run start:lan" on a computer on your Wi-Fi and open the address it prints.')
        : null,
      continueBtn
    ),
    h(
      'div',
      { class: 'menu-footer' },
      button('Settings', () => app.show(settingsScreen), { variant: 'ghost', small: true, testid: 'menu-settings' }),
      button('How to Play', () => app.show(howToScreen), { variant: 'ghost', small: true, testid: 'menu-howto' }),
      fsBtn
    ),
    app.rendererError ? h('div', { class: 'callout warn' }, `3D graphics are unavailable: ${app.rendererError}. Try another browser or enable hardware acceleration.`) : null,
    h('div', { class: 'version' }, 'v1.0 · original board and artwork · no account needed')
  );
  app.root.append(h('div', { class: 'screen' }, card));
  return () => app.renderer?.setAttract(false);
}
