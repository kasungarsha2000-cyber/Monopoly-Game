/**
 * App: screen routing plus the shared 3D renderer, which stays alive between
 * screens (it doubles as the animated main-menu background).
 */
import { defaultContext, type RulesContext } from '@pe/game-core';
import { BoardRenderer } from './three/BoardRenderer';
import { settings } from './settings';
import { clear, closeAllModals, h, button } from './ui/dom';

export type Cleanup = (() => void) | void;
export type Screen = (app: App) => Cleanup;

export class App {
  readonly ctx: RulesContext = defaultContext();
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  renderer: BoardRenderer | null = null;
  rendererError: string | null = null;
  private cleanup: Cleanup = undefined;
  /** Test mode (?e2e=1): instant animations and fast bots. */
  readonly e2e: boolean;

  constructor() {
    this.root = document.getElementById('app') as HTMLElement;
    this.stage = document.getElementById('stage') as HTMLElement;
    const params = new URLSearchParams(location.search);
    this.e2e = params.get('e2e') === '1';
  }

  /** Create the WebGL renderer once. Returns null (and shows why) if WebGL is unavailable. */
  ensureRenderer(): BoardRenderer | null {
    if (this.renderer || this.rendererError) return this.renderer;
    try {
      const s = settings.get();
      this.renderer = new BoardRenderer(this.stage, this.ctx.board, {
        quality: settings.effectiveQuality(),
        pixelDensity: s.pixelDensity,
        onContextLost: () => this.showContextLost()
      });
      this.renderer.setCameraOptions(s.cameraRotate, s.invertCamera);
      settings.subscribe((ns) => {
        this.renderer?.setOptions({ quality: settings.effectiveQuality(), pixelDensity: ns.pixelDensity });
        this.renderer?.setCameraOptions(ns.cameraRotate, ns.invertCamera);
      });
    } catch (e) {
      this.rendererError = (e as Error).message || 'WebGL is not available';
    }
    if (this.e2e && this.renderer) (window as unknown as Record<string, unknown>).__pe3d = this.renderer;
    return this.renderer;
  }

  show(screen: Screen): void {
    if (typeof this.cleanup === 'function') this.cleanup();
    this.cleanup = undefined;
    closeAllModals();
    clear(this.root);
    this.cleanup = screen(this);
  }

  private showContextLost(): void {
    const box = h(
      'div',
      { class: 'fatal', role: 'alertdialog', 'aria-label': 'Graphics interrupted' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Graphics were interrupted'),
        h('p', { class: 'subtitle' }, 'The browser reset the 3D graphics (this can happen when a phone is low on memory). Your game is saved; reload to continue.'),
        button('Reload', () => location.reload(), { variant: 'primary', block: true })
      )
    );
    this.root.append(box);
  }
}
