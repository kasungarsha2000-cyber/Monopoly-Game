/**
 * Procedural SVG illustrations for title deeds and property thumbnails.
 * Shapes come from fixed geometry and board data (colors, prices); no player
 * text is ever placed into markup.
 */
import type { SpaceDef } from '@pe/game-core';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

type Attrs = Record<string, string | number>;

function el(tag: string, attrs: Attrs = {}, ...children: SVGElement[]): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
}

function root(w: number, h: number, cls: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  return svg;
}

/** Mix a hex color with white (t > 0) or black (t < 0). */
export function tint(hex: string, t: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => (t >= 0 ? c + (255 - c) * t : c * (1 + t)));
  return `rgb(${ch.map((c) => Math.round(c)).join(',')})`;
}

function tree(x: number, y: number, s: number, color = '#6DB57A'): SVGElement {
  return el(
    'g',
    {},
    el('rect', { x: x - 1.6 * s, y: y - 6 * s, width: 3.2 * s, height: 7 * s, rx: 1, fill: '#8A6A48' }),
    el('circle', { cx: x, cy: y - 12 * s, r: 9 * s, fill: color }),
    el('circle', { cx: x - 3 * s, cy: y - 15 * s, r: 3.2 * s, fill: 'rgba(255,255,255,0.25)' })
  );
}

/** A building with a window grid; base at (x, groundY). */
function tower(x: number, groundY: number, w: number, floors: number, color: string, opts: { hotel?: boolean } = {}): SVGElement {
  const floorH = 11;
  const h = floors * floorH + 8;
  const top = groundY - h;
  const g = el('g', {});
  g.append(
    el('rect', { x, y: top, width: w, height: h, rx: 2, fill: color }),
    el('rect', { x: x + w * 0.72, y: top, width: w * 0.28, height: h, fill: 'rgba(0,0,0,0.12)' }),
    el('rect', { x: x - 2, y: top - 4, width: w + 4, height: 5, rx: 1.5, fill: tint(color, -0.25) })
  );
  const cols = Math.max(2, Math.floor((w - 6) / 9));
  const gap = (w - 6) / cols;
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const lit = (f * 7 + c * 3) % 5 === 0;
      g.append(el('rect', { x: x + 4 + c * gap, y: top + 6 + f * floorH, width: gap - 3.5, height: 6.5, rx: 1, fill: lit ? '#FFE9A8' : 'rgba(255,255,255,0.78)' }));
    }
  }
  g.append(el('rect', { x: x + w / 2 - 4, y: groundY - 9, width: 8, height: 9, rx: 1, fill: tint(color, -0.4) }));
  if (opts.hotel) {
    g.append(el('rect', { x: x + w / 2 - 15, y: top - 14, width: 30, height: 10, rx: 3, fill: '#F2C14E' }), el('rect', { x: x + w / 2 - 1, y: top - 18, width: 2, height: 5, fill: '#8C949C' }));
  }
  return g;
}

function smallHouse(x: number, groundY: number, s = 1): SVGElement {
  const w = 18 * s;
  const h = 13 * s;
  return el(
    'g',
    {},
    el('rect', { x, y: groundY - h, width: w, height: h, fill: '#4CB36A' }),
    el('path', { d: `M${x - 2 * s} ${groundY - h} L${x + w / 2} ${groundY - h - 9 * s} L${x + w + 2 * s} ${groundY - h} Z`, fill: '#2F7D48' }),
    el('rect', { x: x + w / 2 - 2.5 * s, y: groundY - 7 * s, width: 5 * s, height: 7 * s, fill: '#7C5A3A' }),
    el('rect', { x: x + 2.5 * s, y: groundY - 10 * s, width: 4 * s, height: 3.5 * s, fill: '#FFF4C8' }),
    el('rect', { x: x + w - 6.5 * s, y: groundY - 10 * s, width: 4 * s, height: 3.5 * s, fill: '#FFF4C8' })
  );
}

function train(x: number, y: number, color: string): SVGElement {
  return el(
    'g',
    {},
    el('rect', { x, y: y - 26, width: 120, height: 26, rx: 8, fill: color }),
    el('rect', { x: x + 6, y: y - 21, width: 108, height: 10, rx: 3, fill: '#DCEBF5' }),
    el('rect', { x, y: y - 6, width: 120, height: 4, fill: tint(color, -0.3) }),
    el('circle', { cx: x + 20, cy: y + 2, r: 5, fill: '#334155' }),
    el('circle', { cx: x + 100, cy: y + 2, r: 5, fill: '#334155' })
  );
}

