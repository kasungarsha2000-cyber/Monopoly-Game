/**
 * Property Empire 3D LAN server entry point.
 *
 *   node apps/server/dist/index.js [--lan] [--port 3001] [--host 0.0.0.0]
 *
 * --lan binds to 0.0.0.0 so phones and other computers on the same Wi-Fi or
 * hotspot can connect. Without it the server only listens on this computer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server';
import { getLanAddresses } from './network/lanAddresses';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const here = dirname(fileURLToPath(import.meta.url));
// Works from apps/server/src (tsx) and apps/server/dist (built).
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..', '..');
loadDotEnv(resolve(repoRoot, '.env'));

const lan = process.argv.includes('--lan');
const port = Number(arg('--port') ?? process.env.PE_PORT ?? 3001);
const host = arg('--host') ?? process.env.PE_HOST ?? (lan ? '0.0.0.0' : '127.0.0.1');
const webRoot = resolve(repoRoot, 'apps/web/dist');
const saveDir = resolve(repoRoot, process.env.PE_SAVE_DIR ?? 'apps/server/data/saves');
const allowedOrigins = (process.env.PE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const botDelayMs = Number(process.env.PE_BOT_DELAY_MS ?? 700);

const server = await createGameServer({ port, host, webRoot, saveDir, allowedOrigins, botDelayMs });
const servesWeb = existsSync(resolve(webRoot, 'index.html'));
console.log('');
console.log('  Property Empire 3D LAN server');
console.log(`  Health check:   http://localhost:${server.port}/health`);
if (servesWeb) console.log(`  Play here:      http://localhost:${server.port}/`);
if (host === '0.0.0.0' || host === '::') {
  const ips = getLanAddresses();
  if (ips.length) {
    for (const ip of ips) console.log(`  On your LAN:    http://${ip}:${server.port}/${servesWeb ? '' : '  (WebSocket at /ws)'}`);
    console.log('  Phones must be on the same Wi-Fi/hotspot. Allow Node through your firewall if they cannot connect.');
  } else {
    console.log('  No LAN address found. Connect to Wi-Fi or a hotspot to play with other devices.');
  }
} else {
  console.log(`  Listening on ${host} only. Start with --lan to let other devices join.`);
}
console.log(`  Saves:          ${saveDir}`);
console.log('');

const shutdown = async () => {
  console.log('Saving games and shutting down...');
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
