/**
 * Procedural low-poly meshes built from Three.js primitives: player tokens,
 * houses, hotels. Geometries are created once and shared; materials are
 * cached per color to keep draw-call and memory costs low.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TokenId } from '@pe/game-core';

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of prepared) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
  }
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('Geometry merge failed');
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  return merged;
}

function at<T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function starShape(points: number, outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

const tokenCache = new Map<TokenId, THREE.BufferGeometry>();

/** Token geometry, ~0.42 units tall, base at y=0. */
export function tokenGeometry(token: TokenId): THREE.BufferGeometry {
  const cached = tokenCache.get(token);
  if (cached) return cached;
  const base = () => at(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 20), 0, 0.025, 0);
  let g: THREE.BufferGeometry;
  switch (token) {
    case 'pawn':
      g = merge([base(), at(new THREE.CylinderGeometry(0.06, 0.13, 0.22, 16), 0, 0.16, 0), at(new THREE.SphereGeometry(0.09, 16, 12), 0, 0.33, 0)]);
      break;
    case 'gem':
      g = merge([base(), at(new THREE.OctahedronGeometry(0.17, 0), 0, 0.24, 0)]);
      break;
    case 'rocket':
      g = merge([
        base(),
        at(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 12), 0, 0.17, 0),
        at(new THREE.ConeGeometry(0.07, 0.14, 12), 0, 0.35, 0),
        at(new THREE.BoxGeometry(0.03, 0.09, 0.2), 0, 0.1, 0),
        at(new THREE.BoxGeometry(0.2, 0.09, 0.03), 0, 0.1, 0)
      ]);
      break;
    case 'crown': {
      const parts: THREE.BufferGeometry[] = [base(), at(new THREE.CylinderGeometry(0.13, 0.12, 0.12, 16, 1, true), 0, 0.11, 0), at(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), 0, 0.06, 0)];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(at(new THREE.ConeGeometry(0.035, 0.1, 6), Math.cos(a) * 0.11, 0.21, Math.sin(a) * 0.11));
        parts.push(at(new THREE.SphereGeometry(0.022, 8, 6), Math.cos(a) * 0.11, 0.27, Math.sin(a) * 0.11));
      }
      g = merge(parts);
      break;
    }
    case 'star': {
      const shape = new THREE.ExtrudeGeometry(starShape(5, 0.17, 0.075), { depth: 0.06, bevelEnabled: false });
      shape.center();
      g = merge([base(), at(shape, 0, 0.24, 0)]);
      break;
    }
    case 'puck':
      g = merge([at(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 24), 0, 0.045, 0), at(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 24), 0, 0.11, 0)]);
      break;
    case 'tower': {
      const parts: THREE.BufferGeometry[] = [base(), at(new THREE.BoxGeometry(0.2, 0.24, 0.2), 0, 0.17, 0)];
      for (const [x, z] of [
        [-0.07, -0.07],
        [0.07, -0.07],
        [-0.07, 0.07],
        [0.07, 0.07]
      ] as [number, number][]) {
        parts.push(at(new THREE.BoxGeometry(0.06, 0.07, 0.06), x, 0.32, z));
      }
      g = merge(parts);
      break;
    }
    case 'orb':
    default:
      g = merge([base(), at(new THREE.CylinderGeometry(0.05, 0.09, 0.08, 12), 0, 0.09, 0), at(new THREE.SphereGeometry(0.13, 20, 14), 0, 0.24, 0)]);
      break;
  }
  tokenCache.set(token, g);
  return g;
}

let houseGeo: THREE.BufferGeometry | null = null;
let hotelGeo: THREE.BufferGeometry | null = null;

export function houseGeometry(): THREE.BufferGeometry {
  if (!houseGeo) {
    const roof = new THREE.ConeGeometry(0.115, 0.08, 4);
    roof.rotateY(Math.PI / 4);
    houseGeo = merge([at(new THREE.BoxGeometry(0.15, 0.1, 0.15), 0, 0.05, 0), at(roof, 0, 0.14, 0)]);
  }
  return houseGeo;
}

export function hotelGeometry(): THREE.BufferGeometry {
  if (!hotelGeo) {
    hotelGeo = merge([
      at(new THREE.BoxGeometry(0.62, 0.16, 0.24), 0, 0.08, 0),
      at(new THREE.BoxGeometry(0.4, 0.1, 0.2), 0, 0.21, 0),
      at(new THREE.BoxGeometry(0.16, 0.06, 0.12), 0, 0.29, 0)
    ]);
  }
  return hotelGeo;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared standard material per color/variant. */
export function colorMaterial(color: string, opts: { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number; emissive?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.roughness ?? 0.55}|${opts.metalness ?? 0.05}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.roughness ?? 0.55,
      metalness: opts.metalness ?? 0.05,
      transparent: opts.transparent ?? (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1
    });
    if (opts.emissive) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = opts.emissive;
    }
    materialCache.set(key, m);
  }
  return m;
}
