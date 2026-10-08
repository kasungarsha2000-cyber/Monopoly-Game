/** Minimal WebSocket test client for the LAN protocol. */
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@pe/game-core';

type Msg = ServerMessage;

export class TestClient {
  readonly messages: Msg[] = [];
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  closed = false;
  closeCode: number | null = null;
  private cursor = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Msg;
      this.messages.push(msg);
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          clearTimeout(w.timer);
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
    ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
    });
  }

  static connect(url: string, origin?: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, origin ? { origin } : {});
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(data: string): void {
    this.ws.send(data);
  }

  /** Wait for the next message (after previously consumed ones) matching a predicate. */
  next<T extends Msg['type']>(type: T, pred: (m: Extract<Msg, { type: T }>) => boolean = () => true, timeoutMs = 5000): Promise<Extract<Msg, { type: T }>> {
    const match = (m: Msg) => m.type === type && pred(m as Extract<Msg, { type: T }>);
    for (let i = this.cursor; i < this.messages.length; i++) {
      const m = this.messages[i] as Msg;
      if (match(m)) {
        this.cursor = i + 1;
        return Promise.resolve(m as Extract<Msg, { type: T }>);
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          this.cursor = this.messages.length;
          resolve(m as Extract<Msg, { type: T }>);
        },
        reject,
        timer
      });
    });
  }

  last<T extends Msg['type']>(type: T): Extract<Msg, { type: T }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i] as Msg;
      if (m.type === type) return m as Extract<Msg, { type: T }>;
    }
    return undefined;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  waitClosed(timeoutMs = 5000): Promise<number | null> {
    return new Promise((resolve, reject) => {
      if (this.closed) return resolve(this.closeCode);
      const t = setTimeout(() => reject(new Error('not closed')), timeoutMs);
      this.ws.once('close', (code) => {
        clearTimeout(t);
        resolve(code);
      });
    });
  }
}
