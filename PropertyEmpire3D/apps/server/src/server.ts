/**
 * HTTP + WebSocket server. One port serves:
 *   GET /health   - JSON health check
 *   GET /api/info - LAN addresses for invite links
 *   /ws           - WebSocket room protocol
 *   everything else - the production web build (when present)
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from '@pe/game-core';
import { RoomManager } from './rooms/RoomManager';
import type { ClientLink } from './rooms/Room';
import { SaveStore } from './saves';
import { isAllowedOrigin } from './network/origin';
import { TokenBucket } from './network/rateLimit';
import { createStaticHandler, SECURITY_HEADERS } from './network/static';
import { getLanAddresses } from './network/lanAddresses';

export const SERVER_VERSION = '1.0.0';

export interface GameServerOptions {
  port: number;
  host: string;
  /** Directory with the built web client, served when it exists. */
  webRoot?: string | null;
  saveDir?: string | null;
  allowedOrigins?: string[];
  botDelayMs?: number;
  maxRooms?: number;
  idleMs?: number;
  /** Per-connection command rate limit (token bucket). */
  rateLimit?: { burst: number; perSecond: number };
  log?: (msg: string) => void;
}

export interface GameServer {
  port: number;
  http: Server;
  rooms: RoomManager;
  close(): Promise<void>;
}

const MAX_CONNECTIONS = 400;

export async function createGameServer(opts: GameServerOptions): Promise<GameServer> {
  const log = opts.log ?? ((m: string) => console.log(`[server] ${m}`));
  const store = opts.saveDir ? new SaveStore(opts.saveDir) : null;
  await store?.init();
  const staticHandler = opts.webRoot ? createStaticHandler(opts.webRoot) : null;
  let actualPort = opts.port;

  const inviteBases = (pageOrigin: string | null): string[] => {
    const bases: string[] = [];
    let port = String(actualPort);
    let protocol = 'http:';
    if (pageOrigin) {
      try {
        const u = new URL(pageOrigin);
        protocol = u.protocol;
        port = u.port || (u.protocol === 'https:' ? '443' : '80');
        if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) bases.push(u.origin);
      } catch {
        /* ignore */
      }
    }
    const portPart = (protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443') ? '' : `:${port}`;
    for (const ip of getLanAddresses()) {
      const base = `${protocol}//${ip}${portPart}`;
      if (!bases.includes(base)) bases.push(base);
    }
    if (bases.length === 0) bases.push(`${protocol}//localhost${portPart}`);
    return bases;
  };

  const rooms = new RoomManager({
    store,
    botDelayMs: opts.botDelayMs ?? 700,
    maxRooms: opts.maxRooms ?? 100,
    idleMs: opts.idleMs ?? 30 * 60 * 1000,
    inviteBases,
    log
  });
  const restored = await rooms.restore();
  if (restored) log(`restored ${restored} saved room(s)`);
  rooms.startSweeper();

  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') {
      // Public, non-sensitive status; CORS lets a page on another LAN address check reachability.
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, name: 'property-empire', version: SERVER_VERSION, protocol: PROTOCOL_VERSION, rooms: rooms.rooms.size, uptime: Math.round(process.uptime()) }));
      return;
    }
    if (path === '/api/info') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ lanAddresses: getLanAddresses(), port: actualPort, wsPath: '/ws' }));
      return;
    }
    if (staticHandler && staticHandler(req, res)) return;
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end(staticHandler ? 'Not found' : 'Property Empire LAN server is running. Build the web client (npm run build) or use the Vite dev server.');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const allowed = opts.allowedOrigins ?? [];

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowed)) {
      log(`rejected WebSocket from origin ${String(req.headers.origin)}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (wss.clients.size >= MAX_CONNECTIONS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const bucket = new TokenBucket(opts.rateLimit?.burst ?? 40, opts.rateLimit?.perSecond ?? 20);
    let dropped = 0;
    let alive = true;
    const link: ClientLink = {
      id: randomUUID(),
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close(code = 1000, reason = '') {
        try {
          ws.close(code, reason);
        } catch {
          ws.terminate();
        }
      }
    };
    link.send({ type: 'HELLO', v: PROTOCOL_VERSION, server: 'property-empire', version: SERVER_VERSION });
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closed */
      }
    }, 20_000);
    heartbeat.unref?.();

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        link.send({ type: 'ERROR', reason: 'Binary messages are not supported' });
        return;
      }
      if (!bucket.take()) {
        dropped++;
        if (dropped > 100) link.close(1008, 'rate limit');
        else link.send({ type: 'ERROR', reason: 'Too many messages; slow down' });
        return;
      }
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        link.send({ type: 'ERROR', reason: 'Malformed message' });
        return;
      }
      if (msg.type === 'PING') {
        link.send({ type: 'PONG', ts: msg.ts });
        return;
      }
      if (msg.type === 'HELLO') return;
      if (msg.type === 'JOIN_REQUEST') {
        void rooms.join(link, msg).then((err) => {
          if (err) link.send({ type: 'JOIN_REJECTED', reason: err });
        });
        return;
      }
      const room = rooms.roomOf(link);
      if (!room) {
        link.send({ type: 'ERROR', reason: 'Join a room first' });
        return;
      }
      room.handle(link, msg);
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      rooms.disconnect(link);
    });
    ws.on('error', () => ws.terminate());
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const addr = http.address();
  if (addr && typeof addr === 'object') actualPort = addr.port;

  return {
    port: actualPort,
    http,
    rooms,
    async close() {
      await rooms.shutdown();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  };
}
