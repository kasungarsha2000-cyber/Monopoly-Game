/**
 * LAN WebSocket protocol (schema version 1), shared by the Node room server
 * and the browser client. Clients only ever send *intents*; the server owns
 * dice, cash and every rule decision.
 */
import type { Action, Difficulty, GameEvent, GameState, TokenId } from './types';
import { parseAction } from './validation';
import { TOKENS } from './engine';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export interface LobbyConfig {
  gameName: string;
  presetId: string;
  startingCash: number;
  maxRounds: number;
  freeParkingJackpot: boolean;
  auctions: boolean;
  /** Seconds before a bot plays for a disconnected human. 0 = wait forever. */
  autopilotSeconds: number;
}

export interface SeatView {
  id: string;
  name: string;
  kind: 'human' | 'bot';
  difficulty: Difficulty | null;
  token: TokenId;
  color: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface LobbyView {
  room: string;
  status: 'lobby' | 'playing' | 'finished';
  hostId: string;
  seats: SeatView[];
  config: LobbyConfig;
  maxPlayers: number;
  /** URLs other devices can open to join (computed by the server from its LAN interfaces). */
  inviteUrls: string[];
  canStart: boolean;
  startBlocker: string | null;
}

export type ClientMessage =
  | { type: 'HELLO'; v: number }
  | { type: 'JOIN_REQUEST'; create: boolean; room?: string; name: string; token?: TokenId; sessionToken?: string; pageOrigin?: string }
  | { type: 'PLAYER_READY'; ready: boolean }
  | { type: 'UPDATE_PROFILE'; name?: string; token?: TokenId }
  | { type: 'LOBBY_CONFIG'; config: Partial<LobbyConfig> }
  | { type: 'ADD_BOT'; difficulty: Difficulty; name?: string }
  | { type: 'REMOVE_SEAT'; seatId: string }
  | { type: 'SET_BOT_DIFFICULTY'; seatId: string; difficulty: Difficulty }
  | { type: 'START_GAME' }
  | { type: 'REQUEST_ACTION'; id: string; action: Action }
  | { type: 'STATE_RESYNC_REQUEST' }
  | { type: 'SAVE_GAME' }
  | { type: 'LEAVE' }
  | { type: 'PING'; ts: number };

export type ServerMessage =
  | { type: 'HELLO'; v: number; server: 'property-empire'; version: string }
  | { type: 'JOIN_ACCEPTED'; room: string; playerId: string; sessionToken: string; isHost: boolean }
  | { type: 'JOIN_REJECTED'; reason: string }
  | { type: 'LOBBY_UPDATE'; lobby: LobbyView }
  | { type: 'GAME_START'; rev: number; state: GameState; events: GameEvent[] }
  | { type: 'ACTION_ACCEPTED'; id: string; rev: number }
  | { type: 'ACTION_REJECTED'; id: string; reason: string }
  | { type: 'GAME_EVENT'; rev: number; actorId: string; events: GameEvent[]; state: GameState }
  | { type: 'STATE_SNAPSHOT'; rev: number; state: GameState }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string }
  | { type: 'PLAYER_RECONNECTED'; playerId: string }
  | { type: 'GAME_ENDED'; winnerId: string | null; reason: string }
  | { type: 'SAVED'; at: number }
  | { type: 'ERROR'; reason: string }
  | { type: 'PONG'; ts: number };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: Obj, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const DIFFS: readonly string[] = ['easy', 'medium', 'hard'];
const isDifficulty = (v: unknown): v is Difficulty => typeof v === 'string' && DIFFS.includes(v);
const isToken = (v: unknown): v is TokenId => typeof v === 'string' && (TOKENS as readonly string[]).includes(v);

export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Normalize user-typed room codes (case, spaces, look-alike characters). */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

function parseLobbyConfig(v: unknown): Partial<LobbyConfig> | null {
  if (!isObj(v)) return null;
  const keys = ['gameName', 'presetId', 'startingCash', 'maxRounds', 'freeParkingJackpot', 'auctions', 'autopilotSeconds'];
  if (!onlyKeys(v, keys)) return null;
  const out: Partial<LobbyConfig> = {};
  if (v.gameName !== undefined) {
    if (!isStr(v.gameName, 40)) return null;
    out.gameName = v.gameName;
  }
  if (v.presetId !== undefined) {
    if (!isStr(v.presetId, 32)) return null;
    out.presetId = v.presetId;
  }
  for (const k of ['startingCash', 'maxRounds', 'autopilotSeconds'] as const) {
    if (v[k] === undefined) continue;
    const n = v[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) return null;
    out[k] = n;
  }
  for (const k of ['freeParkingJackpot', 'auctions'] as const) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== 'boolean') return null;
    out[k] = v[k] as boolean;
  }
  return out;
}

