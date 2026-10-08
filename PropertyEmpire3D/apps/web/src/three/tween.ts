/**
 * Minimal tween scheduler driven by the renderer's animation loop. Tweens
 * resolve promises so event playback can simply `await` animations. A
 * duration of 0 completes immediately (reduced motion).
 */
export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outQuad: (t: number) => 1 - (1 - t) * (1 - t)
};

interface Tween {
  start: number;
  duration: number;
  update: (t: number) => void;
  ease: Ease;
  resolve: () => void;
}

export class Tweens {
  private active: Tween[] = [];

  get busy(): boolean {
    return this.active.length > 0;
  }

  /** Run `update(progress)` over `durationMs`. */
  run(durationMs: number, update: (t: number) => void, easing: Ease = ease.inOutCubic): Promise<void> {
    if (durationMs <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.active.push({ start: performance.now(), duration: durationMs, update, ease: easing, resolve });
    });
  }

  /** Advance all tweens; returns true if any are still running. */
  tick(now: number): boolean {
    if (this.active.length === 0) return false;
    const done: Tween[] = [];
    for (const tw of this.active) {
      const t = Math.min(1, (now - tw.start) / tw.duration);
      tw.update(tw.ease(t));
      if (t >= 1) done.push(tw);
    }
    if (done.length) {
      this.active = this.active.filter((t) => !done.includes(t));
      for (const d of done) d.resolve();
    }
    return this.active.length > 0;
  }

  /** Finish everything instantly (e.g. when skipping animations). */
  finishAll(): void {
    const all = this.active;
    this.active = [];
    for (const tw of all) {
      tw.update(1);
      tw.resolve();
    }
  }
}

export function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => window.setTimeout(r, ms));
}
