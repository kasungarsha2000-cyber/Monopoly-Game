import { networkInterfaces } from 'node:os';

/** IPv4 addresses of this machine that other devices on the LAN can reach. */
export function getLanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!addrs || /^(docker|br-|veth|virbr|vmnet|vboxnet)/i.test(name)) continue;
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // Prefer typical home/hotspot ranges first.
  return out.sort((a, b) => rank(a) - rank(b));
}

function rank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  if (ip.startsWith('172.')) return 2;
  return 3;
}