/** Illustration for the title-deed panel. */
export function deedArt(space: SpaceDef, groupColor: string, houses: number): SVGSVGElement {
  const W = 320;
  const H = 170;
  const svg = root(W, H, 'deed-art');
  const id = `sky${uid++}`;
  svg.append(
    el(
      'defs',
      {},
      el(
        'linearGradient',
        { id, x1: 0, y1: 0, x2: 0, y2: 1 },
        el('stop', { offset: 0, 'stop-color': '#E6F1F4' }),
        el('stop', { offset: 1, 'stop-color': '#F6F2E7' })
      )
    ),
    el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${id})` }),
    el('circle', { cx: 262, cy: 40, r: 26, fill: '#F7DB86', opacity: 0.85 }),
    el('circle', { cx: 262, cy: 40, r: 38, fill: '#F7DB86', opacity: 0.18 }),
    el('path', { d: `M0 128 Q 70 92 150 118 T ${W} 108 V ${H} H 0 Z`, fill: '#D3E6C7' }),
    el('path', { d: `M0 142 Q 90 116 190 136 T ${W} 128 V ${H} H 0 Z`, fill: '#C2DCB3' }),
    el('rect', { x: 0, y: 150, width: W, height: 20, fill: '#E7DFCB' })
  );
  const ground = 152;
  if (space.type === 'street') {
    const tierFloors = 5 + Math.round(((space.price ?? 100) - 60) / 70);
    const floors = houses === 5 ? tierFloors + 2 : tierFloors;
    svg.append(tree(34, ground, 1.1), tree(292, ground, 1.25));
    svg.append(tower(132, ground, 56, Math.min(floors, 10), groupColor, { hotel: houses === 5 }));
    const count = houses === 5 ? 0 : houses;
    for (let i = 0; i < count; i++) svg.append(smallHouse(84 + (i % 2) * 120 + Math.floor(i / 2) * 22 * (i % 2 ? 1 : -1), ground));
  } else if (space.type === 'transport') {
    svg.append(
      el('rect', { x: 70, y: 86, width: 180, height: 8, rx: 3, fill: tint(groupColor, -0.2) }),
      el('rect', { x: 80, y: 94, width: 6, height: 40, fill: '#9AA4AE' }),
      el('rect', { x: 234, y: 94, width: 6, height: 40, fill: '#9AA4AE' }),
      train(100, 146, '#4B91D1'),
      el('rect', { x: 0, y: 148, width: W, height: 3, fill: '#8C949C' }),
      tree(40, ground, 1)
    );
  } else if (space.type === 'utility') {
    if (space.id.includes('solar')) {
      for (let i = 0; i < 3; i++) {
        svg.append(el('path', { d: `M${70 + i * 66} 140 l14 -38 h44 l-14 38 z`, fill: '#2F4D6E' }), el('path', { d: `M${78 + i * 66} 132 l10 -24 h30`, stroke: '#7FA6C8', 'stroke-width': 2, fill: 'none' }));
      }
    } else {
      svg.append(
        el('rect', { x: 138, y: 98, width: 6, height: 52, fill: '#7C8A98' }),
        el('rect', { x: 176, y: 98, width: 6, height: 52, fill: '#7C8A98' }),
        el('ellipse', { cx: 160, cy: 84, rx: 40, ry: 24, fill: '#4B91D1' }),
        el('path', { d: 'M150 76 q10 -14 20 0 q-10 16 -20 0', fill: '#DCEBF5' })
      );
    }
    svg.append(tree(46, ground, 1.1), tree(280, ground, 1));
  } else {
    // Non-property spaces: a large emblem.
    const glyph: Record<string, string> = { chance: '?', community: '♥', tax: '$', go: 'GO', jail: '#', free_parking: 'P', go_to_jail: '!' };
    svg.append(
      el('circle', { cx: 160, cy: 92, r: 42, fill: groupColor }),
      el('circle', { cx: 160, cy: 92, r: 34, fill: 'none', stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 3 })
    );
    const t = el('text', { x: 160, y: 106, 'text-anchor': 'middle', 'font-size': space.type === 'go' ? 30 : 40, 'font-weight': 800, fill: '#ffffff', 'font-family': 'Outfit Variable, system-ui, sans-serif' });
    t.textContent = glyph[space.type] ?? '';
    svg.append(t, tree(60, ground, 1), tree(262, ground, 1.15));
  }
  return svg;
}

/** Small thumbnail for property lists. */
export function propertyThumb(space: SpaceDef, groupColor: string, houses: number): SVGSVGElement {
  const svg = root(56, 40, 'thumb');
  svg.append(el('rect', { x: 0, y: 0, width: 56, height: 40, rx: 8, fill: tint(groupColor, 0.78) }), el('rect', { x: 0, y: 31, width: 56, height: 9, fill: tint(groupColor, 0.6) }));
  if (space.type === 'street') {
    const floors = 2 + Math.round(((space.price ?? 100) - 60) / 120) + (houses === 5 ? 1 : 0);
    const top = 32 - floors * 6 - 2;
    svg.append(el('rect', { x: 18, y: top, width: 20, height: 32 - top, rx: 1.5, fill: groupColor }));
    for (let f = 0; f < floors; f++) for (let c = 0; c < 2; c++) svg.append(el('rect', { x: 21 + c * 8, y: top + 3 + f * 6, width: 5, height: 3, fill: 'rgba(255,255,255,0.85)' }));
    if (houses > 0 && houses < 5) for (let i = 0; i < houses; i++) svg.append(el('rect', { x: 5 + (i % 2) * 37, y: 26 - Math.floor(i / 2) * 0, width: 7, height: 6, fill: '#4CB36A' }));
    svg.append(el('circle', { cx: 46, cy: 25, r: 5, fill: '#6DB57A' }), el('circle', { cx: 10, cy: 26, r: 4, fill: '#6DB57A' }));
  } else if (space.type === 'transport') {
    svg.append(el('rect', { x: 8, y: 18, width: 40, height: 12, rx: 4, fill: '#4B91D1' }), el('rect', { x: 11, y: 20, width: 34, height: 4, rx: 1, fill: '#DCEBF5' }));
  } else {
    svg.append(el('circle', { cx: 28, cy: 21, r: 9, fill: space.id.includes('solar') ? '#F2C14E' : '#4B91D1' }));
  }
  return svg;
}
