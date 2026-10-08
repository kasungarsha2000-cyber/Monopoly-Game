import { h } from '../ui/dom';

/** Original Property Empire emblem (inline SVG built from constants). */
export function logoMark(size = 72): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'mark');
  svg.setAttribute('aria-hidden', 'true');
  const shapes: [string, Record<string, string>][] = [
    ['rect', { x: '2', y: '2', width: '60', height: '60', rx: '14', fill: '#253344' }],
    ['rect', { x: '10', y: '30', width: '12', height: '22', rx: '2', fill: '#4B91D1' }],
    ['rect', { x: '26', y: '18', width: '12', height: '34', rx: '2', fill: '#EFB15E' }],
    ['rect', { x: '42', y: '24', width: '12', height: '28', rx: '2', fill: '#55B98A' }],
    ['path', { d: 'M26 18 L32 10 L38 18 Z', fill: '#E77979' }]
  ];
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

export function logo(subtitle?: string): HTMLElement {
  return h(
    'div',
    { class: 'logo' },
    logoMark(),
    h('h1', {}, 'Property ', h('span', {}, 'Empire'), ' 3D'),
    subtitle ? h('p', {}, subtitle) : null
  );
}

export function backHeader(title: string, onBack: () => void): HTMLElement {
  const back = h('button', { type: 'button', class: 'btn ghost icon', 'aria-label': 'Back' }, '←');
  back.addEventListener('click', onBack);
  return h('div', { class: 'card-head' }, back, h('h2', {}, title));
}
