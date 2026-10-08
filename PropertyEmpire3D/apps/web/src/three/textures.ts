/**
 * Procedural textures (no image downloads): wood grain for the table and the
 * board frame, a soft contact-shadow blob, and the scene background gradient.
 */
import * as THREE from 'three';

/** Deterministic pseudo-random so textures look the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export interface WoodOptions {
  width: number;
  height: number;
  base: string;
  planks: number;
  seed: number;
  /** Grain lines per plank. */
  grain?: number;
}

/** Wood planks running along X, with grain, subtle color variation and seams. */
export function woodCanvas(o: WoodOptions): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = o.width;
  c.height = o.height;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const rand = rng(o.seed);
  const plankH = o.height / o.planks;
  for (let p = 0; p < o.planks; p++) {
    const y0 = p * plankH;
    const tone = 0.9 + rand() * 0.2;
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + plankH);
    grad.addColorStop(0, shade(o.base, tone * 1.04));
    grad.addColorStop(1, shade(o.base, tone * 0.94));
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, o.width, plankH);
    // Grain: long wavy strokes.
    const lines = o.grain ?? 26;
    for (let i = 0; i < lines; i++) {
      const y = y0 + rand() * plankH;
      const amp = 1 + rand() * plankH * 0.06;
      const freq = 0.002 + rand() * 0.006;
      const phase = rand() * Math.PI * 2;
      ctx.strokeStyle = rand() < 0.75 ? `rgba(60,35,15,${0.05 + rand() * 0.1})` : `rgba(255,240,215,${0.05 + rand() * 0.08})`;
      ctx.lineWidth = 0.6 + rand() * 2.2;
      ctx.beginPath();
      for (let x = 0; x <= o.width; x += 16) {
        const yy = y + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.25;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // Occasional knot.
    if (rand() < 0.5) {
      const kx = rand() * o.width;
      const ky = y0 + plankH * (0.3 + rand() * 0.4);
      for (let r = 1; r < 6; r++) {
        ctx.strokeStyle = `rgba(70,40,18,${0.12 - r * 0.015})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r * plankH * 0.07, r * plankH * 0.025, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Plank seam and staggered butt joints.
    ctx.fillStyle = 'rgba(40,22,10,0.35)';
    ctx.fillRect(0, y0, o.width, Math.max(1, plankH * 0.012));
    const joint = (rand() * o.width) | 0;
    ctx.fillRect(joint, y0, Math.max(1, plankH * 0.012), plankH);
  }
  return c;
}

export function woodTexture(o: WoodOptions, repeatX = 1, repeatY = 1, anisotropy = 4): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(woodCanvas(o));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  return tex;
}

/** Soft radial blob used as a cheap contact shadow under tokens and dice. */
export function blobTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(30,20,10,0.55)');
  g.addColorStop(0.45, 'rgba(30,20,10,0.28)');
  g.addColorStop(1, 'rgba(30,20,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Warm vertical gradient for the scene background. */
export function backgroundTexture(top: string, bottom: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small tileable paper-grain pattern for the board surface. */
export function paperPattern(ctx: CanvasRenderingContext2D, seed = 7): CanvasPattern | null {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(s, s);
  const rand = rng(seed);
  for (let i = 0; i < s * s; i++) {
    const v = rand();
    const dark = v < 0.5;
    img.data[i * 4] = dark ? 90 : 255;
    img.data[i * 4 + 1] = dark ? 70 : 250;
    img.data[i * 4 + 2] = dark ? 40 : 235;
    img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 30);
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}
