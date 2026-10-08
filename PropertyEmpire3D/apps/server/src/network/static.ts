/**
 * Minimal, safe static file server for the production web build, so a single
 * Node process serves both the game page and the WebSocket on one LAN port.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'"
};

export function createStaticHandler(rootDir: string): ((req: IncomingMessage, res: ServerResponse) => boolean) | null {
  const root = resolve(rootDir);
  if (!existsSync(join(root, 'index.html'))) return null;
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return true;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400).end('Bad request');
      return true;
    }
    let file = resolve(root, '.' + normalize(pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return true;
    }
    let isFile = false;
    try {
      isFile = statSync(file).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      // SPA fallback for page routes (not for missing assets).
      if (extname(pathname)) {
        res.writeHead(404, SECURITY_HEADERS).end('Not found');
        return true;
      }
      file = join(root, 'index.html');
    }
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    createReadStream(file).pipe(res);
    return true;
  };
}
