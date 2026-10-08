/**
 * RulesEngine: the single entry point for changing a match.
 *
 *   applyAction(state, playerId, action) -> { ok, state, events } | { ok: false, error }
 *
 * The input state is never mutated. Every action is validated first (turn
 * ownership, phase, funds, rules) and then executed on a clone, after which
 * `settle` derives the next phase. The same code runs in the browser for solo
 * games and on the Node server for LAN games.
 */
import type {
  Action,
  ActionResult,
  GameEvent,
  GameState,
  PlayerSetup,
  RulesConfig,
  RulesContext,
  TradeOffer
} from './types';
import { defaultContext, isOwnable } from './board';
import { nextInt, randomSeed, shuffleInPlace } from './rng';
import { emptyStats, findPlayer, getPlayer } from './rules/helpers';
import {
  executeBuild,
  executeBuy,
  executeMortgage,
  executeSellBuilding,
  executeSellGroup,
  executeUnmortgage,
  validateBuild,
  validateBuy,
  validateMortgage,
  validateSellBuilding,
  validateSellGroup,
  validateUnmortgage
} from './rules/property';
import { auctionMinBid, currentBidder, passBid, placeBid, startAuction } from './rules/auction';
import { executeTrade, validateTradeOffer } from './rules/trade';
import { declareBankruptcy, payDebt } from './rules/bankruptcy';
import { endTurn, executePayJailFine, executeRoll, executeUseJailCard, settle, startTurn } from './rules/turn';
import { addLog } from './rules/helpers';

export const SCHEMA_VERSION = 1;
export const MAX_NAME_LENGTH = 20;
export const PLAYER_COLORS = ['#E15554', '#3E7CB1', '#3BA55C', '#F2A541', '#8E6CC0', '#2BB5B0', '#E86CA8', '#5B5F66'];
export const TOKENS = ['pawn', 'gem', 'rocket', 'crown', 'star', 'puck', 'tower', 'orb'] as const;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const LIMITS: Record<keyof RulesConfig, [number, number] | 'bool'> = {
  startingCash: [100, 100000],
  goSalary: [0, 10000],
  jailFine: [0, 10000],
  maxJailTurns: [1, 10],
  doublesToJail: [2, 10],
  auctions: 'bool',
  bankruptcyAuctions: 'bool',
  freeParkingJackpot: 'bool',
  bankHouses: [0, 200],
  bankHotels: [0, 100],
  mortgageInterestPercent: [0, 100],
  evenBuild: 'bool',
  minPlayers: [2, 8],
  maxPlayers: [2, 8],
  maxRounds: [0, 1000],
  maxTradeProposalsPerTurn: [0, 20]
};

/**
 * Merge rule defaults, an optional preset and overrides, clamping numbers to
 * safe ranges. Unknown keys and wrong types are ignored, so untrusted input
 * (e.g. from a LAN lobby) is safe to pass.
 */
export function resolveConfig(ctx: RulesContext, presetId?: string, overrides?: Partial<Record<string, unknown>>): RulesConfig {
  const preset = ctx.rules.presets.find((p) => p.id === presetId);
  const merged: Record<string, unknown> = { ...ctx.rules.defaults, ...(preset?.overrides ?? {}) };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!(key in LIMITS)) continue;
    merged[key] = value;
  }
  const out = { ...ctx.rules.defaults } as RulesConfig;
  for (const key of Object.keys(LIMITS) as (keyof RulesConfig)[]) {
    const lim = LIMITS[key];
    const v = merged[key];
    if (lim === 'bool') {
      if (typeof v === 'boolean') (out as unknown as Record<string, unknown>)[key] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      (out as unknown as Record<string, unknown>)[key] = Math.min(lim[1], Math.max(lim[0], Math.round(v)));
    }
  }
  if (out.minPlayers > out.maxPlayers) out.minPlayers = out.maxPlayers;
  return out;
}

