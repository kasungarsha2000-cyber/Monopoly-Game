/**
 * Procedural meshes built from Three.js primitives: player tokens (turned
 * lathe profiles, bevelled bases), houses and hotels with painted roofs and
 * windows (vertex colors, so each building is still one draw call).
 * Geometries are created once and shared; materials are cached.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TokenId } from '@pe/game-core';

type Part = { geo: THREE.BufferGeometry; color?: string };

function prepare(g: THREE.BufferGeometry, color?: string): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const count = ng.getAttribute('position').count;
  if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  const c = new THREE.Color(color ?? '#ffffff');
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return ng;
}

function merge(parts: Part[], smooth = false): THREE.BufferGeometry {
  const merged = mergeGeometries(
    parts.map((p) => prepare(p.geo, p.color)),
    false
  );
  if (!merged) throw new Error('Geometry merge failed');
  if (smooth) merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function at<T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function lathe(points: [number, number][], segments = 40): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments
  );
}

/** Bevelled round base shared by most tokens (height 0.055). */
function base(): THREE.BufferGeometry {
  return lathe([
    [0, 0],
    [0.17, 0],
    [0.182, 0.008],
    [0.185, 0.025],
    [0.18, 0.04],
    [0.165, 0.052],
    [0.12, 0.056],
    [0, 0.056]
  ]);
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

/** Token geometry, about 0.45 units tall, base at y = 0. */
export function tokenGeometry(token: TokenId): THREE.BufferGeometry {
  const cached = tokenCache.get(token);
  if (cached) return cached;
  let g: THREE.BufferGeometry;
  switch (token) {
    case 'pawn':
      g = merge([
        {
          geo: lathe([
            [0, 0],
            [0.175, 0],
            [0.185, 0.02],
            [0.17, 0.05],
            [0.12, 0.075],
            [0.085, 0.11],
            [0.07, 0.2],
            [0.062, 0.26],
            [0.105, 0.285],
            [0.108, 0.3],
            [0.07, 0.315],
            [0, 0.315]
          ])
        },
        { geo: at(new THREE.SphereGeometry(0.098, 32, 20), 0, 0.39, 0) }
      ]);
      break;
    case 'gem': {
      const gem = new THREE.OctahedronGeometry(0.17, 0);
      gem.scale(1, 1.25, 1);
      g = merge([{ geo: base() }, { geo: at(new THREE.CylinderGeometry(0.03, 0.06, 0.06, 16), 0, 0.08, 0) }, { geo: at(gem, 0, 0.3, 0, 0, Math.PI / 4, 0) }]);
      break;
    }
    case 'rocket':
      g = merge([
        { geo: base() },
        {
          geo: at(
            lathe([
              [0, 0],
              [0.075, 0],
              [0.085, 0.08],
              [0.085, 0.2],
              [0.07, 0.28],
              [0.04, 0.34],
              [0, 0.37]
            ]),
            0,
            0.07,
            0
          )
        },
        { geo: at(new THREE.BoxGeometry(0.025, 0.11, 0.24), 0, 0.12, 0) },
        { geo: at(new THREE.BoxGeometry(0.24, 0.11, 0.025), 0, 0.12, 0) },
        { geo: at(new THREE.SphereGeometry(0.035, 16, 12), 0, 0.25, 0.075) }
      ]);
      break;
    case 'crown': {
      const parts: Part[] = [
        { geo: base() },
        {
          geo: at(
            lathe([
              [0.12, 0],
              [0.135, 0.02],
              [0.13, 0.13],
              [0.115, 0.13],
              [0.118, 0.02],
              [0.1, 0.0]
            ]),
            0,
            0.055,
            0
          )
        }
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push({ geo: at(new THREE.ConeGeometry(0.03, 0.1, 10), Math.cos(a) * 0.123, 0.23, Math.sin(a) * 0.123) });
        parts.push({ geo: at(new THREE.SphereGeometry(0.022, 12, 8), Math.cos(a) * 0.123, 0.29, Math.sin(a) * 0.123) });
      }
      g = merge(parts);
      break;
    }
    case 'star': {
      const shape = new THREE.ExtrudeGeometry(starShape(5, 0.17, 0.075), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 3 });
      shape.center();
      g = merge([{ geo: base() }, { geo: at(new THREE.CylinderGeometry(0.025, 0.04, 0.06, 12), 0, 0.08, 0) }, { geo: at(shape, 0, 0.27, 0) }]);
      break;
    }
    case 'puck':
      g = merge([
        {
          geo: lathe([
            [0, 0],
            [0.17, 0],
            [0.185, 0.015],
            [0.185, 0.08],
            [0.17, 0.095],
            [0.12, 0.1],
            [0.11, 0.13],
            [0.09, 0.145],
            [0, 0.145]
          ])
        }
      ]);
      break;
    case 'tower': {
      const parts: Part[] = [
        { geo: base() },
        {
          geo: lathe([
            [0, 0.05],
            [0.11, 0.05],
            [0.095, 0.1],
            [0.09, 0.27],
            [0.115, 0.29],
            [0.115, 0.31],
            [0, 0.31]
          ])
        }
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push({ geo: at(new THREE.BoxGeometry(0.05, 0.06, 0.05), Math.cos(a) * 0.09, 0.34, Math.sin(a) * 0.09, 0, -a, 0) });
      }
      g = merge(parts);
      break;
    }
    case 'orb':
    default:
      g = merge([
        { geo: base() },
        {
          geo: lathe([
            [0.09, 0.05],
            [0.06, 0.1],
            [0.045, 0.13],
            [0, 0.13]
          ])
        },
        { geo: at(new THREE.SphereGeometry(0.135, 36, 24), 0, 0.26, 0) }
      ]);
      break;
  }
  tokenCache.set(token, g);
  return g;
}

