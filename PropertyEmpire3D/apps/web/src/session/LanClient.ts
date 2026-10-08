/**
 * Browser side of the LAN protocol: one WebSocket to the host's Node server,
 * lobby state, automatic reconnect with the session token, and the
 * RemoteSession adapter used by the game screen.
 */
import {
  PROTOCOL_VERSION,
  type Action,
  type ClientMessage,
  type GameState,
  type LobbyView,
  type ServerMessage,
  type TokenId
} from '@pe/game-core';
import { Emitter, randomId, type GameSession, type GameUpdate } from './types';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface JoinParams {
  create: boolean;
  room?: string;
  name: string;
  token: TokenId;
  sessionToken?: string;
}

export interface StoredLanSession {
  room: string;
  playerId: string;
  sessionToken: string;
  wsUrl: string;
  name: string;
  at: number;
}

const STORE_KEY = 'pe.lan.last';

export function loadLanSession(): StoredLanSession | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredLanSession;
    if (Date.now() - s.at > 3 * 24 * 3600 * 1000) return null;
    return s;
  } catch {
    return null;
  }
}

function storeLanSession(s: StoredLanSession | null): void {
  try {
    if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Turn what the user typed (or nothing) into a WebSocket URL.
 * Empty -> same host as the page (works with the dev proxy and production server).
 */
export function buildWsUrl(serverInput: string): string {
  const secure = location.protocol === 'https:';
  const raw = serverInput.trim();
  if (!raw) return `${secure ? 'wss' : 'ws'}://${location.host}/ws`;
  let host = raw.replace(/^(https?|wss?):\/\//i, '').replace(/\/.*$/, '');
  const wantsSecure = /^(https|wss):/i.test(raw) || secure;
  if (!/:\d+$/.test(host) && !host.startsWith('[')) host = `${host}:3001`;
  return `${wantsSecure ? 'wss' : 'ws'}://${host}/ws`;
}

export class LanClient {
  status: ConnStatus = 'idle';
  lobby: LobbyView | null = null;
  playerId = '';
  isHost = false;
  room = '';
  state: GameState | null = null;
  readonly statusChanged = new Emitter<ConnStatus>();
  readonly lobbyChanged = new Emitter<LobbyView>();
  readonly joined = new Emitter<{ room: string; playerId: string; isHost: boolean }>();
  readonly rejected = new Emitter<string>();
  readonly game = new Emitter<GameUpdate>();
  readonly gameStarted = new Emitter<GameState>();
  readonly errors = new Emitter<string>();
  readonly notices = new Emitter<string>();
  private ws: WebSocket | null = null;
  private join: JoinParams | null = null;
  private sessionToken = '';
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private leaving = false;
  private everJoined = false;

  constructor(readonly wsUrl: string) {}

  private setStatus(s: ConnStatus): void {
    this.status = s;
    this.statusChanged.emit(s);
  }

  connect(params: JoinParams): void {
    this.join = params;
    if (params.sessionToken) this.sessionToken = params.sessionToken;
    this.leaving = false;
    this.open();
  }

  private open(): void {
    this.setStatus(this.everJoined ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch (e) {
      this.setStatus('closed');
      this.rejected.emit(`Invalid server address (${(e as Error).message})`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      this.send({ type: 'HELLO', v: PROTOCOL_VERSION });
      const p = this.join;
      if (!p) return;
      const msg: ClientMessage = { type: 'JOIN_REQUEST', create: p.create && !this.everJoined, name: p.name, token: p.token, pageOrigin: location.origin };
      const room = this.room || p.room;
      if (room) msg.room = room;
      if (this.sessionToken) msg.sessionToken = this.sessionToken;
      this.send(msg);
      this.pingTimer = window.setInterval(() => this.send({ type: 'PING', ts: Date.now() }), 15000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = (ev) => {
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (this.leaving) {
        this.setStatus('closed');
        return;
      }
      // 4000-4099: the server closed us on purpose; do not auto-reconnect.
      if (ev.code >= 4000 && ev.code < 4100) {
        this.leaving = true;
        this.setStatus('closed');
        const reasons: Record<number, string> = {
          4000: 'You joined this game from another tab or device.',
          4001: 'The host removed you from the room.',
          4002: 'The room was closed.'
        };
        this.rejected.emit(reasons[ev.code] ?? 'Disconnected by the host.');
        return;
      }
      if (!this.everJoined) {
        this.setStatus('closed');
        this.rejected.emit('Could not reach the host. Check the address, that the host server is running, and that both devices are on the same Wi-Fi.');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const delay = Math.min(15000, 800 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'JOIN_ACCEPTED':
        this.everJoined = true;
        this.room = msg.room;
        this.playerId = msg.playerId;
        this.isHost = msg.isHost;
        this.sessionToken = msg.sessionToken;
        storeLanSession({ room: msg.room, playerId: msg.playerId, sessionToken: msg.sessionToken, wsUrl: this.wsUrl, name: this.join?.name ?? '', at: Date.now() });
        this.joined.emit({ room: msg.room, playerId: msg.playerId, isHost: msg.isHost });
        break;
      case 'JOIN_REJECTED':
        this.leaving = true;
        if (this.everJoined) storeLanSession(null);
        this.rejected.emit(msg.reason);
        this.ws?.close();
        break;
      case 'LOBBY_UPDATE':
        this.lobby = msg.lobby;
        this.isHost = msg.lobby.hostId === this.playerId;
        this.lobbyChanged.emit(msg.lobby);
        break;
      case 'GAME_START':
        this.state = msg.state;
        this.gameStarted.emit(msg.state);
        this.game.emit({ state: msg.state, events: msg.events });
        break;
      case 'GAME_EVENT':
        if (this.state && msg.rev <= this.state.revision) return;
        this.state = msg.state;
        this.game.emit({ state: msg.state, events: msg.events });
        break;
      case 'STATE_SNAPSHOT': {
        const first = !this.state;
        if (this.state && msg.rev < this.state.revision) return;
        this.state = msg.state;
        if (first) this.gameStarted.emit(msg.state);
        this.game.emit({ state: msg.state, events: [], snapshot: true });
        break;
      }
      case 'ACTION_REJECTED':
        if (!/Duplicate/.test(msg.reason)) this.errors.emit(msg.reason);
        break;
      case 'ERROR':
        this.errors.emit(msg.reason);
        break;
      case 'PLAYER_DISCONNECTED':
        this.notices.emit(`${this.nameOf(msg.playerId)} disconnected`);
        break;
      case 'PLAYER_RECONNECTED':
        this.notices.emit(`${this.nameOf(msg.playerId)} is back`);
        break;
      case 'SAVED':
        this.notices.emit('The host saved the game');
        break;
      case 'GAME_ENDED':
        storeLanSession(null);
        break;
      default:
        break;
    }
  }

  private nameOf(id: string): string {
    return this.state?.players.find((p) => p.id === id)?.name ?? this.lobby?.seats.find((s) => s.id === id)?.name ?? 'A player';
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  dispatch(action: Action): void {
    if (this.status !== 'open') {
      this.errors.emit('Not connected to the host right now. Reconnecting...');
      return;
    }
    this.send({ type: 'REQUEST_ACTION', id: randomId(), action });
  }

  leave(): void {
    this.leaving = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.status === 'open' && !this.state) this.send({ type: 'LEAVE' });
    if (!this.state || this.state.phase === 'GAME_OVER') storeLanSession(null);
    this.ws?.close();
    this.setStatus('closed');
  }
}

/** Adapter exposing a LanClient as a GameSession for the game screen. */
export class RemoteSession implements GameSession {
  readonly kind = 'lan' as const;
  private unsubs: (() => void)[] = [];

  constructor(readonly client: LanClient) {}

  get localPlayerId(): string {
    return this.client.playerId;
  }

  get isHost(): boolean {
    return this.client.isHost;
  }

  get state(): GameState {
    if (!this.client.state) throw new Error('No game state yet');
    return this.client.state;
  }

  dispatch(action: Action): void {
    this.client.dispatch(action);
  }

  onUpdate(cb: (u: GameUpdate) => void): () => void {
    const off = this.client.game.on(cb);
    this.unsubs.push(off);
    return off;
  }

  onError(cb: (message: string) => void): () => void {
    const off = this.client.errors.on(cb);
    this.unsubs.push(off);
    return off;
  }

  notifyIdle(): void {
    /* The server paces bots itself. */
  }

  setPaused(): void {
    /* LAN games are shared; the host server keeps running. */
  }

  async save(): Promise<string> {
    if (!this.client.isHost) return 'Only the host can save a LAN game (it autosaves every turn).';
    this.client.send({ type: 'SAVE_GAME' });
    return 'Save requested on the host';
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
