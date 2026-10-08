/**
 * SettingsManager: persistent player preferences in localStorage. Every read
 * and write is guarded so private browsing or blocked storage never breaks
 * the game.
 */
export type AnimationSpeed = 'normal' | 'fast' | 'reduced';
export type GraphicsQuality = 'low' | 'medium' | 'high';
export type PixelDensity = 'auto' | '1' | '1.5' | '2';

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  animationSpeed: AnimationSpeed;
  graphicsQuality: GraphicsQuality;
  cameraRotate: boolean;
  invertCamera: boolean;
  reducedMotion: boolean;
  confirmDestructive: boolean;
  pixelDensity: PixelDensity;
  mobilePreset: boolean;
  playerName: string;
  playerToken: string;
}

const KEY = 'pe.settings.v1';

export function isMobileDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
}

function defaults(): Settings {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = typeof matchMedia === 'function' && isMobileDevice();
  return {
    masterVolume: 0.8,
    musicVolume: 0.25,
    effectsVolume: 0.8,
    animationSpeed: reduced ? 'reduced' : 'normal',
    graphicsQuality: mobile ? 'low' : 'medium',
    cameraRotate: true,
    invertCamera: false,
    reducedMotion: reduced,
    confirmDestructive: true,
    pixelDensity: 'auto',
    mobilePreset: true,
    playerName: '',
    playerToken: 'pawn'
  };
}

type Listener = (s: Settings) => void;

class SettingsStore {
  private value: Settings = defaults();
  private listeners = new Set<Listener>();

  load(): Settings {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        const d = defaults();
        const merged = { ...d } as Settings;
        for (const k of Object.keys(d) as (keyof Settings)[]) {
          if (parsed[k] !== undefined && typeof parsed[k] === typeof d[k]) (merged as unknown as Record<string, unknown>)[k] = parsed[k];
        }
        this.value = merged;
      }
    } catch {
      this.value = defaults();
    }
    this.applyBodyClasses();
    return this.value;
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    if (patch.reducedMotion === true) this.value.animationSpeed = 'reduced';
    if (patch.animationSpeed && patch.animationSpeed !== 'reduced') this.value.reducedMotion = false;
    if (patch.animationSpeed === 'reduced') this.value.reducedMotion = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage unavailable: keep in memory */
    }
    this.applyBodyClasses();
    for (const l of this.listeners) l(this.value);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Graphics preset actually used (phones get Low when the mobile preset is on). */
  effectiveQuality(): GraphicsQuality {
    return this.value.mobilePreset && isMobileDevice() ? 'low' : this.value.graphicsQuality;
  }

  /** Multiplier applied to animation durations (0 = instant). */
  animationScale(): number {
    const s = this.value.animationSpeed;
    if (s === 'reduced' || this.value.reducedMotion) return 0;
    return s === 'fast' ? 0.45 : 1;
  }

  private applyBodyClasses(): void {
    document.body.classList.toggle('reduced-motion', this.value.reducedMotion);
  }
}

export const settings = new SettingsStore();
