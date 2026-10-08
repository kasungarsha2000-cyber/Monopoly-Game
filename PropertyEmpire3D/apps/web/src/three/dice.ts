/**
 * Two lightweight 3D dice. The authoritative engine decides the values first;
 * this only animates a hop-and-spin that settles on those values.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ease, type Tweens } from './tween';
import { blobTexture } from './textures';
import { DICE_TRAY } from './city';

const SIZE = 0.62;

/** Material index (BoxGeometry face order +x,-x,+y,-y,+z,-z) -> pip value. */
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

/** Euler rotation that puts `value` on top (+Y). */
const TOP_ROTATION: Record<number, [number, number, number]> = {
  1: [0, 0, 0],
  6: [Math.PI, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  5: [Math.PI / 2, 0, 0],
  3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2]
};

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73]
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73]
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73]
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73]
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75]
  ]
};

interface DieStyle {
  face: [string, string];
  pip: [string, string];
  one: [string, string];
}

const IVORY: DieStyle = { face: ['#FFFEFA', '#EFE8DA'], pip: ['#41546B', '#141E2A'], one: ['#F07070', '#B92F2F'] };
const GREEN: DieStyle = { face: ['#2F7A5A', '#1F5A42'], pip: ['#FFF8E6', '#E9DDBE'], one: ['#FFE08A', '#E9B949'] };

function faceTexture(value: number, style: DieStyle): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const bg = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.75);
  bg.addColorStop(0, style.face[0]);
  bg.addColorStop(1, style.face[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);
  for (const [x, y] of PIPS[value] ?? []) {
    const r = value === 1 ? 30 : 21;
    const px = x * s;
    const py = y * s;
    const colors = value === 1 ? style.one : style.pip;
    const g = ctx.createRadialGradient(px - r * 0.25, py - r * 0.3, r * 0.1, px, py, r);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Dice {
  readonly group = new THREE.Group();
  private dice: THREE.Mesh[] = [];
  private blobs: THREE.Mesh[] = [];
  // Resting on the felt dice tray (tray surface is at y = 0.115).
  private rest: THREE.Vector3[] = [new THREE.Vector3(DICE_TRAY.x - 0.45, SIZE / 2 + 0.115, DICE_TRAY.z - 0.15), new THREE.Vector3(DICE_TRAY.x + 0.45, SIZE / 2 + 0.115, DICE_TRAY.z + 0.2)];

  constructor() {
    // Rounded cube; it keeps BoxGeometry's per-face material groups.
    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 5, SIZE * 0.14);
    const styles = [IVORY, GREEN];
    for (let i = 0; i < 2; i++) {
      const mats = FACE_VALUES.map((v) => new THREE.MeshPhysicalMaterial({ map: faceTexture(v, styles[i] as DieStyle), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
      const m = new THREE.Mesh(geo, mats);
      // Yaw is applied last so it never changes which face points up.
      m.rotation.order = 'YXZ';
      m.castShadow = true;
      m.position.copy(this.rest[i] as THREE.Vector3);
      this.group.add(m);
      this.dice.push(m);
      // Soft contact shadow that stays on the board while the die hops.
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.renderOrder = 1;
      this.group.add(blob);
      this.blobs.push(blob);
    }
    this.show([5, 2]);
  }

  /** Snap to show values without animation. */
  show(values: [number, number]): void {
    values.forEach((v, i) => {
      const d = this.dice[i] as THREE.Mesh;
      const r = TOP_ROTATION[v] ?? [0, 0, 0];
      d.rotation.set(r[0], (i === 0 ? 0.25 : -0.35), r[2]);
      d.position.copy(this.rest[i] as THREE.Vector3);
    });
    this.updateBlobs();
  }

  private updateBlobs(): void {
    this.dice.forEach((d, i) => {
      const b = this.blobs[i];
      if (!b) return;
      b.position.set(d.position.x, 0.12, d.position.z);
      const lift = Math.max(0, d.position.y - SIZE / 2 - 0.115);
      b.scale.setScalar(1 + lift * 0.6);
      (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - lift * 0.7);
    });
  }

  /** Animate a roll that lands on the given values. */
  async roll(values: [number, number], tweens: Tweens, durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      this.show(values);
      return;
    }
    const starts = this.dice.map((_, i) => new THREE.Vector3(DICE_TRAY.x + (i === 0 ? -0.9 : 0.6), 1.6, DICE_TRAY.z + 2.4));
    const spins = this.dice.map(() => [2 + Math.floor(Math.random() * 3), 1 + Math.floor(Math.random() * 2), 2 + Math.floor(Math.random() * 3)]);
    const finals = values.map((v, i) => {
      const r = TOP_ROTATION[v] ?? [0, 0, 0];
      return [r[0], i === 0 ? 0.25 : -0.35, r[2]];
    });
    await tweens.run(
      durationMs,
      (t) => {
        this.dice.forEach((d, i) => {
          const from = starts[i] as THREE.Vector3;
          const to = this.rest[i] as THREE.Vector3;
          const p = ease.outCubic(t);
          d.position.x = from.x + (to.x - from.x) * p;
          d.position.z = from.z + (to.z - from.z) * p;
          // Three decaying hops.
          const hop = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 1.1;
          d.position.y = SIZE / 2 + 0.115 + hop + (1 - p) * 0.4;
          const left = 1 - ease.outQuad(t);
          const s = spins[i] as number[];
          const f = finals[i] as number[];
          d.rotation.set((f[0] as number) + (s[0] as number) * Math.PI * 2 * left, (f[1] as number) + (s[1] as number) * Math.PI * 2 * left, (f[2] as number) + (s[2] as number) * Math.PI * 2 * left);
        });
        this.updateBlobs();
      },
      ease.linear
    );
    this.show(values);
  }
}
