/**
 * The board's centerpiece: a small procedural city on a green felt field.
 * Buildings, trees, cars, a name plaque, a dice tray and the two card decks
 * are generated from code (no model downloads). The road and block layout is
 * shared with the board painter so painted roads line up with 3D buildings.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** World-space rectangles (x0, z0, x1, z1) inside the board's inner square. */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const CITY_ROADS: Rect[] = [
  { x0: -4.55, z0: -0.6, x1: 4.55, z1: -0.1 },
  { x0: -0.2, z0: -4.55, x1: 0.3, z1: -0.1 },
  { x0: -2.8, z0: -4.55, x1: -2.3, z1: -0.1 },
  { x0: 2.45, z0: -4.55, x1: 2.95, z1: -0.1 }
];

export const CITY_BLOCKS: Rect[] = [
  { x0: -4.45, z0: -4.45, x1: -3.0, z1: -0.8 },
  { x0: -2.1, z0: -4.45, x1: -0.4, z1: -0.8 },
  { x0: 0.5, z0: -4.45, x1: 2.25, z1: -0.8 },
  { x0: 3.15, z0: -4.45, x1: 4.45, z1: -0.8 }
];

export const CITY_PARKS: Rect[] = [
  { x0: -1.4, z0: 3.25, x1: 1.4, z1: 4.45 },
  { x0: 3.15, z0: 0.3, x1: 4.45, z1: 1.55 }
];

/** Where the dice rest (on the tray). */
export const DICE_TRAY = { x: -2.85, z: 1.55, w: 2.5, d: 1.9 };

export const PLAQUE = { x: 1.25, z: 1.75, w: 4.4, d: 1.25, rot: -0.16 };

export const DECKS = [
  { x: -3.55, z: 3.75, rot: 0.32, color: '#8E6CC0', label: 'FORTUNE', glyph: '?' },
  { x: 3.55, z: 3.7, rot: -0.32, color: '#3A936A', label: 'COMMUNITY', glyph: '♥' }
];

const FONT = '"Outfit Variable", "Figtree Variable", system-ui, sans-serif';

/** Deterministic random numbers so the city looks the same every time. */
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

/* ------------------------------------------------------------------ */
/* Window textures                                                     */
/* ------------------------------------------------------------------ */

let windowCanvas: HTMLCanvasElement | null = null;

/** One facade tile: a wall cell with a window (white = wall, tinted by the material color). */
function windowImage(): HTMLCanvasElement {
  if (windowCanvas) return windowCanvas;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  // Floor line.
  g.fillStyle = 'rgba(0,0,0,0.06)';
  g.fillRect(0, s - 4, s, 4);
  // Window with frame and glass reflection.
  g.fillStyle = '#5d6f82';
  g.fillRect(14, 12, 36, 34);
  const glass = g.createLinearGradient(14, 12, 50, 46);
  glass.addColorStop(0, '#c9e2f3');
  glass.addColorStop(0.55, '#8fb3cc');
  glass.addColorStop(1, '#6f93ad');
  g.fillStyle = glass;
  g.fillRect(17, 15, 30, 28);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillRect(17, 15, 30, 6);
  g.fillStyle = '#5d6f82';
  g.fillRect(31, 15, 2, 28);
  windowCanvas = c;
  return c;
}

const facadeCache = new Map<string, THREE.MeshStandardMaterial>();

function facadeMaterial(color: string, cols: number, floors: number): THREE.MeshStandardMaterial {
  const key = `${color}|${cols}|${floors}`;
  let m = facadeCache.get(key);
  if (!m) {
    const tex = new THREE.CanvasTexture(windowImage());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(cols, floors);
    tex.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), map: tex, roughness: 0.62, metalness: 0.02 });
    facadeCache.set(key, m);
  }
  return m;
}

const plainCache = new Map<string, THREE.MeshStandardMaterial>();
function plain(color: string, roughness = 0.7): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = plainCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness });
    plainCache.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

const PALETTE = ['#8DB8DA', '#F2C27A', '#E99A8D', '#9ACFA9', '#C6ADDD', '#F4E3B0', '#A9B7C6', '#7FA6C8', '#E7B7C9'];
const TOWER = ['#2F4D6E', '#3E6A8E', '#5F86A6'];

