/**
 * CameraRig: an orbit-limited perspective camera with mouse, touch and
 * keyboard input, smooth focus on tiles and UI-aware framing (the board is
 * centered in the area not covered by HUD panels).
 */
import * as THREE from 'three';
import { BOARD } from './layout';
import { ease, type Tweens } from './tween';

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MIN_POLAR = 0.32;
const MAX_POLAR = 1.2;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, 0, 0);
  azimuth = 0;
  polar = 0.82;
  radius = 18;
  private fitRadius = 18;
  private width = 1;
  private height = 1;
  private insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  rotateEnabled = true;
  invert = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.apply();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.refit();
  }

  setInsets(insets: Insets): void {
    this.insets = insets;
    this.refit();
  }

  /** Recompute the zoom that shows the whole board inside the free area. */
  private refit(): void {
    const freeW = Math.max(120, this.width - this.insets.left - this.insets.right);
    const freeH = Math.max(120, this.height - this.insets.top - this.insets.bottom);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    // Fraction of the full viewport the free area occupies.
    const fx = freeW / this.width;
    const fy = freeH / this.height;
    const aspect = this.width / this.height;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const needW = (BOARD * 1.08) / 2 / Math.tan((hfov * fx) / 2);
    const needH = (BOARD * 0.95 * Math.cos(this.polar * 0.6)) / 2 / Math.tan((vfov * fy) / 2);
    const prevFit = this.fitRadius;
    this.fitRadius = THREE.MathUtils.clamp(Math.max(needW, needH), 9, 40);
    // Keep the user's zoom relative to the fitted distance.
    this.radius = THREE.MathUtils.clamp(this.radius * (this.fitRadius / prevFit), 6, 46);
    this.camera.aspect = aspect;
    // Shift the projection so the board centers in the free area.
    const dx = (this.insets.left - this.insets.right) / 2;
    const dy = (this.insets.top - this.insets.bottom) / 2;
    this.camera.setViewOffset(this.width, this.height, -dx, -dy, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  apply(): void {
    const sinP = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.radius * sinP * Math.sin(this.azimuth),
      this.target.y + this.radius * Math.cos(this.polar),
      this.target.z + this.radius * sinP * Math.cos(this.azimuth)
    );
    this.camera.lookAt(this.target);
  }

  rotate(dx: number, dy: number): void {
    if (!this.rotateEnabled) return;
    const sign = this.invert ? -1 : 1;
    this.azimuth -= dx * 0.006 * sign;
    this.polar = THREE.MathUtils.clamp(this.polar - dy * 0.004 * sign, MIN_POLAR, MAX_POLAR);
    this.apply();
  }

  zoom(factor: number): void {
    this.radius = THREE.MathUtils.clamp(this.radius * factor, this.fitRadius * 0.38, this.fitRadius * 1.6);
    this.apply();
  }

  pan(dxPx: number, dyPx: number): void {
    const scale = (this.radius / this.height) * 1.1;
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    const forward = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    this.target.addScaledVector(right, -dxPx * scale);
    this.target.addScaledVector(forward, dyPx * scale);
    const lim = BOARD / 2;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -lim, lim);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -lim, lim);
    this.apply();
  }

  /** Smoothly move to a new view. */
  animateTo(tweens: Tweens, to: { target?: THREE.Vector3; radius?: number; azimuth?: number; polar?: number }, durationMs: number): Promise<void> {
    const from = { t: this.target.clone(), r: this.radius, a: this.azimuth, p: this.polar };
    const toT = to.target ?? from.t;
    const toR = to.radius ?? from.r;
    let toA = to.azimuth ?? from.a;
    // Take the short way around.
    while (toA - from.a > Math.PI) toA -= Math.PI * 2;
    while (toA - from.a < -Math.PI) toA += Math.PI * 2;
    const toP = to.polar ?? from.p;
    return tweens.run(
      durationMs,
      (k) => {
        this.target.lerpVectors(from.t, toT, k);
        this.radius = from.r + (toR - from.r) * k;
        this.azimuth = from.a + (toA - from.a) * k;
        this.polar = from.p + (toP - from.p) * k;
        this.apply();
      },
      ease.inOutCubic
    );
  }

  focusPoint(tweens: Tweens, x: number, z: number, durationMs: number): Promise<void> {
    return this.animateTo(tweens, { target: new THREE.Vector3(x * 0.85, 0, z * 0.85), radius: this.fitRadius * 0.62 }, durationMs);
  }

  reset(tweens: Tweens, durationMs: number): Promise<void> {
    return this.animateTo(tweens, { target: new THREE.Vector3(0, 0, 0), radius: this.fitRadius, azimuth: 0, polar: 0.82 }, durationMs);
  }

  get defaultRadius(): number {
    return this.fitRadius;
  }
}
