/**
 * Runtime validation for untrusted input: actions arriving over the network
 * and save files loaded from disk or IndexedDB. Hand-written so the core has
 * no dependencies.
 */
import type { Action, GameState, RulesContext, TradeOffer } from './types';
import { BOARD_SIZE, defaultContext, isOwnable } from './board';
import { SCHEMA_VERSION } from './engine';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(o: Obj, allowed: string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

function isInt(v: unknown, min = -Infinity, max = Infinity): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isIntArray(v: unknown, maxLen: number, min: number, max: number): v is number[] {
  return Array.isArray(v) && v.length <= maxLen && v.every((x) => isInt(x, min, max));
}

const MONEY_MAX = 1_000_000_000;

function parseOffer(v: unknown): TradeOffer | null {
  if (!isObj(v)) return null;
  const keys = ['fromId', 'toId', 'offerCash', 'requestCash', 'offerSpaces', 'requestSpaces', 'offerJailCards', 'requestJailCards'];
  if (!hasOnlyKeys(v, keys)) return null;
  if (typeof v.fromId !== 'string' || v.fromId.length > 64) return null;
  if (typeof v.toId !== 'string' || v.toId.length > 64) return null;
  if (!isInt(v.offerCash, 0, MONEY_MAX) || !isInt(v.requestCash, 0, MONEY_MAX)) return null;
  if (!isInt(v.offerJailCards, 0, 10) || !isInt(v.requestJailCards, 0, 10)) return null;
  if (!isIntArray(v.offerSpaces, BOARD_SIZE, 0, BOARD_SIZE - 1)) return null;
  if (!isIntArray(v.requestSpaces, BOARD_SIZE, 0, BOARD_SIZE - 1)) return null;
  return {
    fromId: v.fromId,
    toId: v.toId,
    offerCash: v.offerCash,
    requestCash: v.requestCash,
    offerSpaces: [...v.offerSpaces],
    requestSpaces: [...v.requestSpaces],
    offerJailCards: v.offerJailCards,
    requestJailCards: v.requestJailCards
  };
}

const SIMPLE = new Set([
  'ROLL',
  'BUY',
  'DECLINE',
  'PASS_BID',
  'PAY_JAIL_FINE',
  'USE_JAIL_CARD',
  'PAY_DEBT',
  'DECLARE_BANKRUPTCY',
  'ACCEPT_TRADE',
  'REJECT_TRADE',
  'CANCEL_TRADE',
  'END_TURN'
]);
const SPACE_ACTIONS = new Set(['BUILD', 'SELL_BUILDING', 'SELL_GROUP_BUILDINGS', 'MORTGAGE', 'UNMORTGAGE']);

/**
 * Strictly parse an action. Extra fields are rejected, which is how the server
 * refuses client-authored dice, cash or ownership values.
 */
export function parseAction(v: unknown): Action | null {
  if (!isObj(v) || typeof v.type !== 'string') return null;
  const t = v.type;
  if (SIMPLE.has(t)) {
    return hasOnlyKeys(v, ['type']) ? ({ type: t } as Action) : null;
  }
  if (SPACE_ACTIONS.has(t)) {
    if (!hasOnlyKeys(v, ['type', 'space']) || !isInt(v.space, 0, BOARD_SIZE - 1)) return null;
    return { type: t, space: v.space } as Action;
  }
  if (t === 'BID') {
    if (!hasOnlyKeys(v, ['type', 'amount']) || !isInt(v.amount, 1, MONEY_MAX)) return null;
    return { type: 'BID', amount: v.amount };
  }
  if (t === 'PROPOSE_TRADE' || t === 'COUNTER_TRADE') {
    if (!hasOnlyKeys(v, ['type', 'offer'])) return null;
    const offer = parseOffer(v.offer);
    return offer ? { type: t, offer } : null;
  }
  return null;
}

/**
 * Validate a deserialized game state (e.g. a save file). Returns an error
 * message or null. Checks structure and the key invariants so a corrupted or
 * incompatible save is rejected gracefully instead of crashing the engine.
 */
export function validateGameState(v: unknown, ctx: RulesContext = defaultContext()): string | null {
  if (!isObj(v)) return 'Save data is not an object';
  if (v.schemaVersion !== SCHEMA_VERSION) return `Unsupported save version ${String(v.schemaVersion)}`;
  if (v.boardId !== ctx.board.id) return 'Save uses a different board';
  if (typeof v.gameId !== 'string') return 'Missing game id';
  if (!isInt(v.revision, 0)) return 'Invalid revision';
  if (!isObj(v.config)) return 'Missing config';
  if (!Array.isArray(v.players) || v.players.length < 2 || v.players.length > 8) return 'Invalid player list';
  const ids = new Set<string>();
  for (const p of v.players) {
    if (!isObj(p)) return 'Invalid player';
    if (typeof p.id !== 'string' || ids.has(p.id)) return 'Invalid player id';
    ids.add(p.id);
    if (typeof p.name !== 'string') return 'Invalid player name';
    if (p.kind !== 'human' && p.kind !== 'bot') return 'Invalid player kind';
    if (!isInt(p.cash, 0)) return `Invalid cash for ${p.name}`;
    if (!isInt(p.position, 0, BOARD_SIZE - 1)) return `Invalid position for ${p.name}`;
    if (typeof p.inJail !== 'boolean' || typeof p.bankrupt !== 'boolean') return 'Invalid player flags';
    if (!Array.isArray(p.jailCards)) return 'Invalid jail cards';
  }
  if (!Array.isArray(v.properties) || v.properties.length !== BOARD_SIZE) return 'Invalid property table';
  let housesOnBoard = 0;
  let hotelsOnBoard = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const prop = v.properties[i];
    const def = ctx.board.spaces[i];
    if (!def) return 'Board mismatch';
    if (!isOwnable(def)) {
      if (prop !== null) return `Space ${i} cannot be owned`;
      continue;
    }
    if (!isObj(prop)) return `Missing property ${i}`;
    if (prop.owner !== null && (typeof prop.owner !== 'string' || !ids.has(prop.owner))) return `Invalid owner for space ${i}`;
    if (!isInt(prop.houses, 0, 5)) return `Invalid buildings on space ${i}`;
    if (prop.houses > 0 && def.type !== 'street') return `Buildings on non-street ${i}`;
    if (prop.houses > 0 && prop.owner === null) return `Unowned buildings on ${i}`;
    if (typeof prop.mortgaged !== 'boolean') return `Invalid mortgage flag on ${i}`;
    if (prop.houses === 5) hotelsOnBoard++;
    else housesOnBoard += prop.houses;
  }
  if (!isObj(v.bank) || !isInt(v.bank.houses, 0) || !isInt(v.bank.hotels, 0)) return 'Invalid bank';
  const cfg = v.config;
  if (isInt(cfg.bankHouses) && v.bank.houses + housesOnBoard !== cfg.bankHouses) return 'House count mismatch';
  if (isInt(cfg.bankHotels) && v.bank.hotels + hotelsOnBoard !== cfg.bankHotels) return 'Hotel count mismatch';
  if (!isObj(v.decks) || !Array.isArray(v.decks.chance) || !Array.isArray(v.decks.community)) return 'Invalid decks';
  if (!isObj(v.turn) || typeof v.turn.playerId !== 'string' || !ids.has(v.turn.playerId)) return 'Invalid turn';
  const phases = ['AWAIT_ROLL', 'JAIL_DECISION', 'PROPERTY_DECISION', 'AUCTION', 'DEBT_RESOLUTION', 'TRADE', 'TURN_END', 'GAME_OVER'];
  if (typeof v.phase !== 'string' || !phases.includes(v.phase)) return 'Invalid phase';
  if (!Array.isArray(v.debts) || !Array.isArray(v.auctionQueue) || !Array.isArray(v.log)) return 'Invalid pending lists';
  if (!isInt(v.rngState, 0, 0xffffffff)) return 'Invalid RNG state';
  if (!isObj(v.stats)) return 'Invalid stats';
  return null;
}

/** Parse and validate a JSON save string. */
export function parseSavedGame(json: string, ctx: RulesContext = defaultContext()): { ok: true; state: GameState } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Save file is not valid JSON' };
  }
  const err = validateGameState(data, ctx);
  if (err) return { ok: false, error: err };
  return { ok: true, state: data as GameState };
}
