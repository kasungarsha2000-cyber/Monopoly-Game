#!/usr/bin/env node
/**
 * Development launcher: starts the LAN room server (tsx watch) and the Vite
 * dev server together, then prints the URLs to open.
 *
 *   npm run dev       -> this computer only (127.0.0.1)
 *   npm run dev:lan   -> reachable from phones on the same Wi-Fi/hotspot
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lan = process.argv.includes('--lan');
const serverPort = process.env.PE_PORT ?? '3001';
const webPort = process.env.PE_WEB_PORT ?? '5173';
const win = process.platform === 'win32';
const bin = (name) => join(root, 'node_modules', '.bin', win ? `${name}.cmd` : name);

const env = { ...process.env, PE_PORT: serverPort, PE_WEB_PORT: webPort, PE_LAN: lan ? '1' : '0' };
const children = [];
function run(label, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: win });
  const prefix = (line) => `[${label}] ${line}`;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) out.write(prefix(l) + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(prefix(`exited with code ${code}`));
    shutdown();
  });
  children.push(child);
}

function lanIps() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|vmnet|vboxnet)/i.test(name)) continue;
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGINT');
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', bin('tsx'), ['watch', 'apps/server/src/index.ts', ...(lan ? ['--lan'] : []), '--port', serverPort], root);
run('web', bin('vite'), ['--port', webPort, '--strictPort'], join(root, 'apps', 'web'));

setTimeout(() => {
  console.log('\n  Property Empire 3D (development)');
  console.log(`  Open on this computer:  http://localhost:${webPort}/`);
  if (lan) {
    const ips = lanIps();
    for (const ip of ips) console.log(`  Phones on your Wi-Fi:   http://${ip}:${webPort}/`);
    if (!ips.length) console.log('  No LAN address found: connect to Wi-Fi or a hotspot.');
    console.log('  If phones cannot connect, allow Node.js through your firewall (private networks).');
  } else {
    console.log('  Only this computer can connect. Use "npm run dev:lan" to let phones join.');
  }
  console.log('  Press Ctrl+C to stop.\n');
}, 1500);
