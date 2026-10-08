/**
 * One LAN room: lobby seats, connected clients, the authoritative game state,
 * bot scheduling, disconnect autopilot and saving. All game changes go
 * through `applyAction` from the shared rules engine.
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  applyAction,
  BotDriver,
  createGame,
  defaultContext,
  estimateAnimationMs,
  PLAYER_COLORS,
  redactStateForClient,
  resolveConfig,
  sanitizeName,
  TOKENS,
  type Action,
  type Difficulty,
  type GameEvent,
  type GameState,
  type LobbyConfig,
  type LobbyView,
  type SeatView,
  type ServerMessage,
  type TokenId,
  type ClientMessage
} from '@pe/game-core';
import type { RoomSave, SavedSeat } from '../saves';

export interface ClientLink {
  /** Unique connection id (for logging only). */
  readonly id: string;
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

export interface RoomOptions {
  botDelayMs: number;
  /** Persist the room; resolved when saved. */
  save: (data: RoomSave) => Promise<void>;
  /** LAN URLs for invites (without room query). */
  inviteBases: (pageOrigin: string | null) => string[];
  log: (msg: string) => void;
}

interface Seat extends SavedSeat {
  ready: boolean;
  connected: boolean;
  link: ClientLink | null;
  lastSeen: number;
}

const BOT_NAMES = ['Ada', 'Bruno', 'Cleo', 'Dexter', 'Elsa', 'Felix', 'Gigi', 'Hugo', 'Iris', 'Jules', 'Kai', 'Luna'];
const MAX_SEATS = 8;
const RECENT_ACTION_IDS = 64;
const LOBBY_GRACE_MS = 20_000;

export const DEFAULT_LOBBY_CONFIG: LobbyConfig = {
  gameName: 'LAN Game',
  presetId: 'classic',
  startingCash: 1500,
  maxRounds: 0,
  freeParkingJackpot: false,
  auctions: true,
  autopilotSeconds: 60
};

function tokenEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function newSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

