/**
 * Two lightweight 3D dice. The authoritative engine decides the values first;
 * this only animates a hop-and-spin that settles on those values.
 */
import * as THREE from 'three';
import { ease, type Tweens } from './tween';

const SIZE = 0.5;

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

function faceTexture(value: number): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#FFFDF8';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#E2D9C6';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, s - 6, s - 6);
  ctx.fillStyle = value === 1 ? '#E15554' : '#253344';
  for (const [x, y] of PIPS[value] ?? []) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, value === 1 ? 15 : 11, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Dice {
  readonly group = new THREE.Group();
  private dice: THREE.Mesh[] = [];
  private rest: THREE.Vector3[] = [new THREE.Vector3(-0.42, SIZE / 2, 0.9), new THREE.Vector3(0.42, SIZE / 2, 0.9)];

  constructor() {
    const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.4 }));
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, mats);
      // Yaw is applied last so it never changes which face points up.
      m.rotation.order = 'YXZ';
      m.castShadow = true;
      m.position.copy(this.rest[i] as THREE.Vector3);
      this.group.add(m);
      this.dice.push(m);
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
  }

  /** Animate a roll that lands on the given values. */
  async roll(values: [number, number], tweens: Tweens, durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      this.show(values);
      return;
    }
    const starts = this.dice.map((_, i) => new THREE.Vector3((i === 0 ? -1 : 1) * 2.2, 1.2, 3.2));
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
          d.position.y = SIZE / 2 + hop + (1 - p) * 0.4;
          const left = 1 - ease.outQuad(t);
          const s = spins[i] as number[];
          const f = finals[i] as number[];
          d.rotation.set((f[0] as number) + (s[0] as number) * Math.PI * 2 * left, (f[1] as number) + (s[1] as number) * Math.PI * 2 * left, (f[2] as number) + (s[2] as number) * Math.PI * 2 * left);
        });
      },
      ease.linear
    );
    this.show(values);
  }
}
