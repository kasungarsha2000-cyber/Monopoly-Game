/**
 * Board geometry in world units. The board is a square on the XZ plane,
 * centered at the origin. GO (index 0) is the bottom-right corner nearest the
 * default camera; play runs clockwise as seen from above (classic layout).
 */
export const TILE = 1.0; // width of a regular tile along the board edge
export const CORNER = 1.6; // corner size (and depth of every tile)
export const BOARD = CORNER * 2 + TILE * 9; // 12.8

export type Side = 'bottom' | 'left' | 'top' | 'right';

export interface TileRect {
  index: number;
  side: Side;
  corner: boolean;
  cx: number;
  cz: number;
  /** Size along X and Z. */
  w: number;
  d: number;
  /** Unit vector pointing from the tile toward the board center. */
  inX: number;
  inZ: number;
  /** Rotation (radians, around Y) so local -Z points toward the center. */
  rotY: number;
}

const H = BOARD / 2;

export function tileRect(index: number): TileRect {
  const i = ((index % 40) + 40) % 40;
  if (i === 0) return corner(i, H - CORNER / 2, H - CORNER / 2, 'bottom');
  if (i === 10) return corner(i, -H + CORNER / 2, H - CORNER / 2, 'left');
  if (i === 20) return corner(i, -H + CORNER / 2, -H + CORNER / 2, 'top');
  if (i === 30) return corner(i, H - CORNER / 2, -H + CORNER / 2, 'right');
  if (i < 10) {
    const k = i - 1;
    return { index: i, side: 'bottom', corner: false, cx: H - CORNER - TILE * k - TILE / 2, cz: H - CORNER / 2, w: TILE, d: CORNER, inX: 0, inZ: -1, rotY: 0 };
  }
  if (i < 20) {
    const k = i - 11;
    return { index: i, side: 'left', corner: false, cx: -H + CORNER / 2, cz: H - CORNER - TILE * k - TILE / 2, w: CORNER, d: TILE, inX: 1, inZ: 0, rotY: -Math.PI / 2 };
  }
  if (i < 30) {
    const k = i - 21;
    return { index: i, side: 'top', corner: false, cx: -H + CORNER + TILE * k + TILE / 2, cz: -H + CORNER / 2, w: TILE, d: CORNER, inX: 0, inZ: 1, rotY: Math.PI };
  }
  const k = i - 31;
  return { index: i, side: 'right', corner: false, cx: H - CORNER / 2, cz: -H + CORNER + TILE * k + TILE / 2, w: CORNER, d: TILE, inX: -1, inZ: 0, rotY: Math.PI / 2 };
}

function corner(index: number, cx: number, cz: number, side: Side): TileRect {
  const inX = cx > 0 ? -1 : 1;
  const inZ = cz > 0 ? -1 : 1;
  const rot: Record<number, number> = { 0: 0, 10: -Math.PI / 2, 20: Math.PI, 30: Math.PI / 2 };
  return { index, side, corner: true, cx, cz, w: CORNER, d: CORNER, inX: inX * Math.SQRT1_2, inZ: inZ * Math.SQRT1_2, rotY: rot[index] ?? 0 };
}

/** Board space under a world XZ point, or -1. */
export function tileAt(x: number, z: number): number {
  if (Math.abs(x) > H || Math.abs(z) > H) return -1;
  const inner = H - CORNER;
  const inBottom = z > inner;
  const inTop = z < -inner;
  const inLeft = x < -inner;
  const inRight = x > inner;
  if (inBottom && inRight) return 0;
  if (inBottom && inLeft) return 10;
  if (inTop && inLeft) return 20;
  if (inTop && inRight) return 30;
  if (inBottom) return 1 + Math.min(8, Math.floor((inner - x) / TILE));
  if (inLeft) return 11 + Math.min(8, Math.floor((inner - z) / TILE));
  if (inTop) return 21 + Math.min(8, Math.floor((x + inner) / TILE));
  if (inRight) return 31 + Math.min(8, Math.floor((z + inner) / TILE));
  return -1;
}

/** Offsets for up to 8 tokens sharing a tile, in tile-local units. */
const SLOT_OFFSETS: [number, number][] = [
  [-0.22, -0.05],
  [0.22, -0.05],
  [-0.22, 0.32],
  [0.22, 0.32],
  [0, 0.13],
  [-0.22, 0.6],
  [0.22, 0.6],
  [0, 0.45]
];

/**
 * World position for a token. Tokens sit on the outer part of a tile (away
 * from the color band). Jailed tokens sit inside the jail cell.
 */
export function tokenPosition(index: number, slot: number, count: number, inJail = false): { x: number; z: number } {
  const r = tileRect(index);
  if (index === 10) {
    if (inJail) {
      // Jail cell: the inner square of the corner.
      const cellX = r.cx + 0.25;
      const cellZ = r.cz - 0.25;
      const o = SLOT_OFFSETS[slot % 8] as [number, number];
      return { x: cellX + o[0] * 0.8, z: cellZ + (o[1] - 0.3) * 0.6 };
    }
    // Just visiting: along the outer L of the corner.
    const lane = [
      [-0.55, 0.55],
      [-0.55, 0.15],
      [-0.15, 0.55],
      [-0.55, -0.25],
      [0.25, 0.55],
      [-0.55, -0.55],
      [0.55, 0.55],
      [-0.15, 0.15]
    ][slot % 8] as [number, number];
    return { x: r.cx + lane[0], z: r.cz + lane[1] };
  }
  const o = count === 1 ? ([0, 0.18] as [number, number]) : (SLOT_OFFSETS[slot % 8] as [number, number]);
  if (r.corner) {
    return { x: r.cx + o[0] * 1.4, z: r.cz + (o[1] - 0.25) * 1.4 };
  }
  // Local frame: x along the edge, y outward (away from the center).
  const ex = -r.inZ;
  const ez = r.inX;
  return {
    x: r.cx + ex * o[0] - r.inX * o[1],
    z: r.cz + ez * o[0] - r.inZ * o[1]
  };
}

/** World position for building slot k (0-3 houses, 4 = hotel) on a street. */
export function buildingPosition(index: number, k: number): { x: number; z: number; rotY: number } {
  const r = tileRect(index);
  const bandDepth = CORNER * 0.22;
  const along = k === 4 ? 0 : (k - 1.5) * 0.225;
  const ex = -r.inZ;
  const ez = r.inX;
  const toBand = CORNER / 2 - bandDepth / 2;
  return {
    x: r.cx + ex * along + r.inX * toBand,
    z: r.cz + ez * along + r.inZ * toBand,
    rotY: r.rotY
  };
}
