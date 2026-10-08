/** Formatting helpers and the inline SVG token icons used in the HTML UI. */
import type { TokenId } from '@pe/game-core';

export function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

export const TOKEN_LABELS: Record<TokenId, string> = {
  pawn: 'Pawn',
  gem: 'Gem',
  rocket: 'Rocket',
  crown: 'Crown',
  star: 'Star',
  puck: 'Puck',
  tower: 'Tower',
  orb: 'Orb'
};

const PATHS: Record<TokenId, string> = {
  pawn: '<circle cx="12" cy="6.5" r="3.5"/><path d="M8.5 11h7l1.5 7h-10z"/><rect x="5.5" y="18" width="13" height="3" rx="1.5"/>',
  gem: '<path d="M6 4h12l4 6-10 11L2 10z"/>',
  rocket: '<path d="M12 2c3 2.5 4.5 6 4.5 10v5h-9v-5C7.5 8 9 4.5 12 2z"/><path d="M7.5 13l-3 4v3l3-2zM16.5 13l3 4v3l-3-2z"/><circle cx="12" cy="10" r="1.6" fill="#fff"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  star: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z"/>',
  puck: '<ellipse cx="12" cy="9" rx="9" ry="4"/><path d="M3 9v6c0 2.2 4 4 9 4s9-1.8 9-4V9c0 2.2-4 4-9 4s-9-1.8-9-4z"/>',
  tower: '<path d="M6 21V9h12v12z"/><path d="M5 9V4h3v2h2.5V4h3v2H16V4h3v5z"/>',
  orb: '<circle cx="12" cy="11" r="7.5"/><rect x="7" y="18" width="10" height="3" rx="1.5"/>'
};

/** SVG icon for a token in a given color. Built from fixed markup (no user data). */
export function tokenIcon(token: TokenId, color: string, size = 28): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'token-icon');
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('fill', /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#888');
  g.setAttribute('stroke', 'rgba(0,0,0,0.25)');
  g.setAttribute('stroke-width', '0.6');
  // PATHS are static constants defined above.
  g.innerHTML = PATHS[token] ?? PATHS.pawn;
  svg.append(g);
  return svg;
}

/** Pick black or white text for a background color. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return '#fff';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x as string, 16) / 255) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.62 ? '#253344' : '#ffffff';
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