/* ------------------------------------------------------------------ */
/* Game creation                                                       */
/* ------------------------------------------------------------------ */

export interface CreateGameOptions {
  players: PlayerSetup[];
  presetId?: string;
  config?: Partial<RulesConfig>;
  seed?: number;
  gameId?: string;
  now?: number;
}

export function sanitizeName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback;
  const clean = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean || fallback;
}

/** Create a new match. Throws if the player setup is invalid. */
export function createGame(opts: CreateGameOptions, ctx: RulesContext = defaultContext()): { state: GameState; events: GameEvent[] } {
  const config = resolveConfig(ctx, opts.presetId, opts.config as Partial<Record<string, unknown>>);
  const n = opts.players.length;
  if (n < config.minPlayers || n > config.maxPlayers) {
    throw new Error(`A game needs between ${config.minPlayers} and ${config.maxPlayers} players`);
  }
  const ids = new Set(opts.players.map((p) => p.id));
  if (ids.size !== n) throw new Error('Player ids must be unique');
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    gameId: opts.gameId ?? `game-${seed.toString(36)}-${Date.now().toString(36)}`,
    boardId: ctx.board.id,
    createdAt: opts.now ?? Date.now(),
    revision: 0,
    config,
    players: opts.players.map((p, i) => ({
      id: p.id,
      name: sanitizeName(p.name, `Player ${i + 1}`),
      kind: p.kind,
      difficulty: p.kind === 'bot' ? p.difficulty ?? 'medium' : null,
      token: p.token,
      color: p.color,
      cash: config.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
      connected: true
    })),
    properties: ctx.board.spaces.map((s) => (isOwnable(s) ? { owner: null, houses: 0, mortgaged: false } : null)),
    bank: { houses: config.bankHouses, hotels: config.bankHotels },
    decks: { chance: ctx.cards.chance.map((c) => c.id), community: ctx.cards.community.map((c) => c.id) },
    freeParkingPot: 0,
    phase: 'AWAIT_ROLL',
    turn: {
      playerId: opts.players[0]?.id ?? '',
      number: 0,
      rolled: false,
      extraRoll: false,
      doublesCount: 0,
      dice: null,
      actionCount: 0,
      tradeProposals: {}
    },
    round: 1,
    startSeat: 0,
    pendingPurchase: null,
    auction: null,
    auctionQueue: [],
    debts: [],
    trade: null,
    nextTradeId: 1,
    lastCard: null,
    winnerId: null,
    endReason: null,
    rngState: seed,
    stats: Object.fromEntries(opts.players.map((p) => [p.id, emptyStats()])),
    log: []
  };
  shuffleInPlace(state, state.decks.chance);
  shuffleInPlace(state, state.decks.community);
  const first = nextInt(state, 0, n - 1);
  state.startSeat = first;
  const events: GameEvent[] = [];
  const firstId = state.players[first]?.id ?? '';
  events.push({ type: 'GAME_STARTED', firstPlayerId: firstId });
  addLog(state, `New game with ${n} players. ${getPlayer(state, firstId).name} goes first.`);
  startTurn(state, firstId, events);
  settle(state, ctx, events);
  return { state, events };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const IDLE_PHASES = new Set(['AWAIT_ROLL', 'JAIL_DECISION', 'TURN_END']);

/** Can the player build or lift mortgages right now (their own turn, between decisions)? */
export function canDevelop(state: GameState, playerId: string): boolean {
  return IDLE_PHASES.has(state.phase) && state.turn.playerId === playerId;
}

/** Can the player sell buildings or mortgage right now (own turn, pending purchase, or own debt)? */
export function canManage(state: GameState, playerId: string): boolean {
  if (canDevelop(state, playerId)) return true;
  if (state.phase === 'PROPERTY_DECISION' && state.turn.playerId === playerId) return true;
  if (state.phase === 'DEBT_RESOLUTION' && state.debts[0]?.debtorId === playerId) return true;
  return false;
}

