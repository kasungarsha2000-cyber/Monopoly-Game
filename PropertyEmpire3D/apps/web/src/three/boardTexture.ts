/**
 * Procedurally paints the whole board (all 40 tiles plus the center art) onto
 * one canvas, used as a single texture. One texture + one mesh keeps draw
 * calls minimal while staying crisp when zoomed in.
 */
import type { BoardDef, SpaceDef } from '@pe/game-core';
import { BOARD, CORNER, TILE, tileRect } from './layout';
import { paperPattern } from './textures';
import { CITY_BLOCKS, CITY_PARKS, CITY_ROADS, DICE_TRAY, PLAQUE, type Rect } from './city';

const INK = '#253344';
const SURFACE = '#EFE4CB';
const TILE_BG = '#FBF7EE';
const TILE_BG_2 = '#F3EBDA';
const LINE = '#BFA97C';
const FONT = '"Outfit Variable", "Figtree Variable", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const SIDE_ANGLE: Record<string, number> = { bottom: 0, left: Math.PI / 2, top: Math.PI, right: -Math.PI / 2 };

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------ icons ------------------------------ */

function iconTrain(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#5B6472';
  roundRect(c, -s * 0.5, -s * 0.45, s, s * 0.7, s * 0.15);
  c.fill();
  c.fillStyle = '#CFE3F5';
  c.fillRect(-s * 0.38, -s * 0.33, s * 0.32, s * 0.22);
  c.fillRect(s * 0.06, -s * 0.33, s * 0.32, s * 0.22);
  c.fillStyle = INK;
  for (const x of [-0.28, 0.28]) {
    c.beginPath();
    c.arc(x * s, s * 0.32, s * 0.12, 0, Math.PI * 2);
    c.fill();
  }
}

function iconFerry(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#4B91D1';
  c.beginPath();
  c.moveTo(-s * 0.6, 0);
  c.lineTo(s * 0.6, 0);
  c.lineTo(s * 0.42, s * 0.3);
  c.lineTo(-s * 0.42, s * 0.3);
  c.closePath();
  c.fill();
  c.fillStyle = '#F5F0E6';
  c.strokeStyle = INK;
  c.lineWidth = s * 0.05;
  c.fillRect(-s * 0.3, -s * 0.32, s * 0.55, s * 0.32);
  c.strokeRect(-s * 0.3, -s * 0.32, s * 0.55, s * 0.32);
  c.fillStyle = '#E77979';
  c.fillRect(-s * 0.05, -s * 0.55, s * 0.14, s * 0.24);
}

function iconPlane(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#5B6472';
  c.beginPath();
  c.ellipse(0, 0, s * 0.62, s * 0.12, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(-s * 0.1, 0);
  c.lineTo(s * 0.12, -s * 0.5);
  c.lineTo(s * 0.26, -s * 0.5);
  c.lineTo(s * 0.18, 0);
  c.lineTo(s * 0.26, s * 0.5);
  c.lineTo(s * 0.12, s * 0.5);
  c.closePath();
  c.fill();
  c.fillRect(-s * 0.6, -s * 0.22, s * 0.12, s * 0.44);
}

function iconTram(c: CanvasRenderingContext2D, s: number): void {
  c.strokeStyle = INK;
  c.lineWidth = s * 0.05;
  c.beginPath();
  c.moveTo(-s * 0.2, -s * 0.38);
  c.lineTo(0, -s * 0.6);
  c.lineTo(s * 0.2, -s * 0.38);
  c.stroke();
  c.fillStyle = '#55B98A';
  roundRect(c, -s * 0.55, -s * 0.38, s * 1.1, s * 0.62, s * 0.14);
  c.fill();
  c.fillStyle = '#E6F5EE';
  for (const x of [-0.42, -0.1, 0.22]) c.fillRect(x * s, -s * 0.28, s * 0.22, s * 0.2);
  c.fillStyle = INK;
  for (const x of [-0.3, 0.3]) {
    c.beginPath();
    c.arc(x * s, s * 0.28, s * 0.1, 0, Math.PI * 2);
    c.fill();
  }
}

function iconSun(c: CanvasRenderingContext2D, s: number): void {
  c.strokeStyle = '#EFB15E';
  c.lineWidth = s * 0.08;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * s * 0.36, Math.sin(a) * s * 0.36);
    c.lineTo(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55);
    c.stroke();
  }
  c.fillStyle = '#F2C14E';
  c.beginPath();
  c.arc(0, 0, s * 0.27, 0, Math.PI * 2);
  c.fill();
}

