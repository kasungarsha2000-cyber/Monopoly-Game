/** Small line-icon set (24x24, stroke = currentColor), built from fixed path data. */

const NS = 'http://www.w3.org/2000/svg';

type Shape = string | { d: string; fill?: boolean };

const ICONS: Record<string, Shape[]> = {
  house: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h13V10', 'M10 20v-5.5h4V20'],
  list: ['M9 6h12', 'M9 12h12', 'M9 18h12', { d: 'M3.5 6a1 1 0 1 0 2 0 1 1 0 1 0-2 0M3.5 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M3.5 18a1 1 0 1 0 2 0 1 1 0 1 0-2 0', fill: true }],
  trade: ['M4 8h14', 'M14 4l4 4-4 4', 'M20 16H6', 'M10 12l-4 4 4 4'],
  save: ['M5 3.5h11l3.5 3.5v13.5h-14.5z', 'M8 3.5v5h7v-5', 'M8 20.5v-6h8v6'],
  home: ['M3 12 12 4l9 8', 'M5.5 10.5V20h13v-9.5'],
  dice: ['M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z', { d: 'M7 8.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M14 15.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M10.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0', fill: true }],
  sliders: ['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1', 'M13 4v4', 'M7 10v4', 'M15 16v4'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.1.9-1.1 1.7v.5', { d: 'M11 17a1 1 0 1 0 2 0 1 1 0 1 0-2 0', fill: true }],
  pause: ['M8 5v14', 'M16 5v14'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4.5v4.5h4.5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  chevron: ['M6 9l6 6 6-6'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  log: ['M5 4.5h14v15H5z', 'M8.5 9h7', 'M8.5 12.5h7', 'M8.5 16h4'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  deed: ['M6 3.5h9l3.5 3.5v13.5H6z', 'M15 3.5V7h3.5', 'M9 11h6', 'M9 14.5h6', 'M9 18h3.5'],
  hammer: ['M14 6l4 4', 'M12.5 7.5 5 15l4 4 7.5-7.5', 'M13 4l7 7'],
  cash: ['M3.5 7h17v10h-17z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6.5 10v4', 'M17.5 10v4'],
  lock: ['M6 11h12v9.5H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  unlock: ['M6 11h12v9.5H6z', 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'],
  wifi: ['M2.5 9a14 14 0 0 1 19 0', 'M5.5 12.5a9.5 9.5 0 0 1 13 0', 'M8.7 16a5 5 0 0 1 6.6 0', { d: 'M11 19a1 1 0 1 0 2 0 1 1 0 1 0-2 0', fill: true }],
  gavel: ['M13.5 4.5l6 6', 'M11 7l6 6', 'M12 6 7 11', 'M7.5 10.5l-4 4 3 3 4-4', 'M14 20h7']
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const shape of ICONS[name] ?? []) {
    const p = document.createElementNS(NS, 'path');
    if (typeof shape === 'string') p.setAttribute('d', shape);
    else {
      p.setAttribute('d', shape.d);
      if (shape.fill) {
        p.setAttribute('fill', 'currentColor');
        p.setAttribute('stroke', 'none');
      }
    }
    svg.append(p);
  }
  return svg;
}
