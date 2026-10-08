/**
 * BoardRenderer3D: the Three.js scene. Owns the renderer, camera rig, board,
 * tokens, buildings, dice, highlights and particles, plus pointer/touch
 * input and picking. It renders on demand: when nothing moves, no frames are
 * drawn, which keeps phones cool while waiting for a player.
 */
import * as THREE from 'three';
import type { BoardDef, GameState, TokenId } from '@pe/game-core';
import { paintBoard } from './boardTexture';
import { BOARD, CORNER, buildingPosition, tileAt, tileRect, tokenPosition } from './layout';
import { CameraRig, type Insets } from './camera';
import { Tweens, ease } from './tween';
import { Dice } from './dice';
import { colorMaterial, hotelGeometry, houseGeometry, tokenGeometry } from './meshes';
import type { GraphicsQuality } from '../settings';

export interface RendererOptions {
  quality: GraphicsQuality;
  pixelDensity: 'auto' | '1' | '1.5' | '2';
  onTileClick?: (index: number) => void;
  onContextLost?: () => void;
}

interface TokenEntry {
  mesh: THREE.Mesh;
  token: TokenId;
  color: string;
  index: number;
  inJail: boolean;
}

const BOARD_TOP = 0;
const PARTICLES = 48;

function frameTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.roundRect(8, 8, s - 16, s - 16, 16);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BoardRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly tweens = new Tweens();
  readonly dice = new Dice();
  private readonly container: HTMLElement;
  private readonly board: BoardDef;
  private opts: RendererOptions;
  private boardMaterial: THREE.MeshStandardMaterial;
  private sun: THREE.DirectionalLight;
  private tokens = new Map<string, TokenEntry>();
  private buildings = new Map<number, { houses: number; group: THREE.Group }>();
  private ownerStrips = new Map<number, THREE.Mesh>();
  private mortgageDims = new Map<number, THREE.Mesh>();
  private stripGeo: THREE.BoxGeometry;
  private dimGeo: THREE.PlaneGeometry;
  private selection: THREE.Mesh;
  private hover: THREE.Mesh;
  private currentRing: THREE.Mesh;
  private highlightPool: THREE.Mesh[] = [];
  private highlightGroup = new THREE.Group();
  private particles: THREE.Points;
  private particleVel: Float32Array;
  private particleLife = 0;
  private raf = 0;
  private needsRender = true;
  private attract = false;
  private lastFrame = performance.now();
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; t: number; button: number } | null = null;
  private dragMoved = false;
  private pinchDist = 0;
  private hoverIndex = -1;
  private textureSize = 2048;

  constructor(container: HTMLElement, board: BoardDef, opts: RendererOptions) {
    this.container = container;
    this.board = board;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: opts.quality !== 'low', alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('tabindex', '-1');
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stopLoop();
      this.opts.onContextLost?.();
    });

    // Lights.
    this.scene.add(new THREE.HemisphereLight(0xfff8ec, 0xb9a57a, 1.15));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-6, 14, 8);
    this.sun.shadow.camera.left = -9;
    this.sun.shadow.camera.right = 9;
    this.sun.shadow.camera.top = 9;
    this.sun.shadow.camera.bottom = -9;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);

    // Table and board.
    const table = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshStandardMaterial({ color: 0xd9c9a6, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.36;
    table.receiveShadow = true;
    this.scene.add(table);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD + 0.36, 0.34, BOARD + 0.36),
      new THREE.MeshStandardMaterial({ color: 0x9c7b52, roughness: 0.7 })
    );
    base.position.y = -0.18;
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);
    this.boardMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD, BOARD), this.boardMaterial);
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_TOP + 0.002;
    top.receiveShadow = true;
    this.scene.add(top);

    // Ownership strips sit on the outer edge of each ownable tile.
    this.stripGeo = new THREE.BoxGeometry(0.86, 0.03, 0.09);
    this.dimGeo = new THREE.PlaneGeometry(1, 1);

    // Selection, hover and current-player markers.
    const frameTex = frameTexture();
    this.selection = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: frameTex, color: 0x4b91d1, transparent: true, depthWrite: false }));
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.hover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: frameTex, color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.visible = false;
    this.scene.add(this.hover);
    this.currentRing = new THREE.Mesh(
      new THREE.RingGeometry(0.19, 0.26, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })
    );
    this.currentRing.rotation.x = -Math.PI / 2;
    this.currentRing.visible = false;
    this.scene.add(this.currentRing);
    this.scene.add(this.highlightGroup);
    this.scene.add(this.dice.group);

    // Particle burst for purchases.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    this.particleVel = new Float32Array(PARTICLES * 3);
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.12, color: 0xffffff, transparent: true, opacity: 1, depthWrite: false }));
    this.particles.visible = false;
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.applyQuality();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* Quality, size and render loop                                       */
  /* ------------------------------------------------------------------ */

  /** Set (or clear) the handler for taps/clicks on board spaces. */
  setTileClickHandler(fn: ((index: number) => void) | undefined): void {
    this.opts.onTileClick = fn;
  }

  setOptions(opts: Partial<RendererOptions>): void {
    this.opts = { ...this.opts, ...opts };
    this.applyQuality();
    this.resize();
  }

  private applyQuality(): void {
    const q = this.opts.quality;
    const dpr = window.devicePixelRatio || 1;
    const cap = this.opts.pixelDensity === 'auto' ? (q === 'low' ? 1 : q === 'medium' ? 1.5 : 2) : Number(this.opts.pixelDensity);
    this.renderer.setPixelRatio(Math.min(dpr, cap, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const shadowSize = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const maxTex = this.renderer.capabilities.maxTextureSize;
    const size = Math.min(maxTex, q === 'low' ? 1024 : 2048);
    if (size !== this.textureSize || !this.boardMaterial.map) {
      this.textureSize = size;
      const tex = new THREE.CanvasTexture(paintBoard(this.board, size));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.boardMaterial.map?.dispose();
      this.boardMaterial.map = tex;
      this.boardMaterial.needsUpdate = true;
    }
    this.invalidate();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setSize(w, h);
    this.invalidate();
  }

  setInsets(insets: Insets): void {
    this.rig.setInsets(insets);
    this.invalidate();
  }

  /** Request a frame. Rendering stops again once nothing is moving. */
  invalidate(): void {
    this.needsRender = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const tweening = this.tweens.tick(now);
    if (this.attract) {
      this.rig.azimuth += dt * 0.12;
      this.rig.apply();
    }
    const particles = this.updateParticles(dt);
    this.renderer.render(this.scene, this.rig.camera);
    this.needsRender = false;
    if (tweening || this.attract || particles || this.needsRender) this.invalidate();
  };

  /** Slow rotating showcase used behind the main menu. */
  setAttract(on: boolean): void {
    this.attract = on;
    if (on) {
      this.rig.polar = 0.95;
      this.rig.target.set(0, 0, 0);
      this.rig.radius = this.rig.defaultRadius * 0.95;
      this.selection.visible = false;
      this.hover.visible = false;
    }
    this.invalidate();
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                                */
  /* ------------------------------------------------------------------ */

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
        this.dragMoved = false;
      } else if (this.pointers.size === 2) {
        this.pinchDist = this.pointerDistance();
        this.dragMoved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse' && !this.attract) this.updateHover(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.attract) return;
      if (this.pointers.size === 2) {
        const d = this.pointerDistance();
        if (this.pinchDist > 0 && d > 0) this.rig.zoom(this.pinchDist / d);
        this.pinchDist = d;
        this.rig.pan(dx / 2, dy / 2);
        this.invalidate();
        return;
      }
      if (this.dragStart && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > 6) this.dragMoved = true;
      if (!this.dragMoved) return;
      if (this.dragStart?.button === 2 || e.shiftKey || !this.rig.rotateEnabled) this.rig.pan(dx, dy);
      else this.rig.rotate(dx, dy);
      this.invalidate();
    });
    const end = (e: PointerEvent) => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (wasSingle && this.dragStart && !this.dragMoved && e.type === 'pointerup' && performance.now() - this.dragStart.t < 600) {
        const idx = this.pick(e.clientX, e.clientY);
        if (idx >= 0 && !this.attract) this.opts.onTileClick?.(idx);
      }
      if (this.pointers.size === 0) this.dragStart = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => {
      if (this.hover.visible) {
        this.hover.visible = false;
        this.hoverIndex = -1;
        this.invalidate();
      }
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.attract) return;
        this.rig.zoom(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015));
        this.invalidate();
      },
      { passive: false }
    );
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);

  /** Board space under a screen point, or -1. */
  pick(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return -1;
    return tileAt(hit.x, hit.z);
  }

  /** Screen position of a board space (for DOM overlays and tests). */
  screenPosition(index: number): { x: number; y: number } {
    const r = tileRect(index);
    const v = new THREE.Vector3(r.cx, BOARD_TOP, r.cz).project(this.rig.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  private updateHover(x: number, y: number): void {
    const idx = this.pick(x, y);
    if (idx === this.hoverIndex) return;
    this.hoverIndex = idx;
    if (idx < 0) this.hover.visible = false;
    else this.placeFrame(this.hover, idx, 0.006);
    this.renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    this.invalidate();
  }

  private placeFrame(mesh: THREE.Mesh, index: number, y: number): void {
    const r = tileRect(index);
    mesh.position.set(r.cx, BOARD_TOP + y, r.cz);
    mesh.scale.set(r.w, r.d, 1);
    mesh.visible = true;
  }

  /* ------------------------------------------------------------------ */
  /* Camera helpers                                                       */
  /* ------------------------------------------------------------------ */

  focusTile(index: number, durationMs: number): Promise<void> {
    const r = tileRect(index);
    const p = this.rig.focusPoint(this.tweens, r.cx, r.cz, durationMs);
    this.invalidate();
    return p;
  }

  resetCamera(durationMs: number): Promise<void> {
    const p = this.rig.reset(this.tweens, durationMs);
    this.invalidate();
    return p;
  }

  zoomBy(factor: number): void {
    this.rig.zoom(factor);
    this.invalidate();
  }

  rotateBy(dx: number, dy: number): void {
    this.rig.rotate(dx, dy);
    this.invalidate();
  }

  setCameraOptions(rotate: boolean, invert: boolean): void {
    this.rig.rotateEnabled = rotate;
    this.rig.invert = invert;
  }

  /* ------------------------------------------------------------------ */
  /* Selection and highlights                                             */
  /* ------------------------------------------------------------------ */

  setSelected(index: number | null): void {
    if (index === null || index < 0) this.selection.visible = false;
    else this.placeFrame(this.selection, index, 0.008);
    this.invalidate();
  }

  /** Highlight a set of spaces (e.g. buildable streets). */
  setHighlights(spaces: number[], color = '#55B98A'): void {
    while (this.highlightPool.length < spaces.length) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      this.highlightPool.push(m);
      this.highlightGroup.add(m);
    }
    this.highlightPool.forEach((m, i) => {
      const s = spaces[i];
      if (s === undefined) {
        m.visible = false;
        return;
      }
      (m.material as THREE.MeshBasicMaterial).color.set(color);
      this.placeFrame(m, s, 0.004);
    });
    this.invalidate();
  }

  /* ------------------------------------------------------------------ */
  /* State sync                                                           */
  /* ------------------------------------------------------------------ */

  /** Bring tokens, ownership, buildings and markers in line with a state (no animation). */
  syncState(state: GameState, opts: { skipTokens?: Set<string> } = {}): void {
    // Tokens.
    const live = new Set<string>();
    for (const p of state.players) {
      if (p.bankrupt) continue;
      live.add(p.id);
      let entry = this.tokens.get(p.id);
      if (!entry || entry.token !== p.token || entry.color !== p.color) {
        if (entry) this.scene.remove(entry.mesh);
        const mesh = new THREE.Mesh(tokenGeometry(p.token), colorMaterial(p.color, { roughness: 0.35, metalness: 0.1 }));
        mesh.castShadow = true;
        mesh.name = `token-${p.id}`;
        this.scene.add(mesh);
        entry = { mesh, token: p.token, color: p.color, index: p.position, inJail: p.inJail };
        this.tokens.set(p.id, entry);
      }
      entry.index = p.position;
      entry.inJail = p.inJail;
    }
    for (const [id, entry] of this.tokens) {
      if (!live.has(id)) {
        this.scene.remove(entry.mesh);
        this.tokens.delete(id);
      }
    }
    this.layoutTokens(opts.skipTokens);

    // Current player ring.
    const cur = this.tokens.get(state.turn.playerId);
    if (cur && state.phase !== 'GAME_OVER') {
      (this.currentRing.material as THREE.MeshBasicMaterial).color.set(cur.color);
      this.currentRing.visible = true;
      this.currentRing.position.set(cur.mesh.position.x, BOARD_TOP + 0.01, cur.mesh.position.z);
    } else this.currentRing.visible = false;

    // Ownership and buildings.
    state.properties.forEach((prop, i) => {
      if (!prop) return;
      const owner = prop.owner ? state.players.find((p) => p.id === prop.owner) : null;
      this.setOwnerStrip(i, owner?.color ?? null, prop.mortgaged);
      this.setBuildings(i, prop.houses, false);
    });
    this.invalidate();
  }

  /** Update only ownership strips and mortgage dimming (used mid-animation). */
  syncOwnership(state: GameState): void {
    state.properties.forEach((prop, i) => {
      if (!prop) return;
      const owner = prop.owner ? state.players.find((p) => p.id === prop.owner) : null;
      this.setOwnerStrip(i, owner?.color ?? null, prop.mortgaged);
    });
    this.invalidate();
  }

  private layoutTokens(skip?: Set<string>): void {
    const groups = new Map<string, string[]>();
    for (const [id, e] of this.tokens) {
      const key = `${e.index}|${e.index === 10 && e.inJail ? 'j' : 'v'}`;
      const arr = groups.get(key) ?? [];
      arr.push(id);
      groups.set(key, arr);
    }
    for (const ids of groups.values()) {
      ids.forEach((id, slot) => {
        if (skip?.has(id)) return;
        const e = this.tokens.get(id);
        if (!e) return;
        const pos = tokenPosition(e.index, slot, ids.length, e.inJail);
        e.mesh.position.set(pos.x, BOARD_TOP, pos.z);
        e.mesh.rotation.y = tileRect(e.index).rotY;
      });
    }
  }

  private setOwnerStrip(index: number, color: string | null, mortgaged: boolean): void {
    let strip = this.ownerStrips.get(index);
    if (!color) {
      if (strip) strip.visible = false;
      const dim = this.mortgageDims.get(index);
      if (dim) dim.visible = false;
      return;
    }
    const r = tileRect(index);
    if (!strip) {
      strip = new THREE.Mesh(this.stripGeo, colorMaterial(color));
      strip.receiveShadow = true;
      this.scene.add(strip);
      this.ownerStrips.set(index, strip);
    }
    strip.material = colorMaterial(color, { roughness: 0.45 });
    strip.visible = true;
    // Outer edge of the tile.
    const out = CORNER / 2 - 0.07;
    strip.position.set(r.cx - r.inX * out, BOARD_TOP + 0.016, r.cz - r.inZ * out);
    strip.rotation.y = r.rotY;
    let dim = this.mortgageDims.get(index);
    if (mortgaged) {
      if (!dim) {
        dim = new THREE.Mesh(this.dimGeo, new THREE.MeshBasicMaterial({ color: 0x3c4450, transparent: true, opacity: 0.42, depthWrite: false }));
        dim.rotation.x = -Math.PI / 2;
        this.scene.add(dim);
        this.mortgageDims.set(index, dim);
      }
      dim.position.set(r.cx, BOARD_TOP + 0.005, r.cz);
      dim.scale.set(r.w * 0.96, r.d * 0.96, 1);
      dim.visible = true;
    } else if (dim) dim.visible = false;
  }

  /** Show buildings on a street; `animate` pops new ones in. */
  setBuildings(index: number, houses: number, animate: boolean, durationMs = 300): Promise<void> {
    const existing = this.buildings.get(index);
    if (existing && existing.houses === houses) return Promise.resolve();
    if (existing) {
      this.scene.remove(existing.group);
      this.buildings.delete(index);
    }
    if (houses <= 0) {
      this.invalidate();
      return Promise.resolve();
    }
    const group = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, color: string, k: number) => {
      const m = new THREE.Mesh(geo, colorMaterial(color, { roughness: 0.5 }));
      const pos = buildingPosition(index, k);
      m.position.set(pos.x, BOARD_TOP, pos.z);
      m.rotation.y = pos.rotY;
      m.castShadow = true;
      group.add(m);
      return m;
    };
    const fresh: THREE.Mesh[] = [];
    if (houses === 5) fresh.push(add(hotelGeometry(), '#E15554', 4));
    else for (let k = 0; k < houses; k++) {
      const m = add(houseGeometry(), '#3BA55C', k);
      if (!existing || k >= existing.houses) fresh.push(m);
    }
    this.scene.add(group);
    this.buildings.set(index, { houses, group });
    if (!animate || durationMs <= 0) {
      this.invalidate();
      return Promise.resolve();
    }
    for (const m of fresh) m.scale.setScalar(0.001);
    const p = this.tweens.run(durationMs, (t) => fresh.forEach((m) => m.scale.setScalar(Math.max(0.001, t))), ease.outBack);
    this.invalidate();
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Animations                                                           */
  /* ------------------------------------------------------------------ */

  /** Hop a token space by space (or fly directly for teleports). */
  async animateMove(playerId: string, from: number, to: number, steps: number, direct: boolean, stepMs: number, inJail: boolean, onStep?: () => void): Promise<void> {
    const e = this.tokens.get(playerId);
    if (!e) return;
    const mesh = e.mesh;
    const hopTo = (target: number, dur: number, height: number, jail = false) => {
      const start = mesh.position.clone();
      const end = tokenPosition(target, 0, 1, jail);
      const rotStart = mesh.rotation.y;
      let rotEnd = tileRect(target).rotY;
      while (rotEnd - rotStart > Math.PI) rotEnd -= Math.PI * 2;
      while (rotEnd - rotStart < -Math.PI) rotEnd += Math.PI * 2;
      return this.tweens.run(
        dur,
        (t) => {
          mesh.position.x = start.x + (end.x - start.x) * t;
          mesh.position.z = start.z + (end.z - start.z) * t;
          mesh.position.y = BOARD_TOP + Math.sin(t * Math.PI) * height;
          mesh.rotation.y = rotStart + (rotEnd - rotStart) * t;
          if (this.currentRing.visible) this.currentRing.position.set(mesh.position.x, BOARD_TOP + 0.01, mesh.position.z);
        },
        ease.inOutCubic
      );
    };
    if (stepMs <= 0) {
      e.index = to;
      e.inJail = inJail;
      this.layoutTokens();
      this.invalidate();
      return;
    }
    this.invalidate();
    if (direct || steps === 0) {
      await hopTo(to, Math.max(350, stepMs * 3), 1.4, inJail);
    } else {
      const dir = steps > 0 ? 1 : -1;
      const count = Math.abs(steps);
      // Long moves speed up so a 12-space move stays snappy.
      const per = count > 7 ? stepMs * 0.75 : stepMs;
      for (let k = 1; k <= count; k++) {
        const idx = (((from + dir * k) % 40) + 40) % 40;
        await hopTo(idx, per, 0.32);
        onStep?.();
      }
    }
    e.index = to;
    e.inJail = inJail;
    this.layoutTokens();
    this.invalidate();
  }

  /** Celebratory particles over a tile in a color. */
  burst(index: number, color: string): void {
    const r = tileRect(index);
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < PARTICLES; i++) {
      pos.setXYZ(i, r.cx, BOARD_TOP + 0.2, r.cz);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6;
      this.particleVel[i * 3] = Math.cos(a) * sp * 0.6;
      this.particleVel[i * 3 + 1] = 2 + Math.random() * 2;
      this.particleVel[i * 3 + 2] = Math.sin(a) * sp * 0.6;
    }
    pos.needsUpdate = true;
    (this.particles.material as THREE.PointsMaterial).color.set(color);
    this.particleLife = 1;
    this.particles.visible = true;
    this.invalidate();
  }

  private updateParticles(dt: number): boolean {
    if (this.particleLife <= 0) return false;
    this.particleLife -= dt * 1.2;
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < PARTICLES; i++) {
      this.particleVel[i * 3 + 1] = (this.particleVel[i * 3 + 1] as number) - 6 * dt;
      arr[i * 3] = (arr[i * 3] as number) + (this.particleVel[i * 3] as number) * dt;
      arr[i * 3 + 1] = Math.max(BOARD_TOP + 0.02, (arr[i * 3 + 1] as number) + (this.particleVel[i * 3 + 1] as number) * dt);
      arr[i * 3 + 2] = (arr[i * 3 + 2] as number) + (this.particleVel[i * 3 + 2] as number) * dt;
    }
    pos.needsUpdate = true;
    (this.particles.material as THREE.PointsMaterial).opacity = Math.max(0, this.particleLife);
    if (this.particleLife <= 0) this.particles.visible = false;
    return this.particleLife > 0;
  }

  rollDice(values: [number, number], durationMs: number): Promise<void> {
    const p = this.dice.roll(values, this.tweens, durationMs);
    this.invalidate();
    return p;
  }

  skipAnimations(): void {
    this.tweens.finishAll();
    this.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
