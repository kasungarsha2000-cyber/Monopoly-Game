/**
 * Procedurally paints the whole board (all 40 tiles plus the center art) onto
 * one canvas, used as a single texture. One texture + one mesh keeps draw
 * calls minimal while staying crisp when zoomed in.
 */
import type { BoardDef, SpaceDef } from '@pe/game-core';
import { BOARD, CORNER, TILE, tileRect } from './layout';

const INK = '#253344';
const SURFACE = '#EFE4CB';
const TILE_BG = '#FBF7EE';
const LINE = '#C9B892';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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

function drawTile(c: CanvasRenderingContext2D, space: SpaceDef, groupColor: string, ppu: number): void {
  const w = TILE * ppu;
  const d = CORNER * ppu;
  const x0 = -w / 2;
  const y0 = -d / 2;
  c.fillStyle = TILE_BG;
  c.fillRect(x0, y0, w, d);
  c.strokeStyle = LINE;
  c.lineWidth = Math.max(1.5, ppu * 0.012);
  c.strokeRect(x0, y0, w, d);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  const nameSize = ppu * 0.15;
  const priceSize = ppu * 0.15;

  if (space.type === 'street') {
    const band = d * 0.22;
    c.fillStyle = groupColor;
    c.fillRect(x0, y0, w, band);
    c.strokeRect(x0, y0, w, band);
    c.fillStyle = INK;
    c.font = `700 ${nameSize}px ${FONT}`;
    const lines = wrap(c, space.shortName.toUpperCase(), w * 0.9);
    lines.forEach((l, i) => c.fillText(l, 0, y0 + band + nameSize * 1.0 + i * nameSize * 1.15));
    c.font = `600 ${priceSize}px ${FONT}`;
    c.fillText(`$${space.price}`, 0, d / 2 - priceSize * 1.0);
    return;
  }

  c.font = `700 ${nameSize}px ${FONT}`;
  const label = space.type === 'chance' ? 'FORTUNE' : space.type === 'community' ? 'COMMUNITY' : space.shortName.toUpperCase();
  const lines = wrap(c, label, w * 0.9);
  lines.forEach((l, i) => c.fillText(l, 0, y0 + nameSize * 1.1 + i * nameSize * 1.15));
  c.save();
  c.translate(0, y0 + d * 0.55);
  const icon =
    ICONS[space.id] ??
    (space.type === 'chance' ? iconQuestion : space.type === 'community' ? iconGift : space.type === 'tax' ? iconDiamond : null);
  icon?.(c, ppu * 0.42);
  c.restore();
  c.fillStyle = INK;
  if (space.type === 'transport' || space.type === 'utility') {
    c.font = `600 ${priceSize}px ${FONT}`;
    c.fillText(`$${space.price}`, 0, d / 2 - priceSize * 1.0);
  } else if (space.type === 'tax') {
    c.font = `600 ${priceSize}px ${FONT}`;
    c.fillText(`PAY $${space.amount}`, 0, d / 2 - priceSize * 1.0);
  }
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
  const grad = c.createRadialGradient(size / 2, size / 2, inner * 0.05, size / 2, size / 2, inner * 0.7);
  grad.addColorStop(0, '#F8F1E1');
  grad.addColorStop(1, '#EADBB9');
  c.fillStyle = grad;
  c.fillRect(x0, x0, inner, inner);

  // Decorative skyline.
  const base = size / 2 + inner * 0.12;
  const colors = ['#4B91D1', '#55B98A', '#EFB15E', '#E77979', '#A589CF', '#7FCBEA', '#F08C2E'];
  const widths = [0.07, 0.09, 0.06, 0.11, 0.08, 0.1, 0.07, 0.09, 0.06];
  const heights = [0.18, 0.3, 0.22, 0.4, 0.26, 0.34, 0.2, 0.28, 0.16];
  let x = size / 2 - inner * 0.37;
  widths.forEach((w, i) => {
    const bw = w * inner;
    const bh = (heights[i] as number) * inner;
    c.fillStyle = colors[i % colors.length] as string;
    roundRect(c, x, base - bh, bw - inner * 0.008, bh, inner * 0.008);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    for (let wy = base - bh + inner * 0.025; wy < base - inner * 0.03; wy += inner * 0.035) {
      for (let wx = x + inner * 0.012; wx < x + bw - inner * 0.025; wx += inner * 0.022) c.fillRect(wx, wy, inner * 0.01, inner * 0.016);
    }
    x += bw;
  });
  c.fillStyle = '#C9B892';
  c.fillRect(size / 2 - inner * 0.4, base, inner * 0.8, inner * 0.012);

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  c.font = `900 ${inner * 0.085}px ${FONT}`;
  c.fillText('PROPERTY', size / 2, size / 2 + inner * 0.2);
  c.fillStyle = '#4B91D1';
  c.fillText('EMPIRE', size / 2, size / 2 + inner * 0.29);
  c.fillStyle = '#6F7B88';
  c.font = `700 ${inner * 0.03}px ${FONT}`;
  c.fillText('BUY  ·  BUILD  ·  TRADE  ·  PROSPER', size / 2, size / 2 + inner * 0.355);

  // Card deck slots.
  const deck = (cx: number, cy: number, color: string, label: string) => {
    c.save();
    c.translate(cx, cy);
    c.rotate(-Math.PI / 4);
    c.strokeStyle = color;
    c.lineWidth = inner * 0.006;
    c.setLineDash([inner * 0.015, inner * 0.01]);
    roundRect(c, -inner * 0.11, -inner * 0.065, inner * 0.22, inner * 0.13, inner * 0.015);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = color;
    c.font = `800 ${inner * 0.028}px ${FONT}`;
    c.fillText(label, 0, 0);
    c.restore();
  };
  deck(size / 2 - inner * 0.28, size / 2 - inner * 0.3, '#A589CF', 'FORTUNE');
  deck(size / 2 + inner * 0.28, size / 2 - inner * 0.3, '#3A936A', 'COMMUNITY');
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
  c.strokeStyle = '#B9A57A';
  c.lineWidth = ppu * 0.03;
  c.strokeRect(0, 0, size, size);
  return canvas;
}