export class Room {
  status: 'lobby' | 'playing' | 'finished' = 'lobby';
  hostId = '';
  config: LobbyConfig = { ...DEFAULT_LOBBY_CONFIG };
  state: GameState | null = null;
  lastActivity = Date.now();
  private seats: Seat[] = [];
  private pageOrigin: string | null = null;
  private readonly driver = new BotDriver({ seed: randomInt(0, 2 ** 31) });
  private botTimer: NodeJS.Timeout | null = null;
  private readonly autopilot = new Set<string>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly recentActions = new Map<string, string[]>();
  private lastEvents: GameEvent[] = [];
  private seatCounter = 0;
  private closed = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    readonly code: string,
    private readonly opts: RoomOptions
  ) {}

  /* ------------------------------------------------------------------ */
  /* Persistence                                                          */
  /* ------------------------------------------------------------------ */

  toSave(): RoomSave {
    return {
      version: 1,
      room: this.code,
      savedAt: Date.now(),
      status: this.status,
      hostId: this.hostId,
      config: this.config,
      seats: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        difficulty: s.difficulty,
        token: s.token,
        color: s.color,
        isHost: s.isHost,
        sessionToken: s.sessionToken
      })),
      state: this.state
    };
  }

  static fromSave(data: RoomSave, opts: RoomOptions): Room {
    const room = new Room(data.room, opts);
    room.status = data.status;
    room.hostId = data.hostId;
    room.config = { ...DEFAULT_LOBBY_CONFIG, ...data.config };
    room.state = data.state;
    room.seats = data.seats.map((s) => ({ ...s, ready: s.kind === 'bot', connected: s.kind === 'bot', link: null, lastSeen: 0 }));
    room.seatCounter = data.seats.length + 1;
    if (room.state) {
      for (const p of room.state.players) p.connected = p.kind === 'bot';
    }
    return room;
  }

  /** Queue a save; saves never overlap and failures are logged, never thrown. */
  save(): Promise<void> {
    const snapshot = this.toSave();
    this.saving = this.saving
      .then(() => this.opts.save(snapshot))
      .catch((err: unknown) => this.opts.log(`save failed for ${this.code}: ${String(err)}`));
    return this.saving;
  }

  /* ------------------------------------------------------------------ */
  /* Membership                                                           */
  /* ------------------------------------------------------------------ */

  connectedHumans(): number {
    return this.seats.filter((s) => s.kind === 'human' && s.connected).length;
  }

  isEmpty(): boolean {
    return this.connectedHumans() === 0;
  }

  private freeColor(): string {
    return PLAYER_COLORS.find((c) => !this.seats.some((s) => s.color === c)) ?? '#888888';
  }

  private freeToken(preferred?: TokenId, exceptSeat?: string): TokenId {
    const taken = new Set(this.seats.filter((s) => s.id !== exceptSeat).map((s) => s.token));
    if (preferred && !taken.has(preferred)) return preferred;
    return (TOKENS.find((t) => !taken.has(t)) ?? 'pawn') as TokenId;
  }

  private uniqueName(name: string, exceptSeat?: string): string {
    const taken = new Set(this.seats.filter((s) => s.id !== exceptSeat).map((s) => s.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 20; i++) {
      const candidate = `${name.slice(0, 17)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  /**
   * Handle a JOIN_REQUEST for this room (or the creation of it). Returns an
   * error string when the join is refused.
   */
  join(link: ClientLink, msg: Extract<ClientMessage, { type: 'JOIN_REQUEST' }>): string | null {
    if (this.closed) return 'This room has closed';
    if (msg.pageOrigin) this.pageOrigin = msg.pageOrigin;
    // Reconnect with a session token restores the original seat.
    if (msg.sessionToken) {
      const seat = this.seats.find((s) => s.sessionToken && tokenEquals(s.sessionToken, msg.sessionToken as string));
      if (seat) {
        this.attach(seat, link, true);
        return null;
      }
      if (this.status !== 'lobby') return 'Your seat could not be found. Ask the host for a new game.';
    }
    if (this.status !== 'lobby') return 'This game has already started';
    if (this.seats.length >= MAX_SEATS) return 'This room is full';
    const id = `h${this.seatCounter++}`;
    const seat: Seat = {
      id,
      name: this.uniqueName(sanitizeName(msg.name, `Player ${this.seats.length + 1}`)),
      kind: 'human',
      difficulty: null,
      token: this.freeToken(msg.token),
      color: this.freeColor(),
      isHost: this.seats.length === 0,
      sessionToken: newSessionToken(),
      ready: this.seats.length === 0,
      connected: true,
      link: null,
      lastSeen: Date.now()
    };
    if (seat.isHost) this.hostId = id;
    this.seats.push(seat);
    this.attach(seat, link, false);
    return null;
  }

  private attach(seat: Seat, link: ClientLink, reconnect: boolean): void {
    if (seat.link && seat.link !== link) {
      seat.link.send({ type: 'ERROR', reason: 'You connected from another tab or device.' });
      seat.link.close(4000, 'replaced');
    }
    seat.link = link;
    seat.connected = true;
    seat.lastSeen = Date.now();
    this.lastActivity = Date.now();
    const timer = this.disconnectTimers.get(seat.id);
    if (timer) clearTimeout(timer);
    this.disconnectTimers.delete(seat.id);
    this.autopilot.delete(seat.id);
    link.send({ type: 'JOIN_ACCEPTED', room: this.code, playerId: seat.id, sessionToken: seat.sessionToken as string, isHost: seat.isHost });
    this.broadcastLobby();
    if (this.state) {
      if (reconnect) this.broadcast({ type: 'PLAYER_RECONNECTED', playerId: seat.id });
      // setPresence broadcasts a fresh snapshot (including to this link) when presence changed.
      if (!this.setPresence(seat.id, true)) {
        link.send({ type: 'STATE_SNAPSHOT', rev: this.state.revision, state: redactStateForClient(this.state) });
      }
      this.scheduleBots();
    }
    this.opts.log(`room ${this.code}: ${seat.name} ${reconnect ? 'reconnected' : 'joined'}`);
  }

  /** A client's socket closed. */
  detach(link: ClientLink): void {
    const seat = this.seats.find((s) => s.link === link);
    if (!seat) return;
    seat.link = null;
    seat.connected = false;
    seat.lastSeen = Date.now();
    this.lastActivity = Date.now();
    if (this.status === 'lobby') {
      // Keep the seat briefly so a page reload can reclaim it, then free it.
      this.broadcastLobby();
      const timer = setTimeout(() => {
        this.disconnectTimers.delete(seat.id);
        if (!seat.connected) this.removeSeat(seat.id);
      }, LOBBY_GRACE_MS);
      timer.unref?.();
      this.disconnectTimers.set(seat.id, timer);
      return;
    }
    this.broadcast({ type: 'PLAYER_DISCONNECTED', playerId: seat.id });
    this.setPresence(seat.id, false);
    this.broadcastLobby();
    if (this.status === 'playing' && this.config.autopilotSeconds > 0) {
      const timer = setTimeout(() => {
        this.disconnectTimers.delete(seat.id);
        if (!seat.connected) {
          this.autopilot.add(seat.id);
          this.opts.log(`room ${this.code}: autopilot for ${seat.name}`);
          this.scheduleBots();
        }
      }, this.config.autopilotSeconds * 1000);
      timer.unref?.();
      this.disconnectTimers.set(seat.id, timer);
    }
    void this.save();
  }

  /** Update a player's connection flag in the game state. Returns true if a snapshot was broadcast. */
  private setPresence(seatId: string, connected: boolean): boolean {
    if (!this.state) return false;
    const p = this.state.players.find((pl) => pl.id === seatId);
    if (!p || p.connected === connected) return false;
    const next = structuredClone(this.state);
    const np = next.players.find((pl) => pl.id === seatId);
    if (np) np.connected = connected;
    next.revision = this.state.revision + 1;
    this.state = next;
    this.broadcast({ type: 'STATE_SNAPSHOT', rev: next.revision, state: redactStateForClient(next) });
    return true;
  }

  private removeSeat(seatId: string): void {
    const idx = this.seats.findIndex((s) => s.id === seatId);
    if (idx < 0) return;
    const [seat] = this.seats.splice(idx, 1);
    if (seat?.link) seat.link.close(4001, 'removed');
    if (seat?.isHost) {
      const next = this.seats.find((s) => s.kind === 'human');
      if (next) {
        next.isHost = true;
        next.ready = true;
        this.hostId = next.id;
        next.link?.send({ type: 'JOIN_ACCEPTED', room: this.code, playerId: next.id, sessionToken: next.sessionToken as string, isHost: true });
      } else {
        this.close('The host left the lobby');
        return;
      }
    }
    this.broadcastLobby();
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.botTimer) clearTimeout(this.botTimer);
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    for (const s of this.seats) {
      if (s.link) {
        s.link.send({ type: 'ERROR', reason });
        s.link.close(4002, 'room closed');
        s.link = null;
      }
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                             */
  /* ------------------------------------------------------------------ */

  /** Seat id for a connected link, if any. */
  seatFor(link: ClientLink): string | null {
    return this.seats.find((s) => s.link === link)?.id ?? null;
  }

  handle(link: ClientLink, msg: ClientMessage): void {
    const seat = this.seats.find((s) => s.link === link);
    if (!seat) {
      link.send({ type: 'ERROR', reason: 'Join a room first' });
      return;
    }
    seat.lastSeen = Date.now();
    this.lastActivity = Date.now();
    const isHost = seat.id === this.hostId;
    const hostOnly = () => {
      link.send({ type: 'ERROR', reason: 'Only the host can do that' });
    };
    const lobbyOnly = () => {
      link.send({ type: 'ERROR', reason: 'The game has already started' });
    };
    switch (msg.type) {
      case 'PLAYER_READY':
        if (this.status !== 'lobby') return lobbyOnly();
        seat.ready = seat.isHost ? true : msg.ready;
        this.broadcastLobby();
        return;
      case 'UPDATE_PROFILE':
        if (this.status !== 'lobby') return lobbyOnly();
        if (msg.name !== undefined) seat.name = this.uniqueName(sanitizeName(msg.name, seat.name), seat.id);
        if (msg.token !== undefined) seat.token = this.freeToken(msg.token, seat.id);
        this.broadcastLobby();
        return;
      case 'LOBBY_CONFIG': {
        if (!isHost) return hostOnly();
        if (this.status !== 'lobby') return lobbyOnly();
        const c = msg.config;
        const ctx = defaultContext();
        if (c.gameName !== undefined) this.config.gameName = sanitizeName(c.gameName, this.config.gameName);
        if (c.presetId !== undefined && ctx.rules.presets.some((p) => p.id === c.presetId)) {
          this.config.presetId = c.presetId;
          const preset = resolveConfig(ctx, c.presetId);
          this.config.startingCash = preset.startingCash;
          this.config.maxRounds = preset.maxRounds;
          this.config.freeParkingJackpot = preset.freeParkingJackpot;
          this.config.auctions = preset.auctions;
        }
        if (c.startingCash !== undefined) this.config.startingCash = Math.min(10000, Math.max(500, c.startingCash));
        if (c.maxRounds !== undefined) this.config.maxRounds = Math.min(500, Math.max(0, c.maxRounds));
        if (c.freeParkingJackpot !== undefined) this.config.freeParkingJackpot = c.freeParkingJackpot;
        if (c.auctions !== undefined) this.config.auctions = c.auctions;
        if (c.autopilotSeconds !== undefined) this.config.autopilotSeconds = Math.min(600, Math.max(0, c.autopilotSeconds));
        this.broadcastLobby();
        return;
      }
      case 'ADD_BOT': {
        if (!isHost) return hostOnly();
        if (this.status !== 'lobby') return lobbyOnly();
        if (this.seats.length >= MAX_SEATS) {
          link.send({ type: 'ERROR', reason: 'The room is full' });
          return;
        }
        const used = new Set(this.seats.map((s) => s.name));
        const fallback = BOT_NAMES.find((n) => !used.has(`${n} (bot)`)) ?? 'Bot';
        const name = this.uniqueName(sanitizeName(msg.name, `${fallback} (bot)`));
        this.seats.push({
          id: `b${this.seatCounter++}`,
          name,
          kind: 'bot',
          difficulty: msg.difficulty,
          token: this.freeToken(),
          color: this.freeColor(),
          isHost: false,
          sessionToken: null,
          ready: true,
          connected: true,
          link: null,
          lastSeen: Date.now()
        });
        this.broadcastLobby();
        return;
      }
      case 'REMOVE_SEAT': {
        if (!isHost) return hostOnly();
        if (this.status !== 'lobby') return lobbyOnly();
        if (msg.seatId === seat.id) return;
        this.removeSeat(msg.seatId);
        return;
      }
      case 'SET_BOT_DIFFICULTY': {
        if (!isHost) return hostOnly();
        if (this.status !== 'lobby') return lobbyOnly();
        const bot = this.seats.find((s) => s.id === msg.seatId && s.kind === 'bot');
        if (bot) bot.difficulty = msg.difficulty;
        this.broadcastLobby();
        return;
      }
      case 'START_GAME': {
        if (!isHost) return hostOnly();
        const blocker = this.startBlocker();
        if (blocker) {
          link.send({ type: 'ERROR', reason: blocker });
          return;
        }
        this.startGame();
        return;
      }
      case 'REQUEST_ACTION':
        this.handleAction(seat, msg.id, msg.action);
        return;
      case 'STATE_RESYNC_REQUEST':
        if (this.state) link.send({ type: 'STATE_SNAPSHOT', rev: this.state.revision, state: redactStateForClient(this.state) });
        else link.send({ type: 'LOBBY_UPDATE', lobby: this.lobbyView() });
        return;
      case 'SAVE_GAME':
        if (!isHost) return hostOnly();
        void this.save().then(() => link.send({ type: 'SAVED', at: Date.now() }));
        return;
      case 'LEAVE':
        if (this.status === 'lobby') this.removeSeat(seat.id);
        else link.close(1000, 'left');
        return;
      default:
        return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lobby                                                                */
  /* ------------------------------------------------------------------ */

  startBlocker(): string | null {
    if (this.status !== 'lobby') return 'The game has already started';
    if (this.seats.length < 2) return 'Add at least one more player or bot';
    if (this.seats.length > MAX_SEATS) return 'Too many players';
    const away = this.seats.filter((s) => s.kind === 'human' && !s.connected);
    if (away.length) return `Waiting for ${away.map((s) => s.name).join(', ')} to reconnect`;
    const waiting = this.seats.filter((s) => s.kind === 'human' && !s.isHost && !s.ready);
    if (waiting.length) return `Waiting for ${waiting.map((s) => s.name).join(', ')} to be ready`;
    return null;
  }

  lobbyView(): LobbyView {
    const seats: SeatView[] = this.seats.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      difficulty: s.difficulty,
      token: s.token,
      color: s.color,
      ready: s.ready,
      connected: s.connected,
      isHost: s.isHost
    }));
    const blocker = this.startBlocker();
    return {
      room: this.code,
      status: this.status,
      hostId: this.hostId,
      seats,
      config: this.config,
      maxPlayers: MAX_SEATS,
      inviteUrls: this.opts.inviteBases(this.pageOrigin).map((base) => `${base}/?room=${this.code}`),
      canStart: blocker === null,
      startBlocker: blocker
    };
  }

  broadcastLobby(): void {
    const lobby = this.lobbyView();
    this.broadcast({ type: 'LOBBY_UPDATE', lobby });
  }

  broadcast(msg: ServerMessage): void {
    for (const s of this.seats) s.link?.send(msg);
  }

  private startGame(): void {
    const { state, events } = createGame({
      players: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        token: s.token,
        color: s.color,
        ...(s.difficulty ? { difficulty: s.difficulty } : {})
      })),
      presetId: this.config.presetId,
      config: {
        startingCash: this.config.startingCash,
        maxRounds: this.config.maxRounds,
        freeParkingJackpot: this.config.freeParkingJackpot,
        auctions: this.config.auctions
      },
      seed: randomInt(0, 2 ** 32 - 1),
      gameId: `lan-${this.code}-${Date.now().toString(36)}`
    });
    this.state = state;
    this.status = 'playing';
    this.lastEvents = events;
    this.broadcastLobby();
    this.broadcast({ type: 'GAME_START', rev: state.revision, state: redactStateForClient(state), events });
    this.opts.log(`room ${this.code}: game started with ${this.seats.length} players`);
    void this.save();
    this.scheduleBots();
  }

  /* ------------------------------------------------------------------ */
  /* Game actions                                                         */
  /* ------------------------------------------------------------------ */

  private handleAction(seat: Seat, actionId: string, action: Action): void {
    const link = seat.link;
    if (!link) return;
    if (this.status !== 'playing' || !this.state) {
      link.send({ type: 'ACTION_REJECTED', id: actionId, reason: 'No game is running' });
      return;
    }
    const recent = this.recentActions.get(seat.id) ?? [];
    if (recent.includes(actionId)) {
      link.send({ type: 'ACTION_REJECTED', id: actionId, reason: 'Duplicate action ignored' });
      return;
    }
    recent.push(actionId);
    if (recent.length > RECENT_ACTION_IDS) recent.shift();
    this.recentActions.set(seat.id, recent);

    const result = applyAction(this.state, seat.id, action);
    if (!result.ok) {
      link.send({ type: 'ACTION_REJECTED', id: actionId, reason: result.error });
      return;
    }
    link.send({ type: 'ACTION_ACCEPTED', id: actionId, rev: result.state.revision });
    this.commit(seat.id, result.state, result.events);
  }

  private commit(actorId: string, state: GameState, events: GameEvent[]): void {
    this.state = state;
    this.lastEvents = events;
    this.lastActivity = Date.now();
    this.broadcast({ type: 'GAME_EVENT', rev: state.revision, actorId, events, state: redactStateForClient(state) });
    const important = events.some((e) =>
      ['TURN_ENDED', 'TURN_STARTED', 'PROPERTY_BOUGHT', 'AUCTION_WON', 'TRADE_ACCEPTED', 'BANKRUPT', 'GAME_OVER', 'BUILT'].includes(e.type)
    );
    if (state.phase === 'GAME_OVER') {
      this.status = 'finished';
      this.broadcast({ type: 'GAME_ENDED', winnerId: state.winnerId, reason: state.endReason ?? 'Game over' });
      this.broadcastLobby();
      this.opts.log(`room ${this.code}: game over`);
    }
    if (important) void this.save();
    this.scheduleBots();
  }

  /** Schedule the next bot (or autopilot) action, paced so clients can animate. */
  scheduleBots(): void {
    if (this.botTimer || this.closed || this.status !== 'playing' || !this.state) return;
    if (this.connectedHumans() === 0) return; // pause when nobody is watching
    const actor = this.driver.actingBot(this.state, this.autopilot);
    if (!actor) return;
    const delay = this.opts.botDelayMs > 0 ? this.opts.botDelayMs + estimateAnimationMs(this.lastEvents) : 0;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (!this.state || this.status !== 'playing' || this.closed) return;
      const current = this.driver.actingBot(this.state, this.autopilot);
      if (!current) return;
      const isAutopilot = this.autopilot.has(current);
      const step = this.driver.step(this.state, current, isAutopilot ? ('medium' as Difficulty) : undefined);
      if (!step) {
        this.opts.log(`room ${this.code}: bot ${current} found no legal action in ${this.state.phase}`);
        return;
      }
      this.commit(current, step.state, step.events);
    }, delay);
  }

  /** For tests: snapshot of seat tokens is never exposed; only ids and names. */
  seatSummary(): { id: string; name: string; kind: string; connected: boolean }[] {
    return this.seats.map((s) => ({ id: s.id, name: s.name, kind: s.kind, connected: s.connected }));
  }
}