function building(x: number, z: number, w: number, d: number, h: number, color: string, rand: () => number, detailed: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const floorH = 0.24;
  const floors = Math.max(2, Math.round(h / floorH));
  const cols = Math.max(2, Math.round(Math.max(w, d) / 0.22));
  const facade = facadeMaterial(color, cols, floors);
  const roof = plain('#EEEAE0', 0.8);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [facade, facade, roof, roof, facade, facade]);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // Roof parapet.
  const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.04), plain('#DDD6C7', 0.8));
  rim.position.y = h + 0.025;
  rim.castShadow = true;
  g.add(rim);
  // Ground-floor awning on shorter buildings.
  if (h < 1.3 && rand() < 0.6) {
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.04, 0.12), plain(rand() < 0.5 ? '#D9534F' : '#3A936A', 0.6));
    awning.position.set(0, 0.24, d / 2 + 0.06);
    awning.rotation.x = 0.35;
    g.add(awning);
  }
  if (detailed) {
    // Rooftop machinery and water tanks.
    const n = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.14), plain('#8C949C', 0.5));
      ac.position.set((rand() - 0.5) * (w - 0.25), h + 0.1, (rand() - 0.5) * (d - 0.25));
      ac.castShadow = true;
      g.add(ac);
    }
    if (h > 1.6 && rand() < 0.7) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), plain('#5B636B', 0.4));
      mast.position.set(w * 0.2, h + 0.22, -d * 0.2);
      g.add(mast);
    } else if (rand() < 0.4) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12), plain('#B88A5A', 0.7));
      tank.position.set(-w * 0.2, h + 0.12, d * 0.15);
      tank.castShadow = true;
      g.add(tank);
    }
  }
  return g;
}

function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.22, 8);
  trunk.translate(0, 0.11, 0);
  const crown = new THREE.SphereGeometry(0.26, 14, 10);
  crown.translate(0, 0.42, 0);
  const color = (g: THREE.BufferGeometry, hex: string) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(hex);
    const n = ng.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return ng;
  };
  const merged = mergeGeometries([color(trunk, '#7A5A3C'), color(crown, '#ffffff')], false);
  if (!merged) throw new Error('tree merge failed');
  return merged;
}

function labelTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function plaque(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(PLAQUE.x, 0, PLAQUE.z);
  g.rotation.y = PLAQUE.rot;
  const base = new THREE.Mesh(new RoundedBoxGeometry(PLAQUE.w + 0.16, 0.12, PLAQUE.d + 0.16, 3, 0.05), plain('#D9C38E', 0.45));
  base.position.y = 0.06;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  const slab = new THREE.Mesh(new RoundedBoxGeometry(PLAQUE.w, 0.12, PLAQUE.d, 3, 0.05), plain('#1E4D3B', 0.5));
  slab.position.y = 0.15;
  slab.castShadow = true;
  g.add(slab);
  const tex = labelTexture(1024, 292, (c, w, h) => {
    c.fillStyle = '#1E4D3B';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(232,214,160,0.55)';
    c.lineWidth = 4;
    c.strokeRect(14, 14, w - 28, h - 28);
    c.fillStyle = '#F4EAD0';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 118px ${FONT}`;
    c.fillText('PROPERTY EMPIRE', w / 2, h * 0.43);
    c.fillStyle = 'rgba(244,234,208,0.78)';
    c.font = `600 34px ${FONT}`;
    c.fillText('BUILD A CITY · MAKE YOUR FORTUNE', w / 2, h * 0.76);
  });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(PLAQUE.w - 0.08, PLAQUE.d - 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.212;
  g.add(top);
  return g;
}

function diceTray(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(DICE_TRAY.x, 0, DICE_TRAY.z);
  const rim = new THREE.Mesh(new RoundedBoxGeometry(DICE_TRAY.w, 0.1, DICE_TRAY.d, 3, 0.05), plain('#D9C38E', 0.45));
  rim.position.y = 0.05;
  rim.castShadow = true;
  rim.receiveShadow = true;
  g.add(rim);
  const felt = new THREE.Mesh(new RoundedBoxGeometry(DICE_TRAY.w - 0.18, 0.1, DICE_TRAY.d - 0.18, 3, 0.04), plain('#2B6A50', 0.95));
  felt.position.y = 0.065;
  felt.receiveShadow = true;
  g.add(felt);
  return g;
}

function deck(spec: (typeof DECKS)[number]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(spec.x, 0, spec.z);
  g.rotation.y = spec.rot;
  const w = 1.0;
  const d = 1.4;
  const cardMat = plain('#F7F2E6', 0.6);
  const edge = plain(spec.color, 0.5);
  for (let i = 0; i < 7; i++) {
    const card = new THREE.Mesh(new RoundedBoxGeometry(w, 0.022, d, 2, 0.01), [edge, edge, cardMat, cardMat, edge, edge]);
    card.position.set((i % 2) * 0.012, 0.011 + i * 0.024, (i % 3) * 0.008);
    card.rotation.y = (i % 2 ? 1 : -1) * 0.012 * i;
    card.castShadow = i === 6;
    card.receiveShadow = true;
    g.add(card);
  }
  const tex = labelTexture(256, 360, (c, cw, ch) => {
    c.fillStyle = spec.color;
    c.beginPath();
    c.roundRect(6, 6, cw - 12, ch - 12, 22);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.65)';
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(20, 20, cw - 40, ch - 40, 16);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 150px ${FONT}`;
    c.fillText(spec.glyph, cw / 2, ch * 0.45);
    c.font = `800 30px ${FONT}`;
    c.fillText(spec.label, cw / 2, ch * 0.8);
  });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, d - 0.04), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0.012 * 6 * 0, 0.011 + 6 * 0.024 + 0.0115, 0);
  g.add(top);
  return g;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export function buildCity(detailed: boolean): THREE.Group {
  const city = new THREE.Group();
  city.name = 'city';
  const rand = rng(20261008);

  // Buildings: a lower front row along Main Street, taller towers behind.
  CITY_BLOCKS.forEach((b, bi) => {
    const bw = b.x1 - b.x0;
    const cols = bw > 1.6 ? 2 : 2;
    const rows = 3;
    const cellW = bw / cols;
    const cellD = (b.z1 - b.z0) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() < 0.08) continue;
        const w = cellW * (0.72 + rand() * 0.18);
        const d = cellD * (0.7 + rand() * 0.2);
        const x = b.x0 + cellW * (c + 0.5);
        const z = b.z0 + cellD * (r + 0.5);
        const backness = (rows - 1 - r) / (rows - 1); // 1 at the back row
        const centerBoost = bi === 1 || bi === 2 ? 0.6 : 0;
        const tower = backness > 0.9 && rand() < 0.55 + centerBoost * 0.5;
        const h = tower ? 1.9 + rand() * 0.9 + centerBoost : 0.55 + rand() * 0.6 + backness * 0.6;
        const color = tower ? (TOWER[Math.floor(rand() * TOWER.length)] as string) : (PALETTE[Math.floor(rand() * PALETTE.length)] as string);
        city.add(building(x, z, w, d, h, color, rand, detailed));
      }
    }
  });

  // Trees: park clusters, along Main Street and around the plaque.
  const spots: [number, number, number][] = [];
  for (const p of CITY_PARKS) {
    const n = Math.round(((p.x1 - p.x0) * (p.z1 - p.z0)) / 0.45);
    for (let i = 0; i < n; i++) spots.push([p.x0 + 0.25 + rand() * (p.x1 - p.x0 - 0.5), p.z0 + 0.25 + rand() * (p.z1 - p.z0 - 0.5), 0.85 + rand() * 0.45]);
  }
  for (let x = -4.2; x <= 4.2; x += 1.05) spots.push([x + (rand() - 0.5) * 0.2, 0.15, 0.75 + rand() * 0.3]);
  spots.push([-0.9, 1.05, 1.1], [3.0, 2.95, 1.0], [-1.5, 2.95, 0.9], [4.2, 2.5, 1.05], [-4.25, 0.55, 0.95]);
  const treeGeo = treeGeometry();
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), spots.length);
  const greens = ['#5FA86E', '#4E9A62', '#6DB57A', '#57A06A'];
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, s], i) => {
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI, 0)), new THREE.Vector3(s, s, s));
    trees.setMatrixAt(i, m);
    trees.setColorAt(i, new THREE.Color(greens[i % greens.length] as string));
  });
  trees.castShadow = true;
  trees.receiveShadow = true;
  city.add(trees);

  // A few cars on the roads.
  const carGeo = new RoundedBoxGeometry(0.26, 0.1, 0.13, 2, 0.03);
  carGeo.translate(0, 0.07, 0);
  const cabGeo = new RoundedBoxGeometry(0.14, 0.07, 0.11, 2, 0.025);
  cabGeo.translate(-0.02, 0.15, 0);
  const carMerged = mergeGeometries([carGeo.toNonIndexed(), cabGeo.toNonIndexed()], false) as THREE.BufferGeometry;
  const carSpots: [number, number, number][] = [
    [-3.6, -0.22, 0],
    [-1.2, -0.48, Math.PI],
    [1.6, -0.22, 0],
    [3.8, -0.48, Math.PI],
    [0.18, -2.4, Math.PI / 2],
    [-2.42, -3.4, -Math.PI / 2],
    [2.82, -1.6, -Math.PI / 2]
  ];
  const cars = new THREE.InstancedMesh(carMerged, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }), carSpots.length);
  const carColors = ['#F2C14E', '#E15554', '#4B91D1', '#F7F7F2', '#55B98A', '#E86CA8', '#5B6472'];
  carSpots.forEach(([x, z, r], i) => {
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r, 0)), new THREE.Vector3(1, 1, 1));
    cars.setMatrixAt(i, m);
    cars.setColorAt(i, new THREE.Color(carColors[i % carColors.length] as string));
  });
  cars.castShadow = true;
  city.add(cars);

  city.add(plaque(), diceTray(), ...DECKS.map(deck));
  return city;
}
