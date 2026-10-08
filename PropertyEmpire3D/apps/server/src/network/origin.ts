/**
 * WebSocket origin checks. Browsers always send an Origin header on
 * WebSocket upgrades, so checking it stops a random public website open in a
 * player's browser from talking to the LAN server. Loopback, private LAN
 * addresses, mDNS .local names, the server's own host and explicitly
 * configured origins are allowed.
 */
import { isIP } from 'node:net';

export function isPrivateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) {
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:127.') || h.startsWith('::ffff:192.168.') || h.startsWith('::ffff:10.');
  }
  return false;
}

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

/**
 * @param origin Origin header (undefined for non-browser clients).
 * @param hostHeader Host header of the upgrade request.
 * @param extraAllowed Exact origins from configuration.
 */
export function isAllowedOrigin(origin: string | undefined, hostHeader: string | undefined, extraAllowed: readonly string[]): boolean {
  if (!origin) return true; // Non-browser clients (tests, tools) do not send Origin.
  if (extraAllowed.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isPrivateAddress(url.hostname)) return true;
  const host = hostnameOf(hostHeader);
  return host !== null && host.toLowerCase() === url.hostname.toLowerCase();
}