function iconDrop(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#4B91D1';
  c.beginPath();
  c.moveTo(0, -s * 0.55);
  c.bezierCurveTo(s * 0.45, -s * 0.05, s * 0.4, s * 0.45, 0, s * 0.45);
  c.bezierCurveTo(-s * 0.4, s * 0.45, -s * 0.45, -s * 0.05, 0, -s * 0.55);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath();
  c.ellipse(-s * 0.12, s * 0.1, s * 0.07, s * 0.14, 0.4, 0, Math.PI * 2);
  c.fill();
}

function iconQuestion(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#A589CF';
  c.beginPath();
  c.arc(0, 0, s * 0.55, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.font = `900 ${s * 0.8}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('?', 0, s * 0.04);
}

function iconGift(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#55B98A';
  roundRect(c, -s * 0.45, -s * 0.2, s * 0.9, s * 0.65, s * 0.08);
  c.fill();
  c.fillStyle = '#3A936A';
  roundRect(c, -s * 0.52, -s * 0.38, s * 1.04, s * 0.22, s * 0.06);
  c.fill();
  c.fillStyle = '#EFB15E';
  c.fillRect(-s * 0.08, -s * 0.38, s * 0.16, s * 0.83);
  c.strokeStyle = '#EFB15E';
  c.lineWidth = s * 0.08;
  c.beginPath();
  c.ellipse(-s * 0.16, -s * 0.48, s * 0.15, s * 0.1, 0, 0, Math.PI * 2);
  c.ellipse(s * 0.16, -s * 0.48, s * 0.15, s * 0.1, 0, 0, Math.PI * 2);
  c.stroke();
}

function iconDiamond(c: CanvasRenderingContext2D, s: number): void {
  c.fillStyle = '#E77979';
  c.beginPath();
  c.moveTo(0, -s * 0.5);
  c.lineTo(s * 0.45, 0);
  c.lineTo(0, s * 0.5);
  c.lineTo(-s * 0.45, 0);
  c.closePath();
  c.fill();
  c.fillStyle = '#fff';
  c.font = `800 ${s * 0.45}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('$', 0, s * 0.03);
}

const ICONS: Record<string, (c: CanvasRenderingContext2D, s: number) => void> = {
  'northgate-station': iconTrain,
  'eastport-ferry': iconFerry,
  'southfield-airport': iconPlane,
  'westline-tram': iconTram,
  'solar-power-co': iconSun,
  'clearwater-co': iconDrop
};

/* ------------------------------ tiles ------------------------------ */

function pricePill(c: CanvasRenderingContext2D, text: string, y: number, ppu: number): void {
  c.font = `800 ${ppu * 0.135}px ${FONT}`;
  const w = c.measureText(text).width + ppu * 0.14;
  const h = ppu * 0.2;
  c.fillStyle = 'rgba(37,51,68,0.08)';
  roundRect(c, -w / 2, y - h / 2, w, h, h / 2);
  c.fill();
  c.fillStyle = INK;
  c.fillText(text, 0, y + ppu * 0.005);
}

function drawTile(c: CanvasRenderingContext2D, space: SpaceDef, groupColor: string, ppu: number): void {
  const w = TILE * ppu;
  const d = CORNER * ppu;
  const x0 = -w / 2;
  const y0 = -d / 2;
  const bg = c.createLinearGradient(0, y0, 0, d / 2);
  bg.addColorStop(0, TILE_BG);
  bg.addColorStop(1, TILE_BG_2);
  c.fillStyle = bg;
  c.fillRect(x0, y0, w, d);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  const nameSize = ppu * 0.148;

  if (space.type === 'street') {
    const band = d * 0.22;
    c.fillStyle = groupColor;
    c.fillRect(x0, y0, w, band);
    // Gloss highlight and a crisp lower edge on the color band.
    const gloss = c.createLinearGradient(0, y0, 0, y0 + band);
    gloss.addColorStop(0, 'rgba(255,255,255,0.35)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = gloss;
    c.fillRect(x0, y0, w, band);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(x0, y0 + band - ppu * 0.012, w, ppu * 0.012);
    c.fillStyle = INK;
    c.font = `800 ${nameSize}px ${FONT}`;
    const lines = wrap(c, space.shortName.toUpperCase(), w * 0.88);
    lines.forEach((l, i) => c.fillText(l, 0, y0 + band + nameSize * 1.05 + i * nameSize * 1.12));
    pricePill(c, `$${space.price}`, d / 2 - ppu * 0.17, ppu);
  } else {
    c.font = `800 ${nameSize}px ${FONT}`;
    const label = space.type === 'chance' ? 'FORTUNE' : space.type === 'community' ? 'COMMUNITY' : space.shortName.toUpperCase();
    const lines = wrap(c, label, w * 0.88);
    lines.forEach((l, i) => c.fillText(l, 0, y0 + nameSize * 1.15 + i * nameSize * 1.12));
    c.save();
    c.translate(0, y0 + d * 0.56);
    c.shadowColor = 'rgba(37,51,68,0.25)';
    c.shadowBlur = ppu * 0.04;
    c.shadowOffsetY = ppu * 0.015;
    const icon =
      ICONS[space.id] ??
      (space.type === 'chance' ? iconQuestion : space.type === 'community' ? iconGift : space.type === 'tax' ? iconDiamond : null);
    icon?.(c, ppu * 0.44);
    c.restore();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (space.type === 'transport' || space.type === 'utility') pricePill(c, `$${space.price}`, d / 2 - ppu * 0.17, ppu);
    else if (space.type === 'tax') pricePill(c, `PAY $${space.amount}`, d / 2 - ppu * 0.17, ppu);
  }
  c.strokeStyle = LINE;
  c.lineWidth = Math.max(1.5, ppu * 0.01);
  c.strokeRect(x0, y0, w, d);
}

function drawCorner(c: CanvasRenderingContext2D, space: SpaceDef, ppu: number): void {
  const s = CORNER * ppu;
  c.fillStyle = TILE_BG;
  c.fillRect(-s / 2, -s / 2, s, s);
  c.strokeStyle = LINE;
  c.lineWidth = Math.max(1.5, ppu * 0.012);
  c.strokeRect(-s / 2, -s / 2, s, s);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  switch (space.type) {
    case 'go': {
      c.font = `800 ${ppu * 0.2}px ${FONT}`;
      c.fillText('COLLECT $200', 0, -s * 0.3);
      c.font = `900 ${ppu * 0.62}px ${FONT}`;
      c.fillStyle = '#E15554';
      c.fillText('GO', 0, s * 0.02);
      // Arrow pointing in the direction of play (toward space 1).
      c.fillStyle = '#E15554';
      c.beginPath();
      c.moveTo(-s * 0.38, s * 0.32);
      c.lineTo(-s * 0.18, s * 0.2);
      c.lineTo(-s * 0.18, s * 0.27);
      c.lineTo(s * 0.36, s * 0.27);
      c.lineTo(s * 0.36, s * 0.37);
      c.lineTo(-s * 0.18, s * 0.37);
      c.lineTo(-s * 0.18, s * 0.44);
      c.closePath();
      c.fill();
      break;
    }
    case 'jail': {
      // Jail cell in the inner quadrant (toward the board center: up-right).
      const cell = s * 0.62;
      const cx = s / 2 - cell;
      const cy = -s / 2;
      c.fillStyle = '#EFB15E';
      c.fillRect(cx, cy, cell, cell);
      c.strokeStyle = INK;
      c.lineWidth = ppu * 0.025;
      c.strokeRect(cx, cy, cell, cell);
      for (let i = 1; i < 5; i++) {
        c.beginPath();
        c.moveTo(cx + (cell * i) / 5, cy + cell * 0.12);
        c.lineTo(cx + (cell * i) / 5, cy + cell * 0.88);
        c.stroke();
      }
      c.fillStyle = INK;
      c.font = `800 ${ppu * 0.17}px ${FONT}`;
      c.fillText('JAIL', cx + cell / 2, cy + cell / 2);
      c.font = `700 ${ppu * 0.13}px ${FONT}`;
      c.fillText('JUST VISITING', 0, s / 2 - ppu * 0.14);
      c.save();
      c.translate(-s / 2 + ppu * 0.14, -ppu * 0.1);
      c.rotate(-Math.PI / 2);
      c.fillText('VISITING', 0, 0);
      c.restore();
      break;
    }
    case 'free_parking': {
      c.fillStyle = '#4B91D1';
      c.beginPath();
      c.arc(0, 0, s * 0.24, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.font = `900 ${ppu * 0.42}px ${FONT}`;
      c.fillText('P', 0, ppu * 0.02);
      c.fillStyle = INK;
      c.font = `800 ${ppu * 0.17}px ${FONT}`;
      c.fillText('FREE', 0, -s * 0.36);
      c.fillText('PARKING', 0, s * 0.36);
      break;
    }
    case 'go_to_jail': {
      c.fillStyle = '#253344';
      c.beginPath();
      c.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#EFB15E';
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? s * 0.17 : s * 0.08;
        if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      c.fillStyle = INK;
      c.font = `800 ${ppu * 0.17}px ${FONT}`;
      c.fillText('GO TO', 0, -s * 0.36);
      c.fillText('JAIL', 0, s * 0.36);
      break;
    }
    default:
      break;
  }
}

function drawCenter(c: CanvasRenderingContext2D, size: number, ppu: number): void {
  const inner = (BOARD - CORNER * 2) * ppu;
  const x0 = (size - inner) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const P = (v: number) => (v + BOARD / 2) * ppu; // world -> canvas

  // Green felt field with a soft vignette.
  const felt = c.createRadialGradient(cx, cy, inner * 0.1, cx, cy, inner * 0.75);
  felt.addColorStop(0, '#2F7357');
  felt.addColorStop(1, '#245C45');
  c.fillStyle = felt;
  c.fillRect(x0, x0, inner, inner);
  // Cream inset border.
  c.strokeStyle = 'rgba(239,228,203,0.9)';
  c.lineWidth = ppu * 0.05;
  c.strokeRect(x0 + ppu * 0.12, x0 + ppu * 0.12, inner - ppu * 0.24, inner - ppu * 0.24);
  c.strokeStyle = 'rgba(239,228,203,0.35)';
  c.lineWidth = ppu * 0.015;
  c.strokeRect(x0 + ppu * 0.22, x0 + ppu * 0.22, inner - ppu * 0.44, inner - ppu * 0.44);

  // City blocks (pavement) and parks.
  const rect = (r: Rect, fill: string, radius = 0.08) => {
    c.fillStyle = fill;
    roundRect(c, P(r.x0), P(r.z0), (r.x1 - r.x0) * ppu, (r.z1 - r.z0) * ppu, radius * ppu);
    c.fill();
  };
  for (const b of CITY_BLOCKS) rect({ x0: b.x0 - 0.1, z0: b.z0 - 0.1, x1: b.x1 + 0.1, z1: b.z1 + 0.1 }, '#D8D1C1');
  for (const p of CITY_PARKS) {
    rect({ x0: p.x0 - 0.08, z0: p.z0 - 0.08, x1: p.x1 + 0.08, z1: p.z1 + 0.08 }, '#D8D1C1', 0.12);
    rect(p, '#78B77F', 0.1);
  }

  // Roads with sidewalks and dashed center lines.
  for (const r of CITY_ROADS) rect({ x0: r.x0 - 0.06, z0: r.z0 - 0.06, x1: r.x1 + 0.06, z1: r.z1 + 0.06 }, '#D8D1C1', 0.04);
  for (const r of CITY_ROADS) rect(r, '#4C5661', 0.02);
  c.strokeStyle = 'rgba(246,240,224,0.9)';
  c.lineWidth = ppu * 0.025;
  c.setLineDash([ppu * 0.14, ppu * 0.12]);
  for (const r of CITY_ROADS) {
    c.beginPath();
    if (r.x1 - r.x0 > r.z1 - r.z0) {
      const z = P((r.z0 + r.z1) / 2);
      c.moveTo(P(r.x0) + ppu * 0.1, z);
      c.lineTo(P(r.x1) - ppu * 0.1, z);
    } else {
      const x = P((r.x0 + r.x1) / 2);
      c.moveTo(x, P(r.z0) + ppu * 0.1);
      c.lineTo(x, P(r.z1) - ppu * 0.6);
    }
    c.stroke();
  }
  c.setLineDash([]);
  // Zebra crossings where avenues meet Main Street.
  const main = CITY_ROADS[0] as Rect;
  c.fillStyle = 'rgba(246,240,224,0.9)';
  for (const r of CITY_ROADS.slice(1)) {
    for (let k = 0; k < 4; k++) c.fillRect(P(r.x0) + ppu * (0.05 + k * 0.12), P(main.z0) - ppu * 0.22, ppu * 0.06, ppu * 0.16);
  }

  // Shadow spots under the plaque, tray and decks help them sit on the felt.
  c.fillStyle = 'rgba(10,30,20,0.18)';
  c.beginPath();
  c.ellipse(P(PLAQUE.x), P(PLAQUE.z), (PLAQUE.w / 2 + 0.2) * ppu, (PLAQUE.d / 2 + 0.2) * ppu, PLAQUE.rot, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(P(DICE_TRAY.x), P(DICE_TRAY.z), (DICE_TRAY.w / 2 + 0.15) * ppu, (DICE_TRAY.d / 2 + 0.15) * ppu, 0, 0, Math.PI * 2);
  c.fill();
  void cy;
}

/** Paint the full board. size = canvas pixels (power of two recommended). */
export function paintBoard(board: BoardDef, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  const ppu = size / BOARD;
  c.fillStyle = SURFACE;
  c.fillRect(0, 0, size, size);
  drawCenter(c, size, ppu);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const groupColor = (g?: string) => board.groups.find((x) => x.id === g)?.color ?? '#999';
  for (const space of board.spaces) {
    const r = tileRect(space.index);
    const px = (r.cx + BOARD / 2) * ppu;
    const py = (r.cz + BOARD / 2) * ppu;
    c.save();
    c.translate(px, py);
    if (r.corner) {
      c.rotate(space.index === 20 || space.index === 30 ? Math.PI : 0);
      if (space.index === 30) c.rotate(Math.PI / 2);
      if (space.index === 20) c.rotate(-Math.PI / 2);
      drawCorner(c, space, ppu);
    } else {
      c.rotate(SIDE_ANGLE[r.side] ?? 0);
      drawTile(c, space, groupColor(space.group), ppu);
    }
    c.restore();
  }
  // Paper grain over everything, then a double outer border.
  const grain = paperPattern(c);
  if (grain) {
    c.fillStyle = grain;
    c.fillRect(0, 0, size, size);
  }
  c.strokeStyle = '#8F7748';
  c.lineWidth = ppu * 0.035;
  c.strokeRect(ppu * 0.0175, ppu * 0.0175, size - ppu * 0.035, size - ppu * 0.035);
  const inner = CORNER * ppu;
  c.strokeStyle = 'rgba(143,119,72,0.6)';
  c.lineWidth = ppu * 0.015;
  c.strokeRect(inner, inner, size - inner * 2, size - inner * 2);
  return canvas;
}