let houseGeo: THREE.BufferGeometry | null = null;
let hotelGeo: THREE.BufferGeometry | null = null;

/** Small house: green walls, darker gabled roof, chimney, door and windows. */
export function houseGeometry(): THREE.BufferGeometry {
  if (!houseGeo) {
    const roof = new THREE.CylinderGeometry(0.0, 0.118, 0.085, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.scale(1, 1, 1);
    houseGeo = merge([
      { geo: at(new THREE.BoxGeometry(0.16, 0.105, 0.15), 0, 0.0525, 0), color: '#4CB36A' },
      { geo: at(roof, 0, 0.1475, 0), color: '#2F7D48' },
      { geo: at(new THREE.BoxGeometry(0.03, 0.05, 0.03), 0.045, 0.17, -0.02), color: '#7C5A3A' },
      { geo: at(new THREE.BoxGeometry(0.036, 0.06, 0.004), 0, 0.03, 0.0765), color: '#7C5A3A' },
      { geo: at(new THREE.BoxGeometry(0.03, 0.03, 0.004), -0.05, 0.065, 0.0765), color: '#FFF4C8' },
      { geo: at(new THREE.BoxGeometry(0.03, 0.03, 0.004), 0.05, 0.065, 0.0765), color: '#FFF4C8' }
    ]);
  }
  return houseGeo;
}

/** Hotel: red tiered block with window bands and a rooftop sign. */
export function hotelGeometry(): THREE.BufferGeometry {
  if (!hotelGeo) {
    const parts: Part[] = [
      { geo: at(new THREE.BoxGeometry(0.64, 0.17, 0.25), 0, 0.085, 0), color: '#E04848' },
      { geo: at(new THREE.BoxGeometry(0.46, 0.11, 0.21), 0, 0.225, 0), color: '#E85E5E' },
      { geo: at(new THREE.BoxGeometry(0.66, 0.02, 0.27), 0, 0.172, 0), color: '#B23535' },
      { geo: at(new THREE.BoxGeometry(0.48, 0.018, 0.23), 0, 0.287, 0), color: '#B23535' },
      { geo: at(new THREE.BoxGeometry(0.18, 0.06, 0.03), 0, 0.33, 0), color: '#F2C14E' },
      { geo: at(new THREE.BoxGeometry(0.07, 0.08, 0.006), 0, 0.04, 0.127), color: '#5B3B2A' }
    ];
    for (const x of [-0.24, -0.14, 0.14, 0.24]) parts.push({ geo: at(new THREE.BoxGeometry(0.06, 0.05, 0.006), x, 0.1, 0.127), color: '#FFF4C8' });
    for (const x of [-0.15, -0.05, 0.05, 0.15]) parts.push({ geo: at(new THREE.BoxGeometry(0.05, 0.04, 0.006), x, 0.225, 0.107), color: '#FFF4C8' });
    hotelGeo = merge(parts);
  }
  return hotelGeo;
}

const materialCache = new Map<string, THREE.Material>();

export type MaterialQuality = 'low' | 'medium' | 'high';
let materialQuality: MaterialQuality = 'medium';

/** Select cheaper or richer materials for newly created meshes. */
export function setMaterialQuality(q: MaterialQuality): void {
  materialQuality = q;
}

/** Glossy enamel for tokens (clearcoat on medium/high). */
export function tokenMaterial(color: string): THREE.Material {
  const key = `token|${color}|${materialQuality}`;
  let m = materialCache.get(key);
  if (!m) {
    m =
      materialQuality === 'low'
        ? new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.3, metalness: 0.1, vertexColors: true })
        : new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.28, metalness: 0.08, clearcoat: 0.9, clearcoatRoughness: 0.12, vertexColors: true });
    materialCache.set(key, m);
  }
  return m;
}

/** Painted wood for houses and hotels (colors come from vertex colors). */
export function buildingMaterial(): THREE.Material {
  const key = `building|${materialQuality}`;
  let m = materialCache.get(key);
  if (!m) {
    m =
      materialQuality === 'low'
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 })
        : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    materialCache.set(key, m);
  }
  return m;
}

/** Shared standard material per color/variant. */
export function colorMaterial(color: string, opts: { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number; emissive?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.roughness ?? 0.55}|${opts.metalness ?? 0.05}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
  let m = materialCache.get(key) as THREE.MeshStandardMaterial | undefined;
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