/** Strictly parse a client message. Returns null for anything malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || typeof v.type !== 'string') return null;
  switch (v.type) {
    case 'HELLO':
      return onlyKeys(v, ['type', 'v']) && typeof v.v === 'number' ? { type: 'HELLO', v: v.v } : null;
    case 'JOIN_REQUEST': {
      if (!onlyKeys(v, ['type', 'create', 'room', 'name', 'token', 'sessionToken', 'pageOrigin'])) return null;
      if (typeof v.create !== 'boolean' || !isStr(v.name, 64)) return null;
      const msg: ClientMessage = { type: 'JOIN_REQUEST', create: v.create, name: v.name };
      if (v.room !== undefined) {
        if (!isStr(v.room, 16)) return null;
        msg.room = v.room;
      }
      if (v.token !== undefined) {
        if (!isToken(v.token)) return null;
        msg.token = v.token;
      }
      if (v.sessionToken !== undefined) {
        if (!isStr(v.sessionToken, 128)) return null;
        msg.sessionToken = v.sessionToken;
      }
      if (v.pageOrigin !== undefined) {
        if (!isStr(v.pageOrigin, 200)) return null;
        msg.pageOrigin = v.pageOrigin;
      }
      return msg;
    }
    case 'PLAYER_READY':
      return onlyKeys(v, ['type', 'ready']) && typeof v.ready === 'boolean' ? { type: 'PLAYER_READY', ready: v.ready } : null;
    case 'UPDATE_PROFILE': {
      if (!onlyKeys(v, ['type', 'name', 'token'])) return null;
      const msg: { type: 'UPDATE_PROFILE'; name?: string; token?: TokenId } = { type: 'UPDATE_PROFILE' };
      if (v.name !== undefined) {
        if (!isStr(v.name, 64)) return null;
        msg.name = v.name;
      }
      if (v.token !== undefined) {
        if (!isToken(v.token)) return null;
        msg.token = v.token;
      }
      return msg;
    }
    case 'LOBBY_CONFIG': {
      if (!onlyKeys(v, ['type', 'config'])) return null;
      const config = parseLobbyConfig(v.config);
      return config ? { type: 'LOBBY_CONFIG', config } : null;
    }
    case 'ADD_BOT': {
      if (!onlyKeys(v, ['type', 'difficulty', 'name']) || !isDifficulty(v.difficulty)) return null;
      if (v.name !== undefined && !isStr(v.name, 64)) return null;
      return v.name !== undefined
        ? { type: 'ADD_BOT', difficulty: v.difficulty, name: v.name as string }
        : { type: 'ADD_BOT', difficulty: v.difficulty };
    }
    case 'REMOVE_SEAT':
      return onlyKeys(v, ['type', 'seatId']) && isStr(v.seatId, 64) ? { type: 'REMOVE_SEAT', seatId: v.seatId } : null;
    case 'SET_BOT_DIFFICULTY':
      return onlyKeys(v, ['type', 'seatId', 'difficulty']) && isStr(v.seatId, 64) && isDifficulty(v.difficulty)
        ? { type: 'SET_BOT_DIFFICULTY', seatId: v.seatId, difficulty: v.difficulty }
        : null;
    case 'START_GAME':
    case 'STATE_RESYNC_REQUEST':
    case 'SAVE_GAME':
    case 'LEAVE':
      return onlyKeys(v, ['type']) ? ({ type: v.type } as ClientMessage) : null;
    case 'REQUEST_ACTION': {
      if (!onlyKeys(v, ['type', 'id', 'action']) || !isStr(v.id, 64) || v.id.length === 0) return null;
      const action = parseAction(v.action);
      return action ? { type: 'REQUEST_ACTION', id: v.id, action } : null;
    }
    case 'PING':
      return onlyKeys(v, ['type', 'ts']) && typeof v.ts === 'number' ? { type: 'PING', ts: v.ts } : null;
    default:
      return null;
  }
}

/**
 * Remove information a client must not see: the RNG state (which would let
 * a client predict dice) and the hidden card order.
 */
export function redactStateForClient(state: GameState): GameState {
  return {
    ...state,
    rngState: 0,
    decks: { chance: state.decks.chance.map(() => 'hidden'), community: state.decks.community.map(() => 'hidden') }
  };
}

/** Rough number of milliseconds clients need to animate a batch of events. */
export function estimateAnimationMs(events: GameEvent[]): number {
  let ms = 0;
  for (const e of events) {
    if (e.type === 'DICE_ROLLED') ms += 1200;
    else if (e.type === 'MOVED') ms += e.direct ? 500 : Math.min(12, Math.abs(e.steps)) * 180 + 150;
    else if (e.type === 'CARD_DRAWN') ms += 1200;
    else if (e.type === 'BUILT' || e.type === 'PROPERTY_BOUGHT') ms += 300;
  }
  return Math.min(ms, 6000);
}