export function canProposeTrade(state: GameState, playerId: string): boolean {
  if (state.trade) return false;
  const p = findPlayer(state, playerId);
  if (!p || p.bankrupt) return false;
  const used = state.turn.tradeProposals[playerId] ?? 0;
  if (used >= state.config.maxTradeProposalsPerTurn) return false;
  if (IDLE_PHASES.has(state.phase)) return true;
  return state.phase === 'DEBT_RESOLUTION' && state.debts[0]?.debtorId === playerId;
}

/** Validate an action for a player. Returns an error message, or null when legal. */
export function validateAction(state: GameState, playerId: string, action: Action, ctx: RulesContext = defaultContext()): string | null {
  if (state.phase === 'GAME_OVER') return 'The game is over';
  const p = findPlayer(state, playerId);
  if (!p) return 'Unknown player';
  if (p.bankrupt) return 'You are bankrupt';
  const isCurrent = state.turn.playerId === playerId;
  const notYourTurn = 'It is not your turn';

  switch (action.type) {
    case 'ROLL':
      if (!isCurrent) return notYourTurn;
      if (state.phase !== 'AWAIT_ROLL' && state.phase !== 'JAIL_DECISION') return 'You cannot roll now';
      return null;
    case 'BUY':
      if (!isCurrent) return notYourTurn;
      if (state.phase !== 'PROPERTY_DECISION') return 'There is nothing to buy';
      return validateBuy(state, ctx, playerId);
    case 'DECLINE':
      if (!isCurrent) return notYourTurn;
      if (state.phase !== 'PROPERTY_DECISION') return 'There is nothing to decline';
      return null;
    case 'BID': {
      if (state.phase !== 'AUCTION') return 'No auction is running';
      if (currentBidder(state) !== playerId) return 'Wait for your turn to bid';
      if (!Number.isInteger(action.amount)) return 'Bids must be whole numbers';
      const min = auctionMinBid(state);
      if (action.amount < min) return `The minimum bid is $${min}`;
      if (action.amount > p.cash) return 'You cannot bid more cash than you have';
      return null;
    }
    case 'PASS_BID':
      if (state.phase !== 'AUCTION') return 'No auction is running';
      if (currentBidder(state) !== playerId) return 'Wait for your turn to bid';
      return null;
    case 'PAY_JAIL_FINE':
      if (!isCurrent) return notYourTurn;
      if (state.phase !== 'JAIL_DECISION' || !p.inJail) return 'You are not in Jail';
      if (p.cash < state.config.jailFine) return `You need $${state.config.jailFine}`;
      return null;
    case 'USE_JAIL_CARD':
      if (!isCurrent) return notYourTurn;
      if (state.phase !== 'JAIL_DECISION' || !p.inJail) return 'You are not in Jail';
      if (p.jailCards.length === 0) return 'You have no Get Out of Jail Free card';
      return null;
    case 'BUILD':
      if (!canDevelop(state, playerId)) return 'You can only build during your turn';
      return validateBuild(state, ctx, playerId, action.space);
    case 'SELL_BUILDING':
      if (!canManage(state, playerId)) return 'You cannot sell buildings right now';
      return validateSellBuilding(state, ctx, playerId, action.space);
    case 'SELL_GROUP_BUILDINGS':
      if (!canManage(state, playerId)) return 'You cannot sell buildings right now';
      return validateSellGroup(state, ctx, playerId, action.space);
    case 'MORTGAGE':
      if (!canManage(state, playerId)) return 'You cannot mortgage right now';
      return validateMortgage(state, ctx, playerId, action.space);
    case 'UNMORTGAGE':
      if (!canDevelop(state, playerId)) return 'You can only lift mortgages during your turn';
      return validateUnmortgage(state, ctx, playerId, action.space);
    case 'PAY_DEBT': {
      const debt = state.debts[0];
      if (state.phase !== 'DEBT_RESOLUTION' || !debt || debt.debtorId !== playerId) return 'You have no debt to pay';
      if (p.cash < debt.amount) return `Raise $${debt.amount - p.cash} more first`;
      return null;
    }
    case 'DECLARE_BANKRUPTCY': {
      const debt = state.debts[0];
      if (state.phase !== 'DEBT_RESOLUTION' || !debt || debt.debtorId !== playerId) return 'You have no debt';
      if (p.cash >= debt.amount) return 'You can afford this debt';
      return null;
    }
    case 'PROPOSE_TRADE':
      if (action.offer.fromId !== playerId) return 'You can only propose trades for yourself';
      if (!canProposeTrade(state, playerId)) return state.trade ? 'Another trade is pending' : 'You cannot propose a trade right now';
      return validateTradeOffer(state, ctx, action.offer);
    case 'ACCEPT_TRADE':
      if (state.phase !== 'TRADE' || !state.trade || state.trade.toId !== playerId) return 'No trade is waiting for you';
      return validateTradeOffer(state, ctx, state.trade);
    case 'REJECT_TRADE':
      if (state.phase !== 'TRADE' || !state.trade || state.trade.toId !== playerId) return 'No trade is waiting for you';
      return null;
    case 'CANCEL_TRADE':
      if (state.phase !== 'TRADE' || !state.trade || state.trade.fromId !== playerId) return 'You have no pending trade';
      return null;
    case 'COUNTER_TRADE':
      if (state.phase !== 'TRADE' || !state.trade || state.trade.toId !== playerId) return 'No trade is waiting for you';
      if (action.offer.fromId !== playerId || action.offer.toId !== state.trade.fromId) return 'A counteroffer must go back to the proposer';
      if (state.trade.counterCount >= 3) return 'Too many counteroffers; accept or reject';
      return validateTradeOffer(state, ctx, action.offer);
    case 'END_TURN':
      if (!isCurrent) return notYourTurn;
      if (state.phase !== 'TURN_END') return state.turn.extraRoll ? 'You rolled doubles: roll again' : 'You cannot end your turn yet';
      return null;
    default:
      return 'Unknown action';
  }
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

function cloneOffer(offer: TradeOffer): TradeOffer {
  return {
    fromId: offer.fromId,
    toId: offer.toId,
    offerCash: offer.offerCash,
    requestCash: offer.requestCash,
    offerSpaces: [...offer.offerSpaces],
    requestSpaces: [...offer.requestSpaces],
    offerJailCards: offer.offerJailCards,
    requestJailCards: offer.requestJailCards
  };
}

function execute(state: GameState, ctx: RulesContext, playerId: string, action: Action, events: GameEvent[]): void {
  switch (action.type) {
    case 'ROLL':
      executeRoll(state, ctx, playerId, events);
      break;
    case 'BUY':
      executeBuy(state, ctx, playerId, events);
      break;
    case 'DECLINE': {
      const space = state.pendingPurchase as number;
      state.pendingPurchase = null;
      if (state.config.auctions) startAuction(state, ctx, space, playerId, events);
      else addLog(state, `${getPlayer(state, playerId).name} declines to buy.`);
      break;
    }
    case 'BID':
      placeBid(state, ctx, playerId, action.amount, events);
      break;
    case 'PASS_BID':
      passBid(state, ctx, playerId, events);
      break;
    case 'PAY_JAIL_FINE':
      executePayJailFine(state, playerId, events);
      break;
    case 'USE_JAIL_CARD':
      executeUseJailCard(state, ctx, playerId, events);
      break;
    case 'BUILD':
      executeBuild(state, ctx, playerId, action.space, events);
      break;
    case 'SELL_BUILDING':
      executeSellBuilding(state, ctx, playerId, action.space, events);
      break;
    case 'SELL_GROUP_BUILDINGS':
      executeSellGroup(state, ctx, playerId, action.space, events);
      break;
    case 'MORTGAGE':
      executeMortgage(state, ctx, playerId, action.space, events);
      break;
    case 'UNMORTGAGE':
      executeUnmortgage(state, ctx, playerId, action.space, events);
      break;
    case 'PAY_DEBT':
      payDebt(state, ctx, playerId, events);
      break;
    case 'DECLARE_BANKRUPTCY':
      declareBankruptcy(state, ctx, playerId, events);
      break;
    case 'PROPOSE_TRADE': {
      const offer = cloneOffer(action.offer);
      state.trade = { ...offer, id: state.nextTradeId++, counterCount: 0 };
      state.turn.tradeProposals[playerId] = (state.turn.tradeProposals[playerId] ?? 0) + 1;
      events.push({ type: 'TRADE_PROPOSED', tradeId: state.trade.id, fromId: offer.fromId, toId: offer.toId, counter: false });
      addLog(state, `${getPlayer(state, offer.fromId).name} proposes a trade to ${getPlayer(state, offer.toId).name}.`);
      break;
    }
    case 'ACCEPT_TRADE': {
      const t = state.trade;
      if (!t) break;
      executeTrade(state, ctx, t, events);
      events.push({ type: 'TRADE_ACCEPTED', tradeId: t.id, fromId: t.fromId, toId: t.toId });
      state.trade = null;
      break;
    }
    case 'REJECT_TRADE': {
      const t = state.trade;
      if (!t) break;
      events.push({ type: 'TRADE_REJECTED', tradeId: t.id, fromId: t.fromId, toId: t.toId });
      addLog(state, `${getPlayer(state, t.toId).name} rejects the trade.`);
      state.trade = null;
      break;
    }
    case 'CANCEL_TRADE': {
      const t = state.trade;
      if (!t) break;
      events.push({ type: 'TRADE_CANCELLED', tradeId: t.id, fromId: t.fromId, toId: t.toId });
      addLog(state, `${getPlayer(state, t.fromId).name} withdraws the trade offer.`);
      state.trade = null;
      break;
    }
    case 'COUNTER_TRADE': {
      const t = state.trade;
      if (!t) break;
      const offer = cloneOffer(action.offer);
      state.trade = { ...offer, id: state.nextTradeId++, counterCount: t.counterCount + 1 };
      events.push({ type: 'TRADE_PROPOSED', tradeId: state.trade.id, fromId: offer.fromId, toId: offer.toId, counter: true });
      addLog(state, `${getPlayer(state, offer.fromId).name} makes a counteroffer.`);
      break;
    }
    case 'END_TURN':
      endTurn(state, ctx, events);
      break;
  }
}

/**
 * Apply an action for a player. Pure with respect to the input: returns a new
 * state and the events describing what happened, or an error.
 */
export function applyAction(state: GameState, playerId: string, action: Action, ctx: RulesContext = defaultContext()): ActionResult {
  const error = validateAction(state, playerId, action, ctx);
  if (error) return { ok: false, error };
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  execute(next, ctx, playerId, action, events);
  next.turn.actionCount++;
  settle(next, ctx, events);
  next.revision = state.revision + 1;
  return { ok: true, state: next, events };
}

/** Players who are expected to act right now (empty when the game is over). */
export function pendingActors(state: GameState): string[] {
  switch (state.phase) {
    case 'GAME_OVER':
      return [];
    case 'TRADE':
      return state.trade ? [state.trade.toId] : [];
    case 'DEBT_RESOLUTION':
      return state.debts[0] ? [state.debts[0].debtorId] : [];
    case 'AUCTION': {
      const b = currentBidder(state);
      return b ? [b] : [];
    }
    default:
      return [state.turn.playerId];
  }
}

/** Mark a player's network presence (server-side only; not a game action). */
export function setConnected(state: GameState, playerId: string, connected: boolean): GameState {
  const next = structuredClone(state);
  const p = findPlayer(next, playerId);
  if (p) p.connected = connected;
  return next;
}
